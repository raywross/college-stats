/**
 * The admin console's data health model (specs/product/admin.md "Health"): `collegeHealth()` on fixtures for each cell
 * of the table, the overall-status order, the current-cycle edition, and guards that moving a threshold changes a
 * status. Also the inputs' assembly from the five files, the overview's cache, the CSV, and "on a family's list".
 * No network, no Supabase: the overview takes its files, dataset, clock, and changes read as dependencies.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import nodeModule from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// lib/admin/health.ts starts with `import "server-only"`, which only Next.js resolves; stand in an empty module.
// (module.registerHooks is in Node 24; the installed @types/node predates it.)
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    return next(specifier, context);
  },
});

const health = await import("../lib/admin/health.ts");
const rules = await import("../lib/admin/health-rules.ts");
const { collegeHealth, healthCsv, familyListUnits, createHealthOverview, latestChanges } = health;
const filesModule = await import("../lib/admin/health-files.ts");
const { healthInputsFor, indexHealthFiles, summarizeRecord, missingCoreFields, newestLineageDate, compactHealth, inputsFromCompact, formatCompact, parseCompact, reduceReportedDocs } = filesModule;
const { HEALTH_RULES, CURRENT_CDS_EDITION, CORE_FEDERAL_FIELDS } = rules;
const { editionCurrentOn } = await import("../lib/cds-reads.ts");
const { isFieldPath } = await import("../lib/fields.ts");
type HealthInputs = import("../lib/admin/health.ts").HealthInputs;
type ReportedDoc = import("../lib/admin/health.ts").ReportedDoc;
type CollegeHealth = import("../lib/admin/health.ts").CollegeHealth;
type HealthFiles = import("../lib/admin/health-files.ts").HealthFiles;
type HealthSchool = import("../lib/admin/health-files.ts").HealthSchool;
type HealthStatus = import("../lib/admin/health-rules.ts").HealthStatus;

const ROOT = join(import.meta.dirname, "..");
const TODAY = "2026-10-12";

/** `n` days before TODAY, as an ISO date. */
function ago(n: number): string {
  return new Date(Date.parse(TODAY) - n * 86_400_000).toISOString().slice(0, 10);
}

function doc(over: Partial<ReportedDoc> = {}): ReportedDoc {
  return {
    kind: "cds",
    edition: CURRENT_CDS_EDITION,
    type: "pdf-flat",
    retrieved: "2026-10-11",
    url: "https://college.example/cds-2025-26.pdf",
    archivedSections: ["A", "B", "C", "D"],
    reads: ["C", "rest"],
    extracted: "2026-10-11",
    ...over,
  };
}

/** Every group fresh; each test changes the one cell it is about. */
function inputs(over: { [K in keyof HealthInputs]?: Partial<HealthInputs[K]> | null } = {}): HealthInputs {
  const base: HealthInputs = {
    today: TODAY,
    federal: { retrieved: "2026-10-04", missing: [] },
    reported: { docs: [doc()], failures: [], queueItems: 0 },
    identity: { newest: ago(8), linkIssues: [] },
    campus: { newest: ago(30) },
    changes: null,
  };
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const current = (base as unknown as Record<string, unknown>)[k];
    out[k] = v === null || current === null || typeof current !== "object" || Array.isArray(v) ? v : { ...(current as object), ...(v as object) };
  }
  return out as unknown as HealthInputs;
}

const row = (h: CollegeHealth, group: string) => h.rows.find((r) => r.group === group)!;
const statusOf = (group: string, i: HealthInputs, r = HEALTH_RULES) => row(collegeHealth("100000", i, r), group).status;
const reported = (docs: ReportedDoc[], more: Partial<NonNullable<HealthInputs["reported"]>> = {}) => inputs({ reported: { docs, failures: [], queueItems: 0, ...more } });

/* ------------------------------------------------------------------ */
/* Federal                                                             */
/* ------------------------------------------------------------------ */

test("federal: all core fields present is Fresh; one or two missing is Watch; there is no worse status", () => {
  assert.equal(statusOf("federal", inputs()), "fresh");
  assert.equal(statusOf("federal", inputs({ federal: { missing: ["test ranges"] } })), "watch");
  assert.equal(statusOf("federal", inputs({ federal: { missing: ["test ranges", "earnings"] } })), "watch");
  // Three or more is still Watch: the table has no Stale or Failing for the federal group.
  assert.equal(statusOf("federal", inputs({ federal: { missing: ["a", "b", "c", "d"] } })), "watch");
  const h = collegeHealth("1", inputs({ federal: { missing: ["admit rate"] } }));
  assert.equal(row(h, "federal").judgedBy, "2026-10-04");
  assert.match(row(h, "federal").reason, /admit rate/);
});

test("federal core fields are registered, and a field with two paths is present when either is", () => {
  for (const f of CORE_FEDERAL_FIELDS) for (const p of f.paths) assert.ok(isFieldPath(p), `${p} is not a registered field`);
  const school = (over: Record<string, unknown> = {}) =>
    ({
      unit_id: "1",
      name: "A",
      admissions: { acceptance_rate: 0.5, sat_math_25_75: null, act_composite_25_75: [22, 28], ...over },
      cost: { avg_net_price: 1000 },
      outcomes: { graduation_rate: 0.6, median_earnings_10yr: 50000 },
    }) as unknown as HealthSchool;
  assert.deepEqual(missingCoreFields(school()), []);
  assert.deepEqual(missingCoreFields(school({ act_composite_25_75: null })), ["test ranges"]);
  assert.deepEqual(missingCoreFields(school({ acceptance_rate: null, act_composite_25_75: null })), ["admit rate", "test ranges"]);
});

/* ------------------------------------------------------------------ */
/* College-reported                                                    */
/* ------------------------------------------------------------------ */

test("reported Fresh: newest edition is the current cycle and every section was read", () => {
  const h = collegeHealth("1", inputs());
  const r = row(h, "reported");
  assert.equal(r.status, "fresh");
  assert.equal(r.judgedBy, "2026-10-11");
  assert.equal(r.link, "https://college.example/cds-2025-26.pdf");
  assert.match(r.reason, /2025-26/);
  assert.match(r.reason, /retrieved 2026-10-11/);
  assert.match(r.reason, /read 2026-10-11/);
});

