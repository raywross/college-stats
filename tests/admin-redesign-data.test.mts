/**
 * The admin redesign's Data door (specs/product/admin-redesign.md "Data", Unit 4): the pure modules
 * (lib/admin/selectivity-words.ts `tierSentence`, lib/admin/report-words.ts `reportLines`, lib/admin/reference-form.ts,
 * lib/admin/health-tabs.ts), the reference form's save through the existing path, the Health page's one code path and
 * its tabs' filters, the old Health addresses, and the pages' words (the high school's two lists with no function or
 * table names; the two undo actions linking each other). The typed words for Publish now and a systemic Approve are
 * tested beside their actions (tests/admin-data.test.mts, tests/admin-steward.test.mts). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as nodeModule from "node:module";
import type { SelectivityInputRow, SelectivityPanel, SelectivityPoolView } from "../lib/admin/hidden.ts";

// lib/admin/hidden.ts starts with `import "server-only"`, which only Next.js resolves.
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

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const words = await import("../lib/admin/selectivity-words.ts");
const report = await import("../lib/admin/report-words.ts");
type ReportLine = import("../lib/admin/report-words.ts").ReportLine;
const form = await import("../lib/admin/reference-form.ts");
const tabs = await import("../lib/admin/health-tabs.ts");
const { resolveAdminRedirect } = await import("../lib/admin/redirects.ts");
const { isHelpKey } = await import("../lib/admin/help.ts");
const { CONFIRM_APPROVE, CONFIRM_PUBLISH } = await import("../lib/admin/console.ts");

/* ------------------------------------------------------------------ */
/* tierSentence                                                        */
/* ------------------------------------------------------------------ */

function inputRow(over: Partial<SelectivityInputRow> & Pick<SelectivityInputRow, "input" | "label" | "display">): SelectivityInputRow {
  return { field: "admissions.acceptance_rate", raw: 0, present: true, filled: "reported", reading: 1, percentile: 90, weight: 1, share: 0.2, contribution: 0.2, ...over };
}

function pool(over: Partial<SelectivityPoolView> = {}): SelectivityPoolView {
  return {
    pool: "all",
    label: "All applicants",
    rows: [
      inputRow({ input: "admit_rate", label: "Admit rate", display: "4%", contribution: 0.9 }),
      inputRow({ input: "class_strength", label: "SAT, 75th percentile", display: "1570", contribution: 0.6 }),
      inputRow({ input: "yield", label: "Yield", display: "83%", contribution: 0.5 }),
      inputRow({ input: "retention", label: "Retention", display: "98%", contribution: 0.1 }),
      inputRow({ input: "graduation", label: "Graduation rate", display: "97%", contribution: 0.05 }),
    ],
    weightedMean: 2.15,
    evidence: { admitted: 2000, factor: 0.98 },
    unclamped: 99,
    exact: 99,
    score: 99,
    plainTier: "elite",
    publishedTier: "elite",
    hysteresis: { held: false, consistent: true, upAt: null, downAt: 80, sentence: "…" },
    ...over,
  };
}

const panel = (pools: SelectivityPoolView[], status: SelectivityPanel["status"] = "rated"): Pick<SelectivityPanel, "status" | "pools"> => ({ status, pools });

test("tierSentence: the tier, then the three reported inputs that weigh most, in the method's order", () => {
  assert.equal(words.tierSentence(panel([pool()])), "Ultra selective: admit rate 4%, SAT, 75th percentile 1570, yield 83%.");
  // Retention outweighs yield here, so it is named instead, still in the method's order.
  const p = pool();
  p.rows[3] = { ...p.rows[3], contribution: 0.7 };
  assert.equal(words.tierSentence(panel([p])), "Ultra selective: admit rate 4%, SAT, 75th percentile 1570, retention 98%.");
  // The admit rate is always named, even when it weighs least.
  const q = pool();
  q.rows[0] = { ...q.rows[0], contribution: 0.01 };
  assert.equal(words.tierSentence(panel([q])), "Ultra selective: admit rate 4%, SAT, 75th percentile 1570, yield 83%.");
});

