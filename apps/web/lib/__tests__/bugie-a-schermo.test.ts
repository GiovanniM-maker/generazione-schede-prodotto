import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

const leggiFile = (rel: string) =>
  readFileSync(join(process.cwd(), 'apps/web', rel), 'utf8');

// ---------------------------------------------------------------------------
// Le frasi che il prodotto diceva e che non erano vere.
//
// Sono i difetti più insidiosi: nessuno schianta, nessun log si accende, i test
// sono verdi. Semplicemente, quello che c'è scritto a schermo non corrisponde a
// quello che il prodotto sta facendo.
//
//   - «l'acquisto è simulato, i crediti sono accreditati senza addebito reale»
//     scritto fisso, cioè anche quando l'addebito è reale;
//   - un file senza righe accolto con la spunta verde, seguito da tre passi che
//     dicono «ok» prima che l'import confessi «nessun prodotto importato»;
//   - una privacy policy pubblica con «[Ragione sociale]» dentro.
//
// Qui si coprono i casi che passano dal codice; il banner e le pagine legali
// sono verificati dai test di interfaccia (e2e/interfaccia.spec.ts).
// ---------------------------------------------------------------------------

const ORG = 'org-1';
const BATCH = 'b1';

let db: FakeDb;

vi.mock('@/lib/supabase/service', () => ({ getServiceClient: () => db }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => ({ id: 'user-1' }),
  getUserOrg: async () => ({ organizationId: ORG }),
}));
vi.mock('@/lib/ownership', () => ({
  assertBatchAccess: async (batchId: string) =>
    db.rows('batches').some((b) => b.id === batchId && b.organization_id === ORG) ? ORG : null,
}));

vi.mock('@/lib/ricerca-brave', () => ({
  ricercaConfigurata: () => ricerca.configurata,
  getFornitoreRicerca: () => ({ nome: 'finta', cerca: async () => [] }),
}));
const ricerca = { configurata: false };

const { uploadBatchFiles, avviaListaSku, proseguiListaSku } = await import(
  '../actions/batch-wizard.js'
);

function seed() {
  db = new FakeDb({ schema: SCHEMA_APP });
  db.seed('organizations', [{ id: ORG, name: 'Prova' }]);
  db.seed('batches', [
    { id: BATCH, organization_id: ORG, status: 'draft', preset_version_id: 'v1', credits_reserved: 0 },
  ]);
}

/** Un caricamento come lo manda il browser. */
function caricamento(contenuto: string, nome = 'catalogo.csv') {
  const fd = new FormData();
  fd.append('batchId', BATCH);
  fd.append('sourceType', 'spreadsheet');
  fd.append('files', new File([contenuto], nome, { type: 'text/csv' }));
  return fd;
}

const messaggio = (r: unknown) => String((r as { error?: string }).error ?? '');

beforeEach(seed);

