import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Le intestazioni di colonna restano.
//
// Erano `static`, e una tabella lunga le portava via con sé: sulla pagina degli
// attributi, arrivati a metà, l'intestazione stava a **−516 px** e sotto
// restavano ancora **1878 px di righe**. Si legge una colonna di valori senza
// sapere di quale colonna si tratta — e in una schermata di configurazione le
// colonne si somigliano tutte.
//
// Il trucco che NON funziona è mettere `sticky top-0` sul `thead` e basta: il
// contenitore ha `overflow-x: auto`, e questo rende `auto` anche l'asse
// verticale. La testa si aggancia allora al bordo di un riquadro che non scorre
// mai per conto suo — cioè non si aggancia a niente. Serve che sia il riquadro
// a scorrere: da qui `scorrevole`, che gli dà un'altezza massima. Senza, la
// riga `sticky` è innocua ma inutile.
// ---------------------------------------------------------------------------

export function Table({
  className,
  scorrevole = false,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  /**
   * Dà alla tabella un riquadro che scorre da sé, così le intestazioni
   * restano. Da accendere quando le righe possono essere tante; su un elenco
   * corto non cambia niente, perché l'altezza è un massimo, non una misura.
   */
  scorrevole?: boolean;
}) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto',
        scorrevole && 'max-h-[min(70vh,44rem)] overflow-y-auto',
      )}
    >
      <table
        className={cn('w-full border-collapse text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function THead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    // `bg-ink-50` sta anche sulle celle, non solo qui: un `thead` che scorre
    // sopra le righe deve essere opaco, e il fondo dichiarato sulla sezione non
    // dipinge sotto le celle.
    <thead
      className={cn(
        'sticky top-0 z-10 border-b border-ink-200 bg-ink-50 [&_th]:bg-ink-50',
        className,
      )}
      {...props}
    />
  );
}

export function TBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn('divide-y divide-ink-100', className)}
      {...props}
    />
  );
}

export function TR({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-ink-50/60', className)} {...props} />;
}

export function TH({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500',
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 align-middle text-ink-700', className)} {...props} />
  );
}