test("tierSentence: a filled input (read as the middle, or from the fit) is never named as a reason", () => {
  const p = pool();
  p.rows[1] = { ...p.rows[1], present: false, filled: "fit", display: "Not reported", contribution: 0.95 };
  assert.equal(words.tierSentence(panel([p])), "Ultra selective: admit rate 4%, yield 83%, retention 98%.");
  assert.deepEqual(words.reasonInputs({ rows: p.rows.map((r) => ({ ...r, present: false })) }), []);
});

test("tierSentence: a tier the band kept, a small admitted class, and a pool in another tier each add a clause", () => {
  const held = pool({ plainTier: "highly_selective", publishedTier: "elite" });
  assert.match(words.tierSentence(panel([held])), /^Ultra selective: .*; kept from the last publish; the score alone reads Highly selective\.$/);
  const thin = pool({ evidence: { admitted: 120, factor: 0.5 } });
  assert.match(words.tierSentence(panel([thin])), /; pulled toward the middle by a small admitted class\.$/);
  const inState = pool({ pool: "in_state", label: "In-state applicants", plainTier: "very_selective", publishedTier: "very_selective" });
  const outState = pool({ pool: "out_of_state", label: "Out-of-state applicants" });
  assert.match(words.tierSentence(panel([pool(), inState, outState])), /; in-state applicants: Very selective\.$/, "only the pool in another tier is named");
  // No stored tier: the plain cutoffs' tier leads.
  assert.match(words.tierSentence(panel([pool({ publishedTier: null, plainTier: "selective" })])), /^Selective: /);
});

test("tierSentence: not rated reads its reason in words", () => {
  assert.match(words.tierSentence(panel([], "no_admit_rate")), /^Not rated: the college publishes no admit rate\.$/);
  assert.match(words.tierSentence(panel([], "inconsistent")), /^Not rated: the college reports more first-years enrolled than undergraduates/);
});

test("tierSentence over the mini fixture's real panels: every rated college leads with its stored tier's words and names its admit rate", async () => {
  const hidden = await import("../lib/admin/hidden.ts");
  const { SELECTIVITY_TIER_LABELS } = await import("../lib/chances/levels.ts");
  const { miniSchools } = await import("./helpers/snapshot.mts");
  const schools = miniSchools();
  const ctx = hidden.selectivityContext(schools);
  let rated = 0;
  for (const s of schools) {
    const p = hidden.selectivityPanel(s, ctx);
    const sentence = words.tierSentence(p);
    assert.ok(sentence.endsWith("."), sentence);
    assert.doesNotMatch(sentence, /undefined|NaN|null/, sentence);
    if (p.status !== "rated") continue;
    rated++;
    const tier = p.pools[0].publishedTier ?? p.pools[0].plainTier;
    assert.ok(sentence.startsWith(`${SELECTIVITY_TIER_LABELS[tier]}: `), `${s.name}: ${sentence}`);
    assert.match(sentence, /admit rate \d/, `${s.name}: the admit rate always weighs in`);
  }
  assert.ok(rated > 0, "the fixture has rated colleges");
});

test("the college page leads its Selectivity panel with tierSentence, puts the table and formula under Details, and explains each statistical word", () => {
  const src = read("app/admin/data/colleges/[unit]/page.tsx");
  const block = src.slice(src.indexOf("function SelectivityBlock"), src.indexOf("/* GPA"));
  assert.ok(block.indexOf("{tierSentence(panel)}") < block.indexOf("<details"), "the sentence comes first");
  assert.ok(block.indexOf("<summary") < block.indexOf("<PoolBlock") && block.indexOf("<summary") < block.indexOf("Weights:"), "the pools and the formula are under Details");
  assert.match(block, />Details<\/summary>/);
  for (const key of ["selectivity-pool", "percentile", "reading", "evidence", "hysteresis"]) assert.match(block, new RegExp(`<HelpTip help="${key}"`), key);
});

