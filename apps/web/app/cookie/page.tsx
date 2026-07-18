import type { Metadata } from 'next';
import { LegalShell } from '@/components/legal/legal-shell';

export const metadata: Metadata = { title: 'Cookie Policy' };

export default function CookiePage() {
  return (
    <LegalShell title="Cookie Policy" updated="luglio 2026">
      <p>
        Questa pagina spiega come il Servizio utilizza i cookie e tecnologie
        simili. È una bozza operativa da validare legalmente.
      </p>

      <h2>1. Cosa sono i cookie</h2>
      <p>
        I cookie sono piccoli file memorizzati dal browser. Possono essere
        tecnici (necessari al funzionamento) o non essenziali (analitici, di
        profilazione).
      </p>

      <h2>2. Cookie che usiamo</h2>
      <ul>
        <li>
          <strong>Cookie tecnici essenziali</strong>: gestiscono la sessione e
          l’autenticazione. Sono necessari e non richiedono consenso.
        </li>
        <li>
          <strong>Archiviazione locale</strong>: memorizziamo la presa d’atto di
          questa informativa (per non ripresentare il banner) e alcune
          preferenze dell’interfaccia.
        </li>
      </ul>
      <p>
        Allo stato attuale <strong>non utilizziamo cookie di profilazione o di
        terze parti a fini pubblicitari</strong>. Se in futuro verranno
        introdotti, questa pagina sarà aggiornata e verrà richiesto il consenso.
      </p>

      <h2>3. Gestione dei cookie</h2>
      <p>
        Puoi eliminare o bloccare i cookie dalle impostazioni del browser.
        Disabilitare i cookie tecnici può impedire l’accesso al Servizio.
      </p>

      <h2>4. Contatti</h2>
      <p>Per domande scrivi a [email di contatto].</p>
    </LegalShell>
  );
}
