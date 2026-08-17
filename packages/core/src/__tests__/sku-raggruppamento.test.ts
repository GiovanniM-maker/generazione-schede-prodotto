import { describe, expect, it } from 'vitest';
import {
  anteprimaCosti,
  applicaRegola,
  normalizzaSku,
  proponiRaggruppamenti,
  proponiRaggruppamento,
  raggruppa,
  type RegolaRaggruppamento,
} from '../sku-raggruppamento.js';

// ---------------------------------------------------------------------------
// Il raggruppamento degli SKU in prodotti e varianti.
//
// Le prove qui sotto difendono due cose diverse, e la seconda conta più della
// prima: che il raggruppamento GIUSTO venga trovato, e che quello SBAGLIATO
// non venga proposto con sicurezza. Fondere due articoli diversi in una scheda
// sola è un errore silenzioso — ogni campo è letto bene, solo dal prodotto
// sbagliato — e nessun controllo a valle lo intercetta.
// ---------------------------------------------------------------------------

const ULTIMO: RegolaRaggruppamento = {
  tipo: 'taglia-ultimo-pezzo',
  descrizione: 'test',
};
const ULTIMI_DUE: RegolaRaggruppamento = {
  tipo: 'taglia-ultimi-due-pezzi',
  descrizione: 'test',
};

describe('normalizzaSku', () => {
  it('uniforma maiuscole, accenti e separatori, e tiene l’originale', () => {
    const n = normalizzaSku(' ab_12.rèd ');
    expect(n.originale).toBe('ab_12.rèd');
    expect(n.normalizzato).toBe('AB-12-RED');
    expect(n.compatto).toBe('AB12RED');
  });

  it('la forma compatta rende uguali due scritture dello stesso codice', () => {
    // È il motivo per cui la forma compatta esiste: il produttore scrive
    // «AB-12-RED», il gestionale del cliente «ab12red». Cercarne una sola vuol
    // dire non trovare la pagina.
    expect(normalizzaSku('AB-12-RED').compatto).toBe(normalizzaSku('ab12red').compatto);
    expect(normalizzaSku('AB-12-RED').normalizzato).not.toBe(normalizzaSku('ab12red').normalizzato);
  });

  it('non lascia separatori doppi né ai bordi', () => {
    expect(normalizzaSku('--AB__12--').normalizzato).toBe('AB-12');
  });

  it('una stringa vuota non esplode', () => {
    expect(normalizzaSku('   ').normalizzato).toBe('');
    expect(normalizzaSku('').compatto).toBe('');
  });
});

describe('applicaRegola', () => {
  it('toglie l’ultimo pezzo, o gli ultimi due', () => {
    expect(applicaRegola('MOD-RED-S', ULTIMO)).toBe('MOD-RED');
    expect(applicaRegola('MOD-RED-S', ULTIMI_DUE)).toBe('MOD');
  });

  it('non lascia mai un codice modello vuoto', () => {
    // «RED-S» non ha un modello da cui derivare: togliere l’ultimo pezzo
    // lascerebbe «RED», togliere due lascerebbe niente. Meglio dire che la
    // regola non si applica che restituire un gruppo fantasma a cui poi
    // finirebbero attaccati codici scorrelati.
    expect(applicaRegola('RED-S', ULTIMI_DUE)).toBeNull();
    expect(applicaRegola('SOLO', ULTIMO)).toBeNull();
  });

  it('il prefisso fisso si applica solo se il codice è più lungo', () => {
    const regola: RegolaRaggruppamento = { tipo: 'prefisso-fisso', lunghezza: 6, descrizione: 't' };
    expect(applicaRegola('ABC123RED', regola)).toBe('ABC123');
    expect(applicaRegola('ABC123', regola)).toBeNull();
    expect(applicaRegola('ABC', regola)).toBeNull();
  });

  it('normalizza prima di tagliare', () => {
    expect(applicaRegola('mod_red_s', ULTIMO)).toBe('MOD-RED');
  });
});

