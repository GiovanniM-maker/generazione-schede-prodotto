import { Scheletro, ScheletroElenco } from '@/components/ui/scheletro';

// ---------------------------------------------------------------------------
// La pagina che sta arrivando.
//
// COSA C'ERA: due file `loading.tsx` identici, ciascuno con una rotella
// centrata che sostituiva l'INTERA pagina. Chi navigava vedeva il layout
// sparire e poi ricomparire — ed è la cosa che fa sembrare lento un prodotto
// anche quando è veloce, perché il tempo percepito comincia quando lo schermo
// si svuota, non quando parte la richiesta.
//
// Due copie identiche, poi, divergono: la prima volta che qualcuno tocca una
// delle due, l'altra resta indietro e nessuno se ne accorge.
//
// LA REGOLA: lo scheletro tiene la forma vera — un titolo, una riga di
// sottotitolo, e tante righe quante ne arrivano di solito. Se ne avesse meno,
// all'arrivo dei dati la pagina salterebbe, e il salto si nota più della
// rotella che si voleva togliere.
// ---------------------------------------------------------------------------

export function PaginaInArrivo({ righe = 5 }: { righe?: number }) {
  return (
    <div>
      <div className="space-y-2">
        <Scheletro className="h-7 w-56" />
        <Scheletro className="h-4 w-80 max-w-full" />
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        <ScheletroElenco righe={righe} />
      </div>
      {/* Detto anche a chi non guarda: senza, il lettore di schermo annuncia
          la pagina come vuota e chi ascolta crede che non ci sia niente. */}
      <span className="sr-only" role="status">
        Caricamento in corso
      </span>
    </div>
  );
}
