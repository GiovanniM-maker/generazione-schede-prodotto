import { describe, expect, it } from 'vitest';
import { extractProductFromPdfText } from '@app/core';
import { estraiTestoDaPdf } from '../pdf';

// ---------------------------------------------------------------------------
// L'adattatore byte → testo, provato su PDF veri.
//
// I PDF li costruiamo qui sotto invece di tenere dei file di esempio nel
// repository: così ogni prova dice esattamente cosa c'è nella pagina — quale
// testo, a quale coordinata, di quale corpo — e le due cose che l'adattatore
// deve fare (misurare i vuoti fra le colonne, misurare il titolo) si possono
// mettere alla prova cambiando un numero.
// ---------------------------------------------------------------------------

interface Voce {
  testo: string;
  x: number;
  y: number;
  corpo?: number;
}

/** Un PDF minimo e valido con del testo posizionato. Nessuna dipendenza. */
function costruisciPdf(pagine: Voce[][]): Uint8Array {
  const contenuti = pagine.map((voci) =>
    voci
      .map((v) => {
        const s = v.testo.replace(/([()\\])/g, '\\$1');
        return `BT /F1 ${v.corpo ?? 11} Tf ${v.x} ${v.y} Td (${s}) Tj ET`;
      })
      .join('\n'),
  );

  // 1 catalogo, 2 pages, 3..(2+N) pagine, poi i contenuti, infine il font.
  const primoContenuto = 3 + pagine.length;
  const idFont = primoContenuto + pagine.length;
  const kids = pagine.map((_, i) => `${3 + i} 0 R`).join(' ');
  const oggetti = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pagine.length} >>`,
    ...pagine.map(
      (_, i) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${idFont} 0 R >> >> /Contents ${primoContenuto + i} 0 R >>`,
    ),
    ...contenuti.map((c) => `<< /Length ${c.length} >>\nstream\n${c}\nendstream`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offset: number[] = [];
  oggetti.forEach((o, i) => {
    offset.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Righe di testo tutte uguali, una sotto l'altra. */
function pagina(righe: string[], corpo = 11): Voce[] {
  return righe.map((testo, i) => ({ testo, x: 60, y: 780 - i * 22, corpo }));
}

describe('estraiTestoDaPdf', () => {
  it('legge il testo riga per riga', async () => {
    const r = await estraiTestoDaPdf(costruisciPdf([pagina(['Sedia Aurora', 'Peso: 4 kg'])]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.testo).toBe('Sedia Aurora\nPeso: 4 kg');
    expect(r.pagine).toBe(1);
    expect(r.troncato).toBe(false);
  });

  it('mette un TAB dove la pagina aveva due colonne', async () => {
    // Etichetta a x=60, valore a x=260: fra le due ci sono ~120 punti di vuoto,
    // undici volte il corpo del carattere. Nel testo estratto quel vuoto è uno
    // spazio identico a quelli fra le parole; qui diventa un TAB.
    const r = await estraiTestoDaPdf(
      costruisciPdf([
        [
          { testo: 'Denominazione', x: 60, y: 700 },
          { testo: 'Tavolo Orione 160', x: 260, y: 700 },
        ],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.testo).toBe('Denominazione\tTavolo Orione 160');
  });

  it('non mette un TAB fra due parole della stessa frase', async () => {
    // La prova che il TAB non è gratis: qui il vuoto è quello di uno spazio
    // normale, e va lasciato spazio. Senza questa, la soglia potrebbe essere
    // zero e la prova qui sopra passerebbe lo stesso.
    const r = await estraiTestoDaPdf(
      costruisciPdf([
        [
          { testo: 'Struttura', x: 60, y: 700 },
          { testo: 'tubolare', x: 112, y: 700 },
        ],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.testo).not.toContain('\t');
    expect(r.testo).toBe('Struttura tubolare');
  });

  it('riconosce come titolo la riga scritta più grande', async () => {
    const r = await estraiTestoDaPdf(
      costruisciPdf([
        [
          { testo: 'Ferrini S.r.l.', x: 60, y: 800, corpo: 9 },
          { testo: 'Lampada Vega', x: 60, y: 760, corpo: 24 },
          { testo: 'Peso: 1,2 kg', x: 60, y: 720, corpo: 11 },
          { testo: 'Colore: Ottone', x: 60, y: 700, corpo: 11 },
        ],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.titoloProbabile).toBe('Lampada Vega');
  });

  it('non suggerisce un titolo se sono tutte della stessa dimensione', async () => {
    // Senza un carattere più grande non c'è niente da misurare: inventare un
    // titolo qui vorrebbe dire eleggere a nome del prodotto la prima riga
    // capitata, che è il mestiere del core e con altre regole.
    const r = await estraiTestoDaPdf(
      costruisciPdf([pagina(['Ferrini S.r.l.', 'Lampada Vega', 'Peso: 1,2 kg'])]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.titoloProbabile).toBeNull();
  });

  it('il titolo lo cerca solo nella prima pagina', async () => {
    const r = await estraiTestoDaPdf(
      costruisciPdf([
        pagina(['Lampada Vega', 'Peso: 1,2 kg']),
        // La seconda pagina ha tutto quello che serve per eleggere un titolo:
        // una riga grande e delle righe normali con cui confrontarla. Se la
        // ricerca non fosse limitata alla prima pagina, il nome del prodotto
        // diventerebbe «ALLEGATO».
        [
          { testo: 'ALLEGATO', x: 60, y: 760, corpo: 40 },
          { testo: 'Nota: imballo', x: 60, y: 700, corpo: 11 },
          { testo: 'Nota: reso', x: 60, y: 680, corpo: 11 },
        ],
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.titoloProbabile).toBeNull();
    expect(r.testo).toContain('ALLEGATO');
  });

  it('unisce le pagine e dichiara quando ne ha lasciate fuori', async () => {
    const tre = [pagina(['Uno']), pagina(['Due']), pagina(['Tre'])];
    const tutto = await estraiTestoDaPdf(costruisciPdf(tre));
    expect(tutto.ok && tutto.testo).toBe('Uno\nDue\nTre');
    expect(tutto.ok && tutto.troncato).toBe(false);

    const poche = await estraiTestoDaPdf(costruisciPdf(tre), { maxPagine: 2 });
    expect(poche.ok && poche.testo).toBe('Uno\nDue');
    expect(poche.ok && poche.pagine).toBe(3);
    expect(poche.ok && poche.troncato).toBe(true);
  });

  it('su byte che non sono un PDF risponde con un errore, non con un’eccezione', async () => {
    const r = await estraiTestoDaPdf(new Uint8Array(Buffer.from('non sono un pdf')));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Il giro completo: byte di PDF → testo → fatti.
//
// Le due metà sono provate ciascuna per conto suo, ma è la giuntura che rompe:
// il TAB che una mette e l'altra legge esiste solo perché si mettano
// d'accordo, e nessuna delle due prove separate se ne accorgerebbe se
// smettessero di parlarsi.
// ---------------------------------------------------------------------------

describe('da un PDF vero ai fatti del prodotto', () => {
  it('legge una scheda tecnica impaginata a due colonne', async () => {
    const pdf = costruisciPdf([
      [
        { testo: 'FERRINI ARREDI', x: 60, y: 800, corpo: 9 },
        { testo: 'SCHEDA TECNICA', x: 60, y: 770, corpo: 10 },
        { testo: 'Sedia Ergonomica Aurora', x: 60, y: 730, corpo: 22 },
        // Etichette a sinistra, valori a destra: nel testo estratto il vuoto
        // fra le due colonne è indistinguibile da uno spazio.
        { testo: 'Marca', x: 60, y: 680 },
        { testo: 'Ferrini', x: 260, y: 680 },
        { testo: 'Codice articolo', x: 60, y: 658 },
        { testo: 'SED-AUR-01', x: 260, y: 658 },
        { testo: 'Materiale', x: 60, y: 636 },
        { testo: 'Faggio massello', x: 260, y: 636 },
        { testo: 'Peso', x: 60, y: 614 },
        { testo: '6,4 kg', x: 260, y: 614 },
        { testo: 'Prezzo', x: 60, y: 592 },
        { testo: '189,00 EUR', x: 260, y: 592 },
      ],
    ]);

    const testo = await estraiTestoDaPdf(pdf);
    expect(testo.ok).toBe(true);
    if (!testo.ok) return;

    const dati = extractProductFromPdfText(testo.testo, {
      titoloProbabile: testo.titoloProbabile,
      filename: 'sedia-aurora.pdf',
    });

    expect(dati.name).toBe('Sedia Ergonomica Aurora');
    expect(dati.source).toBe('titolo');
    expect(dati.brand).toBe('Ferrini');
    expect(dati.sku).toBe('SED-AUR-01');
    expect(dati.price).toBe('189,00 EUR');
    expect(dati.attributes).toEqual({ Materiale: 'Faggio massello', Peso: '6,4 kg' });
  });

  it('una scheda senza testo (scansione) non produce fatti inventati', async () => {
    // Un PDF di sole immagini non ha testo da estrarre. Deve restare vuoto:
    // il momento in cui questo import comincia a indovinare è il momento in
    // cui smette di valere qualcosa.
    const pdf = costruisciPdf([[]]);
    const testo = await estraiTestoDaPdf(pdf);
    expect(testo.ok).toBe(true);
    if (!testo.ok) return;
    expect(testo.testo.trim()).toBe('');

    const dati = extractProductFromPdfText(testo.testo, { filename: 'scansione.pdf' });
    expect(dati.name).toBeNull();
    expect(dati.brand).toBeNull();
    expect(dati.attributes).toEqual({});
  });
});
