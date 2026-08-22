'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import {
  CURVE,
  DURATE,
} from '@app/core/interfaccia';
import {
  collocaSuggerimento,
  FRECCIA_PX,
  legaSuggerimento,
  nomeAmmesso,
  RITARDO_CHIUSURA_MS,
  ritardoApertura,
  type Collocazione,
  type Lato,
  type MotivoApertura,
} from '@app/core/suggerimento';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Il suggerimento che esiste anche su un dito.
//
// IL DIFETTO CHE CHIUDE. Ventisei `title` nativi del browser, di cui venti su
// comandi fatti di sola icona. Su telefono il `title` NON COMPARE MAI — non
// esiste il passaggio del puntatore — quindi «Rinomina», «Duplica»,
// «Archivia», «Sposta su», «Elimina batch» restavano icone senza nome. Non è un
// dettaglio di rifinitura: è metà della barra di comandi di ogni tabella del
// prodotto che su telefono va indovinata.
//
// E anche col mouse il `title` è un mezzo fallimento: compare dopo un secondo e
// mezzo deciso dal sistema operativo, in un riquadro che non si può disegnare,
// sparisce da solo dopo pochi secondi, e diversi lettori di schermo non lo
// annunciano affatto.
//
// COSA FA QUESTO COMPONENTE. Mette il testo dove serve davvero — nel NOME
// accessibile del comando, dove sta sempre — e ne disegna una copia visibile per
// chi usa il puntatore o la tastiera. Le due cose sono separate apposta: il
// riquadro che si vede è `aria-hidden`, perché il testo è già annunciato dal
// nome. Un lettore di schermo che lo leggesse due volte sarebbe peggio di uno
// che non lo legge.
//
// DOVE resta il `title` nativo: sulle celle troncate. Lì il testo è GIÀ a
// schermo, solo tagliato, e il `title` è il modo del browser di darne il
// seguito. Montarci sopra un componente vorrebbe dire un listener per ogni cella
// di ogni riga.
//
// QUELLO CHE ANCORA NON RISOLVE: un comando SPENTO non emette eventi del
// puntatore, quindi il suo suggerimento non compare proprio quando servirebbe di
// più — cioè per dire perché è spento. Si rimedia con `avvolgi`, che sposta
// l'ascolto su un contenitore attorno; la soluzione vera (spento ma
// raggiungibile) è un'altra tappa.
// ---------------------------------------------------------------------------

/** Da quanto è chiuso l'ultimo riquadro: serve all'eco. Vedi `ritardoApertura`. */
let ultimaChiusura: number | null = null;

/** Dove si appoggia la punta, dato il lato e lo scostamento calcolati nel core. */
function puntaDi(c: Collocazione): React.CSSProperties {
  const meta = FRECCIA_PX / 2;
  switch (c.lato) {
    case 'sopra':
      return { left: c.freccia - meta, bottom: -meta };
    case 'sotto':
      return { left: c.freccia - meta, top: -meta };
    case 'sinistra':
      return { top: c.freccia - meta, right: -meta };
    case 'destra':
      return { top: c.freccia - meta, left: -meta };
  }
}

interface ProprietaSuggerimento {
  testo: string;
  /** Il lato preferito. Si ribalta da solo se non ci sta. */
  lato?: Lato;
  /**
   * Il testo DESCRIVE l'ancora invece di darle il nome.
   *
   * Da mettere ogni volta che l'ancora ha già un nome — un'etichetta a schermo
   * o un `aria-label` suo. Senza, il testo lungo diventerebbe il nome del
   * comando e cancellerebbe quello corto che si legge: chi comanda a voce dice
   * quello che vede, e da quel momento non funzionerebbe più.
   */
  descrizione?: boolean;
  /**
   * Le classi di un contenitore attorno all'ancora, che ascolta al posto suo.
   *
   * Serve SOLO quando l'ancora può essere spenta: un controllo `disabled` non
   * emette eventi del puntatore, quindi il suo suggerimento non comparirebbe
   * proprio nel caso in cui spiega perché è spento.
   */
  avvolgi?: string;
  children: React.ReactElement;
}

