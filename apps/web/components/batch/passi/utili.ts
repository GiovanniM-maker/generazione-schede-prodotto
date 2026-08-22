import { type PresetAttributeOption } from '@/lib/actions/batch-wizard';

// Le funzioncine di servizio del wizard.
//
// Nessuna di queste disegna niente: SHA-256 nel browser, il MIME dedotto
// dall'estensione, il messaggio di rete leggibile, e l'accostamento fra il
// nome di una colonna e quello di un attributo.
// ---------------------------------------------------------------------------

// SHA-256 esadecimale nel browser (stesso formato di createHash('sha256').digest('hex')
// lato server). Serve a registrare i file: la colonna sha256 è NOT NULL.
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Il browser a volte non riconosce il MIME (File.type = ''): lo deriviamo
// dall'estensione, così la colonna mime_type (NOT NULL) è sempre valorizzata.
export function mimeFromName(name: string, fallbackType: string): string {
  if (fallbackType && fallbackType.trim()) return fallbackType;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * Messaggio per un guaio di rete durante una server action.
 *
 * Senza questo l'errore restava un `Failed to fetch` inglese, o peggio: la
 * pagina restava su «Caricamento in corso…» per sempre, anche tornando
 * online, perché il `setBusy(false)` stava dopo un `await` che aveva lanciato.
 */
export function messaggioDiRete(e: unknown): string {
  const grezzo = e instanceof Error ? e.message : String(e);
  if (/fetch|network|load failed|connessione/i.test(grezzo)) {
    return 'Connessione persa. Controlla la rete e riprova: il lavoro fatto finora è salvo.';
  }
  return grezzo || 'Errore imprevisto. Riprova.';
}

export function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suggerisce l'header più simile a un attributo (match esatto poi contenuto). */
export function fuzzyHeader(attr: PresetAttributeOption, headers: string[]): string {
  const targets = [normalize(attr.name), attr.key ? normalize(attr.key) : ''].filter(Boolean);
  for (const h of headers) {
    if (targets.includes(normalize(h))) return h;
  }
  for (const h of headers) {
    const nh = normalize(h);
    if (targets.some((t) => t.length >= 4 && (nh.includes(t) || t.includes(nh)))) return h;
  }
  return '';
}