test("reported Fresh: a deterministic read (workbook or form) covers every section", () => {
  const d = doc({ type: "xlsx-template", archivedSections: null, reads: ["deterministic"] });
  assert.equal(statusOf("reported", reported([d])), "fresh");
});

test("reported Fresh: an edition newer than the current cycle is not behind", () => {
  assert.equal(statusOf("reported", reported([doc({ edition: "2026-27" })])), "fresh");
});

test("what the data covers: a reported row names its Common Data Set edition; a class profile says it has no year", () => {
  assert.equal(row(collegeHealth("1", reported([doc({})])), "reported").covers, "2025-26 Common Data Set");
  assert.equal(row(collegeHealth("1", reported([doc({ edition: "2023-24" })])), "reported").covers, "2023-24 Common Data Set");
});

test("what the data covers: federal fields grouped by source and the year they describe, never the collection date", () => {
  type C = { label: string; year: string | null; key: string; replaces?: { year: string | null } };
  const cited: Record<string, C> = {
    "admissions.acceptance_rate": { label: "IPEDS Admissions survey", year: "Fall 2024", key: "ipeds-adm" },
    // A newer college-reported class replaced the federal test ranges: the federal value's year is the one shown.
    "admissions.sat_math_25_75": { label: "Example CDS 2025–26", year: "Fall 2025", key: "college-site", replaces: { year: "Fall 2024" } },
    "admissions.act_composite_25_75": { label: "Example CDS 2025–26", year: "Fall 2025", key: "college-site", replaces: { year: "Fall 2024" } },
    "cost.avg_net_price": { label: "College Scorecard", year: "2023–24", key: "scorecard" },
    "outcomes.graduation_rate": { label: "College Scorecard", year: null, key: "scorecard" },
    "outcomes.median_earnings_10yr": { label: "College Scorecard", year: null, key: "scorecard" },
  };
  const defaults: Record<string, string> = { "admissions.sat_math_25_75": "IPEDS Admissions survey", "admissions.act_composite_25_75": "IPEDS Admissions survey" };
  const cite = (path: string, school?: object) => (school ? cited[path] : { ...cited[path], label: defaults[path] ?? cited[path].label });
  assert.equal(
    health.federalCoverage({}, cite as never),
    "IPEDS Admissions survey: Fall 2024 (admit rate, test ranges) · College Scorecard: 2023–24 (net price) · College Scorecard: latest release, year not stated by the source (graduation rate, earnings)",
  );
});

test("reported Watch: one edition old", () => {
  const h = collegeHealth("1", reported([doc({ edition: "2024-25" })]));
  assert.equal(row(h, "reported").status, "watch");
  assert.match(row(h, "reported").reason, /1 edition behind 2025-26/);
});

test("reported Watch: a section archived but not read (section C, or the others)", () => {
  assert.equal(statusOf("reported", reported([doc({ reads: ["rest"] })])), "watch");
  assert.equal(statusOf("reported", reported([doc({ reads: ["C"] })])), "watch");
  assert.match(row(collegeHealth("1", reported([doc({ reads: ["rest"] })])), "reported").reason, /section C archived but not read/);
  assert.match(row(collegeHealth("1", reported([doc({ reads: ["C"] })])), "reported").reason, /the other sections archived but not read/);
  // A document whose manifest lists only section C needs only the C read.
  assert.equal(statusOf("reported", reported([doc({ archivedSections: ["C"], reads: ["C"] })])), "fresh");
  // An archived document with no record at all was never read.
  assert.equal(statusOf("reported", reported([doc({ reads: null, extracted: null })])), "watch");
});

test("reported Watch: only a class profile (no Common Data Set with a stated edition)", () => {
  const profile = doc({ kind: "class-profile", edition: null, url: "https://college.example/profile" });
  const h = collegeHealth("1", reported([profile]));
  assert.equal(row(h, "reported").status, "watch");
  assert.equal(row(h, "reported").link, "https://college.example/profile");
  assert.equal(statusOf("reported", reported([profile, doc({ kind: "cds", edition: null, reads: null })])), "watch");
});

test("reported Stale: two or more editions old, or no document", () => {
  assert.equal(statusOf("reported", reported([doc({ edition: "2023-24" })])), "stale");
  assert.equal(statusOf("reported", reported([doc({ edition: "2017-18" })])), "stale");
  const none = collegeHealth("1", reported([]));
  assert.equal(row(none, "reported").status, "stale");
  assert.equal(row(none, "reported").judgedBy, null);
  assert.match(row(none, "reported").reason, /No document/);
  // A document with no stated edition and no class profile is no document the pipeline can use.
  assert.equal(statusOf("reported", reported([doc({ edition: null, reads: null })])), "stale");
});

test("reported judges by the newest edition, then the latest retrieval", () => {
  const old = doc({ edition: "2021-22", reads: ["C", "rest"] });
  const current = doc({ edition: "2025-26", retrieved: "2026-09-01" });
  const rereleased = doc({ edition: "2025-26", retrieved: "2026-10-05", url: "https://college.example/second.pdf" });
  const h = collegeHealth("1", reported([old, current, rereleased]));
  assert.equal(row(h, "reported").judgedBy, "2026-10-05");
  assert.equal(row(h, "reported").link, "https://college.example/second.pdf");
});

test("reported Failing: an open failure at the fetch or read stage", () => {
  for (const [reason, stage] of [["host_blocked", "fetch"], ["unreachable", "fetch"], ["never_read", "read"], ["class_profile_no_figures", "read"]]) {
    const h = collegeHealth("1", reported([doc()], { failures: [{ reason, stage, url: "https://college.example/x", lastRun: "2026-10-10" }] }));
    assert.equal(row(h, "reported").status, "failing", `${reason} at ${stage}`);
    assert.equal(row(h, "reported").judgedBy, "2026-10-10");
    assert.equal(row(h, "reported").link, "https://college.example/x");
    assert.deepEqual(h.failures, [{ reason, stage }]);
  }
});

test("reported Failing: failed checks with a review-queue item; without one it is not Failing", () => {
  const failure = { reason: "failed_checks", stage: "checks", url: null, lastRun: "2026-10-11" };
  const queued = collegeHealth("1", reported([doc()], { failures: [failure], queueItems: 3 }));
  assert.equal(row(queued, "reported").status, "failing");
  assert.match(row(queued, "reported").reason, /3 review-queue items/);
  assert.equal(queued.queueItems, 3);
  const unqueued = collegeHealth("1", reported([doc()], { failures: [failure], queueItems: 0 }));
  assert.equal(row(unqueued, "reported").status, "fresh");
});

