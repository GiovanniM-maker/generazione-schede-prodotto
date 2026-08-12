// ---------------------------------------------------------------------------
// Gli errori dell'accesso, detti in italiano.
//
// `signInWithOtp` restituiva l'errore del fornitore così com'era, e quello che
// si leggeva sull'UNICA porta d'ingresso del prodotto era:
//
//     Email address "mario@" is invalid
//     email rate limit exceeded
//
// in mezzo a una pagina curata in italiano. Chi lo legge non capisce se ha
// sbagliato lui, se il prodotto è rotto, o se è stato bloccato — e nel caso del
// limite di invii la risposta è «riprova fra un minuto», che è un'informazione
// che nessuno gli stava dando.
//
// Due regole:
//
//   1. all'utente si dice cosa fare, non cosa è successo dentro;
//   2. il testo originale non si butta — finisce nei log del server, perché
//      quando qualcuno scriverà «non riesco a entrare» servirà.
//
// La corrispondenza si prova prima sul `code` (stabile, è un'interfaccia) e
// solo dopo sul messaggio (instabile, cambia con le versioni). Se non si
// riconosce niente si dice una cosa vera e generica: mai il testo grezzo.
// ---------------------------------------------------------------------------

export interface ErroreFornitore {
  message?: string;
  code?: string;
  status?: number;
}

const PER_CODICE: Record<string, string> = {
  over_email_send_rate_limit:
    'Abbiamo già inviato un codice a questo indirizzo da poco. Aspetta un minuto e riprova.',
  over_request_rate_limit:
    'Troppi tentativi in poco tempo. Aspetta un minuto e riprova.',
  email_address_invalid:
    'Questo indirizzo email non sembra valido. Controlla che sia scritto per intero.',
  email_address_not_authorized:
    'Non possiamo inviare email a questo indirizzo. Provane un altro, o scrivici.',
  validation_failed:
    'Questo indirizzo email non sembra valido. Controlla che sia scritto per intero.',
  otp_expired: 'Il codice è scaduto. Richiedine uno nuovo.',
  signup_disabled: 'Le nuove iscrizioni sono momentaneamente sospese.',
  email_provider_disabled:
    'L’accesso via email non è attivo in questo momento. Riprova più tardi.',
  user_banned: 'Questo account è sospeso. Scrivici per riattivarlo.',
};

/** Il messaggio del fornitore cambia con le versioni: qui è l'ultima spiaggia. */
const PER_MESSAGGIO: Array<[RegExp, string]> = [
  [
    /rate limit|too many requests|only request this after/i,
    'Abbiamo già inviato un codice a questo indirizzo da poco. Aspetta un minuto e riprova.',
  ],
  [
    /invalid.*email|email.*invalid|unable to validate email/i,
    'Questo indirizzo email non sembra valido. Controlla che sia scritto per intero.',
  ],
  [/expired|token has expired/i, 'Il codice è scaduto. Richiedine uno nuovo.'],
  [/signups? not allowed|signup.*disabled/i, 'Le nuove iscrizioni sono momentaneamente sospese.'],
  [
    /smtp|sending.*email|failed to send/i,
    'Non siamo riusciti a inviare l’email in questo momento. Riprova fra qualche minuto.',
  ],
];

const GENERICO =
  'Non siamo riusciti a completare l’accesso. Riprova fra qualche minuto; se continua, scrivici.';

/**
 * Traduce l'errore di accesso in una frase che dice cosa fare.
 *
 * `dove` finisce nel log accanto al testo originale: serve a distinguere «non
 * parte l'email» da «il codice non va bene» quando si legge a distanza di
 * giorni.
 */
export function messaggioAccesso(errore: ErroreFornitore | null | undefined, dove: string): string {
  if (!errore) return GENERICO;

  // Il testo originale non si butta: senza, un «non riesco a entrare» resta
  // senza risposta.
  console.error(
    `[accesso] ${dove}: ${errore.code ?? 'senza codice'} — ${errore.message ?? 'senza messaggio'}`,
  );

  if (errore.code && PER_CODICE[errore.code]) return PER_CODICE[errore.code]!;
  for (const [schema, testo] of PER_MESSAGGIO) {
    if (errore.message && schema.test(errore.message)) return testo;
  }
  return GENERICO;
}