/* ------------------------------------------------------------------ */
/* reportLines                                                         */
/* ------------------------------------------------------------------ */

const COLLEGE_REPORTED = `Run \`2026-11-01-a\` of the college-reported ingestion agent (specs/college-reported-data.md).

> **Stopped early** after 40 of 120 colleges: the budget ran out. Everything below covers the colleges it finished.

## Summary

| | |
|---|---|
| Colleges attempted | 40 |
| Documents read | 38 |
| Failed a check (sent to review) | 3 |
| Cost | $4.20 |

## Circuit breaker

Not tripped. Failure and change shares were within the limits in \`CIRCUIT_BREAKER\` (lib/reported.ts).

## Review queue

3 items failed a check and did **not** publish.

| College | Term | Failed checks | URL |
|---|---|---|---|
| Alpha College (100001) | Fall 2025 | sums-to-100 (SAT bands sum to 97%) | https://a.example/cds.pdf |
| Beta University (100002) | Fall 2025 | admit-rate-range (0.0) | https://b.example/cds.pdf |
| Gamma Institute (100003) | Fall 2025 | yield-range (1.4) | https://c.example/cds.pdf |

---

This run's change set writes \`reported.entries\`.
`;

test("reportLines: headings, a two-column table as counts, a stop and the circuit breaker as checks, a wider table as rows, sentences as notes", () => {
  const lines = report.reportLines(COLLEGE_REPORTED);
  assert.deepEqual(
    lines.filter((l) => l.kind === "heading").map((l) => (l as { text: string }).text),
    ["Summary", "Circuit breaker", "Review queue"],
  );
  assert.deepEqual(
    lines.filter((l) => l.kind === "count"),
    [
      { kind: "count", label: "Colleges attempted", value: "40" },
      { kind: "count", label: "Documents read", value: "38" },
      { kind: "count", label: "Failed a check (sent to review)", value: "3" },
      { kind: "count", label: "Cost", value: "$4.20" },
    ],
  );
  const checks = lines.filter((l) => l.kind === "check") as Extract<ReportLine, { kind: "check" }>[];
  assert.deepEqual(
    checks.map((c) => [c.label, c.ok]),
    [
      ["Stopped early", false],
      ["Circuit breaker", true],
    ],
  );
  assert.equal(checks[1].detail, "Not tripped.", "the first sentence only: no constant or file names");
  const rows = lines.filter((l) => l.kind === "row") as Extract<ReportLine, { kind: "row" }>[];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].facts.slice(0, 3), [
    { label: "College", value: "Alpha College (100001)" },
    { label: "Term", value: "Fall 2025" },
    { label: "Failed checks", value: "sums-to-100 (SAT bands sum to 97%)" },
  ]);
  assert.ok(lines.some((l) => l.kind === "note" && /did not publish/.test(l.text)), "bold marks are gone from a note");
  assert.ok(!lines.some((l) => (l.kind === "note" || l.kind === "heading") && /---|\|/.test(l.text)), "dividers and rules are dropped");
  assert.deepEqual(report.reportTally(lines), { counts: 4, checks: 2, failed: 1 });
});

test("reportLines: the essay run's labelled bullets are counts; a long table stops at maxRows with one 'more' line", () => {
  const essay = [
    "Essay prompts run 2026-11-02 for the 2026-27 cycle (specs/product/essays/prompts.md).",
    "",
    "- Colleges: 300; passed 280, held 12, unchanged 5, not found 2, failed 1",
    "- Spent $3.10 of the $10.00 budget",
    "",
    "### Held",
    "",
    "| College | Unit | Why |",
    "| --- | --- | --- |",
    ...Array.from({ length: 25 }, (_, i) => `| College ${i} | 1000${i} | no limit \\| no prompt |`),
  ].join("\n");
  const lines = report.reportLines(essay, { maxRows: 5 });
  assert.deepEqual(lines.slice(1, 3), [
    { kind: "count", label: "Colleges", value: "300; passed 280, held 12, unchanged 5, not found 2, failed 1" },
    { kind: "note", text: "Spent $3.10 of the $10.00 budget" },
  ]);
  assert.equal(lines.filter((l) => l.kind === "row").length, 5);
  assert.deepEqual(lines.at(-1), { kind: "more", count: 20 });
  const first = lines.find((l) => l.kind === "row") as Extract<ReportLine, { kind: "row" }>;
  assert.equal(first.facts[2].value, "no limit | no prompt", "an escaped pipe stays inside its cell");
});

