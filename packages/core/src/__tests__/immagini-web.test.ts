import { describe, expect, it } from 'vitest';
import {
  MAX_IMMAGINI_PRODOTTO,
  assegnaAlleVarianti,
  daScartare,
  selezionaImmagini,
  troppoPiccola,
  type ImmagineCandidata,
} from '../immagini-web.js';

// ---------------------------------------------------------------------------
// La scelta delle immagini di una pagina.
//
// Due cose da difendere. La prima: non prendere tutto — logo del negozio,
// badge dei pagamenti e icone dei social finirebbero nella scheda del cliente e
// nel suo storage. La seconda, che pesa di più: quando la pagina non dice a
// quale colore appartiene una foto, non si indovina. Assegnare a occhio
// funziona finché il catalogo non ha due rossi diversi, e allora mette in
// vetrina la foto sbagliata accanto al codice giusto.
// ---------------------------------------------------------------------------

function img(url: string, over: Partial<ImmagineCandidata> = {}): ImmagineCandidata {
  return { url, larghezza: 1000, altezza: 1000, ...over };
}

describe('daScartare', () => {
  it('butta via quello che non è una foto di prodotto', () => {
    for (const url of [
      'https://x.it/assets/logo.png',
      'https://x.it/img/banner-saldi.jpg',
      'https://x.it/icons/instagram.png',
      'https://x.it/badge-visa.png',
      'https://x.it/placeholder.jpg',
      'https://x.it/img/spinner.gif',
    ]) {
      expect(daScartare(img(url))).toBe(true);
    }
  });

  it('guarda anche il testo alternativo, non solo l’indirizzo', () => {
    // Un indirizzo può essere `/media/8f3a2b.jpg` e non dire niente: l'alt sì.
    expect(daScartare(img('https://x.it/media/8f3a2b.jpg', { alt: 'Logo Ferrini' }))).toBe(true);
  });

  it('tiene una foto di prodotto normale', () => {
    expect(daScartare(img('https://x.it/media/sedia-aurora-fronte.jpg', { alt: 'Sedia Aurora' }))).toBe(false);
  });

  it('scarta SVG e immagini incorporate nell’indirizzo', () => {
    // Una foto vera pesa troppo per stare dentro un `data:`; un SVG è un
    // disegno, cioè un'icona.
    expect(daScartare(img('https://x.it/media/foto.svg'))).toBe(true);
    expect(daScartare(img('data:image/png;base64,AAAA'))).toBe(true);
  });

  it('scarta quello che non è nemmeno un indirizzo', () => {
    expect(daScartare(img('/relativo/foto.jpg'))).toBe(true);
    expect(daScartare(img(''))).toBe(true);
  });
});

describe('troppoPiccola', () => {
  it('scarta le miniature', () => {
    expect(troppoPiccola(img('https://x.it/a.jpg', { larghezza: 80, altezza: 80 }))).toBe(true);
  });

  it('basta un lato sotto la misura', () => {
    expect(troppoPiccola(img('https://x.it/a.jpg', { larghezza: 1200, altezza: 100 }))).toBe(true);
  });

  it('misure non dichiarate NON sono misure piccole', () => {
    // Tante pagine non dichiarano le dimensioni. Scartarle qui vorrebbe dire
    // perdere le loro foto senza averle mai guardate: chi scarica il file le
    // misurerà davvero.
    expect(troppoPiccola(img('https://x.it/a.jpg', { larghezza: null, altezza: null }))).toBe(false);
  });
});

