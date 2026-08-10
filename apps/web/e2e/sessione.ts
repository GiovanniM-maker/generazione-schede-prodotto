import { createServerClient } from '@supabase/ssr';
import type { BrowserContext, Cookie } from '@playwright/test';

// ---------------------------------------------------------------------------
// Sessione autenticata per i test con browser, SENZA scorciatoie nel prodotto.
//
// Il modo pigro sarebbe una rotta "/api/test-login" nell'app: una porta di
// servizio che poi resta li' per sempre e prima o poi diventa un buco. Qui
// invece la sessione si costruisce da FUORI:
//
//   1) si crea (o riusa) un utente di prova con l'API di amministrazione;
//   2) si ottiene una sessione vera con email+password;
//   3) si chiede a @supabase/ssr — la STESSA libreria che usa l'app — quali
//      cookie scriverebbe, e si mettono nel browser.
//
// Cosi' il formato dei cookie non e' indovinato: lo produce la libreria.
//
// ATTENZIONE: l'utente viene creato sul database configurato in .env.local.
// Se quello e' il database di produzione, questi test ci scrivono dentro. Per
// questo servono DUE consensi espliciti: la chiave di servizio e la variabile
// QA_ALLOW_WRITES. Senza, i test si saltano da soli.
// ---------------------------------------------------------------------------

export const EMAIL_DI_PROVA = 'qa+claude@example.invalid';

/** Perche' i test non possono girare, o null se possono. */
export function motivoPerSaltare(): string | null {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return 'manca SUPABASE_SERVICE_ROLE_KEY: impossibile creare l’utente di prova';
  }
  if (process.env.QA_ALLOW_WRITES !== '1') {
    return 'QA_ALLOW_WRITES non impostata: questi test scrivono sul database configurato';
  }
  return null;
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service || !anon) throw new Error('Configurazione Supabase incompleta');
  return { url, service, anon };
}

/** Password lunga e casuale: vive solo per la durata dei test. */
function passwordUsaEGetta(): string {
  return `qa-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-Aa1!`;
}

interface UtenteDiProva {
  id: string;
  email: string;
  cookies: Cookie[];
}

/**
 * Crea (o riusa) l'utente di prova e restituisce i cookie di sessione.
 * Se l'utente esiste gia', ne cambia la password: cosi' il test non dipende
 * da una password memorizzata da qualche parte.
 */
export async function creaUtenteDiProva(): Promise<UtenteDiProva> {
  const { url, service, anon } = config();
  const password = passwordUsaEGetta();
  const admin = (path: string, init?: RequestInit) =>
    fetch(`${url}/auth/v1/${path}`, {
      ...init,
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

  const risposta = await admin('admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL_DI_PROVA, password, email_confirm: true }),
  });
  let utente = (await risposta.json()) as { id?: string; email?: string };

  if (!risposta.ok) {
    // Esiste gia': recuperalo e reimposta la password.
    const elenco = (await (await admin('admin/users?page=1&per_page=200')).json()) as {
      users?: Array<{ id: string; email: string }>;
    };
    const trovato = (elenco.users ?? []).find((u) => u.email === EMAIL_DI_PROVA);
    if (!trovato) throw new Error(`Utente di prova non creabile: ${JSON.stringify(utente)}`);
    await admin(`admin/users/${trovato.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true }),
    });
    utente = trovato;
  }
  if (!utente.id) throw new Error('Utente di prova senza id');

  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL_DI_PROVA, password }),
  });
  const sessione = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
  if (!sessione.access_token || !sessione.refresh_token) {
    throw new Error('Accesso non riuscito per l’utente di prova');
  }

  // I cookie li produce la libreria dell'app, non li scriviamo a mano.
  const raccolti: Array<{ name: string; value: string }> = [];
  const memoria: Array<{ name: string; value: string }> = [];
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => memoria,
      setAll: (lista) => {
        for (const c of lista) {
          raccolti.push({ name: c.name, value: c.value });
          memoria.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  await client.auth.setSession({
    access_token: sessione.access_token,
    refresh_token: sessione.refresh_token,
  });
  if (raccolti.length === 0) throw new Error('Nessun cookie di sessione prodotto');

  return {
    id: utente.id,
    email: EMAIL_DI_PROVA,
    cookies: raccolti.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  };
}

export async function accedi(context: BrowserContext, utente: UtenteDiProva): Promise<void> {
  await context.addCookies(utente.cookies);
}

/**
 * Cancella l'utente di prova E le organizzazioni che ha creato.
 *
 * L'ordine conta: cancellare solo l'utente lascia l'organizzazione in piedi,
 * senza membri e senza nessuno che possa toccarla. (E' successo davvero, alla
 * prima versione di questo helper: quattro organizzazioni orfane.) L'azione
 * "elimina account" dell'app fa la stessa cosa nello stesso ordine — prima
 * l'organizzazione, con le cascate che portano via batch, prodotti e schede,
 * poi l'utente.
 */
export async function eliminaUtenteDiProva(userId: string): Promise<void> {
  const { url, service } = config();
  const intestazioni = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
  };

  const risposta = await fetch(
    `${url}/rest/v1/organization_members?user_id=eq.${userId}&select=organization_id`,
    { headers: intestazioni },
  );
  const membership = (await risposta.json()) as Array<{ organization_id: string }>;
  for (const m of membership) {
    await fetch(`${url}/rest/v1/organizations?id=eq.${m.organization_id}`, {
      method: 'DELETE',
      headers: intestazioni,
    });
  }

  await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  });
}
