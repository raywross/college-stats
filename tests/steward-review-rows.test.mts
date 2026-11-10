/**
 * The college Review page's rows (lib/steward/review-rows.ts) and the Steward's console reads (lib/admin/steward-reads.ts;
 * specs/product/data-steward.md "The college's Review page", "The console"), on the four colleges whose CDS records the
 * mini fixture keeps (UIUC 145637, Cornell 190415, Vanderbilt 221999, William & Mary 231624) and the mini dataset's
 * `citeField`: one row per open item grouped by code, "On the site now" from the profile's own reader, the document at
 * its cell or line, each issue's cluster key, the existing Accept plan, and a pending proposal's rows on top of them.
 * The reads run over a fake admin client (no database). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { reviewItemsFor } from "../lib/cds-checks.ts";
import type { CollegeRecord } from "../lib/cds-sections.ts";
import { reviewKey, type ReviewItem } from "../lib/reported.ts";
import { resetQueueCache, type StoreClient } from "../lib/admin/review-queue.ts";
import { collegesToReview, isMissingTable, readClusters, readDecisions, readIssues, readProposal, readProposals, readReviewRows, readRuns, readTodo, resetClusterCache, shownOnSite } from "../lib/admin/steward-reads.ts";
import { nowAtField, reviewColleges, reviewRows, valueWords, citeWords } from "../lib/steward/review-rows.ts";
import { clusterQueue, freeDetailChecks } from "../lib/steward/cluster.ts";
import type { ProposalDoc, ProposalRow, RunDoc, TodoDoc } from "../lib/steward/types.ts";
import { miniDataset, miniLayers } from "./helpers/snapshot.mts";

const UNITS = ["145637", "190415", "221999", "231624"] as const;
const data = await miniDataset();
const records = new Map<string, CollegeRecord>();
for (const u of UNITS) records.set(u, (await miniLayers().readOne<CollegeRecord>("reported.cds_records", u))!);

/** The review items the checks queued from a college's record (its failed items), as the pipeline queues them. */
function queued(unit: string): ReviewItem[] {
  const school = data.getSchoolById(unit)!;
  return records.get(unit)!.documents.flatMap((doc) => reviewItemsFor(doc, CDS_TEMPLATE, { unit_id: unit, name: school.name, run: "r1", queued: "2026-10-26" }));
}

/** William & Mary's C1 totals held together (its record passed them), so Accept the value is offered. */
function wmTotals(): ReviewItem[] {
  const doc = records.get("231624")!.documents[0];
  return ["C.116", "C.117", "C.118"].map((code) => ({
    unit_id: "231624",
    name: "William & Mary",
    urls: [doc.url],
    entering_term: "Fall 2025",
    failures: [{ check: "plausible-change", detail: `applicants ${doc.items[code].v} vs federal 17,798` }],
    queued: "2026-10-26",
    run: "r1",
    code,
    edition: doc.edition,
    sha256: doc.sha256,
    value: doc.items[code].v ?? null,
  }));
}

const ALL_ITEMS: ReviewItem[] = [...UNITS.flatMap(queued), ...wmTotals()];

const row = (over: Partial<ProposalRow>): ProposalRow => ({
  unit_id: "145637",
  field: null,
  code: null,
  edition: "2025-26",
  sha256: null,
  now: "stale words",
  proposed: "proposed words",
  source: { page: 3, line: 41, quote: "TOTAL | 1010", url: "https://example.edu/cds.pdf" },
  recommends: "approve",
  item: null,
  ...over,
});

const proposal = (over: Partial<ProposalDoc>): ProposalDoc => ({
  key: "correct-x-r1",
  kind: "correct",
  cause: null,
  status: "open",
  summary: "s",
  evidence: [],
  rows: [],
  run: "r1",
  created: "2026-11-01T10:00:00Z",
  ...over,
});