test("reportLines: nothing for empty text; a tripped breaker and ticked boxes are checks; a check heading judges its lines", () => {
  assert.deepEqual(report.reportLines(null), []);
  assert.deepEqual(report.reportLines("   \n"), []);
  const lines = report.reportLines(["**Tripped:** more than half the reads failed.", "- [x] Lineage", "- [ ] Sums", "## Checks", "- Lineage: passed", "- Sums: failed on 3 colleges"].join("\n"));
  const checks = lines.filter((l) => l.kind === "check").map((l) => [(l as { label: string }).label, (l as { ok: boolean | null }).ok]);
  assert.deepEqual(checks, [
    ["Circuit breaker", false],
    ["Lineage", true],
    ["Sums", false],
    ["Lineage", true],
    ["Sums", false],
  ]);
  assert.equal(report.plainText("**Bold** `code` [link](https://x) _it_"), "Bold code link it");
});

test("the change page renders the report through ChangeReport (the list, then the raw text under Details), and the two undo actions link each other", () => {
  const page = read("app/admin/data/changes/[id]/page.tsx");
  assert.match(page, /<ChangeReport text=\{report\} \/>/);
  assert.doesNotMatch(page, /<pre /, "no raw report on the page itself");
  const component = read("components/admin/ChangeReport.tsx");
  assert.ok(component.indexOf("<ReportList") < component.indexOf(">Details</summary>"), "the list first, the raw text under Details");
  assert.match(component, /word: "Passed"[\s\S]*word: "Failed"/, "a check's outcome is a word, not only a color");
  // "Undo this change" → Published versions; "Make this the live version" → Changes.
  assert.match(page, /To undo a whole publish rather than this one change,[\s\S]{0,300}href="\/admin\/data\/versions"/);
  assert.match(read("app/admin/data/versions/page.tsx"), /To undo one change rather than a whole publish,[\s\S]{0,300}href="\/admin\/data\/changes"[\s\S]{0,300}Undo this change/);
});

/* ------------------------------------------------------------------ */
/* The reference form                                                  */
/* ------------------------------------------------------------------ */

const STATE_LAWS = {
  reviewed: "2026-10-04",
  laws: [{ state: "AL", applies_to: "public", name: "Alabama SB 129" }],
};

test("referenceFields: one field per top-level key, typed by its value; hasForm only for the form documents with an object body", () => {
  const fields = form.referenceFields({ description: "x".repeat(120), cycle: 2027, checked: "2026-10-11", strict: true, programs: [{ id: "a" }] });
  assert.deepEqual(
    fields.map((f) => [f.key, f.label, f.type]),
    [
      ["description", "Description", "text"],
      ["cycle", "Cycle", "number"],
      ["checked", "Checked", "line"],
      ["strict", "Strict", "boolean"],
      ["programs", "Programs", "json"],
    ],
  );
  assert.equal(fields[4].value, JSON.stringify([{ id: "a" }], null, 2));
  assert.deepEqual([...form.FORM_REFERENCES], ["aid-policies", "state-laws", "guaranteed-admission", "calendar"]);
  assert.equal(form.hasForm("state-laws", STATE_LAWS), true);
  assert.equal(form.hasForm("calendar", { reviewed: "2026-09-28", releases: [] }), true, "the release calendar, the one the owner edits most");
  assert.equal(form.hasForm("state-laws", [STATE_LAWS]), false, "an array body keeps the textarea");
  assert.equal(form.hasForm("state-laws", {}), false);
  assert.equal(form.hasForm("organizations", { updated: "x" }), false, "not a form document");
  assert.equal(form.keyLabel("free_tuition_under"), "Free tuition under");
});

