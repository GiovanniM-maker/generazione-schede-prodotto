/**
 * Divide un elenco in blocchi di dimensione fissa.
 *
 * Serve alle scritture su database: mandare 500 righe in una sola richiesta
 * rischia di superare i limiti (payload e tempo), mandarne una per volta è
 * lento. I blocchi sono la via di mezzo.
 *
 * L'ultimo blocco può essere più corto. Con un elenco vuoto il risultato è
 * vuoto: nessun blocco da scrivere.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk: la dimensione deve essere almeno 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
