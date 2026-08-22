import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTI_DI_GUASTO } from '@app/core';

// ---------------------------------------------------------------------------
// La raccolta degli errori del server.
//
// PERCHÉ ESISTE QUESTA PROVA
//
// `instrumentation.ts` non lo importa nessuno: lo carica Next, per convenzione,
// dal nome del file e dal nome delle funzioni esportate. Non c'è nessuna
// chiamata da seguire, quindi nessuno strumento — né il compilatore, né il
// linter, né una ricerca nel codice — si accorgerebbe se il file venisse
// rinominato, spostato in una cartella, o se `onRequestError` diventasse
// `onError` in un rinomina-tutto distratto.
//
// E il modo in cui fallirebbe è il peggiore: nessun errore, nessun test rosso,
// nessuna riga nei log. Semplicemente, da quel giorno in poi, zero guasti
// registrati — che si legge esattamente come «va tutto bene».
//
// Non si prova cosa scrive (per quello serve un server vero): si prova che il
// gancio esista, che si chiami come Next si aspetta, e che il nome dell'evento
// sia uno di quelli che gli avvisi poi vanno a cercare.
// ---------------------------------------------------------------------------

const percorso = join(process.cwd(), 'apps/web/instrumentation.ts');
const sorgente = readFileSync(percorso, 'utf8');

describe('il gancio degli errori del server', () => {
  it('sta dove Next lo cerca', () => {
    // Next carica `instrumentation.ts` dalla radice dell'applicazione. Dentro
    // `lib/` o `app/` non lo carica nessuno, e il file resterebbe lì a non
    // fare niente.
    expect(() => readFileSync(percorso, 'utf8')).not.toThrow();
  });

  it('esporta le funzioni con i nomi che Next chiama', () => {
    expect(sorgente).toMatch(/export function register\(/);
    expect(sorgente).toMatch(/export async function onRequestError\(/);
  });

  it('registra un evento che gli avvisi vanno a cercare', () => {
    // Se il nome qui e l'elenco in `allarmi.ts` divergessero, gli errori del
    // server finirebbero nella tabella e non uscirebbero mai da lì.
    const nome = /const EVENTO = '([a-z_]+)'/.exec(sorgente)?.[1];
    expect(nome).toBeDefined();
    expect([...EVENTI_DI_GUASTO]).toContain(nome!);
  });

  it('non lascia passare un’eccezione', () => {
    // Un raccoglitore di errori che fallisce mentre raccoglie un errore
    // trasforma un guasto in due, e il secondo lo vede l'utente.
    expect(sorgente).toMatch(/\}\s*catch\s*\{/);
  });

  it('non archivia i dati di chi usa il prodotto', () => {
    // Solo messaggio, percorso, metodo e punto del codice. Niente corpo della
    // richiesta, niente intestazioni: lì dentro ci sono i token di sessione.
    expect(sorgente).not.toMatch(/request\.headers/);
    expect(sorgente).not.toMatch(/request\.body/);
  });
});
