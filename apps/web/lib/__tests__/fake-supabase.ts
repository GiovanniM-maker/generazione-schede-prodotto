// ---------------------------------------------------------------------------
// Finto client Supabase, in memoria.
//
// Serve a testare le server action, cioè lo strato dove sono finiti quasi tutti
// i bug veri del progetto e che non aveva un solo test. Non riproduce PostgREST
// per intero: riproduce quello che il codice usa davvero, e soprattutto le due
// cose che hanno prodotto bug muti —
//
//   1) un valore non valido per un enum fa FALLIRE la scrittura (con errore),
//      esattamente come Postgres, invece di essere accettato;
//   2) un vincolo unico violato fa fallire l'INTERO insert, come una vera
//      INSERT multi-riga.
//
// Se un test passa qui ma fallirebbe in produzione, il finto client è sbagliato:
// va corretto lui, non il test.
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

export interface TableSpec {
  /** Colonne con valori ammessi: replica gli enum di Postgres. */
  enums?: Record<string, readonly string[]>;
  /** Gruppi di colonne che devono essere unici insieme. */
  unique?: readonly (readonly string[])[];
  /** Colonne NOT NULL. */
  required?: readonly string[];
  /**
   * Righe che spariscono insieme a questa (ON DELETE CASCADE nel database vero).
   * Senza questo un test puo' vedere "orfani" che in produzione non esistono —
   * o, peggio, non vederli quando ci sono davvero.
   */
  cascadeTo?: readonly { table: string; column: string }[];
}

export interface FakeDbOptions {
  schema?: Record<string, TableSpec>;
  /** Genera gli id; di default incrementale e prevedibile. */
  newId?: () => string;
}

interface Postgrestish<T> {
  data: T;
  error: { message: string } | null;
}

type Filter = (row: Row) => boolean;

export class FakeDb {
  readonly tables: Record<string, Row[]> = {};
  private readonly schema: Record<string, TableSpec>;
  private readonly newId: () => string;
  private seq = 0;
  /** Ogni operazione eseguita, per verificare quante richieste fa il codice. */
  readonly calls: Array<{ table: string; op: string; rows: number }> = [];

  /**
   * Guasti su richiesta: `tabella|op` → messaggio d'errore.
   *
   * Serve a provare la famiglia di bug piu' insidiosa di questo progetto: la
   * scrittura che fallisce e l'applicazione che dice "fatto". Senza poter far
   * fallire una scrittura a comando, quel comportamento non e' verificabile.
   */
  private readonly guasti = new Map<string, string>();

  /** Fa fallire quell'operazione su quella tabella, come farebbe Postgres. */
  guasta(table: string, op: 'insert' | 'update' | 'delete', messaggio: string): void {
    this.guasti.set(`${table}|${op}`, messaggio);
  }

  private guasto(table: string, op: string): { message: string } | null {
    const m = this.guasti.get(`${table}|${op}`);
    return m ? { message: m } : null;
  }

  constructor(opts: FakeDbOptions = {}) {
    this.schema = opts.schema ?? {};
    this.newId = opts.newId ?? (() => `id-${++this.seq}`);
  }

  /** File finti su storage: `bucket/percorso` → contenuto. */
  private readonly files = new Map<string, Buffer>();

