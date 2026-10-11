/**
 * The research list of college-reported failures (specs/college-data-failures.md): the reason classifier on
 * hand-made pipeline state (one case per reason code), first_seen kept across regenerations, the load's resolved
 * rows (scripts/lib/publish-college-failures.mts against a fake client), and the migration
 * (supabase/migrations/20261010140000_college_data_failures.sql): RLS on, no policy or grant for anon/authenticated,
 * checked as text and against PGlite. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recipe, ReviewItem } from "../lib/reported.ts";
import { AUTH_STUB_SQL, asUser } from "./helpers/pg-auth.mts";
import {
  REASON_CODES,
  buildFailuresFile,
  classifyFailures,
  formatFailuresFile,
  type BlockedHost,
  type CollegeInfo,
  type FailureRow,
  type FailureState,
  type ManifestDoc,
  type ReasonCode,
} from "../scripts/lib/college-failures.mts";
import { loadCollegeFailures, planFailureLoad } from "../scripts/lib/publish-college-failures.mts";

const MIGRATION = join(import.meta.dirname, "..", "supabase", "migrations", "20261010140000_college_data_failures.sql");
const D = "2026-10-05";

/* ------------------------------------------------------------------ */
/* Hand-made state                                                     */
/* ------------------------------------------------------------------ */

const probes = (detail?: Partial<Record<"sitemap" | "crawl", string>>) => [
  { step: 0 as const, via: "none" as const, at: D, result: "none" as const, cost_usd: 0 },
  { step: 1 as const, via: "probe-sitemap" as const, at: D, result: "none" as const, detail: detail?.sitemap ?? "1 sitemap(s), 0 hit(s)", cost_usd: 0 },
  { step: 1 as const, via: "probe-crawl" as const, at: D, result: "none" as const, detail: detail?.crawl ?? "3 page(s) crawled", cost_usd: 0 },
];

function recipe(unit_id: string, r: Partial<Recipe> = {}): Recipe {
  return { unit_id, sources: [], index_urls: [], learned: D, model: "none", discovery: { path: "none", tried: probes() }, ...r };
}

function cds(url: string, sha256?: string) {
  return { kind: "cds" as const, url, format: "pdf" as const, checked: D, ...(sha256 ? { sha256 } : {}) };
}

function doc(unit_id: string, sha256: string, url: string, edition: string | null, type = "pdf-flat"): ManifestDoc {
  return { sha256, unit_id, url, kind: "cds", type, edition, retrieved: D };
}

function item(unit_id: string, check: string, detail: string, extra: Partial<ReviewItem> = {}): ReviewItem {
  return { unit_id, name: `College ${unit_id}`, urls: [`https://c${unit_id}.edu/cds.pdf`], entering_term: "Fall 2025", failures: [{ check, detail } as ReviewItem["failures"][number]], queued: "2026-10-10", run: "20261010-180040-39", ...extra };
}