test("reported: a failure at the discovery stage does not by itself make it Failing", () => {
  const failure = { reason: "no_document_found", stage: "discovery", url: null, lastRun: "2026-10-11" };
  const h = collegeHealth("1", reported([], { failures: [failure] }));
  assert.equal(row(h, "reported").status, "stale");
  assert.deepEqual(h.failures, [{ reason: "no_document_found", stage: "discovery" }]);
});

test("reported is not judged (null) when its files are missing, and does not count toward overall", () => {
  const h = collegeHealth("1", inputs({ reported: null }));
  assert.equal(row(h, "reported").status, null);
  assert.match(row(h, "reported").reason, /not in this deploy/);
  assert.equal(h.overall, "fresh");
  assert.deepEqual(h.failures, []);
});

/* ------------------------------------------------------------------ */
/* Identity and campus life                                            */
/* ------------------------------------------------------------------ */

test("identity: 28 days Fresh, to 90 days Watch, over 90 Stale, none Stale", () => {
  const at = (days: number) => statusOf("identity", inputs({ identity: { newest: ago(days) } }));
  assert.equal(at(0), "fresh");
  assert.equal(at(28), "fresh");
  assert.equal(at(29), "watch");
  assert.equal(at(90), "watch");
  assert.equal(at(91), "stale");
  assert.equal(statusOf("identity", inputs({ identity: { newest: null } })), "stale");
  const h = collegeHealth("1", inputs({ identity: { newest: ago(8) } }));
  assert.equal(row(h, "identity").judgedBy, ago(8));
  assert.match(row(h, "identity").reason, /8 days ago/);
});

test("identity: a dead link makes a fresh probe Watch (and links to it), and cannot soften Stale", () => {
  const issue = { field: "apply", url: "https://college.example/apply", status: 404 };
  const fresh = collegeHealth("1", inputs({ identity: { linkIssues: [issue] } }));
  assert.equal(row(fresh, "identity").status, "watch");
  assert.equal(row(fresh, "identity").link, issue.url);
  assert.match(row(fresh, "identity").reason, /apply 404/);
  assert.equal(statusOf("identity", inputs({ identity: { newest: ago(120), linkIssues: [issue] } })), "stale");
});

test("identity is not judged (null) without data/link-issues.json", () => {
  assert.equal(statusOf("identity", inputs({ identity: { linkIssues: null } })), null);
});

test("campus life: 180 days Fresh, to a year Watch, over a year or never Stale", () => {
  const at = (days: number) => statusOf("campus", inputs({ campus: { newest: ago(days) } }));
  assert.equal(at(180), "fresh");
  assert.equal(at(181), "watch");
  assert.equal(at(365), "watch");
  assert.equal(at(366), "stale");
  const never = collegeHealth("1", inputs({ campus: { newest: null } }));
  assert.equal(row(never, "campus").status, "stale");
  assert.equal(row(never, "campus").judgedBy, null);
});

/* ------------------------------------------------------------------ */
/* What changed, and the overall order                                 */
/* ------------------------------------------------------------------ */

test("what changed is informational: carried through, never part of the status", () => {
  const changed = { at: "2026-10-04", fields: 3 };
  const h = collegeHealth("1", inputs({ changes: changed }));
  assert.deepEqual(h.changed, changed);
  assert.equal(h.overall, "fresh");
  assert.equal(h.rows.length, 4);
  assert.equal(collegeHealth("1", inputs()).changed, null);
});

/** Inputs whose four groups land on the given statuses. */
function withStatuses(f: HealthStatus, r: HealthStatus, i: HealthStatus, c: HealthStatus): HealthInputs {
  return inputs({
    federal: { missing: f === "fresh" ? [] : ["admit rate"] },
    reported: r === "fresh" ? undefined : r === "watch" ? { docs: [doc({ edition: "2024-25" })] } : r === "stale" ? { docs: [] } : { failures: [{ reason: "host_blocked", stage: "fetch", url: null, lastRun: null }] },
    identity: { newest: i === "fresh" ? ago(1) : i === "watch" ? ago(60) : ago(200) },
    campus: { newest: c === "fresh" ? ago(1) : c === "watch" ? ago(200) : ago(500) },
  });
}

test("overall is the worst row: Failing > Stale > Watch > Fresh", () => {
  assert.equal(collegeHealth("1", withStatuses("fresh", "fresh", "fresh", "fresh")).overall, "fresh");
  assert.equal(collegeHealth("1", withStatuses("watch", "fresh", "fresh", "fresh")).overall, "watch");
  assert.equal(collegeHealth("1", withStatuses("watch", "watch", "fresh", "watch")).overall, "watch");
  assert.equal(collegeHealth("1", withStatuses("watch", "fresh", "fresh", "stale")).overall, "stale");
  assert.equal(collegeHealth("1", withStatuses("fresh", "fresh", "stale", "watch")).overall, "stale");
  assert.equal(collegeHealth("1", withStatuses("watch", "stale", "stale", "stale")).overall, "stale");
  assert.equal(collegeHealth("1", withStatuses("fresh", "failing", "fresh", "fresh")).overall, "failing");
  assert.equal(collegeHealth("1", withStatuses("watch", "failing", "stale", "stale")).overall, "failing");
  // The fixture helper itself lands where it says (a broken helper would make the checks above vacuous).
  const h = collegeHealth("1", withStatuses("watch", "stale", "watch", "fresh"));
  assert.deepEqual(h.rows.map((r) => r.status), ["watch", "stale", "watch", "fresh"]);
});

test("groups that cannot be judged are left out of overall, and rows come in group order", () => {
  const h = collegeHealth("1", { ...inputs({ reported: null, identity: { linkIssues: null } }), campus: { newest: ago(500) } });
  assert.equal(h.overall, "stale");
  assert.deepEqual(h.rows.map((r) => r.group), ["federal", "reported", "identity", "campus"]);
  assert.equal(rules.statusRank("failing") > rules.statusRank("stale"), true);
  assert.deepEqual([...rules.HEALTH_STATUSES], ["fresh", "watch", "stale", "failing"]);
});

/* ------------------------------------------------------------------ */
/* Thresholds and the current cycle                                    */
/* ------------------------------------------------------------------ */