test("the queued items: one row per open item, grouped by code in template order, with the document's cell and quote", () => {
  const items = queued("145637");
  assert.equal(items.length, 14, "UIUC's record holds 14 failed items");
  const groups = reviewRows("145637", { items: ALL_ITEMS, record: records.get("145637")!, proposals: [], citeField: data.citeField, school: data.getSchoolById("145637"), template: CDS_TEMPLATE });
  assert.deepEqual(groups.map((g) => g.code), items.map((i) => i.code).sort((a, b) => (a! < b! ? -1 : 1)).filter((c) => c!.startsWith("B")).concat(["C.110", "C.111", "C.112", "C.113"]));
  assert.ok(groups.every((g) => g.rows.length === 1));
  const b230 = groups.find((g) => g.code === "B.230")!;
  assert.equal(b230.label, "B2");
  const r = b230.rows[0];
  assert.equal(r.id, "145637|2025-26|B.230");
  assert.deepEqual([r.from?.cell, r.from?.quote, r.value], ["CDS-B!AC109", "TOTAL | 1010", 1010]);
  assert.equal(r.now, "Not shown", "a held code no field reaches, with no other document passing it");
  assert.equal(r.accept?.ok, false);
  assert.ok(r.question && r.question.length > 0, "the template's question");
  const free = freeDetailChecks(ALL_ITEMS);
  const keys = new Set(clusterQueue(ALL_ITEMS).map((c) => c.key));
  for (const g of groups) for (const x of g.rows) for (const issue of x.issues) assert.ok(keys.has(issue.cluster), `${issue.cluster} is an Issues-screen cluster`);
  assert.ok(free instanceof Set);
});

test("'On the site now' comes from citeField for a field Accept would write; a code another document passes shows that value", () => {
  const groups = reviewRows("231624", { items: ALL_ITEMS, record: records.get("231624")!, proposals: [], citeField: data.citeField, school: data.getSchoolById("231624") });
  const applicants = groups.find((g) => g.code === "C.116")!.rows[0];
  assert.equal(applicants.field, "admissions.applicants");
  assert.equal(applicants.label, "Applicants (C1)");
  assert.equal(applicants.accept?.ok, true);
  const school = data.getSchoolById("231624")!;
  const cited = data.citeField("admissions.applicants", school);
  assert.equal(applicants.now, `${valueWords(school.admissions.applicants)} · ${citeWords(cited)}`);
  assert.equal(applicants.now, nowAtField("admissions.applicants", school, data.citeField));
  assert.match(applicants.now, /^17,440 · /);
  // A Vanderbilt item for a code its record passes: the site shows the record's value.
  const vu = records.get("221999")!.documents[0];
  const passed = Object.entries(vu.items).find(([, it]) => it.status === "passed" && typeof it.v === "number")!;
  const item: ReviewItem = { ...queued("221999")[0], code: passed[0], value: 1 };
  const [g] = reviewRows("221999", { items: [item], record: records.get("221999")!, proposals: [], citeField: data.citeField, school: data.getSchoolById("221999") });
  assert.equal(g.rows[0].now, `${valueWords(passed[1].v)} · CDS ${vu.edition}`);
});

