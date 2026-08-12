import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fettaDiPagina } from '../paginazione.js';

// ---------------------------------------------------------------------------
// Il pavimento sotto ogni pagina, e il muro dei risultati.
//
// Due difetti diversi con la stessa forma: qualcosa che cresce senza che
// nessuno lo guardi. Tre andate e ritorno in fila prima di poter disegnare
// un'intestazione, e un elenco che mette nel documento tutte le schede che ci
// sono — 9.428 nodi con 153 prodotti, misurati, e sono i numeri di un catalogo
// piccolo.
// ---------------------------------------------------------------------------

const RADICE = join(process.cwd(), 'apps/web');
const leggi = (rel: string) => readFileSync(join(RADICE, rel), 'utf8');

describe('quale fetta di elenco si sta guardando', () => {
  it('la prima pagina parte da zero e conta da uno', () => {
    // In archivio si conta da zero, a schermo si scrive «Schede 1–50».
    expect(fettaDiPagina(153, 50, 0)).toMatchObject({ da: 0, a: 50, primo: 1, ultimo: 50 });
  });

  it('l’ultima pagina si ferma dove finisce l’elenco', () => {
    expect(fettaDiPagina(153, 50, 3)).toMatchObject({ da: 150, a: 153, primo: 151, ultimo: 153 });
  });

  it('quante pagine servono davvero', () => {
    expect(fettaDiPagina(153, 50, 0).pagine).toBe(4);
    expect(fettaDiPagina(150, 50, 0).pagine).toBe(3);
    expect(fettaDiPagina(151, 50, 0).pagine).toBe(4);
  });

  it('una pagina esiste sempre, anche senza niente da mostrare', () => {
    // «pagina 0 di 0» non si legge. E `primo` resta 0, perché non c'è una
    // prima scheda da numerare.
    expect(fettaDiPagina(0, 50, 0)).toMatchObject({ pagine: 1, da: 0, a: 0, primo: 0, ultimo: 0 });
  });

  it('se l’elenco si accorcia sotto i piedi, si torna dentro i limiti', () => {
    // È il caso vero: sopra c'è un filtro. Si è a pagina 4, si filtra per
    // «falliti», restano tre schede — e senza questo si guarderebbe il vuoto
    // credendo che non ci sia niente.
    expect(fettaDiPagina(3, 50, 3)).toMatchObject({ pagina: 0, da: 0, a: 3, primo: 1, ultimo: 3 });
  });

  it('una pagina negativa non esiste', () => {
    expect(fettaDiPagina(153, 50, -2).pagina).toBe(0);
  });
});

describe('l’ordine delle schede regge la paginazione', () => {
  it('c’è un secondo criterio dopo la data', () => {
    // Un import inserisce tutte le righe nello stesso istante e a parità di
    // timestamp Postgres non promette nessun ordine: con l'elenco paginato
    // vorrebbe dire vedere una scheda su due pagine, o su nessuna,
    // ricaricando.
    for (const p of [
      'app/app/batches/[batchId]/results/page.tsx',
      'app/app/batches/[batchId]/input/page.tsx',
    ]) {
      expect(leggi(p), p).toMatch(
        /\.order\('created_at', \{ ascending: true \}\)\s*\n\s*\.order\('id', \{ ascending: true \}\)/,
      );
    }
  });
});

describe('il pavimento sotto ogni pagina autenticata', () => {
  it('l’intestazione fa una domanda sola, non tre in fila', () => {
    // Verifica del token, poi «di che organizzazione fa parte», poi saldo e
    // dubbi: le ultime due partivano insieme ma solo dopo la seconda. Un giro
    // costa 165-300 ms; misurato, le due letture al database facevano 290 ms e
    // la chiamata unica ne fa 143.
    const layout = leggi('app/app/layout.tsx');
    expect(layout).toMatch(/contestoApp\(user\.id\)/);
    expect(layout).not.toMatch(/getCreditBalance/);
    expect(layout).not.toMatch(/countOpenDoubtsAction/);
  });

  it('anche chi vuole solo l’organizzazione passa di lì', () => {
    // Altrimenti la lettura tolta dall'intestazione ricompare nella pagina, e
    // il conto torna a due.
    expect(leggi('lib/auth.ts')).toMatch(/contestoApp\(userId\)/);
  });

  it('il saldo non è ricalcolato in un secondo posto', () => {
    // Due versioni della stessa somma, prima o poi, divergono — e qui la somma
    // sono soldi.
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20250101000026_contesto_app.sql'),
      'utf8',
    );
    expect(sql).toMatch(/get_credit_balance\(membro\.organization_id\)/);
    expect(sql).not.toMatch(/sum\(amount\)/);
  });
});