test("the thresholds are the spec's numbers", () => {
  assert.deepEqual(HEALTH_RULES.identity, { freshDays: 28, watchDays: 90 });
  assert.deepEqual(HEALTH_RULES.campus, { freshDays: 180, watchDays: 365, neverCollected: "stale" });
  assert.equal(HEALTH_RULES.reported.watchEditionsBehind, 1);
  assert.equal(HEALTH_RULES.reported.staleEditionsBehind, 2);
  assert.deepEqual([...HEALTH_RULES.reported.failingStages], ["fetch", "read"]);
});

test("moving one threshold changes the expected status (the rules are read, not copied)", () => {
  const probed40 = inputs({ identity: { newest: ago(40) } });
  assert.equal(statusOf("identity", probed40), "watch");
  assert.equal(statusOf("identity", probed40, { ...HEALTH_RULES, identity: { ...HEALTH_RULES.identity, freshDays: 45 } }), "fresh");
  assert.equal(statusOf("identity", probed40, { ...HEALTH_RULES, identity: { ...HEALTH_RULES.identity, watchDays: 30 } }), "stale");

  const campus200 = inputs({ campus: { newest: ago(200) } });
  assert.equal(statusOf("campus", campus200), "watch");
  assert.equal(statusOf("campus", campus200, { ...HEALTH_RULES, campus: { ...HEALTH_RULES.campus, freshDays: 250 } }), "fresh");
  assert.equal(statusOf("campus", inputs({ campus: { newest: null } }), { ...HEALTH_RULES, campus: { ...HEALTH_RULES.campus, neverCollected: "watch" } }), "watch");

  const old = reported([doc({ edition: "2024-25" })]);
  assert.equal(statusOf("reported", old), "watch");
  assert.equal(statusOf("reported", old, { ...HEALTH_RULES, reported: { ...HEALTH_RULES.reported, currentEdition: "2024-25" } }), "fresh");
  assert.equal(statusOf("reported", old, { ...HEALTH_RULES, reported: { ...HEALTH_RULES.reported, staleEditionsBehind: 1 } }), "stale");
  // The same documents against the next cycle's edition: the current one is now one behind.
  const current = reported([doc()]);
  assert.equal(statusOf("reported", current), "fresh");
  assert.equal(statusOf("reported", current, { ...HEALTH_RULES, reported: { ...HEALTH_RULES.reported, currentEdition: "2026-27" } }), "watch");
});

