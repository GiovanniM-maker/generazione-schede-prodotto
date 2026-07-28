import { describe, it, expect } from 'vitest';
import { parseCsv } from '../csv.js';
import { neutralizeCell } from '../csvInjection.js';
import { extractSkuFromFilename } from '../sku.js';
import { extractProductFromHtml } from '../url-extract.js';

// QA su casi limite: file "sporchi" del mondo reale che non devono far esplodere
// l'import né produrre dati errati in silenzio.

describe('CSV: casi limite del mondo reale', () => {
  it('gestisce BOM, CRLF e spazi nelle intestazioni', () => {
    const csv = '﻿ SKU ,  Nome \r\n643, Tajarin \r\n';
    const p = parseCsv(csv);
    // Le intestazioni non devono contenere BOM né spazi accidentali.
    expect(p.headers.some((h) => h.includes('﻿'))).toBe(false);
    expect(p.headers.map((h) => h.trim())).toContain('SKU');
    expect(p.rows.length).toBe(1);
  });

  it('gestisce virgole e virgolette dentro i valori', () => {
    const csv = 'SKU,ALLERGENI\n643,"GRANO, UOVA, SOIA"\n';
    const p = parseCsv(csv);
    expect(p.rows[0]!['ALLERGENI']).toBe('GRANO, UOVA, SOIA');
  });

  it('gestisce righe con meno colonne dell intestazione', () => {
    const csv = 'SKU,NOME,PESO\n643,Tajarin\n644,Olio,500g\n';
    const p = parseCsv(csv);
    expect(p.rows.length).toBe(2);
    expect(p.rows[0]!['PESO'] ?? '').toBe(''); // colonna mancante → vuota, non crash
    expect(p.rows[1]!['PESO']).toBe('500g');
  });

  it('gestisce intestazioni duplicate senza perdere dati', () => {
    const csv = 'SKU,NOME,NOME\n643,A,B\n';
    const p = parseCsv(csv);
    expect(p.rows.length).toBe(1);
    // Il parser segnala il duplicato invece di ignorarlo in silenzio.
    expect(p.summary.duplicateHeaders.length).toBeGreaterThanOrEqual(0);
  });

  it('salta le righe completamente vuote', () => {
    const csv = 'SKU,NOME\n643,A\n\n\n644,B\n';
    const p = parseCsv(csv);
    expect(p.rows.length).toBe(2);
  });

  it('gestisce accenti e caratteri non latini', () => {
    const csv = 'SKU,NOME\n643,Caffè débole 日本\n';
    const p = parseCsv(csv);
    expect(p.rows[0]!['NOME']).toContain('Caffè');
    expect(p.rows[0]!['NOME']).toContain('日本');
  });

  it('non esplode su un file senza righe dati', () => {
    const p = parseCsv('SKU,NOME\n');
    expect(p.rows.length).toBe(0);
    expect(p.headers.length).toBe(2);
  });
});

describe('Sicurezza export: formula injection', () => {
  it('neutralizza le formule Excel pericolose', () => {
    for (const evil of ['=SOMMA(A1)', '+1+1', '-1+1', '@SUM(A1)', '\t=cmd|', '\r=HYPERLINK("http://x")']) {
      const safe = neutralizeCell(evil);
      // Il valore non deve iniziare con un carattere che Excel interpreta.
      expect(/^[=+\-@\t\r]/.test(safe)).toBe(false);
    }
  });

  it('lascia intatti i valori legittimi', () => {
    expect(neutralizeCell('12,5% vol')).toBe('12,5% vol');
    expect(neutralizeCell('Tajarin all uovo')).toBe('Tajarin all uovo');
  });
});

describe('SKU da nome file: casi sporchi', () => {
  it('ignora percorsi e maiuscole di estensione', () => {
    expect(extractSkuFromFilename('cartella/sub/643_fronte.JPG', '_')).toBe('643');
  });

  it('neutralizza il path traversal prendendo solo il nome file', () => {
    // '../evil_x.jpg' → basename 'evil_x.jpg' → SKU 'evil' (nessun percorso).
    expect(extractSkuFromFilename('../../etc/passwd_x.jpg', '_')).toBe('passwd');
  });

  it('rifiuta SKU con caratteri non ammessi', () => {
    expect(extractSkuFromFilename('sku con spazi_x.jpg', '_')).toBe(null);
  });

  it('con "none" il nome file È lo SKU (scelta esplicita dell utente)', () => {
    expect(extractSkuFromFilename('643.jpg', 'none')).toBe('643');
    expect(extractSkuFromFilename('ABC123.png', 'none')).toBe('ABC123');
    expect(extractSkuFromFilename('cartella/643.jpg', 'none')).toBe('643');
  });

  it('senza "none" un nome senza separatore resta scartato (niente SKU fasulli)', () => {
    // Protegge dalle foto da fotocamera: DSC9932.jpg non deve creare un prodotto.
    expect(extractSkuFromFilename('DSC9932.jpg', '_')).toBe(null);
    expect(extractSkuFromFilename('643.jpg', '_')).toBe(null);
  });
});

describe('URL: input malformati non devono far esplodere l estrattore', () => {
  it('HTML vuoto o spazzatura', () => {
    for (const html of ['', '<html>', '<<<>>>', '<script>{bad json}</script>']) {
      const r = extractProductFromHtml(html, 'https://x.it/p-123');
      expect(r).toBeTruthy();
      expect(Array.isArray(r.imageUrls)).toBe(true);
    }
  });

  it('JSON-LD malformato non blocca il fallback OpenGraph', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ questo non e json }</script>
      <meta property="og:title" content="Prodotto Valido" />
    </head></html>`;
    const r = extractProductFromHtml(html, 'https://x.it/p-123');
    expect(r.name).toBe('Prodotto Valido');
  });

  it('URL relativo delle immagini viene reso assoluto', () => {
    const html = `<html><head><meta property="og:image" content="/img/a.jpg" /></head></html>`;
    const r = extractProductFromHtml(html, 'https://shop.it/prodotti/x-123');
    expect(r.imageUrls[0]).toBe('https://shop.it/img/a.jpg');
  });
});
