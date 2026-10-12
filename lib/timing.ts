/**
 * Request timing for the signed-in pages and their Server Actions (specs/serving-architecture.md "Timing a request"):
 * every Supabase round trip (by table or function name), named spans (the dataset load, the estimates, the sync pass,
 * revalidation, the render), and one log line per request, `[timing] /plan save 812ms: db 6× in 3 waves 540ms (…) …`.
 *
 * Off unless `QUAD_TIMING=1`: then `withTiming`/`span`/`timedFetch` cost one environment read and nothing else. The
 * line and the `Server-Timing` header carry route labels, table names, counts, and milliseconds only; never an id, a
 * query string, a name, or a value (tests/timing.test.mts).
 *
 * Pure (no Next or server-only imports) so tests run it directly; lib/timing-server.ts adds the `after()` hook.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** Whether timing is on: `QUAD_TIMING=1` in the environment, nothing else. */
export function timingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.QUAD_TIMING === "1";
}

export interface TimedCall {
  /** What ran: a table (`list_items`), a function (`rpc log_access`), `auth`, or a span name. */
  name: string;
  /** Milliseconds from the request's start. */
  start: number;
  dur: number;
}

/** One request's timings. Created by `withTiming`; found again anywhere inside it with `currentTiming()`. */
export class RequestTiming {
  readonly startedAt: number;
  readonly db: TimedCall[] = [];
  readonly spans: TimedCall[] = [];
  /** Set when the response is on its way (a Server Action's result returned); later work is "after". */
  respondedAt: number | null = null;

  readonly label: string;
  private readonly now: () => number;

  constructor(label: string, now: () => number = () => performance.now()) {
    this.label = label;
    this.now = now;
    this.startedAt = now();
  }

  elapsed(): number {
    return this.now() - this.startedAt;
  }

  /** Times `fn` as a named span (spans may nest and overlap). */
  async span<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const start = this.elapsed();
    try {
      return await fn();
    } finally {
      this.spans.push({ name, start, dur: this.elapsed() - start });
    }
  }

  /** Records one Supabase round trip that started `start` ms into the request. */
  recordDb(name: string, start: number, dur: number): void {
    this.db.push({ name, start, dur });
  }

  /** Marks the moment the response left (what the person waited for); work after it is reported separately. */
  responded(): void {
    if (this.respondedAt === null) this.respondedAt = this.elapsed();
  }

  /** The summary line, without the `[timing]` prefix. */
  line(totalMs: number = this.elapsed()): string {
    const parts: string[] = [];
    parts.push(dbPhrase(this.db));
    for (const s of mergeSpans(this.spans)) parts.push(`${s.name} ${ms(s.dur)}ms${s.count > 1 ? ` (${s.count}×)` : ""}`);
    const head = this.respondedAt !== null ? `${this.label} ${ms(this.respondedAt)}ms (+${ms(totalMs - this.respondedAt)}ms after)` : `${this.label} ${ms(totalMs)}ms`;
    return `${head}: ${parts.join(" ")}`;
  }

  /** A `Server-Timing` header value: db (count and summed wave time), each span, and the total. */
  serverTiming(totalMs: number = this.elapsed()): string {
    const waves = dbWaves(this.db);
    const entries = [
      `db;dur=${ms(waves.reduce((a, w) => a + w.dur, 0))};desc="${this.db.length} queries, ${waves.length} waves"`,
      ...mergeSpans(this.spans).map((s) => `${token(s.name)};dur=${ms(s.dur)}`),
      `total;dur=${ms(totalMs)}`,
    ];
    return entries.join(", ");
  }
}

const ms = (n: number) => Math.round(n);
/** A Server-Timing metric name is an HTTP token: letters, digits, and a few marks. */
const token = (s: string) => s.replace(/[^A-Za-z0-9!#$%&'*+.^_`|~-]+/g, "-");

/** Spans with the same name, summed (e.g. one `estimates` per list). */
function mergeSpans(spans: TimedCall[]): { name: string; dur: number; count: number }[] {
  const out = new Map<string, { name: string; dur: number; count: number }>();
  for (const s of spans) {
    const cur = out.get(s.name);
    if (cur) {
      cur.dur += s.dur;
      cur.count += 1;
    } else out.set(s.name, { name: s.name, dur: s.dur, count: 1 });
  }
  return [...out.values()];
}

/**
 * Round trips grouped into waves: calls that overlap in time ran in parallel; a call that starts after every call of
 * the current wave has finished starts a new one (it waited, i.e. ran in sequence). A wave's time is its span from
 * first start to last end, so the waves' sum is the database's share of the critical path.
 */
export function dbWaves(calls: readonly TimedCall[]): { calls: TimedCall[]; dur: number }[] {
  const sorted = [...calls].sort((a, b) => a.start - b.start);
  const waves: { calls: TimedCall[]; start: number; end: number }[] = [];
  for (const c of sorted) {
    const w = waves[waves.length - 1];
    if (w && c.start < w.end) {
      w.calls.push(c);
      w.end = Math.max(w.end, c.start + c.dur);
    } else waves.push({ calls: [c], start: c.start, end: c.start + c.dur });
  }
  return waves.map((w) => ({ calls: w.calls, dur: w.end - w.start }));
}

/** `db 6× in 3 waves 540ms (profiles 120; students 98 ‖ household_members 101; …)`: `‖` joins parallel calls. */
function dbPhrase(calls: readonly TimedCall[]): string {
  if (calls.length === 0) return "db 0×";
  const waves = dbWaves(calls);
  const total = waves.reduce((a, w) => a + w.dur, 0);
  const detail = waves.map((w) => w.calls.map((c) => `${c.name} ${ms(c.dur)}`).join(" ‖ ")).join("; ");
  return `db ${calls.length}× in ${waves.length} wave${waves.length === 1 ? "" : "s"} ${ms(total)}ms (${detail})`;
}

const store = new AsyncLocalStorage<RequestTiming>();

/** The timing of the request this code runs in, or null (timing off, or outside `withTiming`). */
export function currentTiming(): RequestTiming | null {
  return store.getStore() ?? null;
}

/** Runs `fn` with `timing` as the current request's timing (also used to carry it into work after the response). */
export function runWithTiming<T>(timing: RequestTiming, fn: () => T): T {
  return store.run(timing, fn);
}

/** A named span in the current request; just `fn()` when timing is off. */
export async function span<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const t = currentTiming();
  return t ? t.span(name, fn) : fn();
}

/**
 * What a Supabase URL names, with nothing personal: `/rest/v1/list_items?…` → `list_items`, `/rest/v1/rpc/log_access`
 * → `rpc log_access`, `/auth/v1/…` → `auth`. The query string (ids, filters) is never read.
 */
export function supabaseCallName(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "other";
  }
  const rest = /\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/.exec(path);
  if (rest) return rest[1] ? `rpc ${rest[2]}` : rest[2];
  if (path.includes("/auth/v1/")) return "auth";
  if (path.includes("/storage/v1/")) return "storage";
  return "other";
}

/**
 * A `fetch` for the Supabase clients that records each round trip on the current request's timing. When timing is
 * off, or the call is outside a timed request, it is the plain `fetch`.
 */
export const timedFetch: typeof fetch = async (input, init) => {
  const t = currentTiming();
  if (!t) return fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const start = t.elapsed();
  try {
    return await fetch(input, init);
  } finally {
    t.recordDb(supabaseCallName(url), start, t.elapsed() - start);
  }
};
