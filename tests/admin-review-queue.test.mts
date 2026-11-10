/**
 * The console's review-queue reads over the read model (lib/admin/review-queue.ts; specs/product/admin-speed.md,
 * specs/data-platform/change-sets.md "The review queue's read model"), on a fake client that logs every call:
 * `readQueue` makes one counts call and, on a miss, one items call (never the 22 document pages); two concurrent reads
 * share one; the cache is keyed on the counts' newest write; a project without the migration (PGRST202) reads the
 * documents as before; the narrow readers send the queries the indexes serve. `LIGHT_FIELDS` agrees with the
 * migration's list. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as rq from "../lib/admin/review-queue.ts";
import type { ReviewItem } from "../lib/reported.ts";

const ROOT = join(import.meta.dirname, "..");

const item = (unit: string, code: string, over: Partial<ReviewItem> = {}): ReviewItem => ({
  unit_id: unit,
  name: `College ${unit}`,
  urls: [`https://example.edu/${unit}.pdf`],
  entering_term: "Fall 2025",
  failures: [{ check: "range", detail: "x" } as unknown as ReviewItem["failures"][number]],
  queued: "2026-11-01",
  run: "r1",
  code,
  edition: "2025-26",
  sha256: `sha-${unit}`,
  value: 1,
  ...over,
});
const keyOf = (i: ReviewItem) => `${i.unit_id}|${i.edition ?? ""}|${i.code ?? ""}`;

interface Fake {
  client: rq.StoreClient;
  calls: string[];
  /** The newest write the counts report. */
  newest: { value: string | null };
  items: ReviewItem[];
  /** Resolves the pending light call (when `hold` is set). */
  release?: () => void;
}

