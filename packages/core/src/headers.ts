import { buildSynonymIndex, normalizeToken, MODA_FIELDS } from './preset.js';

// ---------------------------------------------------------------------------
// Matching deterministico intestazione -> campo preset.
// Prima il match esatto normalizzato; nessuna chiamata AI per intestazioni ovvie.
// I casi ambigui restano non mappati e richiedono conferma utente.
// ---------------------------------------------------------------------------

export interface HeaderMatch {
  header: string;
  fieldKey: string | null;
  confidence: 'high' | 'medium' | 'none';
  reason: string;
}

const SYNONYM_INDEX = buildSynonymIndex();

/** Prova a mappare un singolo header a un campo del preset. */
export function matchHeader(header: string): HeaderMatch {
  const norm = normalizeToken(header);
  if (norm === '') {
    return { header, fieldKey: null, confidence: 'none', reason: 'Intestazione vuota' };
  }

  // 1) Match esatto su sinonimo normalizzato.
  const exact = SYNONYM_INDEX.get(norm);
  if (exact) {
    return { header, fieldKey: exact, confidence: 'high', reason: 'Corrispondenza esatta' };
  }

  // 2) Match parziale: l'header contiene interamente un sinonimo (o viceversa),
  //    con almeno 4 caratteri, come suggerimento a media confidenza.
  let best: { fieldKey: string; syn: string } | null = null;
  for (const field of MODA_FIELDS) {
    for (const syn of [field.key.replace(/_/g, ' '), ...field.synonyms]) {
      const nsyn = normalizeToken(syn);
      if (nsyn.length < 4) continue;
      if (norm === nsyn) {
        return { header, fieldKey: field.key, confidence: 'high', reason: 'Corrispondenza esatta' };
      }
      if (norm.includes(nsyn) || nsyn.includes(norm)) {
        if (!best || nsyn.length > normalizeToken(best.syn).length) {
          best = { fieldKey: field.key, syn };
        }
      }
    }
  }
  if (best) {
    return {
      header,
      fieldKey: best.fieldKey,
      confidence: 'medium',
      reason: `Corrispondenza parziale con "${best.syn}"`,
    };
  }

  return { header, fieldKey: null, confidence: 'none', reason: 'Nessuna corrispondenza' };
}

/** Mappa un elenco di header, segnalando duplicati (stesso campo più volte). */
export function matchHeaders(headers: string[]): {
  matches: HeaderMatch[];
  duplicates: string[]; // fieldKey mappati da più di un header
} {
  const matches = headers.map(matchHeader);
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.fieldKey && m.confidence === 'high') {
      counts.set(m.fieldKey, (counts.get(m.fieldKey) ?? 0) + 1);
    }
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return { matches, duplicates };
}
