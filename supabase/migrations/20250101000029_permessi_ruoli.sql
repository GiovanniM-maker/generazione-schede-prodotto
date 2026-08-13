-- =====================================================================
-- I permessi dei ruoli, scritti dove si possono rifare.
--
-- COSA MANCAVA
--
-- Nelle ventotto migrazioni precedenti non c'è **un solo `grant` su una
-- tabella**: ci sono solo sei `grant execute` su funzioni. Le tabelle sono
-- create da `postgres` e nessuno concede niente ad `anon`, `authenticated`,
-- `service_role`.
--
-- Sul progetto ospitato l'applicazione funziona lo stesso, perché quei permessi
-- glieli ha dati la piattaforma al momento della creazione — fuori da questo
-- repository. Il risultato è che **le migrazioni qui dentro non sanno
-- ricostruire il database che sta in produzione**: un progetto nuovo creato da
-- questi file avrebbe le tabelle giuste e un'applicazione che non riesce a
-- leggerle.
--
-- Si è visto mettendo la suite del browser in CI, che gira contro un Supabase
-- locale creato solo da queste migrazioni: ottantasei test falliti, tutti con
-- lo stesso messaggio —
--
--     permission denied for table organizations (SQLSTATE 42501)
--
-- PERCHÉ È SICURO CONCEDERE TUTTO
--
-- Perché il permesso non è il controllo d'accesso: il controllo è RLS, e in
-- questo schema RLS è attiva su **tutte e quarantaquattro** le tabelle
-- (verificato contando `enable row level security` contro le `create table`).
-- Un `grant` ad `anon` senza una policy che lo autorizzi non fa vedere niente.
--
-- È anche esattamente quello che fa Supabase sui progetti nuovi: questi comandi
-- non aggiungono un permesso, mettono per iscritto quello che c'è già.
--
-- Su un database dove sono già stati dati, questa migrazione non cambia nulla.
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- E anche per quello che verrà dopo: senza queste righe, la prossima tabella
-- creata da una migrazione futura ripeterebbe il difetto in silenzio.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
