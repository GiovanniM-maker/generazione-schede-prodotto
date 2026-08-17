import { describe, expect, it } from 'vitest';
import { dividiRiga, extractProductFromPdfText, normalizzaEtichetta } from '../pdf-extract.js';

// ---------------------------------------------------------------------------
// L'estrazione dei fatti da una scheda tecnica in PDF.
//
// Ogni prova qui sotto è stata scritta mettendo prima il difetto nel codice e
// controllando che diventasse rossa: una prova che passa anche senza la riga
// che dovrebbe difendere non difende niente.
// ---------------------------------------------------------------------------

const SCHEDA = [
  'SCHEDA TECNICA',
  'Sedia Ergonomica Aurora',
  'Marca: Ferrini',
  'Codice articolo: SED-AUR-01',
  'Materiale: Faggio massello',
  'Dimensioni: 45 x 52 x 88 cm',
  'Peso: 6,4 kg',
  'Colore: Noce',
  'Prezzo: 189,00 EUR',
  'EAN: 8001234567890',
].join('\n');

describe('extractProductFromPdfText — la scheda tipica', () => {
  const r = extractProductFromPdfText(SCHEDA);

  it('riconosce marca, codice e prezzo dalle loro etichette', () => {
    expect(r.brand).toBe('Ferrini');
    expect(r.sku).toBe('SED-AUR-01');
    expect(r.price).toBe('189,00 EUR');
  });

  it('prende come nome la riga libera, non l’intestazione del documento', () => {
    // «SCHEDA TECNICA» è il titolo del foglio, non del prodotto: se finisse nel
    // nome, tutte le schede importate da PDF si chiamerebbero uguale.
    expect(r.name).toBe('Sedia Ergonomica Aurora');
    expect(r.source).toBe('riga');
  });

  it('mette il resto negli attributi, con l’etichetta come sta scritta', () => {
    expect(r.attributes).toEqual({
      Materiale: 'Faggio massello',
      Dimensioni: '45 x 52 x 88 cm',
      Peso: '6,4 kg',
      Colore: 'Noce',
      EAN: '8001234567890',
    });
  });

  it('non rimette marca, codice e prezzo anche fra gli attributi', () => {
    // Finirebbero due volte nella scheda: una come campo, una come fatto.
    expect(Object.keys(r.attributes)).not.toContain('Marca');
    expect(Object.keys(r.attributes)).not.toContain('Codice articolo');
    expect(Object.keys(r.attributes)).not.toContain('Prezzo');
  });

  it('conta le righe riconosciute', () => {
    // 8 coppie etichetta/valore su 10 righe.
    expect(r.righeRiconosciute).toBe(8);
    expect(r.righeTotali).toBe(10);
  });
});

describe('extractProductFromPdfText — le tabelle a due colonne', () => {
  it('usa il TAB messo dall’estrattore dove la pagina aveva un vuoto', () => {
    const r = extractProductFromPdfText(
      ['Denominazione\tTavolo Orione 160', 'Produttore\tLegnami Rossi', 'Portata\t120 kg'].join('\n'),
    );
    expect(r.name).toBe('Tavolo Orione 160');
    expect(r.source).toBe('etichetta');
    expect(r.brand).toBe('Legnami Rossi');
    expect(r.attributes).toEqual({ Portata: '120 kg' });
  });

  it('taglia su un’etichetta nota anche senza nessun separatore', () => {
    // pdf.js a volte riduce il vuoto fra le colonne a uno spazio solo: resta
    // «Cod. Art. TAV-ORI-160», e l’unico appiglio è che l’etichetta la
    // conosciamo. Si prova prima «cod art» e poi «cod», altrimenti il codice
    // diventerebbe «Art. TAV-ORI-160».
    const r = extractProductFromPdfText(['Cod. Art. TAV-ORI-160', 'Marca Ferrini'].join('\n'));
    expect(r.sku).toBe('TAV-ORI-160');
    expect(r.brand).toBe('Ferrini');
  });

  it('fra due etichette note di cui una è prefisso dell’altra vince la più lunga', () => {
    // «codice» è un prefisso di «codice articolo»: se si prova prima la corta,
    // il codice diventa «articolo SED-AUR-01» e il prodotto nasce sbagliato.
    // Vale per la forma senza separatore, dove non c’è nient’altro a cui
    // appoggiarsi.
    const r = extractProductFromPdfText('Codice articolo SED-AUR-01');
    expect(r.sku).toBe('SED-AUR-01');

    const s = extractProductFromPdfText('Nome prodotto Lampada Vega');
    expect(s.name).toBe('Lampada Vega');
  });

  it('non taglia una riga qualsiasi che non comincia con un’etichetta nota', () => {
    // Il taglio senza separatore è a indovinare: si fa solo dove sappiamo.
    const r = extractProductFromPdfText('Struttura tubolare verniciata a polvere');
    expect(r.attributes).toEqual({});
    expect(r.righeRiconosciute).toBe(0);
    expect(r.name).toBe('Struttura tubolare verniciata a polvere');
  });

  it('i due punti vincono sul TAB se vengono prima', () => {
    const c = dividiRiga('Peso: 3 kg\tnetto');
    expect(c).toEqual({ etichetta: 'Peso', valore: '3 kg netto' });
  });

  it('il TAB vince sui due punti se viene prima', () => {
    const c = dividiRiga('Orario\t9:30 - 18:00');
    expect(c).toEqual({ etichetta: 'Orario', valore: '9:30 - 18:00' });
  });
});