export function Suggerimento({
  testo,
  lato = 'sopra',
  descrizione = false,
  avvolgi,
  children,
}: ProprietaSuggerimento) {
  const id = React.useId();
  const [aperto, setAperto] = React.useState(false);
  const [collocazione, setCollocazione] = React.useState<Collocazione | null>(null);
  const [visibile, setVisibile] = React.useState(false);
  const [montato, setMontato] = React.useState(false);

  const ancora = React.useRef<HTMLElement | null>(null);
  const riquadro = React.useRef<HTMLDivElement | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => setMontato(true), []);

  const legame = React.useMemo(
    () => legaSuggerimento({ id, testo, ancoraParlante: descrizione }),
    [id, testo, descrizione],
  );

  const fermaTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const chiudi = React.useCallback((subito = false) => {
    fermaTimer();
    const spegni = () => {
      setAperto((era) => {
        if (era) ultimaChiusura = Date.now();
        return false;
      });
    };
    if (subito) spegni();
    else timer.current = setTimeout(spegni, RITARDO_CHIUSURA_MS);
  }, []);

  const apri = React.useCallback((motivo: MotivoApertura) => {
    fermaTimer();
    const attesa = ritardoApertura({
      motivo,
      msDallUltimaChiusura: ultimaChiusura === null ? null : Date.now() - ultimaChiusura,
    });
    if (attesa === 0) setAperto(true);
    else timer.current = setTimeout(() => setAperto(true), attesa);
  }, []);

  React.useEffect(() => () => fermaTimer(), []);

  // La misura si prende DOPO che il riquadro è nel documento: prima non ha
  // dimensioni, e collocarlo su una misura inventata lo fa saltare di posto al
  // primo fotogramma.
  React.useLayoutEffect(() => {
    if (!aperto) {
      setCollocazione(null);
      setVisibile(false);
      return;
    }
    const a = ancora.current?.getBoundingClientRect();
    const r = riquadro.current?.getBoundingClientRect();
    if (!a || !r) return;
    setCollocazione(
      collocaSuggerimento({
        ancora: { x: a.left, y: a.top, larghezza: a.width, altezza: a.height },
        suggerimento: { larghezza: r.width, altezza: r.height },
        vista: { larghezza: window.innerWidth, altezza: window.innerHeight },
        lato,
      }),
    );
  }, [aperto, lato, testo]);

  // La comparsa ha bisogno di UN fotogramma dipinto nello stato di partenza.
  //
  // Senza, React committa «montato» e «collocato» nello stesso giro: il browser
  // dipinge una volta sola, già a destinazione, e la transizione non parte —
  // il riquadro appare di scatto. Con il fotogramma in mezzo scivola.
  React.useEffect(() => {
    if (!collocazione || visibile) return;
    const f = requestAnimationFrame(() => setVisibile(true));
    return () => cancelAnimationFrame(f);
  }, [collocazione, visibile]);

  // Scorrere la pagina lo chiude. Le misure sono relative alla vista: tenerlo
  // aperto vorrebbe dire trascinarsi dietro un riquadro staccato dalla sua
  // ancora, che è peggio di non averlo.
  React.useEffect(() => {
    if (!aperto) return;
    const via = () => chiudi(true);
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') chiudi(true);
    };
    window.addEventListener('scroll', via, true);
    window.addEventListener('resize', via);
    document.addEventListener('keydown', tasto);
    return () => {
      window.removeEventListener('scroll', via, true);
      window.removeEventListener('resize', via);
      document.removeEventListener('keydown', tasto);
    };
  }, [aperto, chiudi]);

  // In sviluppo: il nome messo sopra un'etichetta che si legge la cancella, e
  // non c'è modo di accorgersene guardando lo schermo.
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production' || legame.ruolo !== 'nome') return;
    const visibile = ancora.current?.textContent?.trim() ?? '';
    if (!nomeAmmesso(visibile, testo)) {
      console.error(
        `<Suggerimento> dà il nome «${testo}» a un comando che a schermo dice «${visibile}». ` +
          'Chi comanda a voce dice quello che legge: aggiungi `descrizione`.',
      );
    }
  }, [legame.ruolo, testo]);

  const ascolto = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') apri('puntatore');
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') chiudi();
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      // Sul dito: la descrizione si apre al tocco, il nome no — lì il tocco fa
      // già la sua azione.
      if (legame.apreAlTocco) apri('tocco');
      else chiudi(true);
    },
    onFocus: () => apri('fuoco'),
    onBlur: () => chiudi(true),
    onClick: () => {
      if (!legame.apreAlTocco) chiudi(true);
    },
  };

  // Il `ref` del figlio non si può semplicemente sovrascrivere: chi lo aveva
  // messo lo usa. Si tiene il nodo e glielo si passa comunque.
  const rifAncora = (nodo: HTMLElement | null) => {
    ancora.current = nodo;
    const suo = (children.props as { ref?: unknown }).ref;
    if (typeof suo === 'function') suo(nodo);
    else if (suo && typeof suo === 'object') (suo as { current: unknown }).current = nodo;
  };

  const figlio = React.cloneElement(children, {
    ...legame.ancora,
    // Col contenitore l'ascolto sta fuori: dentro ci può essere un comando
    // spento, che gli eventi del puntatore non li emette proprio.
    ...(avvolgi ? {} : { ...ascolto, ref: rifAncora }),
  } as Record<string, unknown>);

  const ancorato = avvolgi ? (
    <span
      className={avvolgi}
      ref={(n) => {
        ancora.current = n;
      }}
      {...ascolto}
    >
      {figlio}
    </span>
  ) : (
    figlio
  );

  return (
    <>
      {ancorato}
      {/* La copia per chi ascolta sta SEMPRE nel documento. Un
          `aria-describedby` che punta a un elemento montato solo mentre il
          riquadro è aperto punta al nulla per quasi tutto il tempo: il lettore
          di schermo cerca quell'id quando arriva sul comando, e col puntatore
          non ci passa mai. */}
      {legame.copiaPerLettori && montato && createPortal(
        <span id={id} className="sr-only">
          {testo}
        </span>,
        document.body,
      )}
      {aperto && montato && createPortal(
        <div
          ref={riquadro}
          // Nessun ruolo «tooltip» qui sopra: il testo è già nel nome o nella
          // descrizione dell'ancora. Annunciarlo una seconda volta dal
          // riquadro vuol dire sentirlo due volte di fila.
          aria-hidden="true"
          className={cn(
            'pointer-events-none fixed z-suggerimento max-w-[min(20rem,calc(100vw-1rem))] rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg',
            'transition-[opacity,transform] motion-reduce:transition-none',
            visibile ? 'translate-y-0 opacity-100' : 'opacity-0 motion-safe:translate-y-1',
          )}
          style={{
            left: collocazione?.x ?? 0,
            top: collocazione?.y ?? 0,
            transitionDuration: `${DURATE.rapida}ms`,
            transitionTimingFunction: CURVE.uscita,
          }}
        >
          {testo}
          {/* La punta insegue il centro dell'ANCORA, non quello del riquadro:
              contro un bordo i due non coincidono più, e una punta ferma a metà
              indicherebbe l'icona sbagliata. Il conto sta in `@app/core`. */}
          {collocazione && (
            <span
              aria-hidden="true"
              className="absolute h-2.5 w-2.5 rotate-45 bg-ink-900"
              style={puntaDi(collocazione)}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Il punto interrogativo che apre una spiegazione.
 *
 * Serve dove la spiegazione stava su un `<label>`: un'etichetta non prende il
 * fuoco, quindi con la tastiera quella spiegazione era irraggiungibile, e col
 * dito pure. Qui invece è un comando vero — si raggiunge con Tab, si apre col
 * tocco, e ha un nome suo che resta separato dalla spiegazione.
 */
export function Aiuto({ testo, lato = 'sopra' }: { testo: string; lato?: Lato }) {
  return (
    <Suggerimento testo={testo} lato={lato} descrizione>
      <button
        type="button"
        aria-label="Spiegazione"
        // 24 px di bersaglio attorno a un'icona da 14: sotto i 24 il tocco
        // sbaglia, e questa sta in mezzo a delle caselle di spunta.
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </Suggerimento>
  );
}
