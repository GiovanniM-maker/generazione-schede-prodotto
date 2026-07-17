// ---------------------------------------------------------------------------
// Protezione da CSV/formula injection. Le celle che iniziano con = + - @ (o
// caratteri di controllo tab/CR) possono essere interpretate come formule dai
// fogli di calcolo. Le neutralizziamo con un apostrofo iniziale.
// ---------------------------------------------------------------------------

const DANGEROUS_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/** True se il valore inizia con un carattere pericoloso per i fogli di calcolo. */
export function isDangerousCell(value: string): boolean {
  if (value.length === 0) return false;
  return DANGEROUS_PREFIXES.includes(value[0]!);
}

/** Neutralizza una cella prefissando un apostrofo se necessario. */
export function neutralizeCell(value: string): string {
  if (isDangerousCell(value)) {
    return `'${value}`;
  }
  return value;
}