/** One college per reason code, plus a published college whose only row comes from held values. */
function state(): FailureState {
  const recipes: Recipe[] = [
    recipe("100001"), // no_document_found
    recipe("100002", { sources: [{ kind: "class-profile", url: "https://c100002.edu/profile", format: "html", checked: D }] }), // class_profile_only
    recipe("100003", { sources: [{ kind: "class-profile", url: "https://c100003.edu/profile", format: "html", checked: D, processed: D, extraction: null }] }), // class_profile_no_figures
    recipe("100004", { discovery: { path: "none", tried: probes({ sitemap: "1 sitemap(s), 1 hit(s); share link https://drive.google.com/file/d/abc/view: robots.txt disallows it" }) } }), // robots_disallowed
    recipe("100005", { discovery: { path: "blocked", tried: [...probes(), { step: 2, at: D, result: "blocked", detail: "every candidate host refuses us: www.c100005.edu", cost_usd: 0 }] } }), // host_blocked
    recipe("100006", { sources: [cds("https://c100006.edu/cds-2025-26.pdf")] }), // unreachable (queue)
    recipe("100007", { sources: [cds("https://c100007.edu/cds-2022-23.pdf", "sha7")] }), // edition_too_old
    recipe("100008", { sources: [cds("https://c100008.edu/cds-2024-25.pdf", "sha8")] }), // not_newer
    recipe("100009", { sources: [cds("https://c100009.edu/cds.pdf", "sha9")] }), // edition_unknown
    recipe("100010", { sources: [cds("https://c100010.edu/cds-2025-26.pdf", "sha10")] }), // never_read
    recipe("100011", { sources: [cds("https://c100011.edu/cds-2025-26.pdf", "sha11")] }), // failed_checks
    recipe("100012", { sources: [cds("https://c100012.edu/cds-2025-26a.pdf", "sha12")] }), // read_no_values
    recipe("100013", { discovery: { path: "none", tried: [probes()[0], { step: 1, at: D, result: "failed", detail: "URI malformed", cost_usd: 0 }] } }), // malformed_url
    recipe("100014", { discovery: { path: "none", tried: [...probes(), { step: 1, via: "probe-crawl", at: D, result: "failed", detail: "https://c100014.edu/sitemap.xml: no complete answer in 60 s; aborted", cost_usd: 0 }] } }), // discovery_error
    recipe("100015", { sources: [cds("https://c100015.edu/cds-2025-26.pdf", "sha15")] }), // published, with held values
    recipe("100016", { sources: [cds("https://c100016.edu/cds-2025-26.pdf", "sha16")] }), // published, nothing held: not listed
    recipe("100017", { discovery: undefined }), // never attempted: not listed
  ];
  const docs: ManifestDoc[] = [
    doc("100007", "sha7", "https://c100007.edu/cds-2022-23.pdf", "2022-23"),
    doc("100008", "sha8", "https://c100008.edu/cds-2024-25.pdf", "2024-25"),
    doc("100009", "sha9", "https://c100009.edu/cds.pdf", null),
    doc("100010", "sha10", "https://c100010.edu/cds-2025-26.pdf", "2025-26"),
    doc("100011", "sha11", "https://c100011.edu/cds-2025-26.pdf", "2025-26"),
    doc("100012", "sha12", "https://c100012.edu/cds-2025-26a.pdf", "2025-26"),
    doc("100015", "sha15", "https://c100015.edu/cds-2025-26.pdf", "2025-26"),
    doc("100016", "sha16", "https://c100016.edu/cds-2025-26.pdf", "2025-26"),
  ];
  const queue: ReviewItem[] = [
    item("100006", "unreachable", "HTTP 404 at https://c100006.edu/cds-2025-26.pdf", { urls: ["https://c100006.edu/cds-2025-26.pdf"], entering_term: null }),
    item("100011", "parts-sum", "B1 parts sum to 15,393, the total says 35,621", { code: "B.106", edition: "2025-26", sha256: "sha11" }),
    item("100011", "parts-sum", "B1 women parts", { code: "B.107", edition: "2025-26", sha256: "sha11" }),
    item("100011", "federal-disagrees", "B4 pell six-year rate 25.4% vs federal 41.6%", { code: "B.401", edition: "2025-26", sha256: "sha11" }),
    // An older edition's held value is superseded by the newer document: ignored.
    item("100011", "order", "old", { code: "C.901", edition: "2023-24", sha256: "old" }),
    item("100015", "number-on-line", "3555 isn't on line 97", { code: "B.122", edition: "2025-26", sha256: "sha15" }),
  ];
  const colleges = new Map<string, CollegeInfo>();
  for (const r of recipes) colleges.set(r.unit_id, { name: `College ${r.unit_id}`, published: r.unit_id === "100015" || r.unit_id === "100016", federal_year: 2024 });
  const blockedHosts: BlockedHost[] = [];
  return { recipes, queue, docs, readShas: new Set(["sha11", "sha12", "sha15", "sha16"]), blockedHosts, colleges };
}

const reasons = (rows: readonly Pick<FailureRow, "unit_id" | "reason_code">[], unit_id: string) => rows.filter((r) => r.unit_id === unit_id).map((r) => r.reason_code);

/* ------------------------------------------------------------------ */
/* Classifier                                                          */
/* ------------------------------------------------------------------ */

