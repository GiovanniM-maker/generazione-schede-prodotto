import { cache } from 'react';
import type { Diritti, Lotto, FonteLotto, Pacchetto, StatoAssistente } from '@app/core';
import { getServiceClient } from '@/lib/supabase/service';

// ---------------------------------------------------------------------------
// La lettura, in un giro solo.
//
// `entitlements(org)` in SQL mette insieme saldo, lotti aperti in ordine di
// consumo, abbonamento, omaggio e stato dell'assistente. Qui si aggiunge il
// listino — che non dipende dall'organizzazione e infatti sta in un'altra
// tabella — e si traduce nei tipi che l'interfaccia usa.
//
// Memoizzata per richiesta come le altre letture di sessione: la pagina della
// fatturazione la chiede una volta, il guscio dell'applicazione un'altra, e
// devono costare un giro in tutto.
//
// Il client di servizio, non quello dell'utente: la funzione SQL è SECURITY
// DEFINER ed è concessa solo a `service_role`. L'organizzazione arriva già
// verificata da `getUserOrg`, esattamente come per `getCreditBalance`.
// ---------------------------------------------------------------------------

interface RigaLotto {
  id: string;
  source: string;
  remaining: number;
  expires_at: string | null;
}

interface RispostaSql {
  balance: number;
  lots: RigaLotto[];
  subscription: {
    status: string;
    monthly_credits: number;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  comp_until: string | null;
  assistant: {
    allowance: number;
    requests: number;
    allowance_used: number;
    billable_requests: number;
    credits_charged: number;
    cycle_start: string;
    cycle_end: string;
  } | null;
  now: string;
}

const FONTI: FonteLotto[] = ['trial', 'pack', 'subscription', 'manual'];

function fonte(v: string): FonteLotto {
  return (FONTI as string[]).includes(v) ? (v as FonteLotto) : 'manual';
}

/**
 * Cosa può fare questa organizzazione. Non lancia: se la lettura non riesce,
 * torna un quadro a zero — e un quadro a zero **blocca** invece di lasciar
 * partire, che è il verso giusto in cui sbagliare quando si parla di soldi.
 */
export const leggiDiritti = cache(async (organizationId: string): Promise<Diritti> => {
  const service = getServiceClient();

  const [{ data, error }, { data: listino }] = await Promise.all([
    service.rpc('entitlements', { org: organizationId }),
    service
      .from('billing_products')
      .select('key, name, credits, price_cents, currency')
      .eq('active', true)
      .order('credits', { ascending: true }),
  ]);

  const pacchetti: Pacchetto[] = (listino ?? []).map((p) => ({
    chiave: p.key,
    nome: p.name,
    crediti: p.credits,
    prezzoCent: p.price_cents ?? null,
    valuta: p.currency ?? 'EUR',
  }));

  if (error || !data) {
    return {
      saldo: 0,
      lotti: [],
      abbonamento: null,
      omaggioFinoAl: null,
      assistente: null,
      pacchetti,
      adesso: new Date().toISOString(),
    };
  }

  const r = data as unknown as RispostaSql;

  const lotti: Lotto[] = (r.lots ?? []).map((l) => ({
    id: l.id,
    fonte: fonte(l.source),
    rimanenti: l.remaining,
    scadeIl: l.expires_at,
  }));

  const assistente: StatoAssistente | null = r.assistant
    ? {
        dotazione: r.assistant.allowance,
        richieste: r.assistant.requests,
        dotazioneUsata: r.assistant.allowance_used,
        oltreLaDotazione: r.assistant.billable_requests,
        creditiAddebitati: r.assistant.credits_charged,
        cicloIniziaIl: r.assistant.cycle_start,
        cicloFinisceIl: r.assistant.cycle_end,
      }
    : null;

  return {
    saldo: r.balance ?? 0,
    lotti,
    abbonamento: r.subscription
      ? {
          stato: r.subscription.status,
          creditiMensili: r.subscription.monthly_credits,
          rinnovaIl: r.subscription.current_period_end,
          disdettoAFineCiclo: r.subscription.cancel_at_period_end,
        }
      : null,
    omaggioFinoAl: r.comp_until,
    assistente,
    pacchetti,
    adesso: r.now ?? new Date().toISOString(),
  };
});
