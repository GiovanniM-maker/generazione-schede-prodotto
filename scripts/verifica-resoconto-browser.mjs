#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Una suite che si salta da sola è verde.
//
// `e2e/sessione.ts` ha un `motivoPerSaltare()`: senza
// `SUPABASE_SERVICE_ROLE_KEY` e senza `QA_ALLOW_WRITES=1`, tutti i test che
// toccano l'applicazione si saltano. È una scelta giusta — quei test scrivono
// su un database vero, e saltare è meglio che scrivere dove non si deve — ma in
// CI diventa una trappola: basta una variabile che non arriva e il lavoro
// esce verde **senza aver aperto una sola pagina**.
//
// È lo stesso difetto che ho già trovato due volte in questa stessa suite: un
// test che passa per assenza di bersaglio. Qui c'è il freno.
//
// Uso: node scripts/verifica-resoconto-browser.mjs <resoconto.json> <minimo>
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const [percorso, minimoGrezzo] = process.argv.slice(2);
if (!percorso) {
  console.error('Manca il percorso del resoconto JSON di Playwright.');
  process.exit(2);
}
const minimo = Number(minimoGrezzo ?? 0);
if (!Number.isFinite(minimo) || minimo <= 0) {
  console.error('Il minimo dev’essere un numero maggiore di zero.');
  process.exit(2);
}

let resoconto;
try {
  resoconto = JSON.parse(readFileSync(percorso, 'utf8'));
} catch (e) {
  console.error(`Resoconto illeggibile (${percorso}): ${e.message}`);
  console.error('Se Playwright non l’ha scritto, la suite non è nemmeno partita.');
  process.exit(1);
}

const s = resoconto.stats ?? {};
const passati = s.expected ?? 0;
const falliti = s.unexpected ?? 0;
const instabili = s.flaky ?? 0;
const saltati = s.skipped ?? 0;

console.log(
  `Browser: ${passati} passati, ${falliti} falliti, ${instabili} instabili, ${saltati} saltati.`,
);

const problemi = [];
if (falliti > 0) problemi.push(`${falliti} test falliti`);
if (passati < minimo) {
  problemi.push(
    `solo ${passati} test hanno girato, ne servono almeno ${minimo}: ` +
      'la suite si è saltata da sola (configurazione mancante?) invece di provare qualcosa',
  );
}
// Saltarne qualcuno è normale — alcuni si saltano quando il dato non c'è. Ma se
// i saltati superano quelli girati, quello che resta non è più una verifica.
if (saltati > passati) {
  problemi.push(`${saltati} saltati contro ${passati} girati: la suite sta guardando troppo poco`);
}

if (problemi.length > 0) {
  console.error('\nLa suite del browser non è attendibile:');
  for (const p of problemi) console.error(`  · ${p}`);
  process.exit(1);
}

if (instabili > 0) {
  // Non blocca, ma si legge: un test che passa solo al secondo tentativo è un
  // difetto in arrivo, non un test verde.
  console.log(`\nAttenzione: ${instabili} test sono passati solo al secondo tentativo.`);
}
