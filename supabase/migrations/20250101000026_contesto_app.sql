-- ---------------------------------------------------------------------------
-- Tre andate e ritorno per disegnare un'intestazione.
--
-- Ogni pagina autenticata pagava, in fila:
--
--   1. la verifica del token (rete, verso il servizio di autenticazione);
--   2. «di che organizzazione fa parte questo utente?»;
--   3. il saldo crediti e il conteggio dei dubbi aperti.
--
-- Le ultime due partivano insieme, ma solo dopo che la seconda era finita —
-- perché servono l'id dell'organizzazione. Un giro singolo verso il database
-- costa fra 165 e 300 ms: tre in fila fanno il pavimento di ~800 ms misurato su
-- *ogni* pagina dietro l'accesso, contro i 111-246 ms delle pagine pubbliche.
--
-- I passi 2 e 3 sono una domanda sola: «chi è, e come sta messo». Qui diventano
-- una chiamata sola, e il pavimento scende di un terzo.
--
-- Il saldo non è ricalcolato qui: chiama `get_credit_balance`, che resta
-- l'unico posto dove è scritto come si somma un registro di crediti. Due
-- versioni della stessa somma, prima o poi, divergono.
-- ---------------------------------------------------------------------------

create or replace function contesto_app(u uuid)
returns table (
  organization_id uuid,
  role text,
  credits int,
  open_doubts int
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with membro as (
    select om.organization_id, om.role::text as role
    from organization_members om
    where om.user_id = u
    order by om.created_at asc
    limit 1
  )
  select
    membro.organization_id,
    membro.role,
    get_credit_balance(membro.organization_id),
    coalesce(
      (select count(*)::int
       from ai_doubts d
       where d.organization_id = membro.organization_id
         and d.status = 'open'),
      0
    )
  from membro;
$$;

comment on function contesto_app(uuid) is
  'Organizzazione, ruolo, saldo crediti e dubbi aperti in una chiamata sola. '
  'Va invocata con un id utente gia'' verificato: essendo SECURITY DEFINER non '
  'passa dalle regole di accesso, esattamente come le letture che sostituisce.';
