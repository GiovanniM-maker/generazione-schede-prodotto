-- ---------------------------------------------------------------------------
-- Sapere come va il servizio.
--
-- Non c'era modo di rispondere a nessuna di queste domande: quante
-- organizzazioni ci sono, quanto generano, quanto ci costa l'AI, chi è rimasto
-- bloccato a metà, cosa si è rotto ieri. La materia prima c'era già tutta —
-- `generation_runs` registra token e costo stimato per ogni chiamata,
-- `credit_ledger` i soldi, `app_events` i guasti — ma nessuno la guardava.
--
-- Un servizio che non si guarda si scopre rotto dai clienti.
--
-- Una funzione sola, un giro solo: il pannello non deve costare dieci letture
-- per disegnare sei numeri.
-- ---------------------------------------------------------------------------

create or replace function pannello_servizio(giorni int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with finestra as (
    select now() - make_interval(days => greatest(1, giorni)) as da
  )
  select jsonb_build_object(
    'giorni', greatest(1, giorni),

    -- Chi c'è.
    'organizzazioni', (select count(*) from organizations),
    'organizzazioni_nuove', (
      select count(*) from organizations, finestra where created_at >= finestra.da
    ),
    'persone', (select count(distinct user_id) from organization_members),

    -- Quanto si lavora.
    'batch_totali', (select count(*) from batches),
    'batch_nella_finestra', (
      select count(*) from batches, finestra where created_at >= finestra.da
    ),
    'schede_generate', (
      select count(*) from product_generations, finestra where created_at >= finestra.da
    ),

    -- Quanto costa. `estimated_cost` è una stima del fornitore, non una
    -- fattura: il nome lo dice e il pannello deve dirlo pure lui.
    'costo_stimato', (
      select coalesce(sum(estimated_cost), 0)::float8
      from generation_runs, finestra where created_at >= finestra.da
    ),
    'token_ingresso', (
      select coalesce(sum(input_tokens), 0)::bigint
      from generation_runs, finestra where created_at >= finestra.da
    ),
    'token_uscita', (
      select coalesce(sum(output_tokens), 0)::bigint
      from generation_runs, finestra where created_at >= finestra.da
    ),

    -- Quanto si incassa, e quanto si consuma.
    'crediti_venduti', (
      select coalesce(sum(amount), 0)::int
      from credit_ledger, finestra
      where entry_type = 'purchase' and created_at >= finestra.da
    ),
    'incassato_centesimi', (
      select coalesce(sum((metadata_json->>'amount_cents')::int), 0)::bigint
      from credit_ledger, finestra
      where entry_type = 'purchase'
        and created_at >= finestra.da
        and metadata_json ? 'amount_cents'
    ),
    'crediti_consumati', (
      select coalesce(-sum(amount), 0)::int
      from credit_ledger, finestra
      where entry_type = 'consumption' and created_at >= finestra.da
    ),

    -- Chi si è bloccato: batch fermi in uno stato non terminale da più di
    -- dieci minuti. È la stessa soglia del riconciliatore, e per lo stesso
    -- motivo: sotto quella, «fermo» vuol dire solo «sta lavorando».
    'batch_bloccati', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id,
        'organizzazione', o.name,
        'nome', b.name,
        'stato', b.status,
        'fermo_da_minuti', floor(extract(epoch from (now() - b.updated_at)) / 60)::int
      ) order by b.updated_at), '[]'::jsonb)
      from batches b
      join organizations o on o.id = b.organization_id
      where b.status in ('queued', 'processing', 'sample_pending')
        and b.updated_at < now() - interval '10 minutes'
    ),

    -- Cosa si è rotto. Gli eventi di guasto ci sono già: scritture fallite,
    -- movimenti di credito non registrati, errori non gestiti.
    'guasti', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quando', e.created_at,
        'evento', e.event_name,
        'dettagli', e.metadata_json
      ) order by e.created_at desc), '[]'::jsonb)
      from (
        select * from app_events, finestra
        where event_name in ('write_failed', 'credit_ledger_failed', 'unhandled_error')
          and app_events.created_at >= finestra.da
        order by created_at desc
        limit 50
      ) e
    ),
    'guasti_totali', (
      select count(*) from app_events, finestra
      where event_name in ('write_failed', 'credit_ledger_failed', 'unhandled_error')
        and app_events.created_at >= finestra.da
    )
  );
$$;

comment on function pannello_servizio(int) is
  'Numeri di salute del servizio in una chiamata sola. SECURITY DEFINER: legge '
  'attraverso tutte le organizzazioni, quindi va chiamata solo dopo aver '
  'verificato che chi chiede è un amministratore del prodotto.';
