/**
 * Change detection (lib/changes.ts; specs/product/follow-colleges.md#detecting-changes): every change kind, tolerances
 * (float noise that must not count, a null that must), the derived-field rule, years from lineage, release names, the
 * sentences, the profile panel's grouping, and publish-data's change helpers. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { Release } from "../lib/releases";
import type { ResidencyPrices } from "../lib/types";
import { FIELDS, NOTIFY_FIELDS, type FieldPath } from "../lib/fields.ts";
import { describeChange, diffSchools, formatChangeValue, periodLabel, periodStart, recentPublishes, type DatasetChange, type StoredChange } from "../lib/changes.ts";
import { changeSummary, changeTablesState, computeChanges, formatChangeList, stageChanges } from "../scripts/lib/publish-changes.mts";

const ROOT = join(import.meta.dirname, "..");
const SCHOOLS = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const META = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;

type Full = School & {
  cost: NonNullable<School["cost"]> & { sticker: ResidencyPrices; tuition_fees: ResidencyPrices };
  outcomes: NonNullable<School["outcomes"]>;
};

/** A real college with default lineage for the fields these tests touch, with its funnel set to round numbers. */
function base(): Full {
  const s = structuredClone(SCHOOLS[0]) as Full;
  assert.equal(s.lineage?.["admissions.applicants"], undefined, "fixture: the first college should cite IPEDS by default");
  s.admissions.applicants = 1000;
  s.admissions.admitted = 98;
  s.admissions.acceptance_rate = 0.098;
  return s;
}
const metaWith = (vintages: Partial<DatasetMeta["vintages"]>, retrieved = META.retrieved): DatasetMeta => ({ ...META, retrieved, vintages: { ...META.vintages, ...vintages } });
const PREV_META = metaWith({ "ipeds-adm": "Fall 2024" }, "2026-06-01");
const NEXT_META = metaWith({ "ipeds-adm": "Fall 2025" }, "2026-12-15");

function diff(prev: School, next: School, { prevMeta = PREV_META, nextMeta = PREV_META, fields = NOTIFY_FIELDS as readonly FieldPath[], releases = [] as Release[] } = {}) {
  return diffSchools({ schools: [prev], meta: prevMeta }, { schools: [next], meta: nextMeta }, fields, { calendar: { releases } });
}
const byField = (changes: DatasetChange[]) => Object.fromEntries(changes.map((c) => [c.field, c]));

test("new_year: a new release's figures, with both years from lineage and the spec's sentence", () => {
  const prev = base();
  const next = base();
  next.admissions.admitted = 91;
  next.admissions.acceptance_rate = 0.091;
  const changes = byField(diff(prev, next, { nextMeta: NEXT_META }));
  assert.deepEqual(Object.keys(changes).sort(), ["admissions.acceptance_rate", "admissions.admitted"]);
  const rate = changes["admissions.acceptance_rate"];
  assert.equal(rate.kind, "new_year");
  assert.equal(rate.old_year, "Fall 2024");
  assert.equal(rate.new_year, "Fall 2025");
  assert.equal(rate.source, META.sources["ipeds-adm"]!.label);
  assert.equal(describeChange(rate), "Fall 2025: 9.1% admitted (fall 2024: 9.8%)");
  assert.equal(describeChange(changes["admissions.admitted"]), "Fall 2025: 91 admits (fall 2024: 98)");
});

test("revised: same year, a different value beyond the tolerance", () => {
  const prev = base();
  const next = base();
  next.admissions.admitted = 96;
  next.admissions.acceptance_rate = 0.096;
  const rate = byField(diff(prev, next))["admissions.acceptance_rate"];
  assert.equal(rate.kind, "revised");
  assert.equal(rate.old_year, "Fall 2024");
  assert.equal(describeChange(rate), "Revised fall 2024 figure: 9.6% admitted (was 9.8%)");
});

test("float noise and sub-threshold moves don't count; the default thresholds are 0.1 points, $50, and 1", () => {
  const prev = base();
  const next = base();
  next.admissions.acceptance_rate = 0.098 + 1e-12;
  next.outcomes.graduation_rate = prev.outcomes.graduation_rate! + 0.0009;
  next.outcomes.median_earnings_10yr = prev.outcomes.median_earnings_10yr! + 49;
  next.demographics.undergrad_enrollment = prev.demographics.undergrad_enrollment + 0.4;
  next.admissions.sat_math_25_75 = [prev.admissions.sat_math_25_75![0] + 1e-9, prev.admissions.sat_math_25_75![1]];
  assert.deepEqual(diff(prev, next), []);
  // At the threshold, it counts.
  next.outcomes.median_earnings_10yr = prev.outcomes.median_earnings_10yr! + 50;
  assert.deepEqual(diff(prev, next).map((c) => c.field), ["outcomes.median_earnings_10yr"]);
});

