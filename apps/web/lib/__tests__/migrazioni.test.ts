import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// I nomi dei file delle migrazioni.
//
// Sembra pedanteria finché non si guarda cosa li usa: `supabase db push` decide
// **l'ordine di applicazione dall'ordine alfabetico dei nomi**, e riconosce una
// migrazione già passata dai primi quattordici caratteri. Due file con lo
// stesso prefisso vogliono dire che uno dei due non verrà mai applicato — e
// nessuno se ne accorgerà, perché `db push` non se ne lamenta: dirà che è tutto
// a posto.
//
// È lo stesso difetto trovato ieri un piano più in basso: `create table if not
// exists` che salta in silenzio. Qui si chiude la stessa porta a monte.
// ---------------------------------------------------------------------------

const CARTELLA = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(CARTELLA).filter((f) => f.endsWith('.sql')).sort();

describe('le migrazioni si possono applicare in ordine', () => {
  it('ce ne sono, e il test non passa per un elenco vuoto', () => {
    // Senza questo, cancellare la cartella renderebbe verdi tutte le prove qui
    // sotto: `every` su un elenco vuoto è vero.
    expect(file.length).toBeGreaterThan(20);
  });

  it('ogni nome è «14 cifre + underscore + nome»', () => {
    const storti = file.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
    expect(storti, 'nomi che `db push` ordinerebbe in modo imprevedibile').toEqual([]);
  });

  it('nessun prefisso ripetuto', () => {
    // Il caso che costa caro: due file con lo stesso numero, uno solo applicato,
    // e `db push` che dichiara tutto a posto.
    const visti = new Map<string, string>();
    const doppi: string[] = [];
    for (const f of file) {
      const v = f.slice(0, 14);
      if (visti.has(v)) doppi.push(`${visti.get(v)} e ${f}`);
      else visti.set(v, f);
    }
    expect(doppi).toEqual([]);
  });

  it('i prefissi crescono', () => {
    // L'ordine alfabetico dei nomi deve coincidere con l'ordine dei numeri:
    // se non coincide, una migrazione gira prima di quella che la prepara.
    const versioni = file.map((f) => f.slice(0, 14));
    expect(versioni).toEqual([...versioni].sort());
  });

  it('nessun file vuoto', () => {
    const vuoti = file.filter((f) => readFileSync(join(CARTELLA, f), 'utf8').trim().length === 0);
    expect(vuoti).toEqual([]);
  });

  it('una tabella nuova porta un nome che non è di nessun altro', () => {
    // Il progetto Supabase di produzione è riciclato da un'applicazione
    // precedente e ne portava quindici tabelle. `subscriptions` era una di
    // quelle, ed è per questo che la nostra si chiama `org_subscriptions`.
    //
    // I nomi generici sono quelli che collidono: se ne serve uno, va prefissato.
    // L'elenco è corto apposta — è una lista di parole troppo comuni per essere
    // rivendicate su un database che non abbiamo creato noi.
    const TROPPO_COMUNI = [
      'users', 'profiles', 'sessions', 'accounts', 'settings', 'logs', 'events',
      'subscriptions', 'plans', 'articles', 'notifications', 'feedback', 'schedules',
    ];
    const colpevoli: string[] = [];
    for (const f of file) {
      const src = readFileSync(join(CARTELLA, f), 'utf8');
      for (const m of src.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/g)) {
        if (TROPPO_COMUNI.includes(m[1]!)) colpevoli.push(`${f}: ${m[1]}`);
      }
    }
    expect(colpevoli, 'nome troppo comune: prefissalo, come org_subscriptions').toEqual([]);
  });
});