  seed(table: string, rows: Row[]): void {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows.map((r) => ({ ...r }))];
  }

  /** Mette un file su storage, come farebbe un upload. */
  seedFile(bucket: string, path: string, contenuto: string | Buffer): void {
    this.files.set(`${bucket}/${path}`, Buffer.from(contenuto));
  }

  readonly storage = {
    from: (bucket: string) => ({
      /** Come l'upload vero: `upsert: false` rifiuta un percorso già occupato. */
      upload: async (
        path: string,
        contenuto: Buffer | ArrayBuffer | Uint8Array,
        opts?: { upsert?: boolean },
      ) => {
        const chiave = `${bucket}/${path}`;
        this.calls.push({ table: `storage:${bucket}`, op: 'upload', rows: 1 });
        if (this.files.has(chiave) && !opts?.upsert) {
          return { data: null, error: { message: `Duplicate: ${path}` } };
        }
        this.files.set(chiave, Buffer.from(contenuto as Uint8Array));
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const buf = this.files.get(`${bucket}/${path}`);
        this.calls.push({ table: `storage:${bucket}`, op: 'download', rows: buf ? 1 : 0 });
        if (!buf) return { data: null, error: { message: `Object not found: ${path}` } };
        return {
          data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) },
          error: null,
        };
      },
    }),
  };

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  /**
   * La riga in posizione `i`, o un errore parlante se non c'e'.
   * Meglio fallire qui con "riga assente" che con un "undefined" tre righe dopo.
   */
  row(table: string, i = 0): Row {
    const r = this.rows(table)[i];
    if (!r) throw new Error(`FakeDb: nessuna riga ${i} in "${table}"`);
    return r;
  }

  /** La riga con quell'id, o un errore parlante. */
  byId(table: string, id: string): Row {
    const r = this.rows(table).find((x) => x.id === id);
    if (!r) throw new Error(`FakeDb: nessuna riga con id "${id}" in "${table}"`);
    return r;
  }

  /** Violazioni di schema, come le riporterebbe Postgres. */
  private validate(table: string, row: Row): string | null {
    const spec = this.schema[table];
    if (!spec) return null;
    for (const col of spec.required ?? []) {
      if (row[col] === undefined || row[col] === null) {
        return `null value in column "${col}" of relation "${table}" violates not-null constraint`;
      }
    }
    for (const [col, allowed] of Object.entries(spec.enums ?? {})) {
      const v = row[col];
      if (v === undefined || v === null) continue;
      if (!allowed.includes(String(v))) {
        return `invalid input value for enum ${table}_${col}: "${String(v)}"`;
      }
    }
    return null;
  }

  private uniqueViolation(table: string, candidate: Row, existing: Row[]): string | null {
    const spec = this.schema[table];
    for (const cols of spec?.unique ?? []) {
      const key = cols.map((c) => JSON.stringify(candidate[c])).join('|');
      const clash = existing.some(
        (r) => r !== candidate && cols.map((c) => JSON.stringify(r[c])).join('|') === key,
      );
      if (clash) {
        return `duplicate key value violates unique constraint "${table}_${cols.join('_')}_key"`;
      }
    }
    return null;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  // --- usati da FakeQuery -------------------------------------------------
  _insert(table: string, rows: Row[]): Postgrestish<Row[] | null> {
    const ko = this.guasto(table, 'insert');
    if (ko) return { data: null, error: ko };
    const target = (this.tables[table] ??= []);
    const prepared: Row[] = [];
    for (const r of rows) {
      const row: Row = { id: this.newId(), ...r };
      const bad = this.validate(table, row);
      if (bad) return { data: null, error: { message: bad } };
      prepared.push(row);
    }
    // Come una INSERT multi-riga vera: o entrano tutte o nessuna.
    for (const row of prepared) {
      const dup = this.uniqueViolation(table, row, [...target, ...prepared]);
      if (dup) return { data: null, error: { message: dup } };
    }
    target.push(...prepared);
    this.calls.push({ table, op: 'insert', rows: prepared.length });
    return { data: prepared.map((r) => ({ ...r })), error: null };
  }

  _update(table: string, patch: Row, filters: Filter[]): Postgrestish<Row[] | null> {
    const ko = this.guasto(table, 'update');
    if (ko) return { data: null, error: ko };
    const target = (this.tables[table] ??= []);
    const matched = target.filter((r) => filters.every((f) => f(r)));
    const updated: Row[] = [];
    for (const r of matched) {
      const next = { ...r, ...patch };
      const bad = this.validate(table, next);
      if (bad) return { data: null, error: { message: bad } };
      updated.push(next);
    }
    matched.forEach((r, i) => Object.assign(r, updated[i] ?? {}));
    this.calls.push({ table, op: 'update', rows: matched.length });
    return { data: matched.map((r) => ({ ...r })), error: null };
  }

  _delete(table: string, filters: Filter[]): Postgrestish<Row[] | null> {
    const ko = this.guasto(table, 'delete');
    if (ko) return { data: null, error: ko };
    const target = (this.tables[table] ??= []);
    const rimosse = target.filter((r) => filters.every((f) => f(r)));
    this.tables[table] = target.filter((r) => !filters.every((f) => f(r)));
    this.calls.push({ table, op: 'delete', rows: rimosse.length });
    // ON DELETE CASCADE, ricorsivo come in Postgres.
    for (const fk of this.schema[table]?.cascadeTo ?? []) {
      const ids = new Set(rimosse.map((r) => r.id));
      if (ids.size === 0) continue;
      this._delete(fk.table, [(r) => ids.has(r[fk.column])]);
    }
    return { data: [], error: null };
  }

  /**
   * Colonne chieste nel `select`, in forma semplice.
   *
   * Serve solo a sapere quali chiavi devono esistere nel risultato: le
   * relazioni innestate (`prodotti(nome)`) e le `*` non contano.
   */
  static colonneChieste(cols?: string): string[] {
    if (!cols || cols.includes('*')) return [];
    return cols
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '' && !c.includes('(') && !c.includes(')'));
  }

  _select(
    table: string,
    filters: Filter[],
    order?: { col: string; asc: boolean },
    limit?: number,
    cols?: string,
  ) {
    let out = (this.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (order) {
      const col = order.col;
      out = [...out].sort((a, b) => {
        const av = a[col] as never;
        const bv = b[col] as never;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (order.asc ? 1 : -1);
      });
    }
    if (limit !== undefined) out = out.slice(0, limit);
    this.calls.push({ table, op: 'select', rows: out.length });
    // Una colonna chiesta e mai valorizzata torna `null` da Postgres, non
    // `undefined`: chi legge fa `?? 'IT'` o `=== null` e il finto client, non
    // dandogliela affatto, faceva passare test che in produzione cadevano.
    const chieste = FakeDb.colonneChieste(cols);
    return out.map((r) => {
      const copia = { ...r };
      for (const c of chieste) if (!(c in copia)) copia[c] = null;
      return copia;
    });
  }
}