test("each reason code comes from the state that should produce it", () => {
  const rows = classifyFailures(state());
  const expect: Record<string, ReasonCode[]> = {
    "100001": ["no_document_found"],
    "100002": ["class_profile_only"],
    "100003": ["class_profile_no_figures"],
    "100004": ["robots_disallowed"],
    "100005": ["host_blocked"],
    "100006": ["unreachable"],
    "100007": ["edition_too_old", "never_read"],
    "100008": ["not_newer", "never_read"],
    "100009": ["edition_unknown"],
    "100010": ["never_read"],
    "100011": ["failed_checks"],
    "100012": ["read_no_values"],
    "100013": ["malformed_url"],
    "100014": ["no_document_found", "discovery_error"],
    "100015": ["failed_checks"],
  };
  for (const [id, codes] of Object.entries(expect)) assert.deepEqual(reasons(rows, id).sort(), [...codes].sort(), `college ${id}`);
  assert.deepEqual(reasons(rows, "100016"), [], "a published college with nothing held isn't listed");
  assert.deepEqual(reasons(rows, "100017"), [], "a college never attempted isn't listed");
  const covered = new Set(rows.map((r) => r.reason_code));
  for (const code of REASON_CODES) assert.ok(covered.has(code), `no case produced ${code}`);
});

test("rows carry the stage, url, edition, and the checks that held values", () => {
  const rows = classifyFailures(state());
  const get = (id: string, code: ReasonCode) => rows.find((r) => r.unit_id === id && r.reason_code === code)!;
  const robots = get("100004", "robots_disallowed");
  assert.equal(robots.url, "https://drive.google.com/file/d/abc/view");
  assert.equal(robots.stage, "fetch");
  assert.equal(get("100005", "host_blocked").detail, "every candidate host refuses us: www.c100005.edu");
  const unreachable = get("100006", "unreachable");
  assert.equal(unreachable.url, "https://c100006.edu/cds-2025-26.pdf");
  assert.match(unreachable.detail, /HTTP 404/);
  assert.equal(unreachable.run, "20261010-180040-39");
  const held = get("100011", "failed_checks");
  assert.equal(held.stage, "checks");
  assert.deepEqual(held.checks, ["parts-sum", "federal-disagrees"], "most frequent first; the superseded edition's check is ignored");
  assert.equal(held.edition, "2025-26");
  assert.match(held.detail, /^3 value\(s\) held/);
  assert.equal(get("100007", "edition_too_old").edition, "2022-23");
  assert.equal(get("100009", "edition_unknown").stage, "read");
  assert.equal(get("100001", "no_document_found").stage, "discovery");
  assert.equal(get("100001", "no_document_found").url, null);
});

test("a review-queue reason maps by its check: robots.txt, batch failures, and the federal-year check", () => {
  const s = state();
  const queue = [
    item("100001", "unreachable", "robots.txt disallows https://c100001.edu/cds.pdf"),
    item("100001", "batch-failed", "invalid_request: prompt is too long", { code: "rest-call", edition: "2025-26" }),
    item("100002", "newer-than-federal", "entering term 2024 isn't newer than the federal admissions year 2024"),
    item("100003", "newer-than-federal", "entering term 2017 isn't newer than the federal admissions year 2024"),
    item("100013", "newer-than-federal", 'entering_term "null" isn\'t a recognizable "Fall YYYY"'),
  ];
  const rows = classifyFailures({ ...s, queue });
  assert.ok(reasons(rows, "100001").includes("robots_disallowed"));
  assert.equal(rows.find((r) => r.unit_id === "100001" && r.reason_code === "robots_disallowed")!.url, "https://c100001.edu/cds.pdf");
  assert.ok(reasons(rows, "100001").includes("never_read"));
  assert.ok(reasons(rows, "100002").includes("not_newer"));
  assert.ok(reasons(rows, "100003").includes("edition_too_old"));
  assert.ok(reasons(rows, "100013").includes("edition_unknown"));
});