describe('extractProductFromPdfText — la prosa non è un fatto', () => {
  it('scarta il valore di un’etichetta di prosa', () => {
    const r = extractProductFromPdfText(
      ['Modello: X1', 'Descrizione: Sedia comoda in faggio', 'Peso: 4 kg'].join('\n'),
    );
    expect(Object.keys(r.attributes)).not.toContain('Descrizione');
    expect(r.attributes).toEqual({ Modello: 'X1', Peso: '4 kg' });
  });

  it('scarta un valore lungo come un paragrafo', () => {
    const lungo = 'a'.repeat(200);
    const r = extractProductFromPdfText(`Finitura: ${lungo}`);
    expect(r.attributes).toEqual({});
  });

  it('scarta un valore fatto di più frasi', () => {
    // È il testo di marketing del fornitore. Se entrasse fra i fatti, l’AI lo
    // ricopierebbe: è esattamente ciò che il progetto promette di non fare.
    const r = extractProductFromPdfText('Finitura: Opaca al tatto. Resiste ai graffi.');
    expect(r.attributes).toEqual({});
  });

  it('tiene invece un valore corto con un punto dentro', () => {
    // Senza questa, «Legnami Rossi S.p.A.» verrebbe buttato via.
    const r = extractProductFromPdfText('Produttore: Legnami Rossi S.p.A.');
    expect(r.brand).toBe('Legnami Rossi S.p.A.');
  });

  it('una sigla puntata seguita da una maiuscola non conta come due frasi', () => {
    // «S.p.A. Milano» ha un punto, uno spazio e una maiuscola: la regola
    // ingenua lo leggerebbe come fine frase e butterebbe via una marca vera.
    const r = extractProductFromPdfText('Produttore: Legnami Rossi S.p.A. Milano');
    expect(r.brand).toBe('Legnami Rossi S.p.A. Milano');
  });
});

describe('extractProductFromPdfText — l’impaginazione non è contenuto', () => {
  it('butta via numeri di pagina, righe di soli trattini, url ed email', () => {
    const r = extractProductFromPdfText(
      [
        'Pagina 1 di 3',
        '--------',
        'www.fornitore.it',
        'info@fornitore.it',
        'Modello: X1',
      ].join('\n'),
    );
    expect(r.righeTotali).toBe(1);
    expect(r.attributes).toEqual({ Modello: 'X1' });
  });

  it('butta via una riga che si ripete su ogni pagina', () => {
    // Intestazione e piè di pagina tornano identici a ogni pagina: tre volte o
    // più vuol dire impaginazione. Senza questo, la prima pagina darebbe il
    // nome «Ferrini S.r.l. — Catalogo 2026».
    const testata = 'Ferrini S.r.l. - Catalogo 2026';
    const r = extractProductFromPdfText(
      [testata, 'Sedia Aurora', 'Peso: 4 kg', testata, 'Colore: Noce', testata, 'Base: Metallo'].join('\n'),
    );
    expect(r.name).toBe('Sedia Aurora');
    expect(r.righeTotali).toBe(4);
  });

  it('due sole occorrenze restano: non sono ancora impaginazione', () => {
    const r = extractProductFromPdfText(['Sedia Aurora', 'Sedia Aurora', 'Peso: 4 kg'].join('\n'));
    expect(r.righeTotali).toBe(3);
    expect(r.name).toBe('Sedia Aurora');
  });
});

