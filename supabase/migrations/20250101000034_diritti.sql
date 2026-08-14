-- ---------------------------------------------------------------------------
-- Cosa ha diritto di fare un'organizzazione, in una domanda sola.
--
-- Le risposte esistono già tutte — saldo, lotti aperti, abbonamento, omaggio,
-- dotazione dell'assistente — ma sono sparse in cinque tabelle e due funzioni.
-- Chiederle una per una vuol dire cinque andate e ritorno per disegnare una
-- pagina, e soprattutto vuol dire che ogni punto dell'applicazione si compone
-- la propria risposta: prima o poi due punti se la compongono in modo diverso,
-- e la stessa organizzazione risulta senza crediti in un posto e con crediti in
-- un altro.
--
-- Questa è la fonte unica. Sopra ci sta un modulo solo, e sopra il modulo
-- l'interfaccia.
--
-- Non registra niente e non consuma niente: è una lettura. La dotazione
-- dell'assistente che restituisce è la stessa che userà `record_assistant_request`
-- quando arriverà una richiesta vera, perché la calcola con la stessa funzione.
--
-- I lotti scaduti non ci sono: sono già fuori dal saldo, e mostrarli in un
-- elenco intitolato «i tuoi crediti» sarebbe una bugia a schermo.
-- ---------------------------------------------------------------------------

create or replace function entitlements(org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with lotti as (
    select
      lo.id,
      lo.source::text as source,
      lo.expires_at,
      (lo.source = 'subscription') as prima,
      lo.created_at,
      coalesce(sum(cl.amount), 0)::int as remaining
    from credit_lots lo
    left join credit_ledger cl on cl.lot_id = lo.id
    where lo.organization_id = org
      and (lo.expires_at is null or lo.expires_at > now())
    group by lo.id, lo.source, lo.expires_at, lo.created_at
    having coalesce(sum(cl.amount), 0) > 0
  ),
  ciclo as (
    select cycle_start, cycle_end from current_cycle(org)
  )
  select jsonb_build_object(
    'balance', get_credit_balance(org),
    -- Nello stesso ordine in cui verranno consumati: l'elenco che si legge è
    -- l'elenco che si svuota, dall'alto.
    'lots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', l.id, 'source', l.source,
          'remaining', l.remaining, 'expires_at', l.expires_at
        )
        order by l.prima desc, l.expires_at asc nulls last, l.created_at asc
      )
      from lotti l
    ), '[]'::jsonb),
    'subscription', (
      select jsonb_build_object(
        'status', s.status::text,
        'monthly_credits', s.monthly_credits,
        'current_period_end', s.current_period_end,
        'cancel_at_period_end', s.cancel_at_period_end
      )
      from subscriptions s where s.organization_id = org
    ),
    'comp_until', (select o.comp_until from organizations o where o.id = org),
    'assistant', (
      select jsonb_build_object(
        'allowance', assistant_allowance(org, c.cycle_start, c.cycle_end),
        'requests', coalesce(ac.requests, 0),
        'allowance_used', coalesce(ac.allowance_used, 0),
        'billable_requests', coalesce(ac.billable_requests, 0),
        'credits_charged', coalesce(ac.credits_charged, 0),
        'cycle_start', c.cycle_start,
        'cycle_end', c.cycle_end
      )
      from ciclo c
      left join assistant_counters ac
        on ac.organization_id = org and ac.cycle_start = c.cycle_start
    ),
    'now', now()
  );
$$;

comment on function entitlements(uuid) is
  'Fonte unica di «cosa può fare questa organizzazione»: saldo, lotti aperti in ordine di consumo, abbonamento, omaggio, stato dell''assistente. Sola lettura.';

grant execute on function entitlements(uuid) to service_role;