test("health.ts holds no threshold numbers: they live in health-rules.ts", () => {
  const source = readFileSync(join(ROOT, "lib", "admin", "health.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const hits = [...source.matchAll(/\b(28|90|180|365|2025-26|2024-25)\b/g)].map((m) => m[0]);
  assert.deepEqual(hits, [], "a threshold or edition is written in health.ts; move it to lib/admin/health-rules.ts");
});

test("the current-cycle edition is one constant, a real edition, and not out of date", () => {
  assert.equal(HEALTH_RULES.reported.currentEdition, CURRENT_CDS_EDITION);
  assert.match(CURRENT_CDS_EDITION, /^\d{4}-\d{2}$/);
  assert.equal(CURRENT_CDS_EDITION, rules.editionLabelFor(rules.CURRENT_CDS_EDITION_START));
  assert.equal(rules.editionStart(CURRENT_CDS_EDITION), rules.CURRENT_CDS_EDITION_START);
  assert.equal(rules.editionLabelFor(1999), "1999-00");
  assert.notEqual(rules.editionStart(CURRENT_CDS_EDITION), null);
  const calendar = rules.editionStart(editionCurrentOn(new Date().toISOString().slice(0, 10)))!;
  const ours = rules.editionStart(CURRENT_CDS_EDITION)!;
  assert.ok(ours <= calendar, `${CURRENT_CDS_EDITION} is ahead of the calendar's current edition`);
  assert.ok(calendar - ours <= 1, `${CURRENT_CDS_EDITION} is more than a cycle behind the calendar (${editionCurrentOn(new Date().toISOString().slice(0, 10))}): bump CURRENT_CDS_EDITION in lib/admin/health-rules.ts`);
  // The constant is what separates Fresh from Watch.
  assert.equal(statusOf("reported", reported([doc({ edition: CURRENT_CDS_EDITION })])), "fresh");
  assert.equal(statusOf("reported", reported([doc({ edition: `${ours - 1}-${String(ours % 100).padStart(2, "0")}` })])), "watch");
});

/* ------------------------------------------------------------------ */
/* Inputs from the files                                               */
/* ------------------------------------------------------------------ */

function school(unit: string, lineage: Record<string, { retrieved?: string }> = {}, over: Record<string, unknown> = {}): HealthSchool {
  return {
    unit_id: unit,
    name: `College ${unit}`,
    admissions: { acceptance_rate: 0.4, sat_math_25_75: [600, 700], act_composite_25_75: null },
    cost: { avg_net_price: 20000 },
    outcomes: { graduation_rate: 0.7, median_earnings_10yr: 60000 },
    lineage,
    ...over,
  } as unknown as HealthSchool;
}

test("lineage dates: identity from links, social, brand; campus from directories, campus, religion, LGBTQ", () => {
  const lineage = {
    "links.visit": { retrieved: "2026-09-01" },
    "social.instagram": { retrieved: "2026-10-04" },
    "brand.logo": { retrieved: "2026-08-01" },
    "links.apply": {},
    directories: { retrieved: "2026-05-01" },
    "religion.cccu_member": { retrieved: "2026-06-01" },
    "lgbtq.policies": { retrieved: "2026-04-01" },
    "campus.housing": { retrieved: "2026-02-01" },
    "admissions.acceptance_rate": { retrieved: "2026-10-11" },
    religionless: { retrieved: "2026-10-11" },
  };
  assert.equal(newestLineageDate(lineage, rules.IDENTITY_LINEAGE_PREFIXES), "2026-10-04");
  assert.equal(newestLineageDate(lineage, rules.CAMPUS_LINEAGE_KEYS), "2026-06-01");
  assert.equal(newestLineageDate({}, rules.CAMPUS_LINEAGE_KEYS), null);
  assert.equal(newestLineageDate(undefined, rules.IDENTITY_LINEAGE_PREFIXES), null);
});

const manifest = (over: Record<string, unknown>) => ({ sha256: "s1", unit_id: "1", url: "https://c.example/a.pdf", kind: "cds", type: "pdf-flat", edition: null, retrieved: "2026-10-11", ...over });

function files(over: Partial<HealthFiles> = {}): HealthFiles {
  return {
    manifest: [manifest({ edition: "2025-26", sections: { A: [1, 2], C: [3, 4] } }), manifest({ sha256: "s2", unit_id: "2", kind: "class-profile", type: "class-profile", url: "https://c.example/p" })] as HealthFiles["manifest"],
    records: new Map([["1", [{ sha256: "s1", edition: "2025-26", reads: ["C", "rest"], extracted: "2026-10-11" }]]]),
    failures: [{ unit_id: "2", reason_code: "class_profile_no_figures", stage: "read", url: null, last_run: "2026-10-11" }],
    queue: new Map([["2", 4]]),
    linkIssues: [{ unit_id: "1", field: "visit", url: "https://c.example/visit", last_status: 404 }],
    ...over,
  };
}

const CTX = { today: TODAY, metaRetrieved: "2026-10-04", changes: new Map([["1", { at: "2026-10-04", fields: 3 }]]) };

test("inputs join the manifest to the records by sha256, and group failures, queue items, and link issues by college", () => {
  const index = indexHealthFiles(files());
  const one = healthInputsFor(school("1", { "links.visit": { retrieved: ago(8) } }), index, CTX);
  assert.deepEqual(one.reported?.docs, [
    { kind: "cds", edition: "2025-26", type: "pdf-flat", retrieved: "2026-10-11", url: "https://c.example/a.pdf", archivedSections: ["A", "C"], reads: ["C", "rest"], extracted: "2026-10-11" },
  ]);
  assert.equal(one.identity.newest, ago(8));
  assert.deepEqual(one.identity.linkIssues, [{ field: "visit", url: "https://c.example/visit", status: 404 }]);
  assert.deepEqual(one.changes, { at: "2026-10-04", fields: 3 });
  assert.equal(one.federal.retrieved, "2026-10-04");
  assert.deepEqual(one.federal.missing, []);
  const two = healthInputsFor(school("2"), index, CTX);
  assert.equal(two.reported?.queueItems, 4);
  assert.deepEqual(two.reported?.failures, [{ reason: "class_profile_no_figures", stage: "read", url: null, lastRun: "2026-10-11" }]);
  assert.equal(two.reported?.docs[0].reads, null, "a document with no record was never read");
  assert.equal(two.changes, null);
  const three = healthInputsFor(school("3"), index, CTX);
  assert.deepEqual(three.reported, { docs: [], failures: [], queueItems: 0 });
  assert.deepEqual(three.identity.linkIssues, []);
});

test("a missing file leaves its groups unjudged instead of reading as empty", () => {
  const noDocs = healthInputsFor(school("1"), indexHealthFiles(files({ manifest: null })), CTX);
  assert.equal(noDocs.reported, null);
  assert.equal(healthInputsFor(school("1"), indexHealthFiles(files({ records: null })), CTX).reported, null);
  assert.equal(healthInputsFor(school("1"), indexHealthFiles(files({ failures: null })), CTX).reported, null);
  assert.equal(healthInputsFor(school("1"), indexHealthFiles(files({ queue: null })), CTX).reported, null);
  assert.equal(healthInputsFor(school("1"), indexHealthFiles(files({ linkIssues: null })), CTX).identity.linkIssues, null);
  assert.equal(healthInputsFor(school("1"), indexHealthFiles(files()), { ...CTX, changes: null }).changes, null);
});

test("summarizeRecord keeps the read keys and the newest extraction date", () => {
  const out = summarizeRecord({
    documents: [
      { sha256: "a", edition: "2025-26", reads: { C: { extracted: "2026-10-09" }, rest: { extracted: "2026-10-11" } } },
      { sha256: "b", edition: "2024-25", reads: { deterministic: { extracted: "2026-10-01" } } },
      { sha256: "c", reads: {} },
    ],
  });
  assert.deepEqual(out, [
    { sha256: "a", edition: "2025-26", reads: ["C", "rest"], extracted: "2026-10-11" },
    { sha256: "b", edition: "2024-25", reads: ["deterministic"], extracted: "2026-10-01" },
    { sha256: "c", edition: null, reads: [], extracted: null },
  ]);
});

/* ------------------------------------------------------------------ */
/* What changed: dataset_changes                                       */
/* ------------------------------------------------------------------ */

test("latestChanges: each college's newest publish wins, and fields are counted within that publish", async () => {
  const publishes = [{ id: 30, at: "2026-10-04T12:00:00Z" }, { id: 20, at: "2026-09-20T12:00:00Z" }, { id: 10, at: "2026-09-01T12:00:00Z" }];
  const fields: Record<number, string[]> = { 30: ["1", "1", "1", "2"], 20: ["2", "2", "3"], 10: ["4"] };
  const reader = {
    newestPublishBefore: async (before: number | null) => publishes.find((p) => before === null || p.id < before) ?? null,
    unitsOfPublish: async (id: number) => fields[id],
  };
  const all = await latestChanges(reader, 3);
  assert.deepEqual(all.get("1"), { at: "2026-10-04", fields: 3 });
  assert.deepEqual(all.get("2"), { at: "2026-10-04", fields: 1 });
  assert.deepEqual(all.get("3"), { at: "2026-09-20", fields: 1 });
  assert.deepEqual(all.get("4"), { at: "2026-09-01", fields: 1 });
  const recent = await latestChanges(reader, 1);
  assert.equal(recent.has("3"), false, "only the newest publish was read");
  assert.equal((await latestChanges({ ...reader, newestPublishBefore: async () => null })).size, 0);
});

/** A Supabase-shaped query over fixed rows that records what was asked. */
function fakeClient(tables: Record<string, Record<string, unknown>[]>, log: string[] = []) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: [string, string, unknown][] = [];
          let range: [number, number] | null = null;
          let max: number | null = null;
          let sort: { column: string; ascending: boolean } | null = null;
          const q = {
            eq(c: string, v: unknown) { filters.push(["eq", c, v]); return q; },
            lt(c: string, v: unknown) { filters.push(["lt", c, v]); return q; },
            order(c: string, o?: { ascending?: boolean }) { sort ??= { column: c, ascending: o?.ascending ?? true }; return q; },
            range(a: number, b: number) { range = [a, b]; return q; },
            limit(n: number) { max = n; return q; },
            then(resolve: (v: { data: Record<string, unknown>[]; error: null }) => unknown) {
              log.push(`${table}.${columns}${filters.map((f) => ` ${f.join(" ")}`).join("")}${range ? ` [${range}]` : ""}`);
              let rows = (tables[table] ?? []).filter((r) => filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : Number(r[c]) < Number(v))));
              if (sort) { const s = sort as { column: string; ascending: boolean }; rows = [...rows].sort((a, b) => (Number(a[s.column]) - Number(b[s.column])) * (s.ascending ? 1 : -1)); }
              if (range) rows = rows.slice(range[0], range[1] + 1);
              if (max !== null) rows = rows.slice(0, max);
              return Promise.resolve({ data: rows, error: null }).then(resolve);
            },
          };
          return q;
        },
      };
    },
  } as unknown as Parameters<typeof health.supabaseChangesReader>[0];
}