test("a null that must count: appeared and disappeared", () => {
  const prev = base();
  const next = base();
  prev.outcomes.median_debt = null;
  next.outcomes.median_debt = 24250;
  next.outcomes.graduation_rate = null;
  const changes = byField(diff(prev, next));
  const appeared = changes["outcomes.median_debt"];
  assert.equal(appeared.kind, "appeared");
  assert.equal(appeared.old_value, null);
  assert.equal(appeared.old_year, null);
  assert.equal(describeChange(appeared), "Now reported: median debt at graduation $24,250 (most recent release)");
  const gone = changes["outcomes.graduation_rate"];
  assert.equal(gone.kind, "disappeared");
  assert.equal(gone.new_value, null);
  assert.equal(gone.release, null);
  assert.match(describeChange(gone), /^No longer reported: graduation rate \(was \d+%, most recent release\)$/);
});

test("updated: a source with no single year can't tell a new year from a revision", () => {
  const prev = base();
  const next = base();
  prev.outcomes.graduation_rate = 0.594;
  next.outcomes.graduation_rate = 0.61;
  const c = byField(diff(prev, next))["outcomes.graduation_rate"];
  assert.equal(c.kind, "updated");
  assert.equal(describeChange(c), "Most recent release: graduation rate 61% (was 59%)");
  // Shares that round to the same whole percent get a decimal, so the sentence never reads "98% (was 98%)".
  assert.equal(describeChange({ ...c, old_value: 0.976, new_value: 0.98 }), "Most recent release: graduation rate 98.0% (was 97.6%)");
});

test("derived fields are reported only when an input changed", () => {
  const prev = base();
  const next = base();
  // A formula fix moves the stored rate with no new counts: not news.
  next.admissions.acceptance_rate = 0.12;
  assert.deepEqual(diff(prev, next), []);
  // Sticker price (derived from tuition & fees and components) follows its inputs too, and compares only its listed keys.
  const s0 = base();
  const s1 = base();
  s1.cost.sticker = { ...s0.cost.sticker, in_state: s0.cost.sticker.in_state! + 500 };
  assert.deepEqual(diff(s0, s1), [], "sticker moved without its inputs");
  s1.cost.tuition_fees = { ...s0.cost.tuition_fees, in_state: s0.cost.tuition_fees.in_state! + 500 };
  assert.deepEqual(diff(s0, s1).map((c) => c.field), ["cost.sticker"]);
  const s2 = structuredClone(s1);
  s2.cost.sticker = { ...s0.cost.sticker, in_district: 1 };
  s2.cost.tuition_fees = s0.cost.tuition_fees;
  assert.deepEqual(diff(s0, s2), [], "in_district isn't one of the keys reported");
});

/** A college whose enrollment came from a hand-imported CDS override, cited to the edition "2024-25" (as Purdue's was). */
function withCdsEnrollment(s: Full, edition: string, value: number): Full {
  s.cds = { edition, url: "https://example.edu/CDS.xlsx" };
  s.demographics.undergrad_enrollment = value;
  s.lineage = { ...s.lineage, "demographics.undergrad_enrollment": { source: "cds", year: edition, url: "https://example.edu/CDS.xlsx", retrieved: "2026-09-27" } };
  return s;
}

test("Purdue's case: a CDS edition replaced by Scorecard for the same fall is a source change, not a new year, in one label style", () => {
  // Before: 44,819 from the college's CDS 2024-25 (which reports fall 2024). After: Scorecard's 44,503 for fall 2024.
  const prev = withCdsEnrollment(base(), "2024-25", 44819);
  const next = base();
  next.demographics.undergrad_enrollment = 44503;
  const meta = metaWith({ "scorecard-enrollment": "Fall 2024" });
  const [c] = diff(prev, next, { prevMeta: meta, nextMeta: meta });
  assert.equal(c.field, "demographics.undergrad_enrollment");
  assert.equal(c.kind, "updated", "the same fall from a different source is not a new year");
  assert.equal(c.old_year, "Fall 2024", "the CDS edition is written as the fall it reports");
  assert.equal(c.new_year, "Fall 2024");
  assert.equal(c.old_source, `${prev.name} Common Data Set`);
  assert.equal(
    describeChange(c),
    `Fall 2024: 44,503 undergraduates from ${META.sources.scorecard!.label} (was 44,819 from ${prev.name} Common Data Set)`,
  );
});