test("a source on a blocked host is host_blocked with its url", () => {
  const s = state();
  const recipes = [...s.recipes, recipe("100020", { sources: [cds("https://www.c100020.edu/cds.pdf")] })];
  const colleges = new Map(s.colleges).set("100020", { name: "College 100020", published: false, federal_year: 2024 });
  const rows = classifyFailures({ ...s, recipes, colleges, blockedHosts: [{ host: "www.c100020.edu", status: "challenge", last_seen: D }] });
  const row = rows.find((r) => r.unit_id === "100020")!;
  assert.equal(row.reason_code, "host_blocked");
  assert.equal(row.url, "https://www.c100020.edu/cds.pdf");
  assert.match(row.detail, /bot challenge/);
});

/* ------------------------------------------------------------------ */
/* first_seen                                                          */
/* ------------------------------------------------------------------ */

test("first_seen is kept across regenerations; a new row starts today; the file is one row per line", () => {
  const first = buildFailuresFile(state(), null, "2026-10-10");
  assert.ok(first.rows.every((r) => r.first_seen === "2026-10-10" && r.last_seen === "2026-10-10"));
  const later = state();
  later.queue = [...later.queue, item("100016", "order", "H2 order", { code: "H.227", edition: "2025-26", sha256: "sha16" })];
  const second = buildFailuresFile(later, JSON.parse(formatFailuresFile(first)), "2026-11-02");
  for (const r of second.rows) {
    const isNew = r.unit_id === "100016";
    assert.equal(r.first_seen, isNew ? "2026-11-02" : "2026-10-10", `${r.unit_id} ${r.reason_code}`);
    assert.equal(r.last_seen, "2026-11-02");
  }
  assert.equal(second.counts.failed_checks, 3);
  const text = formatFailuresFile(second);
  assert.equal(text.split("\n").filter((l) => l.startsWith('    {"unit_id"')).length, second.rows.length);
  assert.deepEqual(JSON.parse(text), second);
});

/* ------------------------------------------------------------------ */
/* Load: upserts and resolved rows                                     */
/* ------------------------------------------------------------------ */

test("the load plan resolves open rows no longer in the file, grouped by reason", () => {
  const rows = buildFailuresFile(state(), null, "2026-10-10").rows;
  const open = [
    { unit_id: "100001", reason_code: "no_document_found" as const },
    { unit_id: "199999", reason_code: "no_document_found" as const },
    { unit_id: "199998", reason_code: "failed_checks" as const },
    { unit_id: "100011", reason_code: "never_read" as const },
  ];
  const plan = planFailureLoad(rows, open);
  assert.equal(plan.upserts.length, rows.length);
  assert.deepEqual(Object.fromEntries(plan.resolve), { no_document_found: ["199999"], failed_checks: ["199998"], never_read: ["100011"] });
});