test("the Supabase changes reader asks for the newest publish, then that publish's fields", async () => {
  const log: string[] = [];
  const rows = [
    { id: 1, publish_id: 5, published_at: "2026-09-01T00:00:00Z", unit_id: "1" },
    { id: 2, publish_id: 6, published_at: "2026-10-04T00:00:00Z", unit_id: "1" },
    { id: 3, publish_id: 6, published_at: "2026-10-04T00:00:00Z", unit_id: "1" },
    { id: 4, publish_id: 6, published_at: "2026-10-04T00:00:00Z", unit_id: "2" },
  ];
  const changes = await latestChanges(health.supabaseChangesReader(fakeClient({ dataset_changes: rows }, log)), 5);
  assert.deepEqual(changes.get("1"), { at: "2026-10-04", fields: 2 });
  assert.deepEqual(changes.get("2"), { at: "2026-10-04", fields: 1 });
  assert.equal(changes.size, 2, "publish 5 is older than each college's newest change");
  assert.ok(log.some((l) => l.includes("lt publish_id 6")), "the second look is for publishes older than the first");
});

/* ------------------------------------------------------------------ */
/* The overview                                                        */
/* ------------------------------------------------------------------ */

function overviewDeps(over: Partial<Parameters<typeof createHealthOverview>[0]> = {}) {
  const calls = { compact: 0, changes: 0 };
  let now = Date.parse("2026-10-12T12:00:00Z");
  const deps = {
    compact: async () => {
      calls.compact++;
      const schools = [school("1", { "links.visit": { retrieved: ago(8) }, directories: { retrieved: ago(30) } }), school("2"), school("3", { "links.visit": { retrieved: ago(8) }, directories: { retrieved: ago(30) } })];
      const f = files({ failures: [{ unit_id: "2", reason_code: "host_blocked", stage: "fetch", url: null, last_run: "2026-10-11" }] });
      return compactHealth(f, schools, { metaRetrieved: "2026-10-04", generated: "2026-10-11" });
    },
    changes: async () => {
      calls.changes++;
      return new Map([["1", { at: "2026-10-04", fields: 3 }]]);
    },
    now: () => now,
    ...over,
  };
  return { deps, calls, advance: (ms: number) => (now += ms) };
}

test("the overview sorts worst first, counts every group, and carries what changed", async () => {
  const { deps } = overviewDeps();
  const overview = await createHealthOverview(deps)();
  assert.equal(overview.today, "2026-10-12");
  assert.equal(overview.changesAvailable, true);
  // 2: a failure at fetch; 3: no document; 1: a dead link on an otherwise fresh college.
  assert.deepEqual(overview.colleges.map((c) => [c.unitId, c.overall]), [["2", "failing"], ["3", "stale"], ["1", "watch"]]);
});

test("the overview counts by overall status and by group", async () => {
  const { deps } = overviewDeps();
  const { colleges, counts } = await createHealthOverview(deps)();
  assert.equal(counts.total, 3);
  assert.equal(counts.overall.failing, 1);
  assert.equal(Object.values(counts.overall).reduce((a, b) => a + b, 0), 3);
  for (const g of rules.HEALTH_GROUPS) assert.equal(Object.values(counts.groups[g]).reduce((a, b) => a + b, 0), 3, g);
  assert.equal(counts.groups.reported.failing, 1);
  assert.equal(colleges.find((c) => c.unitId === "1")?.changed?.fields, 3);
});

test("the overview is computed once per instance; the changes read is renewed after its TTL", async () => {
  const { deps, calls, advance } = overviewDeps();
  const overview = createHealthOverview(deps);
  await overview();
  await overview();
  assert.deepEqual(calls, { compact: 1, changes: 1 });
  advance(rules.CHANGES_TTL_MS + 1);
  await overview();
  assert.deepEqual(calls, { compact: 1, changes: 2 }, "the compact file stays cached; changes are read again");
});

test("a failed file read is not cached; a failed or absent changes read leaves what changed out", async () => {
  let attempts = 0;
  const { deps } = overviewDeps({
    compact: async () => {
      if (++attempts === 1) throw new Error("boom");
      return overviewDeps().deps.compact();
    },
  });
  const overview = createHealthOverview(deps);
  await assert.rejects(overview(), /boom/);
  assert.equal((await overview()).colleges.length, 3, "the next call reads again");

  const none = await createHealthOverview(overviewDeps({ changes: async () => null }).deps)();
  assert.equal(none.changesAvailable, false);
  assert.ok(none.colleges.every((c) => c.changed === null));

  const quiet = console.error;
  console.error = () => {};
  try {
    const failed = await createHealthOverview(overviewDeps({ changes: async () => { throw new Error("paused project"); } }).deps)();
    assert.equal(failed.changesAvailable, false);
    assert.equal(failed.colleges.length, 3);
  } finally {
    console.error = quiet;
  }
});

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

