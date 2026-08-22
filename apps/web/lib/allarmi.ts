import 'server-only';
import {
  decidiAvviso,
  inizioFinestra,
  oggettoAvviso,
  EVENTI_DI_GUASTO,
  EVENTO_AVVISO_MANDATO,
  logWrite,
  type EventoRegistrato,
  type GruppoGuasti,
} from '@app/core';
import type { getServiceClient } from '@/lib/supabase/service';
import { sendEmail } from '@/lib/notify';
import { indirizzoApp } from '@/lib/indirizzo-app';

// ---------------------------------------------------------------------------
// Il giro che porta i guasti fuori dal database.
//
// La raccolta esisteva già: `write_failed`, `credit_ledger_failed`,
// `unhandled_error` e ora `errore_server` finiscono tutti in `app_events`. Il
// problema era l'ultimo metro — quella tabella la si vede solo aprendo a mano
// un pannello riservato, e nessuno lo apre. Il risultato pratico era che
// ogni guasto veniva scoperto da un cliente.
//
// Questo file chiude il metro. Gira dentro il cron che già passa ogni minuto,
// e quando trova qualcosa manda un'email a chi sta in `ADMIN_EMAILS`.
//
// LE DECISIONI STANNO ALTROVE. Cosa è un guasto, come si raggruppa, quando è
// troppo presto per riscrivere: tutto in `@app/core/allarmi`, che è puro e si
// prova senza database. Qui restano solo le due cose impure — leggere righe e
// mandare posta — perché sono anche le uniche che non si possono provare
// davvero, e vanno tenute il più magre possibile.
// ---------------------------------------------------------------------------

type Service = ReturnType<typeof getServiceClient>;

export interface EsitoAllarmi {
  /** Vero se un'email è partita adesso. */
  mandato: boolean;
  /** Cosa è successo, in italiano: finisce nella risposta del cron. */
  motivo: string;
  /** Quanti guasti nella finestra guardata. */
  guasti: number;
}

/** Gli indirizzi a cui mandare: gli stessi che possono aprire il pannello. */
function destinatari(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');
}

/**
 * Quando è partito l'ultimo avviso, in millisecondi.
 *
 * Il segnaposto è una riga in `app_events` e non una variabile in memoria: le
 * funzioni serverless muoiono fra una chiamata e l'altra, e un silenzio tenuto
 * in memoria si azzererebbe a ogni giro — cioè non esisterebbe.
 */
async function quandoLUltimoAvviso(service: Service): Promise<number | null> {
  const { data } = await service
    .from('app_events')
    .select('created_at')
    .eq('event_name', EVENTO_AVVISO_MANDATO)
    .order('created_at', { ascending: false })
    .limit(1);
  const quando = (data as { created_at?: string }[] | null)?.[0]?.created_at;
  if (!quando) return null;
  const t = Date.parse(quando);
  return Number.isFinite(t) ? t : null;
}

async function leggiGuasti(service: Service, da: number): Promise<EventoRegistrato[]> {
  const { data } = await service
    .from('app_events')
    .select('event_name, created_at, metadata_json')
    .in('event_name', [...EVENTI_DI_GUASTO])
    .gte('created_at', new Date(da).toISOString())
    .order('created_at', { ascending: false })
    // Un tetto serve: durante un guasto grosso questa lettura potrebbe tirare
    // su decine di migliaia di righe dentro un cron con un budget di tempo.
    // Cinquecento bastano a capire cosa si è rotto; il conteggio esatto non
    // cambia la decisione di chi legge.
    .limit(500);
  return ((data ?? []) as { event_name: string; created_at: string; metadata_json: unknown }[]).map(
    (r) => ({
      eventName: r.event_name,
      createdAt: r.created_at,
      dettagli: (r.metadata_json ?? null) as Record<string, unknown> | null,
    }),
  );
}

