import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal/legal-shell';
import { datiTitolare, oppureDaDefinire } from '@/lib/legale';

// Finché il documento è una bozza chiediamo ai motori di non indicizzarlo:
// una pagina legale incompleta indicizzata resta in giro per mesi.
export function generateMetadata(): Metadata {
  return {
    title: 'Privacy Policy',
    description:
      'Come trattiamo i dati personali di chi usa Verificato: quali dati, perché, per quanto tempo e come chiederne la cancellazione.',
    alternates: { canonical: '/privacy' },
    robots: datiTitolare().completo ? undefined : { index: false, follow: false },
  };
}

export default function PrivacyPage() {
  const t = datiTitolare();
  return (
    <LegalShell title="Informativa sulla privacy" updated="luglio 2026">
      <p>
        La presente informativa descrive come trattiamo i dati personali degli
        utenti del servizio di generazione di schede prodotto (il “Servizio”).
      </p>

      <h2>1. Titolare del trattamento</h2>
      <p>
        Il titolare è {oppureDaDefinire(t.ragioneSociale, 'ragione sociale')},{' '}
        {oppureDaDefinire(t.indirizzo, 'indirizzo')}, email{' '}
        {oppureDaDefinire(t.email, 'indirizzo email')}.
      </p>

      <h2>2. Dati trattati</h2>
      <ul>
        <li>Dati di registrazione: indirizzo email.</li>
        <li>Dati dell’organizzazione: nome azienda, settore, configurazione.</li>
        <li>Contenuti caricati: cataloghi (CSV/Excel), immagini, descrizioni.</li>
        <li>Dati d’uso: log tecnici, eventi di attività, metriche di utilizzo.</li>
        <li>Dati di pagamento: gestiti dal fornitore di pagamenti (Stripe); non conserviamo i dati della carta.</li>
      </ul>

      <h2>3. Finalità e basi giuridiche</h2>
      <ul>
        <li>Erogazione del Servizio (esecuzione del contratto).</li>
        <li>Fatturazione e adempimenti fiscali (obbligo legale).</li>
        <li>Sicurezza e prevenzione abusi (legittimo interesse).</li>
        <li>Assistenza clienti (esecuzione del contratto/legittimo interesse).</li>
      </ul>

      <h2>4. Fornitori e trasferimenti</h2>
      <p>
        Ci avvaliamo di fornitori terzi come responsabili del trattamento:
        infrastruttura e database (Supabase), hosting applicativo (Vercel),
        elaborazione AI (provider di modelli linguistici) e pagamenti (Stripe).
        Alcuni fornitori possono trattare dati fuori dall’UE con garanzie
        adeguate (es. clausole contrattuali standard).
      </p>

      <h2>5. Conservazione</h2>
      <p>
        Conserviamo i dati per la durata del rapporto e per il tempo necessario
        agli obblighi legali. Alla cancellazione dell’account, i dati
        dell’organizzazione vengono eliminati salvo obblighi di legge.
      </p>

      <h2>6. Diritti dell’interessato</h2>
      <p>
        Puoi esercitare i diritti di accesso, rettifica, cancellazione,
        limitazione, opposizione e portabilità. Dall’area Impostazioni → Account
        puoi esportare i tuoi dati e richiedere la cancellazione dell’account.
        Per altre richieste scrivi a {oppureDaDefinire(t.email, 'indirizzo email')}.
      </p>

      <h2>7. Modifiche</h2>
      <p>
        Potremo aggiornare questa informativa; le modifiche saranno pubblicate
        su questa pagina con la nuova data di aggiornamento.
      </p>
    </LegalShell>
  );
}
