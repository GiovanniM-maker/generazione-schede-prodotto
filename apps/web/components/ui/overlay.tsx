'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  CURVE,
  DURATE,
  chiudeIlFoglio,
  prossimoFuoco,
  serveIntervenire,
} from '@app/core/interfaccia';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avviso } from '@/components/ui/avviso';

// ---------------------------------------------------------------------------
// Una finestra sovrapposta sola, con tre facce.
//
// COSA C'ERA PRIMA. Quattro implementazioni scollegate:
//
//   settings/modal.tsx          → completa e corretta
//   results-table.tsx:1262      → modale:   niente dialog, niente fuoco, niente Esc
//   results-table.tsx:1842      → pannello: niente dialog, niente fuoco
//   preset-detail-client.tsx:533→ pannello: niente dialog, niente Esc, niente fuoco
//
// Tre su quattro non trattenevano il fuoco: premendo Tab si usciva dal pannello
// e si finiva a navigare la pagina sottostante — che intanto era coperta da un
// velo e non si poteva usare. Chi non vede lo schermo si ritrovava a leggere
// qualcosa che per tutti gli altri non c'era più.
//
// Non erano quattro sviste: erano quattro occasioni di sbagliare la stessa
// cosa. La coerenza qui non è estetica, è la differenza fra accessibile e no.
//
// LE TRE FACCE. Cambiano dove la finestra sta e come arriva, non come si
// comporta:
//
//   dialogo   — al centro, piccola. Per una domanda con due risposte.
//   pannello  — da destra, alta quanto lo schermo. Per un dettaglio da leggere
//               senza perdere di vista la pagina.
//   foglio    — dal basso. È il pannello, su telefono: il pollice arriva in
//               basso, e una finestra centrata mette i comandi dove la mano
//               non è. La conversione è automatica.
//
// LA QUARTA COSA, che nessuno dei quattro faceva: la guardia sulle modifiche
// non salvate. La finestra si chiude cliccando sul velo, e se dentro c'è un
// modulo compilato a metà se ne va tutto senza una domanda.
// ---------------------------------------------------------------------------

const FUOCABILI =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type FormaOverlay = 'dialogo' | 'pannello' | 'foglio';

/** Sotto questa larghezza un pannello laterale diventa un foglio dal basso. */
const LARGHEZZA_FOGLIO = 700;

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Il titolo: diventa anche il nome della finestra per chi non la vede. */
  title: string;
  forma?: FormaOverlay;
  children: React.ReactNode;
  /** I comandi in fondo. Restano fermi mentre il corpo scorre. */
  azioni?: React.ReactNode;
  className?: string;
  /**
   * L'errore dell'azione lanciata DA QUESTA finestra.
   *
   * Senza, finiva nel corpo della pagina: la finestra è `fixed`, quindi il
   * messaggio veniva disegnato **dietro il velo**. Chi guardava non vedeva
   * succedere niente e ripremeva.
   */
  errore?: string | null;
  /**
   * Vero quando dentro c'è del lavoro non salvato.
   *
   * Con questo acceso, il clic sul velo e l'Esc chiedono conferma invece di
   * buttare via tutto. Il pulsante di chiusura no: quello è una scelta
   * esplicita, e chiedere due volte è insolente.
   */
  sporco?: boolean;
  /** Cosa chiedere quando si prova a chiudere con del lavoro dentro. */
  domandaUscita?: string;
}

type Fase = 'chiusa' | 'entra' | 'aperta' | 'esce';