test("a newer fall is a new year whatever the old label style; an older one never is", () => {
  const meta = metaWith({ "scorecard-enrollment": "Fall 2025" });
  const prev = withCdsEnrollment(base(), "2024-25", 44819);
  const next = base();
  next.demographics.undergrad_enrollment = 45100;
  const [later] = diff(prev, next, { prevMeta: meta, nextMeta: meta });
  assert.equal(later.kind, "new_year");
  assert.equal(describeChange(later), "Fall 2025: 45,100 undergraduates (fall 2024: 44,819)");
  // Going back in time: CDS 2025-26 (fall 2025) replaced by Scorecard's fall 2024 figure.
  const newer = withCdsEnrollment(base(), "2025-26", 46000);
  const older = metaWith({ "scorecard-enrollment": "Fall 2024" });
  const [back] = diff(newer, next, { prevMeta: older, nextMeta: older });
  assert.equal(back.kind, "updated");
  assert.equal(describeChange(back), `Fall 2024: 45,100 undergraduates from ${META.sources.scorecard!.label} (was 46,000 from ${newer.name} Common Data Set, fall 2025)`);
  // The same CDS edition re-read: a revision, en-dashed if it stays an academic year.
  const same = withCdsEnrollment(base(), "2024-25", 44819);
  const reread = withCdsEnrollment(base(), "2024-25", 44700);
  const [rev] = diff(same, reread, { prevMeta: older, nextMeta: older });
  assert.equal(rev.kind, "revised");
  assert.equal(describeChange(rev), "Revised fall 2024 figure: 44,700 undergraduates (was 44,819)");
});

test("periodLabel and periodStart: one style, ordered by period", () => {
  assert.equal(periodLabel("cost.aided_net_price", { key: "cds", year: "2024-25" }, META), "2024–25");
  assert.equal(periodLabel("outcomes.retention_rate", { key: "cds", year: "2025-26" }, metaWith({ "scorecard-retention": "Entered fall 2023" })), "Entered fall 2024");
  assert.equal(periodLabel("admissions.applicants", { key: "ipeds-adm", year: "Fall 2024" }, META), "Fall 2024");
  assert.ok(periodStart("Fall 2025")! > periodStart("Fall 2024")!);
  assert.equal(periodStart("Entered fall 2024"), periodStart("Fall 2024"));
  assert.equal(periodStart("Fall 2027 applicants"), periodStart("Fall 2027"));
  assert.equal(periodStart("2024–25"), Date.UTC(2024, 6, 1));
  assert.equal(periodStart("most recent release"), null);
});

test("years come from lineage before and after, not from meta alone", () => {
  const prev = base();
  const next = base();
  // The college's own newer class replaces the federal count: same meta, but the value's lineage names Fall 2026.
  next.admissions.applicants = 1200;
  next.lineage = {
    ...next.lineage,
    "admissions.applicants": { source: "college-site", method: "extracted", year: "Fall 2026", url: "https://example.edu/profile", retrieved: "2026-10-01", quote: "1,200 applied" },
  };
  const c = byField(diff(prev, next))["admissions.applicants"];
  assert.equal(c.kind, "new_year");
  assert.equal(c.old_year, "Fall 2024");
  assert.equal(c.new_year, "Fall 2026");
  assert.match(c.source!, new RegExp(`^${prev.name}`));
  assert.equal(c.release, null, "a college's own document isn't a calendar release");
  assert.equal(describeChange(c), "Fall 2026: 1,200 applied (fall 2024: 1,000)");
});

test("the release that brought a change is named when one was published between the two datasets", () => {
  const prev = base();
  const next = base();
  next.admissions.applicants = 1100;
  const release = (id: string, published: string): Release => ({ id, source: "ipeds", label: `Release ${id}`, brings: [], updates: ["ipeds-adm"], expected: null, status: "published", published, basis: "" });
  const releases = [release("old", "2026-01-10"), release("winter", "2026-12-09"), release("later", "2027-01-05")];
  const [c] = diff(prev, next, { nextMeta: NEXT_META, releases });
  assert.equal(c.release, "Release winter");
  assert.equal(diff(prev, next, { nextMeta: NEXT_META, releases: [releases[0]] })[0].release, null);
});

test("a rename always counts; colleges in only one dataset are skipped", () => {
  const prev = base();
  const next = base();
  next.name = "Abilene Christian University (renamed)";
  const [c] = diff(prev, next);
  assert.equal(c.field, "name");
  assert.equal(describeChange(c), `Name changed: Abilene Christian University (renamed) (was ${prev.name})`);
  const other = { ...base(), unit_id: "999999" };
  assert.deepEqual(diffSchools({ schools: [prev], meta: PREV_META }, { schools: [other], meta: PREV_META }), []);
});

test("values are written the way the site writes them", () => {
  assert.equal(formatChangeValue("admissions.sat_math_25_75", [540, 650]), "540–650");
  assert.equal(formatChangeValue("cost.sticker", { in_district: 1, in_state: 59402, out_of_state: 59402 }), "$59,402");
  assert.equal(formatChangeValue("cost.sticker", { in_district: 1, in_state: 12000, out_of_state: 41000 }), "$12,000 in-state, $41,000 out-of-state");
  assert.equal(formatChangeValue("admissions.test_policy", "considered"), "Test-optional");
  assert.equal(formatChangeValue("academics.student_faculty_ratio", 13), "13 to 1");
});

