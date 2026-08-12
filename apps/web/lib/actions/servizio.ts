'use server';

import { getSessionUser } from '@/lib/auth';
import { getServerEnv } from '@/lib/env.server';
import { getServiceClient } from '@/lib/supabase/service';
import { logWrite } from '@app/core';

// ---------------------------------------------------------------------------
// Come va il servizio.
//
// Non c'era modo di rispondere a nessuna di queste domande: quante
// organizzazioni ci sono, quanto generano, quanto ci costa l'AI, chi è rimasto
// bloccato a metà, cosa si è rotto ieri. La materia prima c'era già tutta —
// `generation_runs` registra token e costo per ogni chiamata — ma nessuno la
// guardava. Un servizio che non si guarda si scopre rotto dai clienti.
//
// Chi può guardare sta in `ADMIN_EMAILS`, non in una colonna del database. È
// una scelta: un ruolo si assegna per sbaglio, una variabile d'ambiente no. E
// se la variabile è vuota il pannello non esiste per nessuno.
// ---------------------------------------------------------------------------

type Esito<T> = { ok: true; data: T } | { ok: false; error: string };

export interface StatoServizio {
  giorni: number;
  organizzazioni: number;
  organizzazioniNuove: number;
  persone: number;
  batchTotali: number;
  batchNellaFinestra: number;
  schedeGenerate: number;
  costoStimato: number;
  tokenIngresso: number;
  tokenUscita: number;
  creditiVenduti: number;
  incassatoCentesimi: number;
  creditiConsumati: number;
  batchBloccati: {
    id: string;
    organizzazione: string;
    nome: string;
    stato: string;
    fermo_da_minuti: number;
  }[];
  guasti: { quando: string; evento: string; dettagli: Record<string, unknown> }[];
  guastiTotali: number;
}

/** Vero se questo indirizzo è nell'elenco degli amministratori del prodotto. */
export async function sonoAmministratore(): Promise<boolean> {
  const elenco = getServerEnv()
    .ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  if (elenco.length === 0) return false;
  const user = await getSessionUser();
  const email = user?.email?.toLowerCase();
  return Boolean(email && elenco.includes(email));
}

export async function statoServizio(giorni = 30): Promise<Esito<StatoServizio>> {
  if (!(await sonoAmministratore())) {
    return { ok: false, error: 'Non disponibile' };
  }
  const service = getServiceClient();
  const { data, error } = await service.rpc('pannello_servizio', { giorni });
  if (error || !data) return { ok: false, error: error?.message ?? 'Lettura non riuscita' };
  const d = data as Record<string, never>;
  const n = (k: string) => Number((d as Record<string, unknown>)[k] ?? 0);
  return {
    ok: true,
    data: {
      giorni: n('giorni'),
      organizzazioni: n('organizzazioni'),
      organizzazioniNuove: n('organizzazioni_nuove'),
      persone: n('persone'),
      batchTotali: n('batch_totali'),
      batchNellaFinestra: n('batch_nella_finestra'),
      schedeGenerate: n('schede_generate'),
      costoStimato: n('costo_stimato'),
      tokenIngresso: n('token_ingresso'),
      tokenUscita: n('token_uscita'),
      creditiVenduti: n('crediti_venduti'),
      incassatoCentesimi: n('incassato_centesimi'),
      creditiConsumati: n('crediti_consumati'),
      batchBloccati: ((d as Record<string, unknown>).batch_bloccati ??
        []) as StatoServizio['batchBloccati'],
      guasti: ((d as Record<string, unknown>).guasti ?? []) as StatoServizio['guasti'],
      guastiTotali: n('guasti_totali'),
    },
  };
}

/**
 * Registra un errore non gestito.
 *
 * La raccolta degli errori in produzione non esisteva: un errore arrivava a
 * schermo, l'utente ricaricava, e non ne restava traccia da nessuna parte.
 * Questo la fa **in casa**, sulla tabella che già raccoglie i guasti di
 * scrittura: nessun servizio esterno, nessun dato che esce, niente da pagare.
 *
 * È volutamente povera: messaggio, punto del codice e indirizzo. Nessun dato
 * dell'utente, perché un raccoglitore di errori che porta con sé i dati dei
 * clienti è un problema più grande di quello che risolve.
 *
 * Serve una sessione. In Next ogni funzione esportata da un file 'use server' è
 * un indirizzo di rete: senza il controllo, chiunque potrebbe riempire la
 * tabella dei guasti di rumore. Si perde qualche errore capitato prima
 * dell'accesso — la pagina di login ne produce pochi — e si guadagna che quello
 * che c'è scritto viene da qualcuno.
 */
export async function registraErrore(input: {
  messaggio: string;
  origine?: string;
  percorso?: string;
}): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const service = getServiceClient();
  await logWrite(
    'app_events.insert(unhandled_error)',
    service.from('app_events').insert({
      user_id: user.id,
      event_name: 'unhandled_error',
      metadata_json: {
        // Tagliato: un messaggio d'errore può portarsi dietro mezzo documento.
        messaggio: input.messaggio.slice(0, 500),
        origine: input.origine?.slice(0, 200) ?? null,
        percorso: input.percorso?.slice(0, 200) ?? null,
      },
    }),
  );
}
