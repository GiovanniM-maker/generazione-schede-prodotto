-- ---------------------------------------------------------------------------
-- Il listino è pubblico. Anche per chi non è ancora cliente.
--
-- Il commento sopra la vecchia regola diceva «catalogo pubblico dei pacchetti
-- attivi», ma la regola diceva `to authenticated`. Le due cose non
-- coincidevano, e a perderci era esattamente chi doveva decidere se comprare:
-- sulla vetrina, per un visitatore anonimo, la sezione «Pacchetti di crediti»
-- si apriva sul vuoto — titolo, sottotitolo, e nessun cartellino.
--
-- Cioè: il prezzo si vedeva solo dopo aver fatto un account. Dopo. È il difetto
-- che la colonna `price_cents` era stata aggiunta per togliere.
--
-- `billing_products` non contiene niente di riservato: chiave, nome, crediti,
-- prezzo e valuta. È un listino, ed è fatto per essere letto.
-- ---------------------------------------------------------------------------

drop policy if exists billing_products_select on billing_products;

create policy billing_products_select on billing_products
  for select
  to anon, authenticated
  using (active = true);

comment on table billing_products is
  'Listino dei pacchetti di crediti. Leggibile da chiunque quando active = true: '
  'un prezzo che si vede solo dopo l''iscrizione non è un prezzo esposto.';