/** The read model's functions and table over `items`; `missing` answers as a project without the migration. */
function fake(items: ReviewItem[], opts: { missing?: boolean; hold?: boolean } = {}): Fake {
  const calls: string[] = [];
  const newest = { value: "2026-11-01T00:00:00+00:00" as string | null };
  const f: Fake = { client: null as never, calls, newest, items };
  let gate: Promise<void> = Promise.resolve();
  if (opts.hold) gate = new Promise((r) => (f.release = r));
  const missingFn = (fn: string) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn} without parameters in the schema cache` } });
  f.client = {
    async rpc(fn: string, args?: Record<string, unknown>) {
      calls.push(`rpc ${fn}${args ? ` ${JSON.stringify(args)}` : ""}`);
      if (opts.missing) return missingFn(fn);
      if (fn === "review_items_counts") {
        const open = f.items.filter((i) => !i.resolved).length;
        return { data: { open, accepted: f.items.filter((i) => i.resolved === "accepted").length, rejected: f.items.filter((i) => i.resolved === "rejected").length, new_week: open, newest: newest.value }, error: null };
      }
      if (fn === "review_items_light") {
        await gate;
        return { data: [...f.items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1)).map((i) => ({ key: keyOf(i), ...(({ extraction: _, ...rest }) => rest)(i) })), error: null };
      }
      return missingFn(fn);
    },
    from(table: string) {
      return {
        select(columns: string) {
          const ops: string[] = [`${table}.select(${columns})`];
          const q = {
            eq: (c: string, v: unknown) => (ops.push(`eq ${c}=${String(v)}`), q),
            in: (c: string, v: unknown[]) => (ops.push(`in ${c}=${v.join(",")}`), q),
            gt: (c: string, v: string) => (ops.push(`gt ${c}=${v}`), q),
            like: (c: string, v: string) => (ops.push(`like ${c}=${v}`), q),
            overlaps: (c: string, v: readonly string[]) => (ops.push(`ov ${c}=${v.join(",")}`), q),
            order: (c: string, o?: { ascending?: boolean }) => (ops.push(`order ${c}${o?.ascending === false ? " desc" : ""}`), q),
            limit: (n: number) => (ops.push(`limit ${n}`), q),
            then(resolve: (x: unknown) => unknown, reject?: (e: unknown) => unknown) {
              calls.push(ops.join(" "));
              const has = (s: string) => ops.some((o) => o.startsWith(s));
              const val = (s: string) => ops.find((o) => o.startsWith(s))?.slice(s.length) ?? "";
              let out: Record<string, unknown>[];
              if (table === "review_items") {
                if (opts.missing) return Promise.resolve({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.review_items' in the schema cache" } }).then(resolve, reject);
                let rows = f.items.map((i) => ({ key: keyOf(i), unit_id: i.unit_id, status: i.resolved ?? "open", checks: i.failures.map((x) => x.check), body: i }));
                if (has("eq unit_id=")) rows = rows.filter((r) => r.unit_id === val("eq unit_id="));
                if (has("eq status=")) rows = rows.filter((r) => r.status === val("eq status="));
                if (has("ov checks=")) rows = rows.filter((r) => r.checks.some((c) => val("ov checks=").split(",").includes(c)));
                out = rows.sort((a, b) => (a.key < b.key ? -1 : 1));
              } else {
                let rows = f.items.map((i) => ({ key: keyOf(i), body: i, updated_at: newest.value }));
                if (has("like key=")) rows = rows.filter((r) => r.key.startsWith(val("like key=").replace(/%$/, "").replace(/\\(.)/g, "$1")));
                if (has("order updated_at desc")) return Promise.resolve({ data: rows.length ? [{ updated_at: newest.value }] : [], error: null }).then(resolve, reject);
                out = rows.sort((a, b) => (a.key < b.key ? -1 : 1));
              }
              if (has("gt key=")) out = out.filter((r) => String(r.key) > val("gt key="));
              return Promise.resolve({ data: out.slice(0, Number(val("limit ")) || undefined), error: null }).then(resolve, reject);
            },
          };
          return q as never;
        },
      };
    },
  };
  return f;
}

const ITEMS = [
  item("100654", "C.116"),
  item("100654", "H.210", { failures: [{ check: "unreachable", detail: "404" } as unknown as ReviewItem["failures"][number]] }),
  item("100663", "", { code: undefined, edition: undefined, extraction: { applicants: 100, admitted: 50, enrolled: 20 } as ReviewItem["extraction"] }),
  item("100706", "C.901", { resolved: "rejected", failures: [{ check: "not-a-url", detail: "x" } as unknown as ReviewItem["failures"][number]] }),
];

test("readQueue: one counts call and one items call, never the documents; light items without extraction; served from the cache while the newest write holds", async () => {
  rq.resetQueueCache();
  const f = fake(ITEMS);
  let now = 1_000;
  const first = await rq.readQueue(f.client, () => now);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.deepEqual(f.calls, ["rpc review_items_counts", 'rpc review_items_light {"p_status":null}']);
  assert.equal(first.updated, "2026-11-01T00:00:00+00:00");
  assert.equal(first.items.length, 4);
  assert.ok(first.items.every((i) => !("extraction" in i) && !("key" in i)), "no extraction, no key");
  assert.deepEqual(first.rows.map((r) => r.status), ["open", "open", "open", "rejected"]);
  assert.deepEqual(first.rows.map((r) => r.id).slice(0, 3), ["100654|2025-26|C.116", "100654|2025-26|H.210", "100663||"]);

  f.calls.length = 0;
  const second = await rq.readQueue(f.client, () => now);
  assert.ok(second.ok && second.rows === first.rows, "the cached rows");
  assert.deepEqual(f.calls, ["rpc review_items_counts"], "a hit costs the counts call alone");

  f.newest.value = "2026-11-02T00:00:00+00:00";
  f.calls.length = 0;
  const third = await rq.readQueue(f.client, () => now);
  assert.ok(third.ok && third.rows !== first.rows && third.updated === "2026-11-02T00:00:00+00:00");
  assert.equal(f.calls.length, 2, "a new write reads the items again");

  now += rq.QUEUE_CACHE_MS + 1;
  f.calls.length = 0;
  await rq.readQueue(f.client, () => now);
  assert.equal(f.calls.length, 2, "an old cache is read again");
  rq.resetQueueCache();
});

test("readQueue: two concurrent reads share one (one counts call, one items call), and the next read starts a new one", async () => {
  rq.resetQueueCache();
  const f = fake(ITEMS, { hold: true });
  const a = rq.readQueue(f.client);
  const b = rq.readQueue(f.client);
  assert.equal(a, b, "the same promise");
  await new Promise((r) => setTimeout(r, 5));
  f.release!();
  const [ra, rb] = await Promise.all([a, b]);
  assert.ok(ra.ok && rb.ok && ra.rows === rb.rows);
  assert.deepEqual(f.calls, ["rpc review_items_counts", 'rpc review_items_light {"p_status":null}']);
  f.calls.length = 0;
  await rq.readQueue(f.client);
  assert.deepEqual(f.calls, ["rpc review_items_counts"], "not shared once finished: a new read, a cache hit");
  // resetQueueCache forgets a read in flight.
  const g = fake(ITEMS, { hold: true });
  const pending = rq.readQueue(g.client);
  rq.resetQueueCache();
  assert.notEqual(rq.readQueue(g.client), pending);
  g.release!();
  await pending;
  rq.resetQueueCache();
});

test("readQueue without the read model (PGRST202): the documents, as before, with one warning per instance", async () => {
  rq.resetQueueCache();
  const f = fake(ITEMS, { missing: true });
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => void warnings.push(m);
  try {
    const q = await rq.readQueue(f.client);
    assert.ok(q.ok);
    if (!q.ok) return;
    assert.equal(q.items.length, 4);
    assert.ok(q.items.some((i) => i.extraction), "the documents' bodies, whole");
    assert.equal(f.calls[0], "rpc review_items_counts");
    assert.match(f.calls[1], /^data_documents\.select\(updated_at\) eq collection=reported\.review_queue order updated_at desc limit 1$/);
    assert.match(f.calls[2], /^data_documents\.select\(key, body\) eq collection=reported\.review_queue order key limit 1000$/);
    await rq.readCollegeQueueItems(f.client, "100654");
    assert.equal(warnings.length, 1, "one warning per instance");
    assert.match(warnings[0], /20261110120000_admin_speed\.sql/);
  } finally {
    console.warn = warn;
    rq.resetQueueCache();
  }
});

test("readQueue: another RPC error is a failed read, not a fallback; never throws", async () => {
  rq.resetQueueCache();
  const client = { rpc: async () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }), from: () => assert.fail("no documents read") } as unknown as rq.StoreClient;
  assert.deepEqual(await rq.readQueue(client), { ok: false, reason: "admin: reading the review queue's counts failed: canceling statement due to statement timeout" });
  rq.resetQueueCache();
});

test("readQueueCounts: the counts call alone; null when it fails or the read model is missing", async () => {
  const f = fake(ITEMS);
  assert.deepEqual(await rq.readQueueCounts(f.client), { open: 3, accepted: 0, rejected: 1, newWeek: 3, newest: "2026-11-01T00:00:00+00:00" });
  assert.deepEqual(f.calls, ["rpc review_items_counts"]);
  assert.equal(await rq.readQueueCounts(fake(ITEMS, { missing: true }).client), null);
  assert.equal(await rq.readQueueCounts({ rpc: async () => ({ data: true, error: null }) } as unknown as rq.StoreClient), null, "an answer that isn't the counts");
});

test("readCollegeQueueItems: review_items by unit_id, whole bodies (extraction kept); the documents by key prefix without the read model", async () => {
  const f = fake(ITEMS);
  const items = await rq.readCollegeQueueItems(f.client, "100663");
  assert.deepEqual(f.calls, ["review_items.select(key, body) eq unit_id=100663 order key limit 1000"]);
  assert.equal(items.length, 1);
  assert.ok(items[0].extraction, "the whole item");
  const g = fake(ITEMS, { missing: true });
  const fallback = await rq.readCollegeQueueItems(g.client, "100654");
  assert.deepEqual(fallback.map(keyOf), ["100654|2025-26|C.116", "100654|2025-26|H.210"]);
  assert.equal(g.calls[1], "data_documents.select(key, body) eq collection=reported.review_queue like key=100654|% order key limit 1000");
  const broken = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "paused" } }) }) }) }) }) } as unknown as rq.StoreClient;
  await assert.rejects(rq.readCollegeQueueItems(broken, "1"), /paused/);
});

test("readAcquisitionQueueItems: open items whose checks overlap unreachable/not-a-url, in SQL; the whole queue filtered without the read model", async () => {
  rq.resetQueueCache();
  const f = fake(ITEMS);
  const items = await rq.readAcquisitionQueueItems(f.client);
  assert.deepEqual(f.calls, ["review_items.select(key, body) eq status=open ov checks=unreachable,not-a-url order key limit 1000"]);
  assert.deepEqual(items.map(keyOf), ["100654|2025-26|H.210"], "the rejected not-a-url item is left out");
  const g = fake(ITEMS, { missing: true });
  assert.deepEqual((await rq.readAcquisitionQueueItems(g.client)).map(keyOf), ["100654|2025-26|H.210"]);
  rq.resetQueueCache();
});

test("isMissingReadModel: PGRST202, PGRST205, 42P01, 42883 by code or message; not other errors", () => {
  for (const e of [{ code: "PGRST202", message: "x" }, { code: "PGRST205", message: "x" }, { code: "42P01", message: "x" }, { code: "42883", message: "x" }, { message: "Could not find the function public.review_items_counts without parameters in the schema cache" }, new Error('relation "public.review_items" does not exist')]) {
    assert.ok(rq.isMissingReadModel(e), JSON.stringify(e));
  }
  for (const e of [{ code: "57014", message: "statement timeout" }, { message: "permission denied for table review_items" }, null]) assert.ok(!rq.isMissingReadModel(e), JSON.stringify(e));
});

test("LIGHT_DROPPED is the migration's review_items_light subtraction list; LIGHT_FIELDS is what stays, without extraction", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261110120000_admin_speed.sql"), "utf8");
  const fn = sql.slice(sql.indexOf("create or replace function public.review_items_light"));
  const list = /r\.body - array\[([^\]]*)\]/.exec(fn)?.[1] ?? "";
  const dropped = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(dropped, [...rq.LIGHT_DROPPED]);
  assert.ok(dropped.includes("extraction"));
  for (const f of rq.LIGHT_FIELDS) assert.ok(!dropped.includes(f), `${f} is kept`);
  // Every ReviewItem field is on one list or the other (lib/reported.ts ReviewItem).
  const all = ["unit_id", "name", "urls", "entering_term", "extraction", "failures", "queued", "run", "code", "edition", "sha256", "value", "resolved", "resolved_on", "resolved_note"];
  assert.deepEqual([...rq.LIGHT_FIELDS, ...rq.LIGHT_DROPPED].sort(), all.sort());
});