test("a pending proposal's row decorates its item's row; a row with no item is its own; declined and applied proposals don't show", () => {
  const item = "145637|2025-26|B.230";
  const proposals = [
    proposal({ key: "hold-b2-r1", kind: "hold", rows: [row({ code: "B.230", item, proposed: "Hold: column 3 is non-degree students", recommends: "your-call", why: "two readings" }), row({ unit_id: "190415", item: "190415|2025-26|G.001" })] }),
    proposal({ key: "correct-rate-r1", rows: [row({ field: "admissions.acceptance_rate", code: null, proposed: "40.1%", value: 0.401 })] }),
    proposal({ key: "declined-r1", status: "declined", rows: [row({ code: "C.110", item: "145637|2025-26|C.110" })] }),
    proposal({ key: "applied-r1", status: "applied", rows: [row({ code: "C.999" })] }),
  ];
  const groups = reviewRows("145637", { items: ALL_ITEMS, record: records.get("145637")!, proposals, citeField: data.citeField, school: data.getSchoolById("145637") });
  const b230 = groups.find((g) => g.code === "B.230")!.rows[0];
  assert.deepEqual([b230.proposed, b230.recommends, b230.why, b230.proposal], ["Hold: column 3 is non-degree students", "your-call", "two readings", { key: "hold-b2-r1", kind: "hold", status: "open", row: 0 }]);
  assert.deepEqual([b230.from?.page, b230.from?.line, b230.from?.cell], [3, 41, "CDS-B!AC109"]);
  assert.equal(groups.find((g) => g.code === "C.110")!.rows[0].proposal, null, "a declined proposal's row doesn't show");
  assert.ok(!groups.some((g) => g.code === "C.999"), "an applied proposal's row doesn't show");
  const rate = groups.find((g) => g.code === "admissions.acceptance_rate")!;
  assert.equal(groups.at(-1), rate, "field-only groups come after the codes");
  const r = rate.rows[0];
  assert.deepEqual([r.id, r.item, r.accept, r.proposed, r.value], ["correct-rate-r1#0", null, null, "40.1%", 0.401]);
  assert.equal(r.now, nowAtField("admissions.acceptance_rate", data.getSchoolById("145637"), data.citeField), "now is read, not the proposal's stale words");
});

test("Colleges to review: most visible changes first, then 'your call', then open items", () => {
  const proposals = [
    proposal({ key: "a", rows: [row({ unit_id: "190415" }), row({ unit_id: "190415", recommends: "your-call" })] }),
    proposal({ key: "b", kind: "reread", rows: [row({ unit_id: "221999", recommends: "your-call" }), row({ unit_id: "221999", recommends: "your-call" })] }),
    proposal({ key: "c", kind: "hold", rows: [row({ unit_id: "231624", recommends: "your-call" }), row({ unit_id: "231624", decision: "approved" })] }),
  ];
  const list = reviewColleges(ALL_ITEMS, proposals);
  assert.deepEqual(list.map((c) => [c.unit_id, c.changes, c.yourCall, c.items]), [
    ["190415", 2, 1, 1],
    ["231624", 1, 1, 3],
    ["221999", 0, 2, 1],
    ["145637", 0, 0, 14],
  ]);
});

/* ------------------------------------------------------------------ */
/* The reads, over a fake admin client                                 */
/* ------------------------------------------------------------------ */

type Docs = Map<string, Map<string, unknown>>;

/** A queue document as its `review_items` row (supabase/migrations/20261110120000_admin_speed.sql `review_items_put`). */
function readModelRow(key: string, body: ReviewItem): Record<string, unknown> {
  const status = body.resolved === "accepted" || body.resolved === "rejected" ? body.resolved : "open";
  return { collection: "review_items", key, unit_id: body.unit_id, status, checks: [...new Set(body.failures.map((f) => f.check))], body, updated_at: "2026-11-01T00:00:00Z" };
}

/**
 * The slice of PostgREST the reads use, over in-memory collections and the queue's read model (`review_items` and its
 * two functions, derived from the queue's documents); `missing` makes every read fail as a missing table, and
 * `noReadModel` leaves the read model out (a project before the migration). `reads` logs each read's source.
 */