test("healthCsv: a header, one line per college, quoted cells, and spreadsheet formulas defused", () => {
  const rows = [
    collegeHealth("100", inputs({ changes: { at: "2026-10-04", fields: 3 } })),
    collegeHealth("200", reported([doc()], { failures: [{ reason: "host_blocked", stage: "fetch", url: null, lastRun: "2026-10-10" }, { reason: "failed_checks", stage: "checks", url: null, lastRun: "2026-10-10" }], queueItems: 2 })),
  ];
  const csv = healthCsv(rows, { "100": "Smith, \"Big\" College", "200": "=HYPERLINK(\"x\")" });
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], health.HEALTH_CSV_COLUMNS.join(","));
  assert.ok(lines[1].startsWith('100,"Smith, ""Big"" College",fresh,fresh,2026-10-04,'));
  assert.ok(lines[1].includes(",2026-10-04,3,,0"), "changed date and fields, no failures, no queue items");
  assert.ok(lines[2].startsWith(`200,"'=HYPERLINK(""x"")",failing,`));
  assert.ok(lines[2].endsWith(",host_blocked; failed_checks,2"));
  assert.equal(healthCsv([], {}), `${health.HEALTH_CSV_COLUMNS.join(",")}\r\n`);
  assert.equal(health.csvCell(null), "");
  assert.equal(health.csvCell("+1"), "'+1");
  assert.equal(health.csvCell("plain"), "plain");
});

/* ------------------------------------------------------------------ */
/* On a family's list                                                  */
/* ------------------------------------------------------------------ */

test("familyListUnits: the distinct colleges on any list, read in pages", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i, unit_id: String(100 + (i % 7)) }));
  const log: string[] = [];
  const units = await familyListUnits({ client: async () => fakeClient({ list_items: rows }, log) });
  assert.deepEqual([...units!].sort(), ["100", "101", "102", "103", "104", "105", "106"]);
  assert.equal(log.length, 3, "2,500 rows are three pages");
});

test("familyListUnits is null when the read is unavailable: no sign-in, or an error", async () => {
  assert.equal(await familyListUnits({ client: async () => null }), null);
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await familyListUnits({ client: async () => { throw new Error("no session"); } }), null);
    const denied = { from: () => ({ select: () => { const q: Record<string, unknown> = {}; for (const m of ["eq", "lt", "order", "range", "limit"]) q[m] = () => q; q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "permission denied" } }).then(r); return q; } }) };
    assert.equal(await familyListUnits({ client: async () => denied as never }), null);
  } finally {
    console.error = quiet;
  }
});

/* ------------------------------------------------------------------ */
/* Server-only, and the real files                                     */
/* ------------------------------------------------------------------ */

test("client components never import the server-only health module (health-rules.ts is the client-safe one)", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "components"]) {
    for (const f of readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(f) || !statSync(join(ROOT, dir, f)).isFile()) continue;
      const text = readFileSync(join(ROOT, dir, f), "utf8");
      if (/^\s*["']use client["']/m.test(text) && /from\s+["'][^"']*admin\/health["']/.test(text)) offenders.push(join(dir, f));
    }
  }
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(join(ROOT, "lib", "admin", "health.ts"), "utf8"), /^import "server-only";/m);
  // The rules and the input gathering are pure: the script, its check, and client code load them without Next or fs.
  for (const f of ["health-rules.ts", "health-files.ts"]) assert.doesNotMatch(readFileSync(join(ROOT, "lib", "admin", f), "utf8"), /server-only|node:fs/, f);
});

/* ------------------------------------------------------------------ */
/* The compact file: data/college-health.json                         */
/* ------------------------------------------------------------------ */

test("the compact file keeps only the documents the rules look at, and judges the same", () => {
  const docs = [
    doc({ edition: "2021-22", reads: ["C", "rest"] }),
    doc({ edition: "2025-26", retrieved: "2026-09-01", reads: ["C"] }),
    doc({ edition: "2025-26", retrieved: "2026-10-05", url: "https://c.example/second.pdf" }),
    doc({ kind: "class-profile", edition: null, retrieved: "2026-08-01", url: "https://c.example/old-profile" }),
    doc({ kind: "class-profile", edition: null, retrieved: "2026-09-15", url: "https://c.example/new-profile" }),
  ];
  const kept = reduceReportedDocs(docs);
  assert.deepEqual(kept.map((d) => d.url), ["https://c.example/second.pdf", "https://c.example/new-profile"]);
  // With no CDS that states an edition, one CDS stays so "no stated edition" still reads differently from "no document".
  const unstated = [doc({ edition: null, reads: null, retrieved: "2026-08-01" }), doc({ edition: null, reads: null, retrieved: "2026-09-01", url: "https://c.example/b" })];
  assert.deepEqual(reduceReportedDocs(unstated).map((d) => d.url), ["https://c.example/b"]);
  for (const set of [docs, unstated, [], docs.slice(3), docs.slice(0, 1)]) {
    assert.deepEqual(collegeHealth("1", reported(reduceReportedDocs(set))), collegeHealth("1", reported(set)));
  }
});

test("the compact file round-trips: text to the same inputs, deterministic, in unit order", () => {
  const schools = [school("20"), school("3", { "links.visit": { retrieved: ago(8) } }), school("100")];
  const build = () => compactHealth(files(), schools, { metaRetrieved: "2026-10-04", generated: "2026-10-11" });
  const compact = build();
  const text = formatCompact(compact);
  assert.equal(formatCompact(build()), text, "the same sources give the same bytes");
  assert.deepEqual(parseCompact(text), compact);
  assert.deepEqual(Object.keys(compact.colleges), ["3", "20", "100"], "numeric unit order, whatever the dataset's");
  assert.ok(text.endsWith("}\n}\n") && text.split("\n").length === 5 + 3 + 3, "a header, one line per college, a footer");
  const index = indexHealthFiles(files());
  for (const s of schools) {
    const direct = healthInputsFor(s, index, { today: TODAY, metaRetrieved: "2026-10-04", changes: CTX.changes });
    assert.deepEqual(collegeHealth(s.unit_id, inputsFromCompact(parseCompact(text), s.unit_id, { today: TODAY, changes: CTX.changes })!), collegeHealth(s.unit_id, direct));
  }
  assert.equal(inputsFromCompact(compact, "999", { today: TODAY, changes: null }), null);
});

test("the compact file needs every source, and refuses a shape it does not know", () => {
  const schools = [school("1")];
  for (const key of ["manifest", "records", "failures", "queue", "linkIssues"] as const) {
    assert.throws(() => compactHealth(files({ [key]: null }), schools, { metaRetrieved: null, generated: "2026-10-11" }), /every source file is required/, key);
  }
  assert.throws(() => parseCompact(JSON.stringify({ version: 2, generated: "2026-10-11", colleges: {} })), /npm run college-health/);
  assert.throws(() => parseCompact("{}"), /npm run college-health/);
});

