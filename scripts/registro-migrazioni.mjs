#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Il registro delle migrazioni: quali sono passate, su quale database.
//
// PERCHÉ ESISTE
//
// Né la produzione né lo staging avevano `supabase_migrations.schema_migrations`.
// Vuol dire che nessun rilascio è mai passato da `supabase db push`: le
// migrazioni sono state applicate a mano, e da nessuna parte era scritto quali.
//
// Il risultato si è visto guardando: la produzione aveva la 1–29 e la 37, lo
// staging la 1–36 e non la 37. Due ambienti, due buchi diversi, e l'unico modo
// di scoprirlo era andare a cercare a mano se una certa tabella esistesse.
//
// Con il registro, «cosa manca a questo database» diventa una domanda con una
// risposta invece che un ricordo.
//
// USO
//
//   SUPABASE_PAT=sbp_… node scripts/registro-migrazioni.mjs stato <ref>
//   SUPABASE_PAT=sbp_… node scripts/registro-migrazioni.mjs segna <ref> <versioni…>
//
// Le versioni sono i prefissi numerici dei file, singoli o a intervallo:
//
//   node scripts/registro-migrazioni.mjs segna abcdefgh 20250101000001-20250101000029 20250101000037
//
// `segna` NON esegue niente: dichiara che quelle migrazioni sono già passate.
// Si usa una volta sola per ambiente, per mettere per iscritto uno stato che
// esiste già. Da lì in avanti tocca a `supabase db push`.
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAT = process.env.SUPABASE_PAT;

function esci(messaggio) {
  console.error(messaggio);
  process.exit(1);
}

async function query(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const corpo = await r.json();
  if (!r.ok || corpo?.message) {
    throw new Error(corpo?.message ?? `HTTP ${r.status}`);
  }
  return corpo;
}

/** I file che stanno nel repository, in ordine. */
function migrazioniNelRepository() {
  return readdirSync(join(RADICE, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ versione: f.slice(0, 14), nome: f.slice(15, -4), file: f }));
}

/**
 * Il registro, creato se non c'è.
 *
 * Le colonne sono quelle che usa la CLI di Supabase: `version` è la chiave, ed
 * è l'unica che `db push` guarda per decidere cosa applicare.
 */
async function assicuraRegistro(ref) {
  await query(
    ref,
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     );`,
  );
}

function espandi(argomenti, tutte) {
  const versioni = new Set();
  for (const a of argomenti) {
    const [da, a2] = a.split('-');
    if (a2) {
      for (const m of tutte) {
        if (m.versione >= da && m.versione <= a2) versioni.add(m.versione);
      }
    } else {
      versioni.add(da);
    }
  }
  return [...versioni].sort();
}

async function stato(ref) {
  const tutte = migrazioniNelRepository();
  let registrate = new Set();
  let registroEsiste = true;
  try {
    const righe = await query(ref, 'select version from supabase_migrations.schema_migrations;');
    registrate = new Set(righe.map((r) => r.version));
  } catch (e) {
    if (!/does not exist/.test(String(e.message))) throw e;
    registroEsiste = false;
  }

  if (!registroEsiste) {
    console.log(`registro assente su ${ref}: nessun rilascio è mai passato da «supabase db push».`);
    console.log(`${tutte.length} migrazioni nel repository, 0 registrate.`);
    console.log('Usa «segna» per mettere per iscritto quelle già applicate.');
    return 1;
  }

  const mancanti = tutte.filter((m) => !registrate.has(m.versione));
  // Una versione registrata che nel repository non c'è più: qualcuno ha
  // cancellato o rinominato un file dopo averlo applicato. Va detto, perché
  // vuol dire che il database ha dentro qualcosa che il repository non sa
  // ricostruire.
  const orfane = [...registrate].filter((v) => !tutte.some((m) => m.versione === v)).sort();

  console.log(`${ref}: ${registrate.size} registrate su ${tutte.length} nel repository.`);
  if (mancanti.length > 0) {
    console.log(`\nDa applicare (${mancanti.length}):`);
    for (const m of mancanti) console.log(`  ${m.versione}  ${m.nome}`);
  }
  if (orfane.length > 0) {
    console.log(`\nRegistrate ma non più nel repository (${orfane.length}):`);
    for (const v of orfane) console.log(`  ${v}`);
  }
  if (mancanti.length === 0 && orfane.length === 0) console.log('Allineato.');
  return mancanti.length > 0 || orfane.length > 0 ? 1 : 0;
}

async function segna(ref, argomenti) {
  const tutte = migrazioniNelRepository();
  const versioni = espandi(argomenti, tutte);
  if (versioni.length === 0) esci('nessuna versione indicata');

  const sconosciute = versioni.filter((v) => !tutte.some((m) => m.versione === v));
  if (sconosciute.length > 0) {
    esci(`versioni che nel repository non esistono: ${sconosciute.join(', ')}`);
  }

  await assicuraRegistro(ref);
  const valori = versioni
    .map((v) => {
      const m = tutte.find((x) => x.versione === v);
      return `('${v}', '${m.nome.replace(/'/g, "''")}')`;
    })
    .join(', ');
  await query(
    ref,
    `insert into supabase_migrations.schema_migrations (version, name)
     values ${valori}
     on conflict (version) do nothing;`,
  );
  console.log(`${ref}: ${versioni.length} versioni registrate.`);
  return stato(ref);
}

const [comando, ref, ...resto] = process.argv.slice(2);
if (!PAT) esci('manca SUPABASE_PAT');
if (!ref) esci('manca il riferimento del progetto');

try {
  if (comando === 'stato') process.exit(await stato(ref));
  else if (comando === 'segna') process.exit(await segna(ref, resto));
  else esci('comandi: stato | segna');
} catch (e) {
  esci(`errore: ${e.message}`);
}
