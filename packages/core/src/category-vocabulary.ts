/**
 * Il vocabolario delle categorie di un batch.
 *
 * Regola: **il preset è il vocabolario**. Se il preset scelto ha delle proprie
 * categorie, sono quelle e solo quelle a essere usate — per il match della
 * colonna Categoria del file, per la classificazione dalle foto e per la
 * rimappatura manuale.
 *
 * Prima si usavano tutte le categorie del settore (quelle di sistema più quelle
 * dell'organizzazione): chi aveva un preset con il proprio vocabolario si
 * ritrovava assegnate categorie di base che in quel preset non esistono e non
 * hanno attributi, quindi senza nulla da estrarre.
 */

export interface CategoryRow {
  id: string;
  name: string;
  /** null = categoria di sistema; valorizzato = categoria dell'organizzazione. */
  ownerOrganizationId: string | null;
}

export interface CategoryVocabulary {
  entries: Array<{ id: string; name: string }>;
  /** true = categorie del preset; false = ripiego sul settore. */
  fromPreset: boolean;
}

/** Normalizza un nome di categoria per il confronto (maiuscole/accenti/spazi). */
export function normalizeCategoryName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Toglie i doppioni per nome normalizzato. A parità di nome vince la categoria
 * dell'organizzazione su quella di sistema, così il match resta deterministico
 * e punta sempre alla versione che l'utente può modificare.
 */
export function dedupeCategories(rows: readonly CategoryRow[]): Array<{ id: string; name: string }> {
  const sorted = rows
    .slice()
    .sort((a, b) =>
      a.ownerOrganizationId === b.ownerOrganizationId ? 0 : a.ownerOrganizationId ? -1 : 1,
    );
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string }> = [];
  for (const c of sorted) {
    const k = normalizeCategoryName(c.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ id: c.id, name: c.name });
  }
  return out;
}

/**
 * Sceglie il vocabolario da usare. Il ripiego sul settore vale solo per un
 * preset senza categorie configurate: senza elenco l'utente non potrebbe
 * mappare nulla.
 */
export function pickCategoryVocabulary(input: {
  presetCategories: readonly CategoryRow[];
  sectorCategories: readonly CategoryRow[];
}): CategoryVocabulary {
  if (input.presetCategories.length > 0) {
    return { entries: dedupeCategories(input.presetCategories), fromPreset: true };
  }
  return { entries: dedupeCategories(input.sectorCategories), fromPreset: false };
}