export function Overlay({
  open,
  onClose,
  title,
  forma = 'dialogo',
  children,
  azioni,
  className,
  errore,
  sporco,
  domandaUscita = 'Hai delle modifiche non salvate. Vuoi chiudere e perderle?',
}: OverlayProps) {
  const riquadro = React.useRef<HTMLDivElement>(null);
  const titoloId = React.useId();
  const [fase, setFase] = React.useState<Fase>('chiusa');
  const [montato, setMontato] = React.useState(false);
  const [stretto, setStretto] = React.useState(false);
  const [trascina, setTrascina] = React.useState(0);
  const [chiedeUscita, setChiedeUscita] = React.useState(false);

  // `onClose` è quasi sempre una funzione scritta al volo nel punto d'uso,
  // quindi cambia identità a ogni render del genitore. Se gli effetti
  // dipendessero da lei, la pulizia rimetterebbe il fuoco sul pulsante di
  // apertura mentre la finestra è ancora aperta — a ogni battuta di tasto.
  const chiudi = React.useRef(onClose);
  chiudi.current = onClose;
  const sporcoRif = React.useRef(sporco);
  sporcoRif.current = sporco;

  React.useEffect(() => setMontato(true), []);

  // Il pannello diventa foglio da solo. Si misura la finestra e non si usa una
  // media query, perché la forma serve anche al codice — il trascinamento vale
  // solo per il foglio.
  React.useEffect(() => {
    if (!montato) return;
    const misura = () => setStretto(window.innerWidth < LARGHEZZA_FOGLIO);
    misura();
    window.addEventListener('resize', misura);
    return () => window.removeEventListener('resize', misura);
  }, [montato]);

  const formaEffettiva: FormaOverlay =
    forma === 'pannello' && stretto ? 'foglio' : forma;

  /**
   * Chiude chiedendo, se c'è del lavoro dentro.
   *
   * La domanda si fa DENTRO la finestra e non con `window.confirm`: quello
   * blocca il thread, non si può disegnare, e su alcuni browser mostra il
   * dominio — che lo fa sembrare un avviso di sistema invece che una domanda
   * del prodotto. E non si apre una seconda finestra sopra la prima: due
   * finestre impilate sono il modo più veloce di far perdere il filo.
   */
  const chiudiConGuardia = React.useCallback(() => {
    if (sporcoRif.current) {
      setChiedeUscita(true);
      return;
    }
    chiudi.current();
  }, []);

  // Entrata e uscita. Il nodo resta montato durante l'uscita, altrimenti
  // l'animazione non si vede: sparirebbe prima di cominciare.
  React.useEffect(() => {
    if (open) {
      setFase('entra');
      setTrascina(0);
      setChiedeUscita(false);
      const t = setTimeout(() => setFase('aperta'), 20);
      return () => clearTimeout(t);
    }
    setFase((f) => (f === 'chiusa' ? 'chiusa' : 'esce'));
    const t = setTimeout(() => setFase('chiusa'), DURATE.uscita);
    return () => clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const prima = document.activeElement as HTMLElement | null;

    function fuocabili(): HTMLElement[] {
      return Array.from(riquadro.current?.querySelectorAll<HTMLElement>(FUOCABILI) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        chiudiConGuardia();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = fuocabili();
      const attivo = el.indexOf(document.activeElement as HTMLElement);
      // Nel mezzo dell'anello il browser fa già la cosa giusta: intervenire lì
      // vuol dire chiamare `preventDefault` su ogni battuta.
      if (!serveIntervenire(el.length, attivo, e.shiftKey)) return;
      e.preventDefault();
      const prossimo = prossimoFuoco(el.length, attivo, e.shiftKey);
      if (prossimo !== null) el[prossimo]?.focus();
    }

    // La pagina sotto si ferma. Su desktop togliere lo scorrimento fa sparire
    // la barra e il contenuto salta di lato della sua larghezza: si compensa.
    // Sul telefono la barra non occupa spazio, la differenza è zero.
    const scorrimentoPrima = document.body.style.overflow;
    const paddingPrima = document.body.style.paddingRight;
    const larghezzaBarra = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (larghezzaBarra > 0) {
      const attuale = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${attuale + larghezzaBarra}px`;
    }

    document.addEventListener('keydown', onKeyDown);
    const dentro = riquadro.current?.querySelector<HTMLElement>(FUOCABILI);
    (dentro ?? riquadro.current)?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = scorrimentoPrima;
      document.body.style.paddingRight = paddingPrima;
      // Il fuoco torna da dove era partito. È la parte che si dimentica
      // sempre, ed è quella che si sente di più: senza, dopo aver chiuso si
      // riparte dall'inizio della pagina.
      prima?.focus?.();
    };
  }, [open, chiudiConGuardia]);

  // Trascinamento del foglio: solo dalla maniglia. Partendo dal contenuto,
  // ogni scorrimento verso il basso lo chiuderebbe.
  const gesto = React.useRef<{ y: number; t: number } | null>(null);
  function inizioTrascina(e: React.PointerEvent) {
    if (formaEffettiva !== 'foglio') return;
    gesto.current = { y: e.clientY, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function duranteTrascina(e: React.PointerEvent) {
    if (!gesto.current) return;
    setTrascina(Math.max(0, e.clientY - gesto.current.y));
  }
  function fineTrascina() {
    const g = gesto.current;
    gesto.current = null;
    if (!g) return;
    const chiude = chiudeIlFoglio({
      spostamentoPx: trascina,
      altezzaPx: riquadro.current?.offsetHeight ?? 500,
      durataMs: performance.now() - g.t,
    });
    if (chiude) chiudiConGuardia();
    setTrascina(0);
  }

  if (!montato || fase === 'chiusa') return null;

  const visibile = fase === 'entra' || fase === 'esce';
  const posizione: Record<FormaOverlay, string> = {
    dialogo: 'left-1/2 top-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl',
    pannello: 'right-0 top-0 bottom-0 w-[min(36rem,100%)]',
    foglio: 'inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl',
  };
  const chiusa: Record<FormaOverlay, string> = {
    dialogo: 'opacity-0 scale-[.97]',
    pannello: 'translate-x-full',
    foglio: 'translate-y-full',
  };

  return createPortal(
    <div className="fixed inset-0 z-overlay" role="presentation">
      <div
        aria-hidden="true"
        onClick={chiudiConGuardia}
        className={cn(
          'absolute inset-0 bg-ink-900/40 motion-safe:transition-opacity',
          visibile && 'opacity-0',
        )}
        style={{ transitionDuration: `${fase === 'esce' ? DURATE.uscita : DURATE.entrata}ms` }}
      />
      <div
        ref={riquadro}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titoloId}
        tabIndex={-1}
        className={cn(
          'absolute flex max-h-full flex-col overflow-hidden border border-ink-200 bg-white shadow-2xl outline-none motion-safe:transition-transform',
          posizione[formaEffettiva],
          visibile && chiusa[formaEffettiva],
          className,
        )}
        style={{
          transitionDuration: `${
            fase === 'esce'
              ? DURATE.uscita
              : formaEffettiva === 'foglio'
                ? DURATE.foglio
                : DURATE.entrata
          }ms`,
          transitionTimingFunction:
            formaEffettiva === 'foglio' ? CURVE.foglio : fase === 'esce' ? CURVE.entrata : CURVE.uscita,
          // Mentre il dito trascina, la transizione va tolta: altrimenti il
          // foglio insegue il pollice con un ritardo, e si sente subito.
          ...(trascina > 0
            ? { transform: `translateY(${trascina}px)`, transitionDuration: '0ms' }
            : null),
        }}
      >
        {formaEffettiva === 'foglio' && (
          // La maniglia è anche il bersaglio del trascinamento: NN/g chiede che
          // ci sia sempre un pulsante di chiusura accanto, perché un gesto solo
          // esclude chi non lo può fare.
          <div
            onPointerDown={inizioTrascina}
            onPointerMove={duranteTrascina}
            onPointerUp={fineTrascina}
            onPointerCancel={fineTrascina}
            className="flex shrink-0 cursor-grab touch-none items-center justify-center pb-1 pt-2.5"
            aria-hidden="true"
          >
            <span className="block h-1 w-9 rounded-full bg-ink-300" />
          </div>
        )}

        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-200 px-5 py-3.5">
          <h2 id={titoloId} className="min-w-0 text-base font-semibold text-ink-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={chiudiConGuardia}
            className="-m-1 shrink-0 rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {errore && <Avviso tono="errore">{errore}</Avviso>}
          {children}
        </div>

        {chiedeUscita ? (
          <div className="shrink-0 border-t border-ink-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* `Avviso` e non un riquadro ambra scritto a mano: porta con sé
                `role="status"` e `aria-live`, quindi la domanda arriva anche a
                chi non sta guardando lo schermo — che in questo momento è
                proprio chi rischia di perdere il lavoro senza accorgersene. */}
            <Avviso tono="attenzione">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0">{domandaUscita}</p>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setChiedeUscita(false)}>
                    Torna indietro
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => chiudi.current()}>
                    Chiudi e perdile
                  </Button>
                </div>
              </div>
            </Avviso>
          </div>
        ) : (
          azioni && (
            // I comandi restano fermi mentre il corpo scorre: su un contenuto
            // lungo, un pulsante in fondo alla pagina si raggiunge scorrendo, e
            // su telefono non lo si trova più.
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ink-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {azioni}
            </div>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// La conferma di un'azione che non torna indietro.
//
// Va usata SOLO per quelle. Dove l'azione è reversibile — accettare una scheda,
// togliere una persona dal team — la strada giusta è farla subito e offrire
// «Annulla» per dieci secondi: costa un clic invece di due e protegge di più,
// perché intercetta anche l'errore che ci si accorge di aver fatto DOPO.
// ---------------------------------------------------------------------------
export function ConfermaDistruttiva({
  open,
  title,
  message,
  confirmLabel = 'Conferma',
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Overlay
      open={open}
      onClose={onCancel}
      title={title}
      forma="dialogo"
      className="max-w-md"
      azioni={
        <>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Annulla
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">{message}</p>
    </Overlay>
  );
}
