// Non tutti i fatti possono sostenere le stesse parole.
//
// L'audit dei claim sensibili confronta il testo generato con i fatti verificati
// del prodotto: se la scheda dice «biologico» e nessun fatto lo dice, il claim
// è segnalato. Il meccanismo funziona finché tutti i fatti arrivano dal
// cliente. Con la ricerca per codice non è più così, e senza una distinzione
// una pagina qualsiasi trovata su un marketplace basterebbe ad autorizzare
// «certificato», «made in Italy» o «biologico» — parole che, se sbagliate,
// costano al cliente molto più di una scheda da riscrivere.
//
// Tre livelli, e uno di questi non vale come prova:
//
//   dichiarato   — CSV, PDF, inserimento manuale. È il cliente che lo dice, e
//                  ne risponde lui. Può sostenere un claim.
//   ufficiale    — sito del produttore o di un fornitore riconosciuto in
//                  configurazione. Può sostenere un claim, ma la fonte va
//                  nominata nel rapporto: chi firma la scheda deve sapere su
//                  cosa poggia.
//   terza-parte  — marketplace, rivenditori, aggregatori. NON può sostenere un
//                  claim sensibile. Il dato resta e si usa per il resto: è
//                  buono per dire com'è fatto un prodotto, non per dichiarare
//                  che è certificato.
//
// Funzioni PURE.

import { FACT_USABLE_STATUSES, SENSITIVE_CLAIMS } from '@app/config';
import { detectUnsupportedClaims } from './claims.js';
import { collectGeneratedText } from './factAudit.js';
import type { OrigineFatto } from './precedenza.js';
import type { AuditSeverity, FactAttribute, FactAuditResult, ProductCopy } from './types.js';

export type LivelloAttendibilita = 'dichiarato' | 'ufficiale' | 'terza-parte';

export const ATTENDIBILITA_PER_ORIGINE: Record<OrigineFatto, LivelloAttendibilita> = {
  manuale: 'dichiarato',
  foglio: 'dichiarato',
  pdf: 'dichiarato',
  // Un URL lo sceglie l'utente, ma la pagina resta di qualcun altro: vale come
  // fonte ufficiale, non come dichiarazione del cliente.
  'url-utente': 'ufficiale',
  'ricerca-ufficiale': 'ufficiale',
  'ricerca-terza-parte': 'terza-parte',
  derivato: 'dichiarato',
};

/** Un fatto di terza parte non è una prova: è un'indicazione. */
export function puoSostenereClaim(livello: LivelloAttendibilita): boolean {
  return livello !== 'terza-parte';
}

/** Un fatto che sa da dove viene. */
export interface FattoAttendibile extends FactAttribute {
  attendibilita: LivelloAttendibilita;
  /** La pagina da cui viene, quando la fonte non è il cliente. */
  urlFonte?: string | null;
}

export interface AuditAttendibilita extends FactAuditResult {
  /**
   * I claim che il testo fa e che poggiano SOLO su fatti di terza parte.
   * Sono la ragione per cui questo modulo esiste: senza il filtro passerebbero
   * per sostenuti, con severità nessuna.
   */
  claimSoloDaTerzaParte: string[];
  /** Le pagine ufficiali su cui poggia un claim: vanno nominate nel rapporto. */
  fontiCitate: string[];
}

/**
 * L'audit, tenendo conto di chi ha detto cosa.
 *
 * Gira DUE volte lo stesso rilevamento: una con tutti i fatti e una con i soli
 * fatti che possono fare da prova. La differenza fra i due risultati è
 * esattamente l'insieme dei claim che stavano in piedi solo grazie a una fonte
 * che non può sostenerli — e quelli vanno segnalati con gravità alta, come se
 * non fossero sostenuti affatto, perché è ciò che sono.
 */
export function auditConAttendibilita(
  fatti: FattoAttendibile[],
  contenuto: ProductCopy,
  claimAggiuntivi: readonly string[] = [],
): AuditAttendibilita {
  const testo = collectGeneratedText(contenuto);
  const claims = [...SENSITIVE_CLAIMS, ...claimAggiuntivi];

  const ammessi = fatti.filter((f) => puoSostenereClaim(f.attendibilita));

  const nonSostenutiDaTutti = detectUnsupportedClaims(testo, fatti, FACT_USABLE_STATUSES, claims).map(
    (u) => u.claim,
  );
  const nonSostenutiDaiSoliAmmessi = detectUnsupportedClaims(
    testo,
    ammessi,
    FACT_USABLE_STATUSES,
    claims,
  ).map((u) => u.claim);

  const daTutti = new Set(nonSostenutiDaTutti);
  const claimSoloDaTerzaParte = nonSostenutiDaiSoliAmmessi.filter((c) => !daTutti.has(c));

  // I claim non sostenuti sono quelli che non reggono nemmeno con le fonti
  // ammesse: comprende sia quelli che non aveva nessuno, sia quelli che aveva
  // solo un marketplace.
  const unsupportedClaims = [...new Set(nonSostenutiDaiSoliAmmessi)];
  const severity: AuditSeverity = unsupportedClaims.length > 0 ? 'high' : 'none';

  const fontiCitate = [
    ...new Set(
      fatti
        .filter((f) => f.attendibilita === 'ufficiale' && f.urlFonte)
        .map((f) => f.urlFonte as string),
    ),
  ];

  return {
    passed: severity === 'none',
    unsupportedClaims,
    conflicts: [],
    severity,
    recommendedStatus: severity === 'high' ? 'rejected' : 'generated',
    claimSoloDaTerzaParte,
    fontiCitate,
  };
}