function corpoAvviso(gruppi: GruppoGuasti[], da: number, a: number): string {
  const ora = (t: number) =>
    new Date(t).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
  const righe = gruppi
    .slice(0, 15)
    .map(
      (g) => `<tr>
        <td style="padding:6px 12px 6px 0;text-align:right;font-weight:700;white-space:nowrap">${g.quante}×</td>
        <td style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${escapeHtml(g.esempio)}</td>
      </tr>`,
    )
    .join('');
  const altri = gruppi.length > 15 ? `<p style="color:#6b6259;font-size:13px">…e altri ${gruppi.length - 15} tipi.</p>` : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#17130f">
    <h2 style="font-size:20px;margin:0 0 4px;letter-spacing:-.02em">Verificato — guasti registrati</h2>
    <p style="color:#6b6259;font-size:13px;margin:0 0 16px">Dal ${ora(da)} al ${ora(a)}.</p>
    <table style="border-collapse:collapse;width:100%">${righe}</table>
    ${altri}
    <p style="margin:20px 0 0"><a href="${indirizzoApp()}/app/settings/servizio" style="display:inline-block;background:#c22b27;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:700">Apri il pannello</a></p>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Guarda se c'è qualcosa di rotto e, se serve, lo manda per email.
 *
 * Best-effort come tutto quello che gira nel cron: non lancia mai, perché un
 * allarme che fa cadere il giro di generazione è peggio del guasto che voleva
 * segnalare.
 *
 * QUANDO NON È CONFIGURATO LO DICE. Senza `ADMIN_EMAILS` o senza
 * `RESEND_API_KEY` non c'è modo di mandare niente, e il caso va detto invece
 * che ingoiato: un sistema di allarmi che tace perché è spento è
 * indistinguibile da uno che tace perché va tutto bene, ed è la differenza fra
 * essere tranquilli e crederlo.
 */
export async function controllaGuasti(
  service: Service,
  opzioni: { adesso?: number } = {},
): Promise<EsitoAllarmi> {
  const adesso = opzioni.adesso ?? Date.now();
  const a = destinatari();
  if (a.length === 0) {
    return { mandato: false, motivo: 'Avvisi non configurati: manca ADMIN_EMAILS.', guasti: 0 };
  }
  if (!process.env.RESEND_API_KEY) {
    return { mandato: false, motivo: 'Avvisi non configurati: manca RESEND_API_KEY.', guasti: 0 };
  }

  try {
    const ultimoAvviso = await quandoLUltimoAvviso(service);
    const da = inizioFinestra({ adesso, ultimoAvviso });
    const eventi = await leggiGuasti(service, da);
    const decisione = decidiAvviso(eventi, { adesso, ultimoAvviso });
    if (!decisione.avvisa) {
      return { mandato: false, motivo: decisione.motivo, guasti: decisione.totale };
    }

    // Il segnaposto si scrive PRIMA di mandare, non dopo: due giri del cron
    // possono sovrapporsi, e se il silenzio partisse dall'invio riuscito
    // entrambi troverebbero campo libero e manderebbero la stessa email.
    // Scrivendo prima, il secondo trova il silenzio già in piedi. Il prezzo è
    // che un invio fallito costa mezz'ora di attesa — accettabile: i guasti
    // restano nella finestra e arrivano al giro dopo.
    await logWrite(
      `app_events.insert(${EVENTO_AVVISO_MANDATO})`,
      service.from('app_events').insert({
        event_name: EVENTO_AVVISO_MANDATO,
        metadata_json: { guasti: decisione.totale, tipi: decisione.gruppi.length },
      }),
    );

    const oggetto = oggettoAvviso(decisione);
    const html = corpoAvviso(decisione.gruppi, da, adesso);
    let partite = 0;
    for (const indirizzo of a) {
      if (await sendEmail(indirizzo, oggetto, html)) partite++;
    }
    return {
      mandato: partite > 0,
      motivo: partite > 0 ? `Avviso mandato a ${partite} indirizzi.` : 'Invio non riuscito.',
      guasti: decisione.totale,
    };
  } catch (e) {
    return {
      mandato: false,
      motivo: `Controllo guasti non riuscito: ${e instanceof Error ? e.message : 'errore'}`,
      guasti: 0,
    };
  }
}
