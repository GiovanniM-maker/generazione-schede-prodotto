-- Analisi foto in BACKGROUND: lo stato vive sul batch, così il lavoro continua
-- anche se l'utente chiude la pagina e il cron può riprenderlo.
--   pending  = da analizzare (o da riprendere)
--   running  = un'esecuzione è in corso (claim con visual_analysis_claimed_at)
--   done     = completata
--   error    = fallita in modo definitivo (messaggio in visual_analysis_error)
alter table batches add column if not exists visual_analysis_status text;
alter table batches add column if not exists visual_analysis_claimed_at timestamptz;
alter table batches add column if not exists visual_analysis_error text;

-- Il cron cerca i batch da analizzare: indice mirato.
create index if not exists batches_visual_analysis_idx
  on batches(visual_analysis_status)
  where visual_analysis_status in ('pending', 'running');