describe('raggruppa', () => {
  it('un gruppo di uno solo non è un gruppo', () => {
    // Senza questa regola un codice isolato produrrebbe un «prodotto con una
    // variante», che è una complicazione senza contropartita: è un prodotto.
    const r = raggruppa(['MOD-RED-S', 'MOD-RED-M', 'ALTRO-BLU-S'], ULTIMO);
    expect(r.gruppi).toHaveLength(1);
    expect(r.gruppi[0]!.codiceModello).toBe('MOD-RED');
    expect(r.nonRaggruppati).toEqual(['ALTRO-BLU-S']);
  });

  it('tiene i suffissi allineati agli SKU', () => {
    const r = raggruppa(['MOD-RED-S', 'MOD-RED-M'], ULTIMO);
    expect(r.gruppi[0]!.sku).toEqual(['MOD-RED-S', 'MOD-RED-M']);
    expect(r.gruppi[0]!.suffissi).toEqual(['S', 'M']);
  });

  it('gli SKU restano nella forma originale, non normalizzata', () => {
    // Lo SKU è la chiave verso il gestionale del cliente e verso l’export:
    // restituirlo maiuscolo lo scollegherebbe dalle sue stesse righe.
    const r = raggruppa(['mod-red-s', 'mod-red-m'], ULTIMO);
    expect(r.gruppi[0]!.sku).toEqual(['mod-red-s', 'mod-red-m']);
  });

  it('i codici a cui la regola non si applica non spariscono', () => {
    const r = raggruppa(['MOD-RED-S', 'MOD-RED-M', 'SINGOLO'], ULTIMO);
    expect([...r.gruppi.flatMap((g) => g.sku), ...r.nonRaggruppati].sort()).toEqual(
      ['MOD-RED-M', 'MOD-RED-S', 'SINGOLO'].sort(),
    );
  });
});

describe('proponiRaggruppamento — quando deve trovare', () => {
  it('otto codici colore dello stesso modello diventano un prodotto', () => {
    // È il caso della specifica, ed è quello che vale otto crediti contro uno.
    const skus = ['TS100-RED', 'TS100-BLU', 'TS100-NER', 'TS100-VER', 'TS100-GIA', 'TS100-BIA', 'TS100-GRI', 'TS100-ROS'];
    const p = proponiRaggruppamento(skus)!;
    expect(p).not.toBeNull();
    expect(p.prodotti).toBe(1);
    expect(p.varianti).toBe(8);
    expect(p.gruppi[0]!.codiceModello).toBe('TS100');
    // Proposto, ma senza spacciarlo per certo: dai soli codici questo caso è
    // indistinguibile da otto articoli diversi che cominciano uguale.
    expect(p.forza).toBeLessThan(0.5);
    expect(p.motivi.join(' ')).toMatch(/Controlla il campione/i);
  });

  it('riconosce un sistema di codifica dai suffissi che tornano', () => {
    // Quattro modelli, gli stessi due colori: i suffissi ricorrono, ed è il
    // segnale che questa non è una coincidenza ma una codifica.
    const skus = [
      'TS100-RED', 'TS100-BLU',
      'TS200-RED', 'TS200-BLU',
      'PL300-RED', 'PL300-BLU',
      'PL400-RED', 'PL400-BLU',
    ];
    const p = proponiRaggruppamento(skus)!;
    expect(p.prodotti).toBe(4);
    expect(p.varianti).toBe(8);
    expect(p.forza).toBeGreaterThan(0.9);
    expect(p.motivi.join(' ')).toMatch(/sistema di codifica/i);
  });

  it('offre entrambe le letture di modello-colore-taglia, la più prudente per prima', () => {
    // Qui i segnali NON distinguono: togliendo un pezzo si ottengono quattro
    // prodotti (una scheda per colorazione, che nella moda è normale),
    // togliendone due se ne ottengono due (colore e taglia come varianti).
    // Entrambe le regole hanno suffissi che ricorrono su tutti i gruppi.
    //
    // A parità, viene prima quella che lascia più prodotti: separare di troppo
    // costa un credito e si vede, fondere di troppo produce una scheda che
    // descrive il prodotto sbagliato e non si vede. L'altra resta offerta.
    const skus = [
      'TS100-RED-S', 'TS100-RED-M', 'TS100-BLU-S', 'TS100-BLU-M',
      'PL200-RED-S', 'PL200-RED-M', 'PL200-BLU-S', 'PL200-BLU-M',
    ];
    const proposte = proponiRaggruppamenti(skus);
    expect(proposte).toHaveLength(2);
    expect(proposte[0]!.regola.tipo).toBe('taglia-ultimo-pezzo');
    expect(proposte[0]!.prodotti).toBe(4);
    expect(proposte[1]!.regola.tipo).toBe('taglia-ultimi-due-pezzi');
    expect(proposte[1]!.prodotti).toBe(2);
    expect(proponiRaggruppamento(skus)!.prodotti).toBe(4);
  });

  it('i codici non raggruppabili restano prodotti a sé, e si contano', () => {
    const skus = ['TS100-RED', 'TS100-BLU', 'TS200-RED', 'TS200-BLU', 'ARTICOLOUNICO'];
    const p = proponiRaggruppamento(skus)!;
    expect(p.gruppi).toHaveLength(2);
    expect(p.prodotti).toBe(3);
    expect(p.varianti).toBe(5);
  });
});

