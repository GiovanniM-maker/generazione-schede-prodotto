import { Fragment } from 'react';

// ---------------------------------------------------------------------------
// La prova, messa dove si guarda.
//
// Il campione è il momento in cui si decide se spendere i crediti su tutto il
// catalogo: è l'unica schermata in cui il prodotto può dimostrare la sua unica
// promessa — «i dati posseggono i fatti, l'AI la prosa».
//
// Lo mostrava in quattro riquadri impilati: completezza, poi i fatti, poi il
// contenuto come un elenco di campi con l'etichetta sopra. Tre cose vere, dette
// una sotto l'altra, in modo che nessuna dimostrasse l'altra. I fatti stavano a
// 400 px dalla prosa che ne era uscita: per collegarli bisognava scorrere su e
// giù e tenerli a mente.
//
// Qui stanno affiancati. A sinistra quello che c'era nel file, a destra la
// scheda composta come si vedrà davvero — non un modulo, una scheda. Sotto,
// quello che nel file NON c'era, detto per nome: è la parte della promessa che
// costa di più mantenere, e nasconderla sarebbe stato il modo più rapido di non
// meritarsela.
// ---------------------------------------------------------------------------

export interface FattoDelCampione {
  fieldKey: string;
  value: string;
  status: string;
}

export interface SchedaDelCampione {
  title: string;
  shortDescription: string;
  longDescription: string;
  bullets: string[];
  metaDescription: string;
  usedFactKeys: string[];
}

export function ProvaDelCampione({
  fatti,
  scheda,
  mancanti,
}: {
  fatti: FattoDelCampione[];
  scheda: SchedaDelCampione;
  /** Attributi che il file non aveva: si dicono, non si riempiono. */
  mancanti: string[];
}) {
  const usati = new Set(scheda.usedFactKeys);

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* Da una parte i dati. */}
        <div className="border-b border-ink-200 bg-ink-50 p-6 lg:border-b-0 lg:border-r">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Dal tuo file
          </h3>
          <p className="mt-1 text-xs text-ink-500">
            {fatti.length === 0
              ? 'Nessun fatto letto per questo prodotto.'
              : `${fatti.length} ${fatti.length === 1 ? 'fatto letto' : 'fatti letti'}, nessuno aggiunto.`}
          </p>

          <dl className="mt-4 space-y-2.5">
            {fatti.map((f) => (
              <Fragment key={f.fieldKey}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {f.fieldKey}
                </dt>
                <dd className="flex items-start justify-between gap-2 text-sm text-ink-800">
                  <span className="min-w-0 break-words">{f.value}</span>
                  {usati.has(f.fieldKey) && (
                    <span className="mt-0.5 shrink-0 rounded-full bg-white px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-ink-500 ring-1 ring-ink-200">
                      in scheda
                    </span>
                  )}
                </dd>
              </Fragment>
            ))}
          </dl>

          {/* Il contrappunto onesto: la scheda non è completa perché il file
              non lo era, e la differenza si vede qui invece che scoprirla dopo
              su tutto il catalogo. */}
          {mancanti.length > 0 && (
            <div className="mt-6 border-t border-ink-200 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Nel file non c’era
              </h4>
              <p className="mt-1 text-xs text-ink-600">
                Non è stato inventato: la scheda ne fa a meno.
              </p>
              <ul className="mt-2 flex flex-wrap gap-1">
                {mancanti.map((a) => (
                  <li
                    key={a}
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
                  >
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Dall'altra la prosa, composta come si vedrà. */}
        <div className="p-6 sm:p-8">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            La scheda che ne esce
          </span>

          <h3 className="mt-3 text-xl font-semibold text-ink-900">{scheda.title}</h3>
          <p className="mt-2 text-base text-ink-700">{scheda.shortDescription}</p>

          {scheda.longDescription && (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink-700">
              {scheda.longDescription}
            </p>
          )}

          {scheda.bullets.length > 0 && (
            <ul className="mt-5 space-y-1.5 text-sm text-ink-700">
              {scheda.bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-300">
                    •
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {/* La meta description non è un campo come gli altri: è quello che si
              legge su Google. Mostrarla com'è là dentro dice in un colpo se è
              lunga giusta, cosa che un'etichetta «Meta description» sopra un
              paragrafo non dice. */}
          {scheda.metaDescription && (
            <div className="mt-6 border-t border-ink-100 pt-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                Come appare nei risultati di ricerca
              </span>
              <p className="mt-2 max-w-[36rem] text-sm text-ink-600">
                {scheda.metaDescription}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {scheda.metaDescription.length} caratteri
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
