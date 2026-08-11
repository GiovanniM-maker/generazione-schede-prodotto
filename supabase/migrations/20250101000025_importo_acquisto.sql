-- ---------------------------------------------------------------------------
-- Quanto è stato pagato, non quanto costa oggi.
--
-- Il registro dei crediti annotava solo `price_key`: per sapere l'importo di un
-- acquisto bisognava andare a leggere il prezzo *attuale* del pacchetto. Ma i
-- prezzi cambiano, e una cronologia che si riscrive da sola quando cambia il
-- listino non è una cronologia — è una bugia retroattiva.
--
-- L'importo va scritto nel momento in cui i soldi passano, e resta quello.
-- ---------------------------------------------------------------------------

drop function if exists apply_credit_purchase(uuid, int, uuid, text);

create or replace function apply_credit_purchase(
  org uuid,
  amt int,
  stripe_event uuid,
  price_key text,
  amount_cents int default null,
  currency text default 'EUR'
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Idempotenza applicativa: non fare nulla se esiste gia' un acquisto per
  -- questo evento Stripe (reference_id = stripe_event).
  if exists (
    select 1 from credit_ledger
    where organization_id = org
      and entry_type = 'purchase'
      and reference_id = stripe_event
  ) then
    return;
  end if;

  insert into credit_ledger (organization_id, amount, entry_type, reference_type, reference_id, metadata_json)
  values (
    org, amt, 'purchase', 'stripe_event', stripe_event,
    jsonb_build_object('price_key', price_key, 'amount_cents', amount_cents, 'currency', currency)
  );
end;
$$;