describe('proponiRaggruppamento — quando NON deve proporre', () => {
  it('non propone niente su codici che non hanno modelli in comune', () => {
    // Cinque articoli scorrelati. Togliendo l’ultimo pezzo non si formano
    // gruppi, e la risposta onesta è «non lo so», non un raggruppamento a caso.
    const p = proponiRaggruppamento(['ABC-111', 'DEF-222', 'GHI-333', 'JKL-444', 'MNO-555']);
    expect(p).toBeNull();
  });

  it('quando tutto finisce in un prodotto solo lo dice, invece di fingere sicurezza', () => {
    // Quattro articoli diversi che per caso cominciano uguale. Hanno la stessa
    // identica forma di «TS100-RED, TS100-BLU»: nessun segnale nei codici
    // separa i due casi. La proposta si fa — sarebbe peggio nasconderla e
    // lasciare che il cliente paghi otto crediti per otto colori — ma arriva
    // con forza bassa e con scritto perché.
    const p = proponiRaggruppamento(['CAT-SEDIA', 'CAT-TAVOLO', 'CAT-LAMPADA', 'CAT-DIVANO'])!;
    expect(p.prodotti).toBe(1);
    expect(p.forza).toBeLessThan(0.5);
    expect(p.motivi.join(' ')).toMatch(/non si può distinguere/i);
  });

  it('con meno di due codici non c’è niente da raggruppare', () => {
    expect(proponiRaggruppamento([])).toBeNull();
    expect(proponiRaggruppamento(['SOLO-UNO'])).toBeNull();
  });

  it('ignora le righe vuote invece di contarle', () => {
    const p = proponiRaggruppamento(['TS100-RED', '', '   ', 'TS100-BLU'])!;
    expect(p.varianti).toBe(2);
  });

  it('un raggruppamento senza suffissi ricorrenti è debole, e lo dice', () => {
    // Due gruppi, suffissi tutti diversi: potrebbe essere giusto, ma non c’è
    // niente che lo sostenga. Deve arrivare all’utente con forza bassa e col
    // motivo scritto, non con un numero alto e basta.
    const p = proponiRaggruppamento(['AA-11', 'AA-22', 'BB-33', 'BB-44'])!;
    expect(p.forza).toBeLessThan(0.5);
    expect(p.motivi.join(' ')).toMatch(/potrebbe star tagliando/i);
  });

  it('con un gruppo solo dichiara che la ricorrenza non è misurabile', () => {
    const p = proponiRaggruppamento(['TS100-RED', 'TS100-BLU'])!;
    expect(p.forza).toBeLessThan(0.5);
    expect(p.motivi.join(' ')).toMatch(/non c’è modo di verificare/i);
  });

  it('non c’è modo di distinguere il caso buono dal caso cattivo, e le due proposte lo mostrano', () => {
    // Prova di coerenza, non di comportamento: due liste con significati
    // opposti devono ricevere lo stesso trattamento, perché nei codici sono
    // la stessa cosa. Se un giorno una delle due passasse con forza alta,
    // vorrebbe dire che qualcuno ha messo un'euristica a indovinare.
    const buono = proponiRaggruppamento(['TS100-RED', 'TS100-BLU'])!;
    const cattivo = proponiRaggruppamento(['CAT-SEDIA', 'CAT-TAVOLO'])!;
    expect(buono.forza).toBe(cattivo.forza);
    expect(buono.prodotti).toBe(cattivo.prodotti);
  });
});

describe('anteprimaCosti', () => {
  it('mostra il risparmio in crediti fra le due scelte', () => {
    const a = anteprimaCosti(500, 60);
    expect(a.creditiSenzaRaggruppamento).toBe(500);
    expect(a.creditiRaggruppati).toBe(60);
    expect(a.creditiRisparmiati).toBe(440);
  });

  it('senza raggruppamento il risparmio è zero, non negativo', () => {
    const a = anteprimaCosti(40, 40);
    expect(a.creditiRisparmiati).toBe(0);
  });

  it('non può promettere più prodotti degli SKU caricati', () => {
    // Un numero incoerente in ingresso non deve diventare un risparmio
    // negativo mostrato al cliente.
    const a = anteprimaCosti(10, 99);
    expect(a.prodottiRaggruppati).toBe(10);
    expect(a.creditiRisparmiati).toBe(0);
  });
});
