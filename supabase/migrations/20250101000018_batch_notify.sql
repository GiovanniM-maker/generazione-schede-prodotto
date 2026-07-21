-- Notifica email a fine generazione: email destinatario + timestamp inviata.
alter table batches add column if not exists notify_email text;
alter table batches add column if not exists notified_at timestamptz;