/** A stand-in for the few supabase-js calls the load makes, over an in-memory table. */
function fakeClient(table: Map<string, Record<string, unknown>>) {
  const calls: string[] = [];
  const client = {
    from() {
      return {
        select() {
          const q = {
            is: () => q,
            order: () => q,
            range: async (a: number, b: number) => ({ data: [...table.values()].filter((r) => r.resolved_at == null).slice(a, b + 1).map((r) => ({ unit_id: r.unit_id, reason_code: r.reason_code })), error: null }),
          };
          return q;
        },
        async upsert(rows: Record<string, unknown>[]) {
          calls.push(`upsert ${rows.length}`);
          for (const r of rows) table.set(`${r.unit_id}|${r.reason_code}`, { ...table.get(`${r.unit_id}|${r.reason_code}`), ...r });
          return { error: null };
        },
        update(values: Record<string, unknown>) {
          const f: { reason?: string; ids?: string[] } = {};
          const q = {
            eq: (_c: string, v: string) => ((f.reason = v), q),
            in: (_c: string, v: string[]) => ((f.ids = v), q),
            is: async () => {
              calls.push(`resolve ${f.reason} ${f.ids!.join(",")}`);
              for (const id of f.ids!) {
                const r = table.get(`${id}|${f.reason}`);
                if (r && r.resolved_at == null) Object.assign(r, values);
              }
              return { error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test("a load upserts the file, resolves what left it, and reopens a row that came back", async () => {
  const file = buildFailuresFile(state(), null, "2026-10-10").rows;
  const table = new Map<string, Record<string, unknown>>();
  const { client, calls } = fakeClient(table);
  table.set("199999|host_blocked", { unit_id: "199999", reason_code: "host_blocked", resolved_at: null });

  const r1 = await loadCollegeFailures(client, file, { now: "2026-10-10T12:00:00Z" });
  assert.deepEqual(r1, { upserted: file.length, resolved: 1 });
  assert.equal(table.get("199999|host_blocked")!.resolved_at, "2026-10-10T12:00:00Z");
  assert.ok(calls.includes("resolve host_blocked 199999"));

  // The next file drops one row: it is resolved, not deleted. A re-run resolves nothing new.
  const dropped = file.filter((r) => r.unit_id !== "100001");
  const r2 = await loadCollegeFailures(client, dropped, { now: "2026-10-11T12:00:00Z" });
  assert.equal(r2.resolved, 1);
  assert.equal(table.get("100001|no_document_found")!.resolved_at, "2026-10-11T12:00:00Z");
  assert.equal((await loadCollegeFailures(client, dropped, { now: "2026-10-12T12:00:00Z" })).resolved, 0);
  assert.equal(table.get("100001|no_document_found")!.resolved_at, "2026-10-11T12:00:00Z", "a resolved row keeps its date");

  // It comes back: the upsert clears resolved_at.
  await loadCollegeFailures(client, file, { now: "2026-10-13T12:00:00Z" });
  assert.equal(table.get("100001|no_document_found")!.resolved_at, null);

  const dry = await loadCollegeFailures(client, dropped, { dryRun: true });
  assert.equal(dry.resolved, 1);
  assert.equal(table.get("100001|no_document_found")!.resolved_at, null, "a dry run writes nothing");
});

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

test("the migration turns RLS on and gives anon and authenticated no policy or grant", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /alter table public\.college_data_failures enable row level security;/);
  assert.doesNotMatch(sql, /create policy/i, "service role only: no policies");
  assert.doesNotMatch(sql, /grant [^;]* to [^;]*\b(anon|authenticated)\b/i);
  assert.match(sql, /revoke all on table public\.college_data_failures from public, anon, authenticated;/);
  assert.match(sql, /primary key \(unit_id, reason_code\)/);
  assert.match(sql, /on public\.college_data_failures \(reason_code\)/);
  assert.match(sql, /resolved_at timestamptz/);
  for (const code of REASON_CODES) assert.ok(sql.includes(`'${code}'`), `the reason_code check lists ${code}`);
});

test("against Postgres: the service role writes and reads; anon and authenticated can do neither", async () => {
  const pg = await PGlite.create();
  await pg.exec(AUTH_STUB_SQL);
  await pg.exec(readFileSync(MIGRATION, "utf8"));
  const [row] = buildFailuresFile(state(), null, "2026-10-10").rows;
  await pg.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    await tx.query(
      `insert into public.college_data_failures (unit_id, name, reason_code, stage, detail, url, edition, checks, last_run, run, first_seen, last_seen)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [row.unit_id, row.name, row.reason_code, row.stage, row.detail, row.url, row.edition, row.checks, row.last_run, row.run, row.first_seen, row.last_seen],
    );
    const back = await tx.query<{ n: number }>("select count(*)::int as n from public.college_data_failures where resolved_at is null");
    assert.equal(back.rows[0].n, 1);
  });
  for (const user of [null, "00000000-0000-0000-0000-000000000001"]) {
    await assert.rejects(asUser(pg, user, "select * from public.college_data_failures"), /permission denied/);
    await assert.rejects(asUser(pg, user, "insert into public.college_data_failures (unit_id, name, reason_code, stage, detail, last_run, first_seen, last_seen) values ('1', 'x', 'never_read', 'read', 'x', now(), now(), now())"), /permission denied/);
  }
  await assert.rejects(pg.query("insert into public.college_data_failures (unit_id, name, reason_code, stage, detail, last_run, first_seen, last_seen) values ('1', 'x', 'made_up', 'read', 'x', now(), now(), now())"), /check constraint/);
});