test("NOTIFY_FIELDS: stored fields only, each with a unit, each present in the dataset", () => {
  assert.ok(NOTIFY_FIELDS.length >= 10 && NOTIFY_FIELDS.length <= 25, `keep the list judicious (${NOTIFY_FIELDS.length})`);
  assert.ok(NOTIFY_FIELDS.includes("name"));
  const valueAt = (s: School, p: string) => p.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), s);
  for (const p of NOTIFY_FIELDS) {
    const def = FIELDS[p] as (typeof FIELDS)[FieldPath];
    assert.ok(!("computed" in def), `${p} is computed at render time; only stored fields are diffed`);
    assert.ok(SCHOOLS.some((s) => valueAt(s, p) !== undefined && valueAt(s, p) !== null), `${p} is never stored (a typo?)`);
  }
});

test("recentPublishes: the last two publishes that touched a college, newest first; nothing after a year", () => {
  const c = (publish_id: number, published_at: string, field: FieldPath, release: string | null = null): StoredChange => ({
    publish_id, published_at, field, unit_id: "1", kind: "revised", old_value: 1, new_value: 2, old_year: "Fall 2024", new_year: "Fall 2024", source: "IPEDS", old_source: null, release,
  });
  const rows = [
    c(1, "2026-01-01T00:00:00Z", "admissions.applicants"),
    c(3, "2026-09-01T00:00:00Z", "outcomes.graduation_rate"),
    c(3, "2026-09-01T00:00:00Z", "admissions.acceptance_rate", "IPEDS winter release"),
    c(2, "2026-05-01T00:00:00Z", "name"),
  ];
  const groups = recentPublishes(rows, new Date("2026-10-05T00:00:00Z"));
  assert.deepEqual(groups.map((g) => g.publish_id), [3, 2]);
  assert.deepEqual(groups[0].changes.map((x) => x.field), ["admissions.acceptance_rate", "outcomes.graduation_rate"], "registry order");
  assert.deepEqual(groups[0].releases, ["IPEDS winter release"]);
  assert.deepEqual(recentPublishes(rows, new Date("2027-09-02T00:00:00Z")), []);
  assert.deepEqual(recentPublishes([], new Date()), []);
});

/* ------------------------------------------------------------------ */
/* publish-data's change step (scripts/lib/publish-changes.mts)        */
/* ------------------------------------------------------------------ */

test("publish-data: no changes on a first publish; the list prints college by college", () => {
  const prev = base();
  const next = base();
  next.admissions.applicants = 1100;
  assert.deepEqual(computeChanges(null, { schools: [next], meta: PREV_META }, { releases: [] }), []);
  const changes = computeChanges({ schools: [prev], meta: PREV_META }, { schools: [next], meta: NEXT_META }, { releases: [] });
  assert.equal(changeSummary(changes), "1 changes (new_year 1)");
  assert.equal(changeSummary([]), "no changes");
  const lines = formatChangeList(changes, [next]);
  assert.equal(lines[0], `${next.name} (${next.unit_id})`);
  assert.match(lines[1], /^ {2}· Fall 2025: 1,100 applied \(fall 2024: 1,000\) {3}\[new_year · /);
});

test("publish-data: a missing change table skips changes; other errors stop the publish", async () => {
  const fakeFrom = (error: { code?: string; message?: string } | null) => ({ from: () => ({ select: () => ({ limit: async () => ({ error }) }) }) }) as never;
  assert.equal(await changeTablesState(fakeFrom(null)), "ready");
  assert.equal(await changeTablesState(fakeFrom({ code: "PGRST205", message: "not in schema cache" })), "missing");
  assert.equal(await changeTablesState(fakeFrom({ code: "42P01", message: "does not exist" })), "missing");
  await assert.rejects(changeTablesState(fakeFrom({ message: "" })), /checking dataset_change_staging failed/);
});

test("publish-data: staging always resets on its first call, even with no changes, and batches the rest", async () => {
  const calls: { reset: boolean; n: number }[] = [];
  const client = { rpc: async (_fn: string, args: { p_changes: unknown[]; p_reset: boolean }) => (calls.push({ reset: args.p_reset, n: args.p_changes.length }), { error: null }) } as never;
  await stageChanges(client, []);
  assert.deepEqual(calls, [{ reset: true, n: 0 }]);
  calls.length = 0;
  const one = diff(base(), { ...base(), name: "x" })[0];
  await stageChanges(client, Array.from({ length: 5 }, () => one), 2);
  assert.deepEqual(calls, [{ reset: true, n: 2 }, { reset: false, n: 2 }, { reset: false, n: 1 }]);
});