test("the overview needs the compact file: a deploy without it fails loudly, not as empty health", async () => {
  const dir = join(ROOT, "lib", "admin", "health.ts");
  assert.match(readFileSync(dir, "utf8"), /data\/college-health\.json is not in this deploy/);
});

/**
 * A tiny file store with every source `npm run college-health` reads (reported.docs, cds_records, failures,
 * review_queue, identity.link_issues, base.meta), and a bundled copy holding its one college (QUAD_SNAPSHOT_DIR), in a
 * temp folder.
 */
async function fixtureStore(): Promise<{ dir: string; store: string; snapshot: string }> {
  const { fileStore } = await import("../scripts/lib/data-platform/store.mts");
  const dir = mkdtempSync(join(tmpdir(), "college-health-"));
  const store = join(dir, "layers");
  const snapshot = join(dir, "snapshot");
  mkdirSync(snapshot, { recursive: true });
  writeFileSync(join(snapshot, "colleges.json"), JSON.stringify([school("1", { "links.visit": { retrieved: "2026-10-04" } })]));
  writeFileSync(join(snapshot, "meta.json"), JSON.stringify({ retrieved: "2026-10-04" }));
  writeFileSync(join(snapshot, "manifest.json"), JSON.stringify({ id: 1 }));
  const h = await fileStore(store).open("import", "files", "fixture");
  await h.write("import.headers", [{ key: "college-docs.json", body: { updated: "2026-10-11" } }, { key: "review-queue.json", body: { updated: "2026-10-11" } }]);
  await h.write("reported.docs", [{ key: "s1", body: manifest({ edition: "2025-26", sections: { C: [1, 2] } }) }]);
  await h.write("reported.cds_records", [{ key: "1", body: { unit_id: "1", documents: [{ sha256: "s1", edition: "2025-26", reads: { C: { extracted: "2026-10-11" } } }] } }]);
  await h.write("reported.review_queue", [{ key: "1|a", body: { unit_id: "1" } }]);
  await h.write("base.meta", [{ key: "meta", body: { retrieved: "2026-10-04" } }]);
  await h.close("applied");
  return { dir, store, snapshot };
}

function runScript(script: string, snapshot: string, ...args: string[]) {
  return spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", script), ...args], { env: { ...process.env, QUAD_SNAPSHOT_DIR: snapshot }, encoding: "utf8" });
}

test("npm run college-health writes the document; check:college-health passes, then fails when a source changes", async () => {
  const { dir, store, snapshot } = await fixtureStore();
  const { fileStore } = await import("../scripts/lib/data-platform/store.mts");
  try {
    const missing = runScript("check-college-health.mts", snapshot, "--store", `file:${store}`);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no health document.*npm run college-health/);

    const wrote = runScript("college-health.mts", snapshot, "--store", `file:${store}`);
    assert.equal(wrote.status, 0, wrote.stderr);
    const doc = parseCompact(JSON.stringify(await fileStore(store).readOne("health.colleges", "health")));
    assert.equal(doc.generated, "2026-10-11", "the newest date among the sources, not today");
    assert.equal(doc.colleges["1"].queue, 1);
    const ok = runScript("check-college-health.mts", snapshot, "--store", `file:${store}`);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /a fresh build of its sources/);

    // A new queue item and a dead link each make the stored document stale.
    const h = await fileStore(store).open("pipeline", "college-reported", "run-2");
    await h.write("reported.review_queue", [{ key: "1|b", body: { unit_id: "1" } }]);
    await h.close("applied");
    const stale = runScript("check-college-health.mts", snapshot, "--store", `file:${store}`);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /stale/);
    assert.match(stale.stderr, /1 college\(s\) differ, e\.g\. 1/);
    assert.match(stale.stderr, /npm run college-health/);
    const fixed = runScript("college-health.mts", snapshot, "--store", `file:${store}`);
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.equal(runScript("check-college-health.mts", snapshot, "--store", `file:${store}`).status, 0);
    const l = await fileStore(store).open("pipeline", "identity-refresh", "run-3");
    await l.write("identity.link_issues", [{ key: "1", body: [{ unit_id: "1", field: "apply", url: "https://c.example/a", last_status: 404 }] }]);
    await l.close("applied");
    assert.equal(runScript("check-college-health.mts", snapshot, "--store", `file:${store}`).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:college-health over the mini fixture: the layers' document covers every college of the fixture's snapshot", () => {
  const run = spawnSync("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "check-college-health.mts")], {
    env: { ...process.env, QUAD_SNAPSHOT_DIR: join(ROOT, "tests", "fixtures", "snapshot-mini", "snapshot") },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /the mini fixture's layers\): ok \(38 colleges/);
});

test("the compact health is read from the data store in one query, falling back to the file when the store has none", async () => {
  const { readCompact, readCompactFromStore, HEALTH_DOCUMENT } = health;
  const compact = await overviewDeps().deps.compact();
  const queries: string[] = [];
  /** A client whose data_documents read answers `rows` (or an error), recording the filters. */
  const client = (rows: { body: unknown }[] | null, error: string | null = null) => ({
    from(table: string) {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (queries.push(`${table}.${c}=${String(v)}`), q),
        lt: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: error ? { message: error } : null }).then(ok),
      };
      return q as never;
    },
  });
  const disk = () => ({ ...compact, generated: "from-disk" });

  const fromStore = await readCompact({ client: async () => client([{ body: compact }]), disk });
  assert.equal(fromStore.generated, compact.generated, "the store's document");
  assert.deepEqual(queries, [`data_documents.collection=${HEALTH_DOCUMENT.collection}`, `data_documents.key=${HEALTH_DOCUMENT.key}`], "one query, by collection and key");
  assert.equal((await readCompact({ client: async () => client([]), disk })).generated, "from-disk", "an empty table falls back to the file");
  assert.equal((await readCompact({ client: async () => null, disk })).generated, "from-disk", "no session falls back to the file");
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await readCompact({ client: async () => client(null, "paused project"), disk })).generated, "from-disk", "a failed read falls back too");
  } finally {
    console.error = quiet;
  }
  await assert.rejects(readCompactFromStore(client([{ body: { version: 0 } }]) as never), /npm run college-health/, "a malformed document is refused, not shown as empty");
});
