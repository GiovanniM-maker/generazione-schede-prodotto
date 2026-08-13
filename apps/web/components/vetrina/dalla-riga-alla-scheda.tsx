import { ArrowRight, ArrowDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// La prova, invece della promessa.
//
// L'apertura della vetrina diceva «descrizioni fedeli ai dati — mai inventate»
// e poi passava ai pulsanti. È l'unica affermazione che distingue questo
// prodotto da qualunque generatore di testo, ed era **affermata**: la sola
// dimostrazione stava a 780 px di scorrimento, in una scheda d'esempio senza il
// dato di partenza accanto.
//
// Chi arriva qui è qualcuno che ha un listino e ha già visto un'AI inventare un
// grammaggio. A quella persona non serve leggere «mai inventate»: serve vedere
// una riga di Excel e la frase che ne esce, vicine, e poter contare i fatti.
//
// I dati qui sotto sono un esempio dichiarato, non l'output di un cliente. È
// scritto sull'etichetta, perché un finto caso reale sarebbe esattamente il
// genere di cosa che questo prodotto promette di non fare.
// ---------------------------------------------------------------------------

/** La riga com'è nel file: chiave tecnica e valore, niente di più. */
const RIGA: Array<[string, string]> = [
  ['sku', 'PASS-DAT-340'],
  ['prodotto', 'passata datterino giallo'],
  ['formato', '340 g'],
  ['vaso', 'vetro'],
  ['origine', 'Sicilia'],
  ['pomodoro_pct', '99'],
  ['sale', 'marino'],
];

const SCHEDA = {
  titolo: 'Passata di pomodoro datterino giallo — 340 g',
  breve:
    'Passata di datterino giallo siciliano, densa e naturalmente dolce, in vasetto di vetro da 340 g.',
  punti: [
    'Ingredienti: pomodoro datterino giallo (99%), sale marino',
    'Formato: vasetto in vetro da 340 g',
    'Origine: Sicilia',
  ],
};

export function DallaRigaAllaScheda() {
  return (
    <figure className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className="grid items-stretch md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)]">
        {/* Il file. */}
        <div className="border-b border-ink-200 bg-ink-50 p-5 sm:p-6 md:border-b-0 md:border-r">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              La riga del listino
            </span>
            <span className="font-mono text-xs text-ink-500">listino.xlsx</span>
          </div>
          <dl className="mt-4 space-y-1.5 font-mono text-xs">
            {RIGA.map(([chiave, valore]) => (
              <div key={chiave} className="flex gap-3">
                <dt className="w-28 shrink-0 text-ink-500">{chiave}</dt>
                <dd className="min-w-0 break-words text-ink-800">{valore}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Il passaggio. Su telefono la freccia gira, perché gira il layout. */}
        <div
          className="flex items-center justify-center border-b border-ink-200 bg-ink-50 px-4 py-3 md:border-b-0 md:border-r md:px-5 md:py-0"
          aria-hidden="true"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand-accent ring-1 ring-ink-200">
            <ArrowDown className="h-4 w-4 md:hidden" />
            <ArrowRight className="hidden h-4 w-4 md:block" />
          </span>
        </div>

        {/* La scheda. */}
        <div className="p-5 sm:p-6">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            La scheda che ne esce
          </span>
          <h3 className="mt-3 text-lg font-semibold text-ink-900">{SCHEDA.titolo}</h3>
          <p className="mt-2 text-sm text-ink-700">{SCHEDA.breve}</p>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-600">
            {SCHEDA.punti.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-300">
                  •
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Il punto, detto una volta e senza aggettivi. Se questa riga non fosse
          vera il prodotto non avrebbe ragione di esistere, quindi vale la pena
          scriverla dove si legge invece di lasciarla a un elenco di spunte. */}
      <figcaption className="border-t border-ink-200 bg-white px-5 py-3 text-xs text-ink-600 sm:px-6">
        Sei dei sette campi finiscono nel testo; lo SKU resta il codice. Quello
        che nella riga non c’è — la raccolta a mano, il premio, il «migliore» —
        non compare. Esempio.
      </figcaption>
    </figure>
  );
}
