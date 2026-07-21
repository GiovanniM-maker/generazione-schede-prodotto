import 'server-only';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { isBlockedIp } from '@app/core';

// Fetch server-side SICURO contro SSRF (import da URL).
// - Solo http/https.
// - Risolve il DNS e BLOCCA IP privati/loopback/link-local/metadata cloud.
// - Segue i redirect a mano (max 3), rivalidando ogni hop.
// - Timeout + tetto sui byte scaricati.
//
// Nota: la protezione fa il lookup DNS e valida gli IP risolti; per l'MVP è la
// difesa giusta contro gli abusi ovvi (localhost, IP interni, 169.254.169.254).
// Il DNS-rebinding puro (record che cambia tra check e connessione) non è coperto.

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT = 'ScheduAI-Importer/1.0 (+import-url; rispetta robots)';

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  bytes: Uint8Array;
  error?: string;
}

/** Valida che l'hostname dell'URL risolva SOLO a IP pubblici. */
async function assertPublicHost(u: URL): Promise<string | null> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Sono ammessi solo URL http/https.';
  const host = u.hostname;
  // Se è già un IP letterale, validalo direttamente.
  if (net.isIP(host)) {
    return isBlockedIp(host) ? 'Indirizzo IP interno non consentito.' : null;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'Host interno non consentito.';
  }
  let addrs;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return 'Impossibile risolvere il dominio.';
  }
  if (addrs.length === 0) return 'Dominio senza indirizzi.';
  for (const a of addrs) {
    if (isBlockedIp(a.address)) return 'Il dominio punta a un indirizzo interno.';
  }
  return null;
}

/** Legge il body con un tetto massimo di byte (interrompe lo stream oltre il cap). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const lenHeader = res.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > maxBytes) {
    throw new Error('Contenuto troppo grande.');
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Contenuto troppo grande.');
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export async function safeFetch(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs?: number; accept?: string } = { maxBytes: 3_000_000 },
): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    return { ok: false, status: 0, finalUrl: rawUrl, contentType: '', bytes: new Uint8Array(0), error: 'URL non valido.' };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await assertPublicHost(current);
    if (blocked) {
      return { ok: false, status: 0, finalUrl: current.toString(), contentType: '', bytes: new Uint8Array(0), error: blocked };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: opts.accept ?? 'text/html,application/xhtml+xml',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout della richiesta.' : 'Richiesta fallita.';
      return { ok: false, status: 0, finalUrl: current.toString(), contentType: '', bytes: new Uint8Array(0), error: msg };
    }
    clearTimeout(timer);

    // Redirect: rivalida la destinazione e riprova.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return { ok: false, status: res.status, finalUrl: current.toString(), contentType: '', bytes: new Uint8Array(0), error: 'Redirect senza destinazione.' };
      }
      try {
        current = new URL(loc, current);
      } catch {
        return { ok: false, status: res.status, finalUrl: current.toString(), contentType: '', bytes: new Uint8Array(0), error: 'Redirect non valido.' };
      }
      continue;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      return { ok: false, status: res.status, finalUrl: current.toString(), contentType, bytes: new Uint8Array(0), error: `HTTP ${res.status}` };
    }
    let bytes: Uint8Array;
    try {
      bytes = await readCapped(res, opts.maxBytes);
    } catch (err) {
      return { ok: false, status: res.status, finalUrl: current.toString(), contentType, bytes: new Uint8Array(0), error: err instanceof Error ? err.message : 'Lettura fallita.' };
    }
    return { ok: true, status: res.status, finalUrl: current.toString(), contentType, bytes };
  }

  return { ok: false, status: 0, finalUrl: current.toString(), contentType: '', bytes: new Uint8Array(0), error: 'Troppi redirect.' };
}
