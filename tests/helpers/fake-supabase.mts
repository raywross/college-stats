/**
 * A small in-memory stand-in for the Supabase client's query builder, enough for the act-tracking writers and the
 * morning job (lib/planner/interest-acts-server.ts): `from(table)` with select / insert / update / upsert, the filters
 * eq, neq, is, in, gt, lt, gte, lte, order, limit, maybeSingle, single, and `await`. Every write is logged in `writes`
 * so a test can prove what was (and wasn't) written. Not a test file (no `.test.mts`).
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeWrite {
  table: string;
  op: "insert" | "update" | "upsert";
  values: Row;
  ids: unknown[];
}

export interface FakeClient {
  tables: Record<string, Row[]>;
  writes: FakeWrite[];
  from: (table: string) => Builder;
  rpc: (fn: string, args: Row) => Promise<{ data: unknown; error: null }>;
}

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

class Builder implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private values: Row | null = null;
  private wantRows = false;
  private one: "single" | "maybe" | null = null;
  private max: number | null = null;
  private sortKey: string | null = null;
  private asc = true;

  private client: FakeClient;
  private table: string;

  constructor(client: FakeClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select() {
    if (this.op !== "select") this.wantRows = true;
    return this;
  }
  insert(values: Row) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }
  upsert(values: Row) {
    this.op = "upsert";
    this.values = values;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) > v);
    return this;
  }
  lt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) < v);
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => String(r[col]) >= v);
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => String(r[col]) <= v);
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.sortKey = col;
    this.asc = opts.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }

  private run(): { data: unknown; error: { message: string } | null } {
    const rows = (this.client.tables[this.table] ??= []);
    let out: Row[];
    if (this.op === "insert") {
      const row = { id: newId(), ...this.values };
      rows.push(row);
      this.client.writes.push({ table: this.table, op: "insert", values: this.values!, ids: [row.id] });
      out = [row];
    } else if (this.op === "upsert") {
      const key = this.values!.user_id;
      let row = rows.find((r) => r.user_id === key);
      if (!row) {
        row = { your_week: null, unsubscribe_token: "f".repeat(64), ...this.values };
        rows.push(row);
      }
      this.client.writes.push({ table: this.table, op: "upsert", values: this.values!, ids: [key] });
      out = [row];
    } else {
      out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of out) Object.assign(r, this.values);
        this.client.writes.push({ table: this.table, op: "update", values: this.values!, ids: out.map((r) => r.id ?? r.user_id) });
        if (!this.wantRows && !this.one) return { data: null, error: null };
      }
    }
    if (this.sortKey) {
      const k = this.sortKey;
      out = [...out].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (this.asc ? 1 : -1));
    }
    if (this.max !== null) out = out.slice(0, this.max);
    const copy = out.map((r) => ({ ...r }));
    if (this.one === "single") return copy.length ? { data: copy[0], error: null } : { data: null, error: { message: "no rows" } };
    if (this.one === "maybe") return { data: copy[0] ?? null, error: null };
    return { data: copy, error: null };
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(tables: Record<string, Row[]> = {}): FakeClient {
  const client: FakeClient = {
    tables,
    writes: [],
    from: (table: string) => new Builder(client, table),
    rpc: async () => ({ data: true, error: null }),
  };
  return client;
}