const formOf = (fields: Record<string, string>) => ({ get: (name: string) => (name in fields ? fields[name] : null) });

test("formToBody puts the document together in the keys' order; a bad number, yes/no, or JSON refuses with the field's words", () => {
  const fields = form.referenceFields({ reviewed: "2026-10-04", count: 3, on: false, laws: [{ state: "AL" }] });
  const base = { fields: form.fieldList(fields), "field:reviewed": " 2026-11-01 ", "field:count": "4", "field:on": "true", "field:laws": '[{"state":"AK"}]' };
  const ok = form.formToBody(formOf(base));
  assert.ok(ok.ok);
  assert.deepEqual(ok.body, { reviewed: "2026-11-01", count: 4, on: true, laws: [{ state: "AK" }] });
  assert.deepEqual(Object.keys(ok.body), ["reviewed", "count", "on", "laws"]);
  assert.equal(ok.bodyText, JSON.stringify(ok.body, null, 2));
  assert.deepEqual(form.formToBody(formOf({ ...base, "field:count": "four" })), { ok: false, problem: "Count: enter a number." });
  assert.deepEqual(form.formToBody(formOf({ ...base, "field:count": "" })), { ok: false, problem: "Count: enter a number." });
  assert.deepEqual(form.formToBody(formOf({ ...base, "field:on": "maybe" })), { ok: false, problem: "On: choose yes or no." });
  assert.deepEqual(form.formToBody(formOf({ ...base, "field:laws": "[{" })), { ok: false, problem: "Laws: not valid JSON." });
  for (const bad of [undefined, "", "not json", "[]", '[["a","nope"]]', '[["a","line"],["a","line"]]', '{"a":"line"}']) {
    const r = form.formToBody(formOf(bad === undefined ? {} : { fields: bad }));
    assert.equal(r.ok, false, String(bad));
  }
});

test("problemsByField: the validators' real messages land beside the key they name; the rest stay above the form", async () => {
  const { validateReference } = await import("../lib/reference-validators.ts");
  const today = new Date("2026-10-31T12:00:00Z");
  // state-laws: a bad "reviewed" date, an entry's problem, and the sort order.
  const laws = { reviewed: "Oct 4", laws: [{ state: "TX", applies_to: "public" }, { state: "AL", applies_to: "public" }] };
  const lawProblems = validateReference("state-laws", laws, undefined, today);
  const placedLaws = form.problemsByField(lawProblems, form.referenceFields(laws));
  assert.ok(placedLaws.byKey.reviewed?.some((p) => /"reviewed" must be YYYY-MM-DD/.test(p)), JSON.stringify(placedLaws));
  assert.ok((placedLaws.byKey.laws?.length ?? 0) > 1, "each entry's problems go to the laws field");
  assert.ok(placedLaws.byKey.laws?.some((p) => /keep laws sorted/.test(p)), "the sort-order message names the laws");
  assert.deepEqual(placedLaws.rest, []);
  // guaranteed-admission: the cycle and checked keys after the document's name, and an entry's problem.
  const programs = { description: "d", cycle: 2020, checked: "soon", programs: [{ id: "Bad Id" }] };
  const g = form.problemsByField(validateReference("guaranteed-admission", programs, undefined, today), form.referenceFields(programs));
  assert.ok(g.byKey.cycle?.length === 1 && /cycle 2020 must be/.test(g.byKey.cycle[0]), JSON.stringify(g));
  assert.ok(g.byKey.checked?.length === 1);
  assert.ok((g.byKey.programs?.length ?? 0) > 0);
  // aid-policies: an entry's problem goes to policies; a message that names no key stays above.
  const placed = form.problemsByField(["aid-policies[0] 1: unit_id isn't a college in the dataset", "Something about the whole file."], form.referenceFields({ description: "d", policies: [] }));
  assert.deepEqual(placed, { byKey: { policies: ["aid-policies[0] 1: unit_id isn't a college in the dataset"] }, rest: ["Something about the whole file."] });
});

