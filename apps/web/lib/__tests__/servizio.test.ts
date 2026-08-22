import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTI_DI_GUASTO } from '@app/core';
import { FakeDb, SCHEMA_APP } from './fake-supabase.js';

// ---------------------------------------------------------------------------
// Sapere come va il servizio, e chi può saperlo.
//
// Non c'era modo di rispondere a nessuna domanda sulla salute del prodotto:
// quante organizzazioni, quanto generano, quanto costa l'AI, chi è rimasto
// bloccato, cosa si è rotto ieri. La materia prima c'era già tutta — nessuno la
// guardava. Un servizio che non si guarda si scopre rotto dai clienti.
//
// Ma una pagina che legge **attraverso tutte le organizzazioni** è la cosa più
// pericolosa del prodotto: sbagliare il controllo qui vuol dire mostrare i
// numeri di tutti al primo che passa. Per questo il controllo non è un ruolo nel
// database — un ruolo si assegna per sbaglio — ma una variabile d'ambiente, e il
// caso predefinito è **chiuso**.
// ---------------------------------------------------------------------------

let db: FakeDb;
let emailCorrente: string | null = 'chiunque@example.invalid';
let adminEmails = '';

vi.mock('@/lib/supabase/service', () => ({ getServiceClient: () => db }));
vi.mock('@/lib/env.server', () => ({ getServerEnv: () => ({ ADMIN_EMAILS: adminEmails }) }));
vi.mock('@/lib/auth', () => ({
  getSessionUser: async () => (emailCorrente ? { id: 'user-1', email: emailCorrente } : null),
}));

const servizio = await import('../actions/servizio.js');

beforeEach(() => {
  db = new FakeDb({ schema: SCHEMA_APP });
  emailCorrente = 'chiunque@example.invalid';
  adminEmails = '';
});

describe('chi può vedere lo stato del servizio', () => {
  it('senza elenco configurato, nessuno', () => {
    // È il caso predefinito, ed è quello che conta: un pannello che legge i dati
    // di tutte le organizzazioni non deve MAI aprirsi per dimenticanza.
    adminEmails = '';
    return expect(servizio.sonoAmministratore()).resolves.toBe(false);
  });

  it('chi è nell’elenco sì', async () => {
    adminEmails = 'capo@example.invalid';
    emailCorrente = 'capo@example.invalid';
    await expect(servizio.sonoAmministratore()).resolves.toBe(true);
  });

  it('chi non c’è, no — anche se ha una sessione valida', async () => {
    adminEmails = 'capo@example.invalid';
    emailCorrente = 'altro@example.invalid';
    await expect(servizio.sonoAmministratore()).resolves.toBe(false);
  });

  it('l’elenco tollera spazi e maiuscole, che è come lo si scrive davvero', async () => {
    adminEmails = ' Capo@Example.Invalid , socia@example.invalid ';
    emailCorrente = 'capo@example.invalid';
    await expect(servizio.sonoAmministratore()).resolves.toBe(true);
    emailCorrente = 'socia@example.invalid';
    await expect(servizio.sonoAmministratore()).resolves.toBe(true);
  });

  it('senza sessione, no', async () => {
    adminEmails = 'capo@example.invalid';
    emailCorrente = null;
    await expect(servizio.sonoAmministratore()).resolves.toBe(false);
  });
});

describe('leggere lo stato', () => {
  it('a chi non è amministratore non arriva niente', async () => {
    adminEmails = 'capo@example.invalid';
    emailCorrente = 'curioso@example.invalid';
    const res = await servizio.statoServizio();
    expect(res.ok).toBe(false);
    // Il messaggio non dice «non sei autorizzato»: confermerebbe che c'è
    // qualcosa da autorizzare.
    expect(String((res as { error: string }).error)).toBe('Non disponibile');
    expect(db.calls).toHaveLength(0);
  });

  it('la pagina risponde 404, non «non autorizzato»', () => {
    // Una pagina che dice «non sei autorizzato» conferma di esistere.
    const pagina = readFileSync(
      join(process.cwd(), 'apps/web/app/app/admin/page.tsx'),
      'utf8',
    );
    expect(pagina).toMatch(/if \(!res\.ok\) notFound\(\)/);
  });
});

describe('la raccolta degli errori', () => {
  it('scrive il guasto dove finiscono già gli altri', async () => {
    await servizio.registraErrore({ messaggio: 'boom', origine: 'prova', percorso: '/app' });
    const riga = db.row('app_events');
    expect(riga.event_name).toBe('unhandled_error');
    expect((riga.metadata_json as Record<string, unknown>).messaggio).toBe('boom');
  });

  it('taglia i messaggi lunghi', async () => {
    // Un errore può portarsi dietro mezzo documento.
    await servizio.registraErrore({ messaggio: 'x'.repeat(2000) });
    const m = db.row('app_events').metadata_json as Record<string, string>;
    expect(m.messaggio).toHaveLength(500);
  });

  it('senza sessione non scrive niente', async () => {
    // In Next ogni funzione esportata da un file 'use server' è un indirizzo di
    // rete: senza il controllo, chiunque potrebbe riempire di rumore la tabella
    // dei guasti.
    emailCorrente = null;
    await servizio.registraErrore({ messaggio: 'spam' });
    expect(db.rows('app_events')).toHaveLength(0);
  });
});

describe('cosa mostra il pannello', () => {
  // La 42 è l'ultima a ridefinire `pannello_servizio`: leggere la 27 vorrebbe
  // dire provare una versione della funzione che in produzione non esiste più.
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20250101000042_allarmi.sql'),
    'utf8',
  );

  it('«fermo» ha la stessa soglia del riconciliatore', () => {
    // Dieci minuti: sotto quella, «fermo» vuol dire solo «sta lavorando». Due
    // soglie diverse per la stessa idea porterebbero il pannello a segnalare
    // batch che il riconciliatore considera sani, o viceversa.
    expect(sql).toMatch(/interval '10 minutes'/);
    const reconcile = readFileSync(
      join(process.cwd(), 'packages/pipeline/src/reconcile.ts'),
      'utf8',
    );
    expect(reconcile).toMatch(/FERMO_DA_MS = 10 \* 60 \* 1000/);
  });

  it('raccoglie gli stessi guasti che il codice manda per email', () => {
    // Le due liste devono coincidere, non «contenersi». Un nome che sta solo
    // nel database arriva nel pannello e mai per email; uno che sta solo nel
    // codice arriva per email e non compare nel pannello di chi va a
    // guardare — e in entrambi i casi si scopre da un cliente che scrive.
    const elencoSql = /select array\[([\s\S]*?)\]::text\[\]/.exec(sql)?.[1] ?? '';
    const nelSql = [...elencoSql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(nelSql).toEqual([...EVENTI_DI_GUASTO]);
  });

  it('dice quando è partito l’ultimo avviso', () => {
    // Senza questo, «nessun guasto» e «nessun avviso configurato» si leggono
    // uguali nel pannello, e il secondo è il caso in cui non si sa niente.
    expect(sql).toContain('ultimo_avviso');
  });

  it('è una chiamata sola', () => {
    // Il pannello non deve costare dieci letture per disegnare sei numeri.
    const azioni = readFileSync(
      join(process.cwd(), 'apps/web/lib/actions/servizio.ts'),
      'utf8',
    );
    expect(azioni.match(/service\.rpc\(/g) ?? []).toHaveLength(1);
    expect(azioni).not.toMatch(/\.from\('generation_runs'\)/);
  });
});