describe('file senza prodotti', () => {
  it('un file completamente vuoto viene respinto', async () => {
    const res = await uploadBatchFiles(caricamento(''));
    // Prima riceveva la spunta verde e l'utente scopriva il problema tre passi
    // dopo, davanti a «Nessun prodotto importato».
    expect(res.ok).toBe(false);
    expect(messaggio(res)).toMatch(/vuoto/i);
  });

  it('un file con la sola intestazione viene respinto, e dice perché', async () => {
    const res = await uploadBatchFiles(caricamento('sku,nome,formato'));
    expect(res.ok).toBe(false);
    // Il messaggio deve distinguere questo caso dal file vuoto: la causa e il
    // rimedio sono diversi (qui l'export si è fermato all'intestazione).
    expect(messaggio(res)).toMatch(/intestazione/i);
    expect(messaggio(res)).not.toMatch(/^Il file è vuoto/);
  });

  it('non lascia il file agganciato al batch', async () => {
    await uploadBatchFiles(caricamento('sku,nome'));
    // Un file registrato come sorgente valida farebbe credere all'analisi di
    // avere uno spreadsheet da leggere.
    expect(db.rows('source_items')).toHaveLength(0);
  });

  it('un file con una riga vera passa', async () => {
    const res = await uploadBatchFiles(caricamento('sku,nome\nOLIO-1,Olio EVO'));
    expect(res.ok).toBe(true);
    expect(db.rows('source_items')).toHaveLength(1);
  });

  it('quando passa non segnala nessun problema', async () => {
    const res = await uploadBatchFiles(caricamento('sku,nome\nOLIO-1,Olio EVO\nFORM-1,Pecorino'));
    expect(res.ok).toBe(true);
    const dati = (res as { data: { totalRows: number; file: { problem: string | null } } }).data;
    expect(dati.totalRows).toBe(2);
    expect(dati.file.problem).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// La prova, e la sua onestà.
//
// L'apertura della vetrina ora mostra una riga di listino accanto alla scheda
// che ne esce: è la dimostrazione della sola frase che distingue questo
// prodotto da un generatore di testo qualsiasi. Proprio per questo è il posto
// in cui una bugia costerebbe di più — un esempio che promette più di quello
// che il prodotto fa, o che si spaccia per il caso di un cliente vero.
// ---------------------------------------------------------------------------

describe('la prova nell’apertura non promette più di quello che c’è', () => {
  const prova = leggiFile('components/vetrina/dalla-riga-alla-scheda.tsx');

  it('ogni fatto della scheda sta anche nella riga', () => {
    // Il punto dell'esempio è che i numeri combacino. Se qualcuno domani
    // ritocca la descrizione per farla suonare meglio e ci infila un fatto che
    // nella riga non c'è, l'esempio dimostra il contrario di quello che dice.
    const riga = new Map(
      [...prova.matchAll(/\['([a-z_]+)', '([^']+)'\]/g)].map((m) => [m[1]!, m[2]!]),
    );
    expect(riga.size, 'la riga d’esempio è sparita').toBeGreaterThan(3);

    const scheda = prova.slice(prova.indexOf('const SCHEDA'), prova.indexOf('export function'));
    // I fatti verificabili: il grammaggio, la percentuale, l'origine, il vaso.
    for (const chiave of ['formato', 'origine', 'vaso', 'pomodoro_pct']) {
      const valore = riga.get(chiave);
      expect(valore, `manca «${chiave}» nella riga`).toBeTruthy();
      const nudo = valore!.replace(/\s+/g, '').toLowerCase();
      const testo = scheda.replace(/\s+/g, '').toLowerCase();
      expect(testo, `«${chiave}: ${valore}» non compare nella scheda`).toContain(nudo);
    }
  });

  it('è dichiarato per quello che è: un esempio', () => {
    // Un finto caso reale, su questa pagina, sarebbe esattamente il genere di
    // cosa che il prodotto promette di non fare.
    expect(prova).toMatch(/Esempio/);
  });

  it('non si vanta di cose che il prodotto non fa', () => {
    // Nessun numero di clienti, nessuna percentuale di precisione, nessun
    // premio: sono le tre cose che una pagina di apertura scrive per prima
    // quando comincia a mentire.
    for (const bugia of [/\d+ ?% (di )?(precisione|accuratezza)/i, /\bclienti\b/i, /garantit/i]) {
      expect(prova, `l’esempio promette «${bugia}»`).not.toMatch(bugia);
    }
  });
});

describe('il campione mostra i dati accanto alla prosa', () => {
  const prova = leggiFile('components/prova-del-campione.tsx');
  const runner = leggiFile('components/sample-runner.tsx');

  it('i fatti e la scheda stanno nello stesso riquadro, affiancati', () => {
    // Erano quattro riquadri impilati, con i fatti a 400 px dalla prosa che ne
    // era uscita: per collegarli bisognava scorrere su e giù e tenerli a mente.
    expect(prova).toMatch(/lg:grid-cols-\[/);
    expect(prova).toMatch(/Dal tuo file/);
    expect(prova).toMatch(/La scheda che ne esce/);
    expect(runner).toMatch(/<ProvaDelCampione/);
  });

  it('quello che nel file non c’era viene detto, non riempito', () => {
    // È la parte della promessa che costa di più mantenere. Nasconderla
    // sarebbe stato il modo più rapido di non meritarsela.
    expect(prova).toMatch(/mancanti/);
    expect(prova).toMatch(/Nel file non c’era/);
    expect(prova).toMatch(/non è stato inventato/i);
    expect(runner).toMatch(/mancanti=\{sample\.completeness\?\.missingAttributes \?\? \[\]\}/);
  });
});

describe('i risultati dicono cosa è stato consegnato', () => {
  it('il sottotitolo porta il conto, non solo le istruzioni', () => {
    // Diceva cosa si DEVE fare — «rivedi, modifica e approva» — e non quello
    // che si è ottenuto. Il numero che conta si poteva solo dedurre dai filtri,
    // che sono filtri.
    const pagina = leggiFile('app/app/batches/[batchId]/results/page.tsx');
    expect(pagina).toMatch(/frasiDiConsegna\(consegna\(rows\)\)/);
    expect(pagina).toMatch(/\{consegnata\}/);
    // E le istruzioni non sono sparite: sono scese accanto alla tabella.
    expect(pagina).toMatch(/Rivedi, modifica e approva/);
  });
});

describe('la ricerca online non configurata', () => {
  // Senza chiave il fornitore finto non trova niente, e ogni codice sarebbe
  // finito nel registro come «non trovato». Che è una RISPOSTA, non un guasto:
  // viene scritta, la cache la riusa per giorni, e quando la chiave arriva
  // quegli stessi codici continuano a risultare inesistenti senza che nessuno
  // abbia mai cercato niente. Il danno non è il messaggio: è il registro.
  beforeEach(() => {
    ricerca.configurata = false;
  });

  it('non mette in coda niente, e dice che il problema è la configurazione', async () => {
    const res = await avviaListaSku({
      batchId: BATCH,
      testo: 'SED-AUR-01\nSED-AUR-02',
      raggruppa: false,
      domini: [],
    });
    expect(res.ok).toBe(false);
    expect(messaggio(res)).toMatch(/non è configurata/i);
    // Il messaggio NON deve mandare a cercare il problema nei codici.
    expect(messaggio(res)).not.toMatch(/nessuna pagina trovata/i);
    // E soprattutto: nel registro non è stato scritto niente.
    expect(db.rows('sku_resolutions')).toHaveLength(0);
  });

  it('non riprende nemmeno una coda già esistente', async () => {
    // La configurazione può essere cambiata fra un giro e l'altro: una coda
    // messa in piedi ieri non deve poter girare a vuoto oggi.
    db.seed('sku_resolutions', [
      {
        id: 'r1',
        organization_id: ORG,
        batch_id: BATCH,
        codice_originale: 'SED-AUR-01',
        marca_originale: null,
        sku_membri: ['SED-AUR-01'],
        ambito: [],
        esito: 'in-coda',
        tentativi: 0,
      },
    ]);
    const res = await proseguiListaSku({ batchId: BATCH });
    expect(res.ok).toBe(false);
    expect(messaggio(res)).toMatch(/non è configurata/i);
    expect(db.byId('sku_resolutions', 'r1').esito).toBe('in-coda');
  });

  it('con la chiave configurata la coda parte', async () => {
    // Senza questa, le due prove qui sopra passerebbero anche se l'avvio fosse
    // rotto per sempre.
    ricerca.configurata = true;
    const res = await avviaListaSku({
      batchId: BATCH,
      testo: 'SED-AUR-01\nSED-AUR-02',
      raggruppa: false,
      domini: [],
    });
    expect(res.ok).toBe(true);
    expect(db.rows('sku_resolutions')).toHaveLength(2);
  });
});