test("saveReference with the form: the same validator and the same rpc as the textarea; a refusal carries the messages one by one", async () => {
  const actions = await import("../lib/admin/reference-actions.ts");
  const calls: { p_name: string; p_body: string; p_note: string | null }[] = [];
  const deps = {
    async rpc(args: { p_name: string; p_body: string; p_note: string | null }) {
      calls.push(args);
      return { ok: true as const, data: 1 };
    },
    async readVersion() {
      return null;
    },
    async knownUnitIds() {
      return undefined;
    },
  };
  const { miniReference } = await import("./helpers/snapshot.mts");
  const doc = miniReference("state-laws") as Record<string, unknown>;
  const fields = form.referenceFields(doc);
  const values = Object.fromEntries(fields.map((f) => [form.fieldName(f.key), f.value]));
  const sound = await actions.saveReference(deps, formOf({ name: "state-laws", kind: "form", fields: form.fieldList(fields), ...values, note: "a form edit" }));
  assert.deepEqual(sound, { status: "done", message: "Saved." });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].p_body), doc, "the form's document is the stored one, key for key");
  assert.equal(calls[0].p_note, "a form edit");

  const refused = await actions.saveReference(deps, formOf({ name: "state-laws", kind: "form", fields: form.fieldList(fields), ...values, [form.fieldName("reviewed")]: "yesterday" }));
  assert.equal(refused.status, "error");
  assert.ok(refused.status === "error" && refused.problems?.some((p) => /"reviewed" must be YYYY-MM-DD/.test(p)), JSON.stringify(refused));
  const garbled = await actions.saveReference(deps, formOf({ name: "state-laws", kind: "form", fields: "nope" }));
  assert.equal(garbled.status, "error");
  assert.equal(calls.length, 1, "neither refusal reached the database");
});

