-- ---------------------------------------------------------------------------
-- Lo schema `public` torna a contenere solo questa applicazione.
--
-- COSA C'ERA
--
-- Il progetto Supabase di produzione è riciclato da un'applicazione precedente
-- — un aggregatore di notizie — e in `public` ne restavano quindici tabelle:
--
--     articles (1011)   pipeline_logs (2612)   notifications (102)
--     feedback (49)     prompt_logs (19)       user_prompts (18)
--     weekly_status (13) feeds_config (9)      preset_templates (9)
--     profiles (9)      selection_prefs (9)    subscriptions (9)
--     user_templates (3) schedules (0)         sessions (0)
--
-- più un trigger su `auth.users`, `on_auth_user_created`, ancora attivo: a ogni
-- registrazione di questo prodotto scriveva quattro righe dentro quelle
-- tabelle. Nessuna riga di questo repository le nomina, e nessuna chiave
-- esterna attraversa il confine: puntano tutte a `auth.users` e basta.
--
-- SPOSTATE, NON CANCELLATE
--
-- Sono quasi quattromila righe del lavoro di qualcun altro (o del lavoro
-- precedente della stessa persona). `drop table` è irreversibile e non c'era
-- alcun bisogno di correre quel rischio: `set schema` le toglie da `public` —
-- quindi PostgREST smette di esporle, i nomi si liberano e l'applicazione non
-- le vede più — lasciandole leggibili.
--
-- Quando si è sicuri, si buttano davvero con una riga sola:
--
--     drop schema archivio_pre_verificato cascade;
--
-- IL TRIGGER SÌ, QUELLO SI TOGLIE
--
-- Quello va rimosso davvero: se le tabelle si spostano e lui resta, la
-- registrazione del prossimo utente fallisce. Il corpo originale è qui sotto,
-- per intero, così ricostruirlo è copiare e incollare:
--
--     BEGIN
--         INSERT INTO public.profiles (id, email, full_name)
--         VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
--         INSERT INTO public.subscriptions (user_id, plan, status)
--         VALUES (NEW.id, 'free', 'active');
--         INSERT INTO public.feeds_config (user_id, categories)
--         VALUES (NEW.id, '{}'::jsonb);
--         INSERT INTO public.selection_prefs (user_id)
--         VALUES (NEW.id);
--         RETURN NEW;
--     END;
--
-- Questo prodotto non ne ha bisogno: l'organizzazione la crea `ensureOrg` dal
-- codice, alla prima pagina dopo l'accesso, e i crediti di benvenuto li dà
-- `create_organization_for_user`.
--
-- Tutto con `if exists`: su ogni altro database — CI, staging, una copia nuova —
-- questa migrazione non trova niente e non fa niente.
-- ---------------------------------------------------------------------------

-- Prima il trigger: se restasse acceso senza le sue tabelle, la prossima
-- registrazione fallirebbe.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.increment_weekly_status() cascade;

create schema if not exists archivio_pre_verificato;

comment on schema archivio_pre_verificato is
  'Tabelle dell''applicazione che occupava questo progetto Supabase prima di Verificato. '
  'Nessun codice le usa. Si eliminano con: drop schema archivio_pre_verificato cascade;';

-- `public.` esplicito su ognuna, e non è pedanteria: esiste anche una
-- `auth.sessions`, che è di Supabase e regge le sessioni di accesso. Spostare
-- quella al posto della `public.sessions` dell'altra applicazione butterebbe
-- fuori tutti.
do $$
declare
  t text;
  estranee text[] := array[
    'articles', 'feedback', 'feeds_config', 'notifications', 'pipeline_logs',
    'preset_templates', 'profiles', 'prompt_logs', 'schedules', 'selection_prefs',
    'sessions', 'subscriptions', 'user_prompts', 'user_templates', 'weekly_status'
  ];
begin
  foreach t in array estranee loop
    if to_regclass('public.' || t) is not null then
      -- Una tabella nostra non finisce mai qui dentro: i nomi non si
      -- sovrappongono più (la nostra è `org_subscriptions`), ma il controllo
      -- resta perché il costo è zero e lo sbaglio sarebbe grosso.
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'organization_id'
      ) then
        raise exception
          'la tabella «public.%» ha una colonna organization_id: sembra nostra, non la sposto.', t;
      end if;

      execute format('alter table public.%I set schema archivio_pre_verificato', t);
      raise notice 'archiviata: %', t;
    end if;
  end loop;
end $$;
