// ---------------------------------------------------------------------------
// Logica pura del ledger crediti. Il saldo è SEMPRE la somma del ledger.
// Nessuna colonna mutabile. Le convenzioni di segno sono documentate qui e
// rispecchiate dalle funzioni SQL.
// ---------------------------------------------------------------------------

export type CreditEntryType =
  | 'purchase'
  | 'welcome'
  | 'reservation'
  | 'release'
  | 'consumption'
  | 'refund'
  | 'admin_adjustment';

export interface LedgerEntry {
  amount: number; // firmato
  entryType: CreditEntryType;
}

/** Convenzione di segno attesa per ciascun tipo (admin_adjustment è libero). */
export const SIGN_CONVENTION: Record<CreditEntryType, 'positive' | 'negative' | 'any'> = {
  purchase: 'positive',
  welcome: 'positive',
  release: 'positive',
  refund: 'positive',
  reservation: 'negative',
  consumption: 'negative',
  admin_adjustment: 'any',
};

/** Calcola il saldo sommando gli importi firmati. */
export function computeBalance(entries: LedgerEntry[]): number {
  return entries.reduce((acc, e) => acc + e.amount, 0);
}

/** Valida che un importo rispetti la convenzione di segno del tipo. */
export function validateSign(entry: LedgerEntry): boolean {
  const conv = SIGN_CONVENTION[entry.entryType];
  if (conv === 'any') return true;
  if (conv === 'positive') return entry.amount > 0;
  return entry.amount < 0;
}

/** True se il saldo consente di riservare `amount` crediti. */
export function canReserve(entries: LedgerEntry[], amount: number): boolean {
  if (amount <= 0) return false;
  return computeBalance(entries) >= amount;
}

/**
 * Simula la sequenza di prenotazione -> consumo/rilascio per N item,
 * utile a validare l'invarianza "nessun saldo negativo" nei test.
 */
export function simulateBatch(
  initial: LedgerEntry[],
  reserve: number,
  outcomes: Array<'consume' | 'fail'>,
): { finalBalance: number; entries: LedgerEntry[] } {
  const entries = [...initial];
  entries.push({ amount: -reserve, entryType: 'reservation' });
  for (const outcome of outcomes) {
    if (outcome === 'consume') {
      // release +1 (restituisce il riservato) + consumption -1 (netto 0).
      entries.push({ amount: 1, entryType: 'release' });
      entries.push({ amount: -1, entryType: 'consumption' });
    } else {
      // fail: refund del credito riservato.
      entries.push({ amount: 1, entryType: 'release' });
    }
  }
  return { finalBalance: computeBalance(entries), entries };
}