function fakeClient(docs: Docs, opts: { missing?: boolean; noReadModel?: boolean; reads?: string[] } = {}): StoreClient {
  const queue = () => [...(docs.get("reported.review_queue") ?? new Map<string, unknown>())] as [string, ReviewItem][];
  return {
    rpc(fn: string, args?: Record<string, unknown>) {
      opts.reads?.push(`rpc ${fn}`);
      if (opts.missing || opts.noReadModel) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache` } });
      const rows = queue().map(([key, body]) => readModelRow(key, body)).sort((a, b) => (String(a.key) < String(b.key) ? -1 : 1));
      if (fn === "review_items_counts") {
        const n = (s: string) => rows.filter((r) => r.status === s).length;
        return Promise.resolve({ data: { open: n("open"), accepted: n("accepted"), rejected: n("rejected"), new_week: 0, newest: rows.length ? "2026-11-01T00:00:00+00:00" : null }, error: null });
      }
      if (fn === "review_items_light") {
        const status = args?.p_status ?? null;
        return Promise.resolve({ data: rows.filter((r) => status === null || r.status === status).map((r) => ({ key: r.key, ...(({ extraction: _, ...rest }) => rest)(r.body as ReviewItem) })), error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown function ${fn}` } });
    },
    from(table: string) {
      return {
        select(columns: string) {
          const filters: ((r: Record<string, unknown>) => boolean)[] = [];
          let desc = false;
          let limit = Infinity;
          const q = {
            eq(col: string, v: unknown) {
              filters.push((r) => r[col] === v);
              return q;
            },
            in(col: string, vs: unknown[]) {
              filters.push((r) => vs.includes(r[col]));
              return q;
            },
            gt(col: string, v: string) {
              filters.push((r) => String(r[col]) > v);
              return q;
            },
            like(col: string, pattern: string) {
              assert.match(pattern, /%$/, "a prefix pattern");
              const prefix = pattern.slice(0, -1).replace(/\\(.)/g, "$1");
              filters.push((r) => String(r[col]).startsWith(prefix));
              return q;
            },
            overlaps(col: string, vs: readonly string[]) {
              filters.push((r) => Array.isArray(r[col]) && (r[col] as string[]).some((v) => vs.includes(v)));
              return q;
            },
            order(_col: string, o?: { ascending?: boolean }) {
              desc = o?.ascending === false;
              return q;
            },
            limit(n: number) {
              limit = n;
              return q;
            },
            then(resolve: (x: { data: Record<string, unknown>[] | null; error: { message: string; code?: string } | null }) => unknown) {
              const readModel = table === "review_items" && !opts.noReadModel;
              if (opts.missing || (table !== "data_documents" && !readModel)) return Promise.resolve({ data: null, error: { code: "PGRST205", message: `relation "public.${table}" does not exist` } }).then(resolve);
              const rows: Record<string, unknown>[] = readModel
                ? queue().map(([key, body]) => readModelRow(key, body))
                : [...docs].flatMap(([collection, m]) => [...m].map(([key, body]) => ({ collection, key, body, updated_at: "2026-11-01T00:00:00Z" })));
              const found = rows.filter((r) => filters.every((f) => f(r))).sort((a, b) => (String(a.key) < String(b.key) ? -1 : String(a.key) > String(b.key) ? 1 : 0));
              if (desc) found.reverse();
              const picked = found.slice(0, limit).map((r) => Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, r[c]])));
              opts.reads?.push(readModel ? "review_items" : String(found[0]?.collection ?? ""));
              return Promise.resolve({ data: picked, error: null }).then(resolve);
            },
          };
          return q as never;
        },
      };
    },
  };
}

