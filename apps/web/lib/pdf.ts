import { getDocumentProxy } from 'unpdf';

// ---------------------------------------------------------------------------
// Da byte di PDF a testo. È la metà IMPURA dell'import da PDF: apre il file,
// dipende da una libreria, e non decide niente. Chi decide cosa è un fatto è
// `extractProductFromPdfText` in @app/core, che riceve solo testo.
//
// Due cose non banali succedono qui, e per questo non stanno nel core:
//
//  1) LE COLONNE. Nelle schede tecniche l'etichetta sta a sinistra e il valore
//     a destra, in due colonne. Nel testo estratto quel vuoto diventa uno
//     spazio solo, identico a quello fra due parole: «Denominazione Tavolo
//     Orione 160», e non c'è più modo di sapere dove finisce l'etichetta.
//     Qui il vuoto lo misuriamo davvero — pdf.js dà la larghezza dello spazio
//     in punti — e dove è ampio scriviamo un TAB. Il core poi taglia lì.
//
//  2) IL TITOLO. Nel testo tutte le righe sono uguali; nella pagina no. La
//     riga scritta più grande della prima pagina è quasi sempre il nome del
//     prodotto. Non è una congettura sul contenuto ma una misura sul
//     documento, e la passiamo al core come semplice suggerimento: se una
//     etichetta esplicita c'è, vince quella.
// ---------------------------------------------------------------------------

/** Oltre questo numero di pagine non è più una scheda tecnica: è un catalogo. */
export const MAX_PAGINE_PDF = 30;

/**
 * Un vuoto largo almeno questo, in multipli dell'altezza del carattere, separa
 * due colonne invece di due parole. Uno spazio normale sta sotto 0,4.
 */
const RAPPORTO_COLONNA = 1.6;
const VUOTO_MINIMO_PUNTI = 8;

export type EsitoTestoPdf =
  | { ok: true; testo: string; pagine: number; titoloProbabile: string | null; troncato: boolean }
  | { ok: false; error: string };

interface Riga {
  pezzi: string[];
  altezza: number;
}

function chiudi(riga: Riga, righe: string[], altezze: number[]): void {
  const t = riga.pezzi.join('').replace(/[ \t]+$/, '');
  if (t.trim().length > 0) {
    righe.push(t);
    altezze.push(riga.altezza);
  }
  riga.pezzi = [];
  riga.altezza = 0;
}

/** La mediana, per capire quale sia l'altezza "normale" della pagina. */
function mediana(valori: number[]): number {
  if (valori.length === 0) return 0;
  const s = [...valori].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export async function estraiTestoDaPdf(
  bytes: Uint8Array,
  options: { maxPagine?: number } = {},
): Promise<EsitoTestoPdf> {
  const maxPagine = Math.max(1, options.maxPagine ?? MAX_PAGINE_PDF);

  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) return { ok: false, error: 'Il PDF è protetto da password.' };
    return { ok: false, error: `PDF illeggibile: ${msg.slice(0, 200)}` };
  }

  try {
    const pagineTotali = doc.numPages;
    const daLeggere = Math.min(pagineTotali, maxPagine);
    const righeDocumento: string[] = [];
    let titoloProbabile: string | null = null;

    for (let n = 1; n <= daLeggere; n++) {
      const pagina = await doc.getPage(n);
      const contenuto = await pagina.getTextContent();
      const righe: string[] = [];
      const altezze: number[] = [];
      const corrente: Riga = { pezzi: [], altezza: 0 };

      for (const voce of contenuto.items) {
        const item = voce as { str?: string; width?: number; height?: number; hasEOL?: boolean };
        const testo = typeof item.str === 'string' ? item.str : '';
        const altezza = typeof item.height === 'number' ? item.height : 0;
        if (altezza > corrente.altezza) corrente.altezza = altezza;

        if (testo.length > 0 && testo.trim().length === 0) {
          // Uno spazio "vuoto": la sua larghezza dice se separava due parole o
          // due colonne. pdf.js non gli dà altezza, quindi si usa quella della
          // riga in corso.
          const larghezza = typeof item.width === 'number' ? item.width : 0;
          const riferimento = corrente.altezza > 0 ? corrente.altezza : 10;
          const colonna = larghezza >= riferimento * RAPPORTO_COLONNA && larghezza >= VUOTO_MINIMO_PUNTI;
          corrente.pezzi.push(colonna ? '\t' : ' ');
        } else if (testo.length > 0) {
          corrente.pezzi.push(testo);
        }

        if (item.hasEOL) chiudi(corrente, righe, altezze);
      }
      chiudi(corrente, righe, altezze);

      if (n === 1 && righe.length > 0) {
        // Il titolo è la riga più grande, e solo se è davvero più grande delle
        // altre: in un documento tutto della stessa dimensione non esiste un
        // titolo da misurare, ed è più onesto non suggerirne uno.
        const normale = mediana(altezze.filter((a) => a > 0));
        let migliore = -1;
        for (let i = 0; i < righe.length; i++) {
          if (righe[i]!.trim().length < 3) continue;
          if (migliore < 0 || altezze[i]! > altezze[migliore]!) migliore = i;
        }
        if (migliore >= 0 && normale > 0 && altezze[migliore]! > normale * 1.15) {
          titoloProbabile = righe[migliore]!.replace(/\t/g, ' ').trim();
        }
      }

      righeDocumento.push(...righe);
      // Senza questo pdf.js tiene in memoria il contenuto di ogni pagina letta.
      if (typeof pagina.cleanup === 'function') pagina.cleanup();
    }

    return {
      ok: true,
      testo: righeDocumento.join('\n'),
      pagine: pagineTotali,
      titoloProbabile,
      troncato: pagineTotali > daLeggere,
    };
  } catch (e) {
    return { ok: false, error: `Lettura del PDF fallita: ${e instanceof Error ? e.message : 'errore'}` };
  } finally {
    try {
      // `destroy` c'è in pdf.js ma non nei tipi che unpdf ri-esporta: senza
      // questa chiamata il documento resta in memoria per tutta la richiesta.
      const chiudibile = doc as unknown as { destroy?: () => Promise<void> };
      if (typeof chiudibile.destroy === 'function') await chiudibile.destroy();
    } catch {
      /* la chiusura non deve mai far fallire una lettura riuscita */
    }
  }
}
