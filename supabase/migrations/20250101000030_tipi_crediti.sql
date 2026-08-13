-- ---------------------------------------------------------------------------
-- I tipi che servono ai lotti di credito.
--
-- Stanno in una migrazione tutta loro per una ragione precisa: `alter type …
-- add value` aggiunge un valore all'enum, ma quel valore **non è utilizzabile
-- nella stessa transazione** che lo ha aggiunto. Le migrazioni di Supabase
-- girano una per transazione: mettere qui i tipi e nella prossima le funzioni
-- che li usano è l'unico ordine che funziona in ogni caso.
--
-- `expiry` è la riga che il registro scrive quando un lotto scade: importo
-- negativo pari a quello che restava. Senza, il saldo verrebbe calcolato
-- «togliendo» i lotti scaduti a ogni lettura, e la storia di quei crediti — chi
-- li aveva comprati, quando sono svaniti — non resterebbe scritta da nessuna
-- parte.
--
-- `subscription_grant` distingue i 150 crediti mensili dell'abbonamento da un
-- acquisto: hanno prezzo diverso, scadenza diversa (fine ciclo contro dodici
-- mesi) e precedenza diversa nel consumo. Chiamarli entrambi `purchase`
-- renderebbe impossibile rispondere a «quanto rende davvero l'abbonamento».
-- ---------------------------------------------------------------------------

alter type credit_entry_type add value if not exists 'expiry';
alter type credit_entry_type add value if not exists 'subscription_grant';

-- Da dove viene un lotto. Determina anche la precedenza nel consumo: prima
-- l'abbonamento (scade comunque a fine ciclo), poi il resto per scadenza.
do $$ begin
  create type credit_lot_source as enum ('trial', 'pack', 'subscription', 'manual');
exception when duplicate_object then null; end $$;

-- Gli stati che Stripe usa per un abbonamento, ridotti a quelli che ci
-- cambiano il comportamento. `incomplete` e `unpaid` non danno diritti;
-- `past_due` sì, finché Stripe non si arrende: sospendere al primo pagamento
-- fallito significa spegnere il servizio a un cliente per una carta scaduta.
do $$ begin
  create type subscription_status as enum (
    'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid'
  );
exception when duplicate_object then null; end $$;
