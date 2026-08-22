// Undici passi diventano cinque stadi.
//
// IL DIFETTO CHE RISOLVE. Il wizard chiedeva undici volte «Continua» per fare
// una cosa sola: portare dentro un catalogo. Undici non è un numero di passi,
// è un numero di INTERRUZIONI — e sei di quelle undici schermate non chiedono
// niente, mostrano solo il risultato di quella prima e aspettano che si
// prema. Chi apre il wizard la prima volta legge «1 di 11» e capisce che sta
// per perderci il pomeriggio.
//
// I cinque stadi sono i cinque momenti in cui si fa davvero qualcosa di
// diverso:
//
//   PREPARA  di che lavoro si tratta, e con quali regole   (vecchi 1-2)
//   CARICA   da dove arrivano i dati, e portarli dentro    (vecchi 3-5)
//   MAPPA    far combaciare quello che c'è con quel che serve (vecchi 6-8)
//   RIPARA   quello che non torna, prima di spendere       (vecchio 9)
//   PROVA    una scheda vera prima di farne mille          (vecchi 10-11)
//
// LA PARTE DELICATA, e il motivo per cui questo file esiste invece di due
// costanti nel componente: **gli indirizzi già in giro**. Il wizard si scrive
// da solo `?batch=…&passo=8` nella cronologia a ogni cambio di passo, e quel
// numero finisce nei segnalibri, nella cronologia del browser e nei link che
// la gente si manda. Se «8» smettesse di voler dire qualcosa, chi torna su un
// lavoro lasciato a metà atterrerebbe all'inizio — cioè perderebbe il punto in
// cui era, che è l'unica cosa che quel link doveva proteggere.
//
// Funzioni PURE.

export const STADI = ['prepara', 'carica', 'mappa', 'ripara', 'prova'] as const;

export type Stadio = (typeof STADI)[number];

export const TITOLI: Record<Stadio, string> = {
  prepara: 'Prepara',
  carica: 'Carica',
  mappa: 'Mappa',
  ripara: 'Ripara',
  prova: 'Prova',
};

/**
 * Cosa si fa in ciascuno, detto a chi lo sta guardando.
 *
 * Non è decorazione: «Mappa» da solo non vuol dire niente a chi apre il wizard
 * la prima volta, e il titolo di uno stadio si legge PRIMA di sapere cosa
 * conterrà.
 */
export const SOTTOTITOLI: Record<Stadio, string> = {
  prepara: 'Come si chiama questo lavoro e quali regole segue.',
  carica: 'Da dove arrivano i dati dei prodotti.',
  mappa: 'Far combaciare quello che è arrivato con quello che serve.',
  ripara: 'Quello che non torna, prima di spendere crediti.',
  prova: 'Una scheda vera, prima di farne mille.',
};

/** I vecchi passi raccolti nei cinque stadi. */
export const PASSI_DELLO_STADIO: Record<Stadio, number[]> = {
  prepara: [1, 2],
  carica: [3, 4, 5],
  mappa: [6, 7, 8],
  ripara: [9],
  prova: [10, 11],
};

/**
 * In quale stadio cade un passo della vecchia numerazione.
 *
 * Serve a non buttare via gli indirizzi già in giro: `?passo=8` deve continuare
 * a portare dove portava, cioè in mezzo alla mappatura.
 *
 * Fuori scala si stringe agli estremi invece di lanciare: un numero storto in
 * un indirizzo non deve produrre una pagina rotta, deve produrre l'inizio.
 */
export function stadioDelPasso(passo: number): Stadio {
  if (!Number.isFinite(passo)) return 'prepara';
  const p = Math.round(passo);
  for (const stadio of STADI) {
    const passi = PASSI_DELLO_STADIO[stadio];
    if (p <= passi[passi.length - 1]!) return stadio;
  }
  return 'prova';
}

/** Il primo passo di uno stadio: quello che i caricamenti vanno a chiedere. */
export function primoPasso(stadio: Stadio): number {
  return PASSI_DELLO_STADIO[stadio][0]!;
}