describe('extractProductFromPdfText — da dove viene il nome', () => {
  it('l’etichetta esplicita batte tutto il resto', () => {
    const r = extractProductFromPdfText(['Un titolo grosso', 'Prodotto: Lampada Vega'].join('\n'), {
      titoloProbabile: 'Un titolo grosso',
    });
    expect(r.name).toBe('Lampada Vega');
    expect(r.source).toBe('etichetta');
  });

  it('senza etichetta vale il testo più grande della prima pagina', () => {
    const r = extractProductFromPdfText(['Peso: 4 kg', 'Lampada Vega'].join('\n'), {
      titoloProbabile: 'Lampada Vega',
    });
    expect(r.name).toBe('Lampada Vega');
    expect(r.source).toBe('titolo');
  });

  it('il titolo suggerito non vale se è l’intestazione del foglio', () => {
    const r = extractProductFromPdfText(['SCHEDA TECNICA', 'Lampada Vega', 'Peso: 4 kg'].join('\n'), {
      titoloProbabile: 'SCHEDA TECNICA',
    });
    expect(r.name).toBe('Lampada Vega');
    expect(r.source).toBe('riga');
  });

  it('senza niente da cui ricavarlo, il nome resta vuoto', () => {
    // Meglio nessun nome che un nome inventato: chi importa se ne accorge.
    const r = extractProductFromPdfText('Peso: 4 kg');
    expect(r.name).toBeNull();
    expect(r.source).toBe('none');
  });
});

describe('extractProductFromPdfText — lo SKU', () => {
  it('il codice dichiarato batte il nome del file', () => {
    const r = extractProductFromPdfText('SKU: ABC-1', { filename: 'listino-2026.pdf' });
    expect(r.sku).toBe('ABC-1');
  });

  it('senza codice dichiarato si ripiega sul nome del file', () => {
    const r = extractProductFromPdfText('Peso: 4 kg', { filename: 'SED-AUR-01.pdf' });
    expect(r.sku).toBe('SED-AUR-01');
  });

  it('il nome del file viene ripulito degli accenti e degli spazi', () => {
    const r = extractProductFromPdfText('Peso: 4 kg', { filename: 'Sedia Città 2026.pdf' });
    expect(r.sku).toBe('Sedia-Citta-2026');
  });

  it('un nome file troppo corto non diventa uno SKU', () => {
    const r = extractProductFromPdfText('Peso: 4 kg', { filename: 'a.pdf' });
    expect(r.sku).toBeNull();
  });
});

describe('extractProductFromPdfText — i limiti', () => {
  it('la prima occorrenza di un’etichetta vince sulle successive', () => {
    const r = extractProductFromPdfText(['Peso: 4 kg', 'Peso: circa 4 kg'].join('\n'));
    expect(r.attributes).toEqual({ Peso: '4 kg' });
  });

  it('vale anche se l’etichetta ripetuta è scritta diversamente', () => {
    const r = extractProductFromPdfText(['Peso: 4 kg', 'PESO.: 5 kg'].join('\n'));
    expect(r.attributes).toEqual({ Peso: '4 kg' });
  });

  it('tiene al massimo 80 attributi', () => {
    const righe = Array.from({ length: 120 }, (_, i) => `Campo${i}: valore${i}`);
    const r = extractProductFromPdfText(righe.join('\n'));
    expect(Object.keys(r.attributes)).toHaveLength(80);
  });

  it('un valore lunghissimo viene scartato, non troncato', () => {
    // Il tetto è uno solo — la soglia della prosa — e vale anche per i campi
    // riconosciuti: un codice articolo da 600 caratteri non è un codice.
    const r = extractProductFromPdfText(`Nota tecnica: ${'x'.repeat(600)}`);
    expect(r.attributes['Nota tecnica']).toBeUndefined();
    const s = extractProductFromPdfText(`Codice: ${'x'.repeat(600)}`);
    expect(s.sku).toBeNull();
  });

  it('nemmeno il nome può essere un paragrafo intero', () => {
    const r = extractProductFromPdfText(['x'.repeat(600), 'Lampada Vega', 'Peso: 4 kg'].join('\n'));
    expect(r.name).toBe('Lampada Vega');
  });

  it('un testo vuoto non produce niente e non esplode', () => {
    for (const t of ['', '   ', '\n\n']) {
      const r = extractProductFromPdfText(t);
      expect(r.name).toBeNull();
      expect(r.attributes).toEqual({});
      expect(r.righeTotali).toBe(0);
    }
  });

  it('scarta una coppia dove il valore ripete l’etichetta', () => {
    const r = extractProductFromPdfText('Colore: colore');
    expect(r.attributes).toEqual({});
  });
});

describe('normalizzaEtichetta', () => {
  it('toglie accenti, punteggiatura e maiuscole', () => {
    expect(normalizzaEtichetta('Cod. Art.')).toBe('cod art');
    expect(normalizzaEtichetta('PESO NETTO')).toBe('peso netto');
    expect(normalizzaEtichetta('Città')).toBe('citta');
  });
});
