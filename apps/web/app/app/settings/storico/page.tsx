import { permanentRedirect } from 'next/navigation';

// La rotta si chiamava `/storico`: unica in italiano fra sette in inglese
// (`settings`, `presets`, `categories`, `attributes`, `sectors`, `team`,
// `integrations`). La convenzione è quella — indirizzi in inglese, interfaccia
// in italiano — e una sola eccezione è solo un inciampo.
//
// Il vecchio indirizzo resta e reindirizza: i segnalibri di chi lo usava non si
// rompono per una questione di coerenza nostra.
export default function StoricoSpostato(): never {
  permanentRedirect('/app/settings/activity');
}
