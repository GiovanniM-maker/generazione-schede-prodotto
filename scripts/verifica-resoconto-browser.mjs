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

// I motivi, raggruppati.
//
// Quando qualcosa manca all'ambiente, ottanta test falliscono per la STESSA
// ragione: il log di CI diventa ottanta ripetizioni della stessa pila di
// chiamate, e per trovare la frase che conta bisogna scorrere migliaia di
// righe. Qui i messaggi si contano e si stampano una volta sola.
function messaggi(nodo, dentro = []) {
  for (const s of nodo.suites ?? []) messaggi(s, dentro);
  for (const spec of nodo.specs ?? []) {
    for (const t of spec.tests ?? []) {
      for (const r of t.results ?? []) {
        for (const e of r.errors ?? []) {
          const testo = (e.message ?? '').replace(/\[[0-9;]*m/g, '');
          // Due righe, non una: «expect(locator).toBeVisible() failed» da sola
          // non distingue un difetto da un altro. La seconda dice quale.
          const righe = testo
            .split('\n')
            .map((r2) => r2.trim())
            .filter(Boolean)
            .slice(0, 2);
          if (righe.length) dentro.push(righe.join(' — ').slice(0, 200));
        }
      }
    }
  }
  return dentro;
}

const tutti = (resoconto.suites ?? []).flatMap((s) => messaggi(s));
if (tutti.length > 0) {
  const conta = new Map();
  for (const m of tutti) conta.set(m, (conta.get(m) ?? 0) + 1);
  const ordinati = [...conta.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\nMotivi distinti dei fallimenti, dal più frequente:');
  for (const [m, n] of ordinati.slice(0, 12)) console.log(`  ${String(n).padStart(4)} ×  ${m}`);
  if (ordinati.length > 12) console.log(`  … e altri ${ordinati.length - 12} motivi diversi.`);
}

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