describe('selezionaImmagini', () => {
  it('mette per prima quella che la pagina dichiara principale', () => {
    const scelte = selezionaImmagini([
      img('https://x.it/2.jpg', { posizione: 2 }),
      img('https://x.it/main.jpg', { principale: true, posizione: 5 }),
      img('https://x.it/1.jpg', { posizione: 1 }),
    ]);
    expect(scelte[0]!.url).toBe('https://x.it/main.jpg');
    expect(scelte[0]!.motivoOrdine).toMatch(/principale/i);
  });

  it('poi segue la posizione in galleria', () => {
    const scelte = selezionaImmagini([
      img('https://x.it/c.jpg', { posizione: 3 }),
      img('https://x.it/a.jpg', { posizione: 1 }),
      img('https://x.it/b.jpg', { posizione: 2 }),
    ]);
    expect(scelte.map((s) => s.url)).toEqual([
      'https://x.it/a.jpg',
      'https://x.it/b.jpg',
      'https://x.it/c.jpg',
    ]);
  });

  it('a parità resta l’ordine di comparsa', () => {
    // Un ordinamento che rimescola rende l'import non ripetibile: due
    // esecuzioni sullo stesso catalogo darebbero due copertine diverse.
    const scelte = selezionaImmagini([
      img('https://x.it/primo.jpg'),
      img('https://x.it/secondo.jpg'),
      img('https://x.it/terzo.jpg'),
    ]);
    expect(scelte.map((s) => s.url)).toEqual([
      'https://x.it/primo.jpg',
      'https://x.it/secondo.jpg',
      'https://x.it/terzo.jpg',
    ]);
  });

  it('la stessa foto non viene tenuta due volte', () => {
    const scelte = selezionaImmagini([img('https://x.it/a.jpg'), img('https://x.it/a.jpg')]);
    expect(scelte).toHaveLength(1);
  });

  it('scarta e limita insieme', () => {
    const molte = [
      img('https://x.it/logo.png'),
      ...Array.from({ length: 20 }, (_, i) => img(`https://x.it/foto${i}.jpg`, { posizione: i })),
    ];
    const scelte = selezionaImmagini(molte);
    expect(scelte).toHaveLength(MAX_IMMAGINI_PRODOTTO);
    expect(scelte.some((s) => s.url.includes('logo'))).toBe(false);
  });

  it('una pagina senza foto utili non ne produce', () => {
    expect(selezionaImmagini([img('https://x.it/logo.png'), img('https://x.it/badge.png')])).toEqual([]);
    expect(selezionaImmagini([])).toEqual([]);
  });
});

describe('assegnaAlleVarianti', () => {
  const rosso = selezionaImmagini([img('https://x.it/r.jpg', { varianteDichiarata: 'Rosso' })]);
  const senza = selezionaImmagini([img('https://x.it/g.jpg')]);

  it('assegna solo quello che la pagina dichiara', () => {
    const a = assegnaAlleVarianti([...rosso, ...senza], ['Rosso', 'Blu']);
    expect(a.perVariante.get('Rosso')!.map((i) => i.url)).toEqual(['https://x.it/r.jpg']);
    expect(a.alProdotto.map((i) => i.url)).toEqual(['https://x.it/g.jpg']);
  });

  it('quando la pagina non dichiara niente, tutto resta al prodotto', () => {
    // Il caso normale, ed è quello in cui NON si indovina: non c'è modo onesto
    // di sapere quale foto sia di quale colore.
    const a = assegnaAlleVarianti(senza, ['Rosso', 'Blu']);
    expect(a.perVariante.size).toBe(0);
    expect(a.alProdotto).toHaveLength(1);
  });

  it('dice quando una variante eredita le foto del prodotto', () => {
    // Va mostrato, non nascosto: chi guarda deve sapere che quella foto non è
    // della sua colorazione.
    const a = assegnaAlleVarianti([...rosso, ...senza], ['Rosso', 'Blu']);
    expect(a.ereditano).toBe(true);
  });

  it('se ogni variante ha le sue, nessuna eredita', () => {
    const tutte = selezionaImmagini([
      img('https://x.it/r.jpg', { varianteDichiarata: 'Rosso' }),
      img('https://x.it/b.jpg', { varianteDichiarata: 'Blu' }),
    ]);
    expect(assegnaAlleVarianti(tutte, ['Rosso', 'Blu']).ereditano).toBe(false);
  });

  it('una variante dichiarata dalla pagina ma non caricata non ne crea una nuova', () => {
    // La pagina ha otto colori, il cliente ne ha caricati due: gli altri sei
    // sono una segnalazione da mostrargli, non roba da mettergli a catalogo.
    const verde = selezionaImmagini([img('https://x.it/v.jpg', { varianteDichiarata: 'Verde' })]);
    const a = assegnaAlleVarianti(verde, ['Rosso', 'Blu']);
    expect(a.perVariante.has('Verde')).toBe(false);
    expect(a.alProdotto).toHaveLength(1);
  });

  it('maiuscole e spazi non impediscono l’aggancio', () => {
    const r = selezionaImmagini([img('https://x.it/r.jpg', { varianteDichiarata: ' rosso ' })]);
    expect(assegnaAlleVarianti(r, ['Rosso']).perVariante.get('Rosso')).toHaveLength(1);
  });
});
