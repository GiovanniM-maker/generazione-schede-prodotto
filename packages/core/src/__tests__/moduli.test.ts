import { describe, expect, it } from 'vitest';
import { mostraErrore, puoInviare, riassuntoErrori } from '../moduli.js';

const ORDINE = [
  { id: 'nome', etichetta: 'Nome' },
  { id: 'prezzo', etichetta: 'Prezzo' },
  { id: 'email', etichetta: 'Email' },
];

describe('il sommario degli errori', () => {
  it('non dice niente quando non c’è niente', () => {
    const r = riassuntoErrori({}, ORDINE);
    expect(r.quanti).toBe(0);
    expect(r.titolo).toBe('');
    expect(r.primo).toBeNull();
  });

  it('con un campo solo lo nomina invece di contarlo', () => {
    // «1 campo da sistemare» costringe ad andare a cercare quale. Dirlo costa
    // le stesse parole e risparmia il viaggio.
    const r = riassuntoErrori({ prezzo: 'Ha due virgole.' }, ORDINE);
    expect(r.titolo).toBe('Prezzo: Ha due virgole.');
    expect(r.primo).toBe('prezzo');
  });

  it('da due in su conta', () => {
    const r = riassuntoErrori({ nome: 'Serve.', prezzo: 'Due virgole.' }, ORDINE);
    expect(r.titolo).toBe('2 campi da sistemare');
  });

  it('conta i CAMPI, non i messaggi', () => {
    // Un campo con due problemi resta un campo: «5 errori» su tre campi fa
    // sembrare il modulo peggio di com'è, e non dice quante volte ci si dovrà
    // fermare.
    const r = riassuntoErrori({ nome: 'Serve.', prezzo: 'Due virgole.', email: 'Manca la @.' }, ORDINE);
    expect(r.quanti).toBe(3);
    expect(r.campi).toHaveLength(3);
  });

  it('segue l’ordine della pagina, non quello del validatore', () => {
    // IL CASO CHE CONTA. Chi legge «tre campi da sistemare» e preme il
    // sommario si aspetta di essere portato in cima al modulo. Con l'ordine di
    // validazione si finisce a metà, si corregge, e si torna su — a rimbalzo.
    const r = riassuntoErrori(
      { email: 'Manca la @.', nome: 'Serve.' },   // ordine di scoperta: email prima
      ORDINE,                                      // ordine di pagina: nome prima
    );
    expect(r.campi.map((c) => c.id)).toEqual(['nome', 'email']);
    expect(r.primo).toBe('nome');
  });

  it('ignora i messaggi vuoti e gli spazi', () => {
    // Un validatore che azzera un errore spesso ci mette '' invece di null.
    const r = riassuntoErrori({ nome: '', prezzo: '   ', email: null }, ORDINE);
    expect(r.quanti).toBe(0);
  });

  it('ignora gli errori di campi che non stanno nel modulo', () => {
    // Capita con i moduli a passi: il validatore conosce tutti i campi, la
    // pagina ne mostra tre. Contare anche gli altri direbbe «5 campi da
    // sistemare» in una schermata che ne ha tre.
    const r = riassuntoErrori({ nome: 'Serve.', fantasma: 'Boh.' }, ORDINE);
    expect(r.quanti).toBe(1);
  });

  it('regge dati assenti', () => {
    expect(() => riassuntoErrori(undefined as never, undefined as never)).not.toThrow();
  });
});

describe('se il modulo si può inviare', () => {
  it('sì finché non è stato trovato niente', () => {
    // È la regola che tiene il comando ACCESO. Un pulsante grigio non sa dire
    // perché è grigio, e su telefono l'autocompilazione spesso non fa scattare
    // la validazione: il modulo è giusto e il comando resta spento.
    expect(puoInviare({})).toBe(true);
    expect(puoInviare({ nome: null, prezzo: '' })).toBe(true);
  });

  it('no quando un errore c’è già', () => {
    expect(puoInviare({ nome: 'Serve.' })).toBe(false);
  });
});

describe('quando si mostra l’errore di un campo', () => {
  const base = { toccato: false, inviato: false, giaSbagliato: false, scrivendo: false };

  it('zitti mentre si scrive la prima volta', () => {
    // Chi scrive «gio» in un campo email vedrebbe «indirizzo non valido» prima
    // di aver finito il nome: la validazione diventa un rimprovero continuo.
    expect(mostraErrore({ ...base, scrivendo: true })).toBe(false);
  });

  it('zitti anche tornando su un campo già visitato', () => {
    // QUESTA È LA PROVA CHE CONTA, e la prima versione non c'era: con
    // `toccato: false` il risultato è `false` comunque, quindi la prova sopra
    // resta verde anche togliendo del tutto la regola sullo scrivere. Verde
    // per assenza di bersaglio.
    //
    // Il caso vero è chi esce dal campo, ci rientra e ricomincia a scrivere:
    // lì `toccato` è già `true`, e senza la regola l'errore tornerebbe a
    // lampeggiare a ogni tasto.
    expect(mostraErrore({ ...base, toccato: true, scrivendo: true })).toBe(false);
  });

  it('si dice uscendo dal campo', () => {
    expect(mostraErrore({ ...base, toccato: true })).toBe(true);
  });

  it('si dice comunque all’invio, anche su un campo mai toccato', () => {
    expect(mostraErrore({ ...base, inviato: true })).toBe(true);
  });

  it('una volta detto, si corregge mentre si scrive', () => {
    // Senza questo, chi sta rimediando dovrebbe uscire di nuovo dal campo per
    // sapere se è a posto: si scrive alla cieca.
    expect(mostraErrore({ ...base, giaSbagliato: true, scrivendo: true })).toBe(true);
  });
});