test("the reference page gives the form documents their fields; the editor keeps Edit as text and posts kind=form with the field list", () => {
  const page = read("app/admin/data/reference/[name]/page.tsx");
  assert.match(page, /hasForm\(name, doc\.body\) \? referenceFields\(/);
  assert.match(page, /fields=\{fields\}/);
  const editor = read("components/admin/ReferenceEditor.tsx");
  assert.match(editor, /"Edit as text"/);
  assert.match(editor, /name="kind" value=\{formFields \? "form" : kind\}/);
  assert.match(editor, /name="fields" value=\{fieldList\(formFields\)\}/);
  assert.match(editor, /problemsByField\(shown, formFields\)/);
  const valueImports = editor.split("\n").filter((l) => /^import /.test(l) && !/^import type /.test(l));
  assert.deepEqual(valueImports.filter((l) => /reference-validators|reference-view|reference-actions/.test(l)), [], "the client editor imports the validators' modules by type only");
});

/* ------------------------------------------------------------------ */
/* Health: one page, two tabs                                          */
/* ------------------------------------------------------------------ */

test("healthTab and healthTabHref: each tab's link keeps the filters both tabs read and drops the ones only one has", () => {
  assert.equal(tabs.healthTab({}), "colleges");
  assert.equal(tabs.healthTab({ tab: "sources" }), "sources");
  assert.equal(tabs.healthTab({ tab: "files" }), "colleges");
  const fromColleges = { status: "stale", input: "gpa", state: "oh", tier: "1", family: "1", sort: "name", page: "3" };
  assert.equal(tabs.healthTabHref("sources", fromColleges), "/admin/data/health?tab=sources&status=stale&state=OH&tier=1&family=1&sort=name");
  assert.equal(tabs.healthTabHref("colleges", fromColleges), "/admin/data/health?status=stale&state=OH&tier=1&family=1&sort=name");
  const fromSources = new URLSearchParams("tab=sources&status=unjudged&group=reported&reason=fetch_failed&sort=queue&state=GA");
  assert.equal(tabs.healthTabHref("colleges", fromSources), "/admin/data/health?state=GA", "unjudged, group, reason, and the queue sort are the Sources tab's own");
  assert.equal(tabs.healthTabHref("sources", fromSources), "/admin/data/health?tab=sources&state=GA&sort=queue");
  assert.equal(tabs.healthTabHref("colleges", {}), "/admin/data/health");
  assert.equal(tabs.healthTabHref("colleges", { state: "Ohio", tier: "9", family: "yes" }), "/admin/data/health", "bad values are dropped");
});

test("the old Health addresses land on the right tab with their filters", () => {
  assert.equal(resolveAdminRedirect("/admin/health?status=stale&state=OH"), "/admin/data/health?status=stale&state=OH");
  assert.equal(resolveAdminRedirect("/admin/health/files?group=reported&state=OH"), "/admin/data/health?tab=sources&group=reported&state=OH");
  assert.equal(resolveAdminRedirect("/admin/health/files"), "/admin/data/health?tab=sources");
});

test("Health is one page with one code path: one header and tab bar, each tab a loader in the page; the tab bar's links carry the filters", () => {
  assert.equal(existsSync(join(ROOT, "app/admin/data/health/sources.tsx")), false);
  const page = read("app/admin/data/health/page.tsx");
  assert.equal(page.match(/<PageHeader /g)?.length, 1, "one header for both tabs");
  assert.equal(page.match(/<HealthTabs /g)?.length, 1, "one tab bar");
  assert.match(page, /colleges: healthTabHref\("colleges", params\), sources: healthTabHref\("sources", params\)/);
  assert.match(page, /tab === "sources" \? await sourcesTab\(params\) : await collegesTab\(params\)/);
  assert.match(read("components/admin/ops/HealthTabs.tsx"), /href=\{hrefs\[t\.key\]\}/);
});

/* ------------------------------------------------------------------ */
/* The high school page                                                */
/* ------------------------------------------------------------------ */

test("the high school page: two lists with the threshold as a sentence, and no function or table names on screen", () => {
  const src = read("app/admin/data/high-schools/[id]/page.tsx");
  const body = src.slice(src.indexOf("export default async function"));
  assert.match(body, /title="Courses the plan lists"/);
  assert.match(body, /title="Below the line"/);
  assert.match(body, /The course plan suggests a course once \$\{min\} or more students list it/);
  assert.doesNotMatch(body.replace(/\/\*\*[\s\S]*?\*\//g, ""), /school_course_\w+|\(\)\s*,|<table/, "no function or table names, no table outside comments");
  assert.doesNotMatch(body, /font-mono[^"]*">\s*\{r\.key\}/, "the course key isn't shown beside its name");
});

/* ------------------------------------------------------------------ */
/* Typed words and help                                                */
/* ------------------------------------------------------------------ */

test("the typed words live beside the others in lib/admin/console.ts", () => {
  assert.equal(CONFIRM_PUBLISH, "publish");
  assert.equal(CONFIRM_APPROVE, "approve");
  assert.match(read("lib/admin/steward-actions.ts"), /export \{ CONFIRM_APPROVE \};/, "the Steward's actions use console.ts's word");
});

test("the Data words this unit explains are in the glossary, under Data", async () => {
  const { helpEntry } = await import("../lib/admin/help.ts");
  for (const key of ["selectivity-tier", "hysteresis", "top-band", "selectivity-movers", "tier-counts", "method-log", "change-report", "change-actions", "documents-touched", "reference-versions", "reference-form", "course-counts", "course-offering", "health-sources"]) {
    assert.ok(isHelpKey(key), key);
    assert.equal(helpEntry(key as Parameters<typeof helpEntry>[0]).door, "data", key);
  }
});