function world(): Docs {
  const runs: RunDoc[] = ["2026-10-30", "2026-11-01", "2026-10-31"].map((day, i) => ({ key: `run-${i}`, mode: "run", started: `${day}T09:00:00Z`, finished: null, budget_usd: 5, spent_usd: 1, clusters: 3, issues: 1, proposals: 1, todo: 0, decisions: 0, audits: 0, stopped: null, request_id: null }));
  const todo: TodoDoc = { key: "cds:145637:-", kind: "cds", unit_id: "145637", subject: "UIUC", edition: null, landing: "https://uiuc.edu/cds", document_url: null, host: "uiuc.edu", why: "challenge", reach: 1, demand: 0, status: "open", route: null, attempts: [], note: null, updated: "2026-11-01" };
  return new Map<string, Map<string, unknown>>([
    ["reported.review_queue", new Map(ALL_ITEMS.map((i) => [reviewKey(i), i]))],
    ["reported.cds_records", new Map([...records])],
    ["reported.docs", new Map([[records.get("145637")!.documents[0].sha256, { sha256: "x" }]])],
    ["reported.failures", new Map([["190415", [{ unit_id: "190415", name: "Cornell University", reason_code: "host_blocked", stage: "fetch", detail: "refused by irp.cornell.edu (bot challenge)", url: "https://irp.cornell.edu/cds", edition: null, last_run: "2026-10-20" }]]])],
    ["directories.blocked", new Map([["blocked", { blocked: [{ org: "Some Directory", url: "https://dir.example/list", reason: "login", first_seen: "2026-09-01", last_seen: "2026-09-02" }] }]])],
    ["steward.proposals", new Map<string, unknown>([
      ["p-old", proposal({ key: "p-old", created: "2026-10-01T00:00:00Z" })],
      ["p-sys", proposal({ key: "p-sys", kind: "systemic", status: "declined" })],
      ["p-asked", proposal({ key: "p-asked", status: "asked", rows: [row({ unit_id: "221999" })] })],
    ])],
    ["steward.runs", new Map(runs.map((r) => [r.key, r]))],
    ["steward.todo", new Map([[todo.key, todo]])],
    ["steward.decisions", new Map<string, unknown>([
      ["d1", { key: "d1", question: "q", recommends: "r", options: [], answer: "yes", note: null, decided_by: null, decided_at: null, run: "r1", created: "2026-11-01" }],
      ["d2", { key: "d2", question: "q", recommends: "r", options: [], answer: null, note: null, decided_by: null, decided_at: null, run: "r1", created: "2026-10-01" }],
    ])],
  ]);
}

test("readClusters: the queue's clusters with their kinds, recomputed only when the queue is read again", async () => {
  resetQueueCache();
  resetClusterCache();
  const client = fakeClient(world());
  const first = await readClusters(client);
  assert.ok(first.ok);
  assert.deepEqual(first.clusters.map((c) => c.cluster), clusterQueue(ALL_ITEMS, { publishedBy: shownOnSite }));
  assert.ok(first.clusters.every((c) => c.cluster.published === c.cluster.colleges), "every code queued here is one a spec displays");
  assert.equal(shownOnSite({ ...ALL_ITEMS[0], code: "A.001" }), (CDS_TEMPLATE.byCode.get("A.001")?.owner ?? null) !== null);
  const kinds = new Map(first.clusters.map((c) => [c.cluster.key, c.kind]));
  assert.equal([...kinds].find(([k]) => k.startsWith("not-a-url|"))?.[1], "acquisition");
  assert.equal([...kinds].find(([k]) => k.startsWith("plausible-change|"))?.[1], "acquisition", "W&M's document isn't in the manifest the fake holds");
  const second = await readClusters(client);
  assert.ok(second.ok);
  assert.equal(second.clusters, first.clusters, "the cached clusters");
  // A missing table reads as an empty queue.
  resetQueueCache();
  resetClusterCache();
  const missing = await readClusters(fakeClient(world(), { missing: true }));
  assert.deepEqual(missing, { ok: true, updated: null, clusters: [], items: [], free: new Set() });
});

test("the Steward's documents: proposals systemic first then by status, one proposal by key, decisions unanswered first, runs newest first; a missing table is empty", async () => {
  const client = fakeClient(world());
  assert.deepEqual((await readProposals(client)).map((p) => p.key), ["p-sys", "p-old", "p-asked"]);
  assert.deepEqual((await readProposals(client, "asked")).map((p) => p.key), ["p-asked"]);
  assert.equal((await readProposal(client, "p-old"))?.key, "p-old");
  assert.equal(await readProposal(client, "nope"), null);
  assert.deepEqual((await readDecisions(client)).map((d) => d.key), ["d2", "d1"]);
  assert.deepEqual((await readRuns(client, 2)).map((r) => r.started.slice(0, 10)), ["2026-11-01", "2026-10-31"]);
  assert.equal((await readIssues(client)).size, 0);
  const gone = fakeClient(world(), { missing: true });
  assert.deepEqual([(await readIssues(gone)).size, (await readProposals(gone)).length, (await readRuns(gone)).length], [0, 0, 0]);
  assert.ok(isMissingTable(new Error("Could not find the table 'public.data_documents' in the schema cache")));
  assert.ok(!isMissingTable(new Error("permission denied")));
});

