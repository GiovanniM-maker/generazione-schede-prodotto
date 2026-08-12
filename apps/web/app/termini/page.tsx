import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal/legal-shell';
import { datiTitolare, oppureDaDefinire } from '@/lib/legale';

// Finché il documento è una bozza chiediamo ai motori di non indicizzarlo:
// una pagina legale incompleta indicizzata resta in giro per mesi.
export function generateMetadata(): Metadata {
  return {
    title: 'Termini di servizio',
    description:
      'Le condizioni d’uso di Verificato: cosa offre il servizio, cosa ci si impegna a fare, crediti, responsabilità e recesso.',
    alternates: { canonical: '/termini' },
    robots: datiTitolare().completo ? undefined : { index: false, follow: false },
  };
}



export default function TerminiPage() {
  return (
    <LegalShell title="Termini di servizio" updated="luglio 2026">
      <p>
        I presenti Termini regolano l’uso del Servizio. Utilizzandolo accetti
        questi Termini.
      </p>

      <h2>1. Il Servizio</h2>
      <p>
        Il Servizio consente di generare schede prodotto a partire dai dati
        caricati dall’utente. I contenuti generati derivano dai dati forniti:
        l’utente è responsabile della verifica finale prima della pubblicazione.
      </p>

      <h2>2. Account</h2>
      <p>
        L’accesso avviene tramite link via email. Sei responsabile della
        sicurezza della tua casella di posta e delle attività svolte con il tuo
        account.
      </p>

      <h2>3. Uso consentito</h2>
      <ul>
        <li>Non caricare contenuti illeciti o di cui non detieni i diritti.</li>
        <li>Non tentare di aggirare i limiti tecnici o di sicurezza.</li>
        <li>Non usare il Servizio per generare contenuti ingannevoli o vietati.</li>
      </ul>

      <h2>4. Crediti e pagamenti</h2>
      <p>
        Alcune funzioni consumano crediti. I pagamenti sono gestiti da Stripe.
        Salvo diversa indicazione, i crediti acquistati non sono rimborsabili
        una volta utilizzati.
      </p>

      <h2>5. Proprietà intellettuale</h2>
      <p>
        I dati e i contenuti che carichi restano tuoi. I contenuti generati sono
        a tua disposizione per l’uso commerciale, fermo restando l’obbligo di
        verificarne accuratezza e conformità.
      </p>

      <h2>6. Limitazione di responsabilità</h2>
      <p>
        Il Servizio è fornito “così com’è”. Non garantiamo che i contenuti
        generati siano privi di errori: la responsabilità della pubblicazione
        resta dell’utente. Nei limiti di legge, la nostra responsabilità è
        limitata.
      </p>

      <h2>7. Sospensione e cessazione</h2>
      <p>
        Possiamo sospendere l’account in caso di violazione dei Termini. Puoi
        cessare l’uso in qualsiasi momento eliminando l’account.
      </p>

      <h2>8. Legge applicabile</h2>
      <p>
        Si applica la legge italiana; foro competente{' '}
        {oppureDaDefinire(datiTitolare().citta, 'città del foro')}.
      </p>
    </LegalShell>
  );
}
