#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Setup del progetto Supabase remoto: link + migrazioni + seed + verifica.
# Esegui dal TUO terminale (non da questa sessione), dopo aver fatto login:
#   supabase login
#   export SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
#   bash scripts/setup-remote.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-fepljzntmbtcucbymtgq}"

command -v supabase >/dev/null 2>&1 || { echo "❌ Supabase CLI non trovato. Installa: https://supabase.com/docs/guides/cli"; exit 1; }

echo "▶ Collego il progetto $PROJECT_REF…"
supabase link --project-ref "$PROJECT_REF"

echo "▶ Applico le migrazioni (tabelle, RLS, funzioni, coda)…"
supabase db push

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "⚠  SUPABASE_DB_URL non impostata: salto seed e verifiche."
  echo "   Imposta la connection string (Settings → Database) e ri-esegui per il seed."
  exit 0
fi

command -v psql >/dev/null 2>&1 || { echo "❌ psql non trovato (installa postgresql-client)."; exit 1; }

echo "▶ Eseguo il seed (preset Moda, pacchetti crediti, coda generation_jobs)…"
psql "$SUPABASE_DB_URL" -f supabase/seed.sql

echo "▶ Verifiche:"
echo -n "   pgmq abilitata: "
psql "$SUPABASE_DB_URL" -tAc "select coalesce((select 'sì' from pg_extension where extname='pgmq'),'NO — abilitala in Database → Extensions')"
echo -n "   preset Moda: "
psql "$SUPABASE_DB_URL" -tAc "select coalesce((select 'presente' from presets where key='moda'),'assente')"
echo -n "   pacchetti crediti: "
psql "$SUPABASE_DB_URL" -tAc "select count(*)::text || ' pacchetti' from billing_products"
echo -n "   coda generation_jobs: "
psql "$SUPABASE_DB_URL" -tAc "select coalesce((select 'creata' from pgmq.list_queues() where queue_name='generation_jobs'),'assente')" 2>/dev/null || echo "verifica manualmente (pgmq)"

echo "✅ Setup remoto completato."
