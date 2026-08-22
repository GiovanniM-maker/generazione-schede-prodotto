import { describe, expect, it } from 'vitest';
import { aspettoComando, motivoMancante } from '../comandi.js';

describe('come si presenta un comando', () => {
  it('pronto: non tocca niente', () => {
    const a = aspettoComando({});
    expect(a.modo).toBe('pronto');
    expect(a.spentoDavvero).toBe(false);
    expect(a.dichiaratoSpento).toBe(false);
    expect(a.ignoraClic).toBe(false);
    expect(a.aggiuntaAlNome).toBe('');
  });

  it('mentre lavora si spegne DAVVERO', () => {
    // Qui `disabled` è giusto: dura il tempo di una richiesta, e serve a non
    // mandare la stessa cosa due volte. Perdere il fuoco per mezzo secondo è
    // un prezzo accettabile.
    const a = aspettoComando({ lavora: true });
    expect(a.modo).toBe('lavora');
    expect(a.spentoDavvero).toBe(true);
    expect(a.dichiaratoSpento).toBe(false);
  });

  it('non disponibile NON usa `disabled`, ed è il punto di tutto', () => {
    // QUESTA È LA PROVA CHE CONTA. Un elemento `disabled` non prende il fuoco:
    // con la tastiera lo si salta, quindi non si scopre nemmeno che esiste, e
    // il motivo per cui è spento non lo si può leggere. Con `aria-disabled` il
    // comando resta raggiungibile: non fa niente, ma è un niente che si capisce.
    const a = aspettoComando({ motivo: 'Il preset è pubblicato: duplicalo per modificarlo.' });
    expect(a.modo).toBe('nonDisponibile');
    expect(a.spentoDavvero, 'un comando irraggiungibile nasconde la funzione').toBe(false);
    expect(a.dichiaratoSpento).toBe(true);
    expect(a.ignoraClic).toBe(true);
  });

  it('il motivo entra nel NOME, non in una descrizione', () => {
    // Le descrizioni sono facoltative e molti lettori le saltano. Il nome viene
    // letto sempre: se il comando non si può usare, il perché deve stare lì.
    expect(aspettoComando({ motivo: 'Completa la bozza.' }).aggiuntaAlNome).toBe(
      'Completa la bozza.',
    );
  });

  it('lavorare vince sul motivo', () => {
    // Un comando che è partito e intanto porta ancora addosso il motivo per cui
    // prima era spento racconta una cosa vecchia proprio nel momento in cui ne
    // sta succedendo una nuova.
    const a = aspettoComando({ lavora: true, motivo: 'Serve prima: il nome.' });
    expect(a.modo).toBe('lavora');
    expect(a.aggiuntaAlNome).toBe('');
    expect(a.spentoDavvero).toBe(true);
  });

  it('un motivo di soli spazi non è un motivo', () => {
    // Capita: `motivo={errore ?? ''}`. Senza questo, il comando resterebbe
    // spento per una stringa vuota — spento senza nemmeno un perché.
    expect(aspettoComando({ motivo: '   ' }).modo).toBe('pronto');
    expect(aspettoComando({ motivo: null }).modo).toBe('pronto');
    expect(aspettoComando({ motivo: undefined }).modo).toBe('pronto');
  });

  it('regge dati assenti', () => {
    expect(() => aspettoComando(undefined as never)).toThrow();
    expect(aspettoComando({ lavora: false, motivo: '' }).modo).toBe('pronto');
  });
});

describe('il motivo che si costruisce dalle condizioni', () => {
  it('niente da dire quando non manca niente', () => {
    expect(motivoMancante([{ manca: false, cosa: 'il nome' }])).toBe('');
    expect(motivoMancante([])).toBe('');
  });

  it('con una condizione sola la nomina', () => {
    expect(motivoMancante([{ manca: true, cosa: 'il nome del lavoro' }])).toBe(
      'Serve prima: il nome del lavoro.',
    );
  });

  it('con più condizioni le nomina tutte', () => {
    // «Completa il modulo» costringe a rileggere tutto per capire quale pezzo
    // manchi. Elencarli costa le stesse parole.
    expect(
      motivoMancante([
        { manca: true, cosa: 'il nome' },
        { manca: false, cosa: 'il settore' },
        { manca: true, cosa: 'almeno una categoria' },
      ]),
    ).toBe('Serve prima: il nome e almeno una categoria.');
  });

  it('con tre usa le virgole e una «e» sola', () => {
    expect(
      motivoMancante([
        { manca: true, cosa: 'a' },
        { manca: true, cosa: 'b' },
        { manca: true, cosa: 'c' },
      ]),
    ).toBe('Serve prima: a, b e c.');
  });

  it('salta le condizioni senza testo invece di lasciare un buco', () => {
    // Un elenco che dice «Serve prima: il nome e .» è peggio di uno che non
    // dice niente: sembra un difetto del prodotto, non un requisito.
    expect(
      motivoMancante([
        { manca: true, cosa: 'il nome' },
        { manca: true, cosa: '  ' },
      ]),
    ).toBe('Serve prima: il nome.');
  });

  it('regge dati assenti', () => {
    expect(motivoMancante(undefined as never)).toBe('');
  });
});