export function indiceStadio(stadio: Stadio): number {
  return STADI.indexOf(stadio);
}

/**
 * Legge lo stadio da un indirizzo.
 *
 * Prima il nome nuovo, poi il numero vecchio, e se non c'è né l'uno né l'altro
 * si comincia. Un nome sconosciuto non è un errore da mostrare: è un indirizzo
 * scritto male, e chi ci arriva vuole comunque usare il wizard.
 */
export function leggiStadio(nome: string | null | undefined, passo: string | null | undefined): Stadio {
  const pulito = (nome ?? '').trim().toLowerCase();
  if ((STADI as readonly string[]).includes(pulito)) return pulito as Stadio;
  const n = Number(passo);
  if (passo != null && String(passo).trim() !== '' && Number.isFinite(n) && n >= 1) {
    return stadioDelPasso(n);
  }
  return 'prepara';
}

/**
 * I passi da mostrare dentro uno stadio, dato quello che c'è davvero.
 *
 * L'associazione degli SKU e l'accostamento delle colonne (7 e 8) hanno senso
 * solo con un foglio: chi carica soltanto immagini non ha colonne da
 * accostare. Prima quei due passi sparivano dalla barra, e la barra
 * dell'avanzamento cambiava lunghezza a metà strada — «5 di 11» che diventa
 * «5 di 9» mentre la si guarda.
 *
 * Con gli stadi la barra resta di cinque SEMPRE: cambia cosa c'è dentro uno di
 * essi, non quanti sono. È il motivo principale per cui cinque è meglio di
 * undici, al di là del conto.
 */
export function passiVisibili(stadio: Stadio, stato: { haFoglio: boolean }): number[] {
  const SOLO_CON_FOGLIO = new Set([7, 8]);
  return PASSI_DELLO_STADIO[stadio].filter((p) => stato?.haFoglio || !SOLO_CON_FOGLIO.has(p));
}

export function prossimoStadio(stadio: Stadio): Stadio | null {
  return STADI[indiceStadio(stadio) + 1] ?? null;
}

export function stadioPrecedente(stadio: Stadio): Stadio | null {
  const i = indiceStadio(stadio);
  return i > 0 ? STADI[i - 1]! : null;
}

/**
 * Fin dove si può riprendere un lavoro lasciato a metà.
 *
 * Il server risponde con un tetto nella vecchia numerazione — quanto reggono i
 * dati che ha trovato. Riportarlo qui vuol dire che un lavoro senza file non
 * salta a «Prova» solo perché l'indirizzo lo chiedeva.
 *
 * `voluto` è quello che chiede l'indirizzo, `tetto` quello che i dati
 * permettono: vince il più basso dei due.
 */
export function stadioDiRipresa(voluto: Stadio, tettoInPassi: number): Stadio {
  const tetto = stadioDelPasso(tettoInPassi);
  return indiceStadio(voluto) <= indiceStadio(tetto) ? voluto : tetto;
}

/**
 * Su quale passo, dentro uno stadio, si sta lavorando adesso.
 *
 * PERCHÉ SERVE. Accorpare non vuol dire impilare: dentro «Carica» la scelta
 * della fonte deve succedere PRIMA che ci sia qualcosa da caricare, e
 * l'anteprima del foglio esiste solo dopo che il foglio è stato letto. I pezzi
 * di uno stadio compaiono man mano, e il comando principale in fondo deve
 * essere quello del primo pezzo ancora da fare — non quello dell'ultimo, che
 * chiederebbe di continuare senza aver fatto niente.
 *
 * Se è tutto fatto, il comando è quello dell'ultimo pezzo: è lì che si va
 * avanti.
 */
export function passoAttivo(passi: number[], fatto: Record<number, boolean>): number | null {
  const elenco = passi ?? [];
  if (elenco.length === 0) return null;
  return elenco.find((p) => !fatto?.[p]) ?? elenco[elenco.length - 1]!;
}
