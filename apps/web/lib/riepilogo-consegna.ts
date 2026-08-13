import type { CompletenessStatus } from '@/lib/completeness';

// ---------------------------------------------------------------------------
// Cosa è stato consegnato.
//
// La pagina dei risultati si apriva su una tabella e un sottotitolo che dava
// istruzioni: «rivedi, modifica e approva le schede generate, poi esporta il
// catalogo». Vere, ma è quello che si deve fare — non quello che si è ottenuto.
// Il numero che conta — «dodici schede che non hai scritto tu» — non era scritto
// da nessuna parte: si poteva solo dedurre dai filtri, che sono filtri.
//
// Questo è il conto, e basta. Niente aggettivi, niente «ottimo lavoro»: le
// categorie a zero non si nominano, perché «0 fallite» mette in testa un'idea
// di fallimento che non c'è, e le schede fallite invece si nominano sempre —
// anche una sola — perché è l'unica parte che chiede di fare qualcosa.
// ---------------------------------------------------------------------------

export interface RigaDaRiepilogare {
  status: string;
  jobFailed: boolean;
  completeness: { status: CompletenessStatus } | null;
}

export interface Consegna {
  /** Quante schede esistono davvero, su quanti prodotti. */
  generate: number;
  prodotti: number;
  complete: number;
  daGuardare: number;
  fallite: number;
}

const NON_GENERATE = new Set(['pending', 'failed']);
const DA_GUARDARE: readonly CompletenessStatus[] = [
  'partial',
  'insufficient',
  'needs_review',
  'blocked',
];

export function consegna(righe: readonly RigaDaRiepilogare[]): Consegna {
  const c: Consegna = {
    generate: 0,
    prodotti: righe.length,
    complete: 0,
    daGuardare: 0,
    fallite: 0,
  };
  for (const r of righe) {
    if (r.jobFailed || r.status === 'failed') {
      c.fallite++;
      continue;
    }
    if (NON_GENERATE.has(r.status)) continue;
    c.generate++;
    if (r.completeness?.status === 'complete') c.complete++;
    else if (r.completeness && DA_GUARDARE.includes(r.completeness.status)) c.daGuardare++;
  }
  return c;
}

const plurale = (n: number, uno: string, molti: string) => (n === 1 ? uno : molti);

/**
 * Una riga sola, in italiano, con dentro solo quello che è successo davvero.
 *
 * Torna `null` quando non c'è ancora niente da dire: un batch senza nemmeno una
 * scheda non ha una consegna da riassumere, e inventargliela — «0 schede
 * generate» — sarebbe peggio del silenzio.
 */
export function frasiDiConsegna(c: Consegna): string | null {
  if (c.generate === 0 && c.fallite === 0) return null;

  const pezzi: string[] = [];
  if (c.generate > 0) {
    const su =
      c.prodotti > c.generate ? ` su ${c.prodotti} prodotti` : '';
    pezzi.push(
      `${c.generate} ${plurale(c.generate, 'scheda generata', 'schede generate')}${su}`,
    );
  }
  if (c.complete > 0) pezzi.push(`${c.complete} ${plurale(c.complete, 'completa', 'complete')}`);
  if (c.daGuardare > 0) pezzi.push(`${c.daGuardare} da guardare`);
  if (c.fallite > 0) {
    pezzi.push(`${c.fallite} ${plurale(c.fallite, 'fallita', 'fallite')}`);
  }
  return pezzi.join(' · ');
}