test("readTodo: stored rows over the generated ones from failures, the queue and blocked directories; demand from the lists", async () => {
  resetQueueCache();
  const rows = await readTodo(fakeClient(world()), { demand: new Map([["190415", 3]]) });
  assert.deepEqual(rows.map((r) => [r.key, r.why, r.demand]), [
    ["cds:190415:-", "challenge", 3],
    ["other:190415:2025-26", "unknown", 3],
    ["campus-page:some-directory:-", "login", 0],
    ["cds:145637:-", "challenge", 0],
  ]);
});

test("readReviewRows: one college's To do rows on top and its rows by code; collegesToReview over the queue and proposals", async () => {
  resetQueueCache();
  resetClusterCache();
  const client = fakeClient(world());
  const page = await readReviewRows(client, "190415", data);
  assert.equal(page.queueOk, true);
  assert.deepEqual(page.todo.map((t) => t.key), ["cds:190415:-", "other:190415:2025-26"]);
  assert.deepEqual(page.groups.map((g) => g.code), ["G.001"]);
  assert.equal(page.groups[0].rows[0].issues[0].check, "not-a-url");
  const uiuc = await readReviewRows(client, "145637", data);
  assert.deepEqual(uiuc.todo.map((t) => t.key), ["cds:145637:-"]);
  assert.equal(uiuc.groups.length, 14);
  const list = await collegesToReview(client);
  assert.deepEqual(list.map((c) => c.unit_id), ["221999", "145637", "231624", "190415"]);
});

test("To do and the Review page never read the whole queue: To do reads the open acquisition items, Review the college's items", async () => {
  resetQueueCache();
  resetClusterCache();
  const reads: string[] = [];
  const client = fakeClient(world(), { reads });
  const todo = await readTodo(client, { demand: new Map([["190415", 3]]) });
  assert.ok(!reads.some((r) => r.startsWith("rpc ")), `no queue RPC: ${reads.join(", ")}`);
  assert.ok(!reads.includes("reported.review_queue"), "no queue document");
  assert.ok(reads.includes("review_items"));
  assert.ok(todo.some((t) => t.key === "other:190415:2025-26"), "the not-a-url item is a To do row");

  reads.length = 0;
  const page = await readReviewRows(client, "145637", data);
  assert.deepEqual(reads.filter((r) => r.startsWith("rpc ") || r === "reported.review_queue"), [], "no whole-queue read");
  assert.equal(page.groups.length, 14);
  assert.ok(page.groups.flatMap((g) => g.rows).every((r) => r.item?.unit_id === "145637" || r.item === null));

  // collegesToReview with the clusters' items reads only the proposals.
  const clusters = await readClusters(client);
  assert.ok(clusters.ok);
  reads.length = 0;
  const list = await collegesToReview(client, { items: clusters.items });
  assert.deepEqual(reads.filter((r) => r.startsWith("rpc ")), []);
  assert.deepEqual(list.map((c) => c.unit_id), ["221999", "145637", "231624", "190415"]);
});

test("without the read model (a project before the migration) To do, Review, and the clusters read the documents and agree", async () => {
  const run = async (noReadModel: boolean) => {
    resetQueueCache();
    resetClusterCache();
    const client = fakeClient(world(), { noReadModel });
    const todo = await readTodo(client, { demand: new Map([["190415", 3]]) });
    const review = await readReviewRows(client, "190415", data);
    const uiuc = await readReviewRows(client, "145637", data);
    const clusters = await readClusters(client);
    assert.ok(clusters.ok);
    return { todo: todo.map((t) => t.key), review: review.groups, uiuc: uiuc.groups, queueOk: review.queueOk, clusters: clusters.clusters.map((c) => [c.cluster.key, c.kind]) };
  };
  const withModel = await run(false);
  const without = await run(true);
  assert.equal(without.queueOk, true);
  assert.deepEqual(without, withModel);
});