/** Catena di query: solo i metodi che il codice usa davvero. */
class FakeQuery implements PromiseLike<Postgrestish<Row[] | null>> {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private orderBy?: { col: string; asc: boolean };
  private limitN?: number;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  private cols?: string;

  select(cols?: string): this {
    if (this.mode === 'select') this.mode = 'select';
    this.cols = cols;
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  update(patch: Row): this {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.mode = 'delete';
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  is(col: string, val: null): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: readonly unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  not(col: string, op: string, vals: string): this {
    // Usato come .not('status', 'in', '(a,b)')
    if (op === 'in') {
      const list = vals.replace(/^\(|\)$/g, '').split(',');
      this.filters.push((r) => !list.includes(String(r[col])));
    }
    return this;
  }
  or(expr: string): this {
    // `a.is.null,b.eq.X` → OR fra condizioni semplici
    const parts = expr.split(',').map((p) => p.trim());
    this.filters.push((r) =>
      parts.some((p) => {
        const [col, op, val] = p.split('.');
        if (!col) return false;
        if (op === 'is') return (r[col] ?? null) === null;
        if (op === 'eq') return String(r[col]) === val;
        return false;
      }),
    );
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private run(): Postgrestish<Row[] | null> {
    if (this.mode === 'insert') return this.db._insert(this.table, this.payload);
    if (this.mode === 'update') return this.db._update(this.table, this.patch, this.filters);
    if (this.mode === 'delete') return this.db._delete(this.table, this.filters);
    return {
      data: this.db._select(this.table, this.filters, this.orderBy, this.limitN, this.cols),
      error: null,
    };
  }

  async maybeSingle(): Promise<Postgrestish<Row | null>> {
    const res = this.run();
    if (res.error) return { data: null, error: res.error };
    return { data: res.data?.[0] ?? null, error: null };
  }

  async single(): Promise<Postgrestish<Row | null>> {
    const res = this.run();
    if (res.error) return { data: null, error: res.error };
    if (!res.data || res.data.length !== 1) {
      return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { data: res.data[0] ?? null, error: null };
  }

  then<A, B = never>(
    onOk?: ((v: Postgrestish<Row[] | null>) => A | PromiseLike<A>) | null,
    onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onOk, onErr);
  }
}

// ---------------------------------------------------------------------------
// I vincoli VERI dello schema, in un posto solo.
//
// Ripeterli in ogni test li farebbe divergere dal database — ed e' esattamente
// il modo in cui in questo progetto sono gia' nati dei bug: la stessa regola
// scritta due volte, e le due copie che si allontanano.
// ---------------------------------------------------------------------------
export const SCHEMA_APP: Record<string, TableSpec> = {
  batches: {
    enums: { visual_analysis_status: ['pending', 'running', 'done', 'error'] },
    cascadeTo: [
      { table: 'products', column: 'batch_id' },
      { table: 'batch_sources', column: 'batch_id' },
      { table: 'job_items', column: 'batch_id' },
    ],
  },
  products: {
    unique: [['batch_id', 'external_id']],
    cascadeTo: [
      { table: 'product_attribute_values', column: 'product_id' },
      { table: 'product_source_links', column: 'product_id' },
      { table: 'product_generations', column: 'product_id' },
      { table: 'product_variants', column: 'product_id' },
    ],
  },
  batch_sources: {
    cascadeTo: [{ table: 'source_items', column: 'batch_source_id' }],
  },
  source_items: {
    enums: { status: ['pending', 'valid', 'missing_sku', 'invalid', 'duplicate'] },
    cascadeTo: [{ table: 'product_source_links', column: 'source_item_id' }],
  },
  product_attribute_values: {
    unique: [['product_id', 'attribute_id']],
  },
  product_source_links: {
    unique: [['product_id', 'source_item_id']],
  },
};
