-- ---------------------------------------------------------------------------
-- Gli errori del server entrano nel conto dei guasti.
--
-- COSA CAMBIA. `instrumentation.ts` comincia a registrare `errore_server`: le
-- eccezioni dentro server action, route handler e render di pagina, che prima
-- finivano solo nei log di Vercel. Ma l'elenco dei guasti stava scritto a mano
-- dentro `pannello_servizio`, in due punti, e senza toccarlo quegli eventi
-- sarebbero arrivati nella tabella e non sarebbero comparsi da nessuna parte —
-- raccolti e invisibili, che è il modo più costoso di non avere niente.
--
-- E siccome erano due copie della stessa lista in una funzione di novanta
-- righe, il prossimo nome nuovo sarebbe finito di nuovo in una sola delle due.
-- Adesso la lista sta in un posto e si legge da lì.
-- ---------------------------------------------------------------------------

-- L'elenco dei nomi che raccontano un guasto. Deve restare allineato a
-- `EVENTI_DI_GUASTO` in `packages/core/src/allarmi.ts`, che è la copia che il
-- codice usa per decidere cosa mandare per email.
create or replace function eventi_di_guasto()
returns text[]
language sql
immutable
set search_path = public, pg_catalog
as $$
  select array[
    'unhandled_error',
    'errore_server',
    'write_failed',
    'credit_ledger_failed'
  ]::text[];
$$;

comment on function eventi_di_guasto() is
  'I nomi di app_events che indicano un guasto. Allineato a EVENTI_DI_GUASTO '
  'in packages/core/src/allarmi.ts.';

-- L'indice che serve alla lettura degli allarmi: il cron gira ogni minuto e
-- chiede sempre la stessa cosa — questi nomi, da questo istante in poi.
-- L'indice esistente è sul solo `event_name`, quindi il filtro sulla data
-- restava una scansione delle righe trovate, e `app_events` cresce a ogni
-- azione di ogni cliente.
create index if not exists app_events_guasti_idx
  on app_events (event_name, created_at desc);

-- Lo stesso, per il segnaposto del silenzio: una riga sola, la più recente,
-- letta a ogni giro del cron.
create index if not exists app_events_avvisi_idx
  on app_events (created_at desc)
  where event_name = 'alert_sent';

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
    -- movimenti di credito non registrati, errori non gestiti, ed errori del
    -- server presi dalla strumentazione.
    'guasti', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quando', e.created_at,
        'evento', e.event_name,
        'dettagli', e.metadata_json
      ) order by e.created_at desc), '[]'::jsonb)
      from (
        select * from app_events, finestra
        where event_name = any(eventi_di_guasto())
          and app_events.created_at >= finestra.da
        order by created_at desc
        limit 50
      ) e
    ),
    'guasti_totali', (
      select count(*) from app_events, finestra
      where event_name = any(eventi_di_guasto())
        and app_events.created_at >= finestra.da
    ),

    -- Quando è partito l'ultimo avviso per email. `null` non vuol dire «va
    -- tutto bene»: vuol dire o che non si è rotto niente, o che gli avvisi non
    -- sono configurati. Le due cose si distinguono dalla risposta del cron.
    'ultimo_avviso', (
      select max(created_at) from app_events where event_name = 'alert_sent'
    )
  );
$$;

comment on function pannello_servizio(int) is
  'Numeri di salute del servizio in una chiamata sola. SECURITY DEFINER: legge '
  'attraverso tutte le organizzazioni, quindi va chiamata solo dopo aver '
  'verificato che chi chiede è un amministratore del prodotto.';
