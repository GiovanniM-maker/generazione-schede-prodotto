'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Tour guidato ("fumettini"): evidenzia un elemento della pagina (trovato via
// [data-tour="..."]) e mostra un fumetto con spiegazione + Avanti/Indietro.
// Zero dipendenze, zero AI: contenuti statici, posizionamento calcolato.
// ---------------------------------------------------------------------------

export interface TourStep {
  /** Valore dell'attributo data-tour dell'elemento da evidenziare. */
  target: string;
  title: string;
  body: string;
}

const PAD = 8; // padding attorno all'elemento evidenziato
const BUBBLE_W = 320;

function findTarget(step: TourStep): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

export function GuidedTour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  /** completed = l'utente ha finito o saltato: il chiamante salva "visto". */
  onClose: (completed: boolean) => void;
}) {
  // Considera solo i passi il cui elemento esiste davvero in pagina. La ricerca
  // avviene DOPO il mount (il DOM deve esserci) e ritenta per un po': alcuni
  // target compaiono solo a caricamento dati completato.
  const [available, setAvailable] = useState<TourStep[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    let tries = 0;
    const attempt = () => {
      const found = steps.filter((s) => findTarget(s));
      if (found.length > 0 || tries >= 25) {
        setAvailable(found);
        clearInterval(timer);
      }
      tries++;
    };
    const timer = setInterval(attempt, 200);
    attempt();
    return () => clearInterval(timer);
  }, [steps]);

  const step = available?.[idx] ?? null;

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  // Porta l'elemento in vista e misura; rimisura su scroll/resize. Se il
  // target è sparito dal DOM (render condizionale cambiato), salta al passo
  // successivo invece di restare bloccato invisibile.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step);
    if (!el) {
      setIdx((i) => i + 1); // oltre l'ultimo → step diventa null → chiusura
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    // misura dopo lo scroll (qualche frame di assestamento)
    let ticks = 0;
    const tick = () => {
      measure();
      if (ticks++ < 20) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const onMove = () => measure();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [step, measure]);

  // Esc per chiudere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Niente da mostrare (nessun target) o indice oltre la fine (target spariti):
  // chiudi via effetto, mai durante il render.
  const empty = available !== null && (available.length === 0 || idx >= available.length);
  useEffect(() => {
    if (empty) onClose(true);
  }, [empty, onClose]);
  if (empty || !step || !rect || available === null) return null;

  const total = available.length;
  const last = idx === total - 1;

  // Fumetto sotto l'elemento se c'è spazio, altrimenti sopra.
  const below = rect.bottom + 190 < window.innerHeight || rect.top < 200;
  const bubbleTop = below ? rect.bottom + PAD + 10 : undefined;
  const bubbleBottom = below ? undefined : window.innerHeight - rect.top + PAD + 10;
  const left = Math.max(
    12,
    Math.min(rect.left, window.innerWidth - BUBBLE_W - 12),
  );

  return (
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-label={`Guida: ${step.title}`}
      onClick={() => (last ? onClose(true) : setIdx((i) => i + 1))}
    >
      {/* Alone scuro con "buco" sull'elemento (box-shadow gigante). */}
      <div
        aria-hidden
        className="pointer-events-none fixed rounded-lg transition-all duration-200"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: '0 0 0 9999px rgba(15, 23, 32, 0.55)',
          border: '2px solid rgba(255,255,255,0.9)',
        }}
      />
      {/* Fumetto */}
      <div
        className="fixed rounded-xl border border-gray-200 bg-white p-4 shadow-xl"
        style={{ top: bubbleTop, bottom: bubbleBottom, left, width: BUBBLE_W, maxWidth: 'calc(100vw - 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">{step.title}</p>
          <button
            type="button"
            onClick={() => onClose(true)}
            aria-label="Chiudi la guida"
            className="rounded p-0.5 text-gray-400 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {idx + 1} di {total}
          </span>
          <div className="flex gap-2">
            {idx > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIdx((i) => i - 1)}>
                Indietro
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => (last ? onClose(true) : setIdx((i) => i + 1))}
            >
              {last ? 'Ho capito' : 'Avanti'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- persistenza "già visto" (localStorage, a prova di private mode) --------

export function tourSeen(key: string): boolean {
  try {
    return localStorage.getItem(`tour.${key}`) === '1';
  } catch {
    return true; // se lo storage non funziona, non assillare l'utente
  }
}

export function markTourSeen(key: string): void {
  try {
    localStorage.setItem(`tour.${key}`, '1');
  } catch {
    /* ignora */
  }
}
