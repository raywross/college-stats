/**
 * The college-reported-data pilot set and answer key: data/reference/college-reported-pilot.json and
 * data/reference/college-reported-answer-key.json. `npm test`. See specs/college-reported-data.md#pilot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { School } from "../lib/types";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const byId = new Map(schools.map((s) => [s.unit_id, s]));

interface PilotCollege {
  unit_id: string;
  name: string;
  tier: "very-selective" | "selective" | "less-selective" | "open-admission";
  sector: string;
}
interface PilotFile {
  chosen: string;
  colleges: PilotCollege[];
}

interface AnswerKeyEntry {
  unit_id: string;
  entering_term: string | null;
  applicants: number | null;
  admitted: number | null;
  enrolled: number | null;
  acceptance_rate: number | null;
  url: string;
  quote: string | null;
  checked: string;
  kind: "class-profile" | "cds";
  none_found?: boolean;
  notes?: string;
}

const pilot: PilotFile = JSON.parse(readFileSync(join(ROOT, "data", "reference", "college-reported-pilot.json"), "utf8"));
const answerKey: AnswerKeyEntry[] = JSON.parse(
  readFileSync(join(ROOT, "data", "reference", "college-reported-answer-key.json"), "utf8"),
);

/** Tier bands by federal acceptance rate, as described in the task that built this pilot. */
function expectedTier(rate: number | null): PilotCollege["tier"] {
  if (rate === null) return "open-admission";
  if (rate < 0.15) return "very-selective";
  if (rate <= 0.5) return "selective";
  if (rate <= 0.85) return "less-selective";
  return "open-admission";
}

/** Tolerant number match: strips thousands separators and whitespace differences before comparing. */
function quoteContainsNumber(quote: string, n: number): boolean {
  const plain = String(n);
  const withCommas = n.toLocaleString("en-US");
  const normalizedQuote = quote.replace(/[ \s]+/g, " ");
  return normalizedQuote.includes(plain) || normalizedQuote.includes(withCommas);
}

test("the pilot has exactly 50 colleges, each unique", () => {
  assert.equal(pilot.colleges.length, 50);
  assert.equal(new Set(pilot.colleges.map((c) => c.unit_id)).size, 50);
});

test("every pilot unit_id exists in data/schools.json with a matching name", () => {
  for (const c of pilot.colleges) {
    const school = byId.get(c.unit_id);
    assert.ok(school, `${c.unit_id} (${c.name}) is not in data/schools.json`);
    assert.equal(school!.name, c.name, `${c.unit_id}: pilot name "${c.name}" does not match dataset name "${school!.name}"`);
  }
});

test("every pilot tier matches the school's federal acceptance rate band", () => {
  for (const c of pilot.colleges) {
    const school = byId.get(c.unit_id)!;
    const rate = school.admissions.acceptance_rate;
    assert.equal(
      c.tier,
      expectedTier(rate),
      `${c.unit_id} (${c.name}): rate ${rate} should be tier "${expectedTier(rate)}", pilot says "${c.tier}"`,
    );
  }
});

test("every pilot sector matches the school's recorded type", () => {
  for (const c of pilot.colleges) {
    const school = byId.get(c.unit_id)!;
    assert.equal(c.sector, school.type, `${c.unit_id} (${c.name}): sector mismatch`);
  }
});

test("the pilot mixes tiers and sectors roughly as planned", () => {
  const tierCounts: Record<string, number> = {};
  const sectorCounts: Record<string, number> = {};
  for (const c of pilot.colleges) {
    tierCounts[c.tier] = (tierCounts[c.tier] ?? 0) + 1;
    sectorCounts[c.sector] = (sectorCounts[c.sector] ?? 0) + 1;
  }
  assert.equal(tierCounts["very-selective"], 15);
  assert.equal(tierCounts["selective"], 15);
  assert.equal(tierCounts["less-selective"], 12);
  assert.equal(tierCounts["open-admission"], 8);
  assert.ok(Object.keys(sectorCounts).length >= 2, "the pilot should mix public and private sectors");
});

test("the pilot includes Princeton, Columbia, and USC (named in the spec) and all 8 CDS-override colleges", () => {
  const ids = new Set(pilot.colleges.map((c) => c.unit_id));
  for (const id of ["186131" /* Princeton */, "190150" /* Columbia */, "123961" /* USC */]) {
    assert.ok(ids.has(id), `pilot is missing ${id}`);
  }
  const overrides = JSON.parse(readFileSync(join(ROOT, "data", "overrides.json"), "utf8"));
  const overrideIds = Object.keys(overrides).filter((k) => !k.startsWith("_"));
  assert.equal(overrideIds.length, 8, "expected 8 CDS-override colleges in data/overrides.json");
  for (const id of overrideIds) {
    assert.ok(ids.has(id), `pilot is missing CDS-override college ${id}`);
  }
});

test("the answer key's unit_ids are a subset of the pilot set, each appearing once", () => {
  const pilotIds = new Set(pilot.colleges.map((c) => c.unit_id));
  const seen = new Set<string>();
  for (const e of answerKey) {
    assert.ok(pilotIds.has(e.unit_id), `answer-key unit_id ${e.unit_id} is not in the pilot set`);
    assert.ok(!seen.has(e.unit_id), `answer-key unit_id ${e.unit_id} appears more than once`);
    seen.add(e.unit_id);
  }
});

test("the answer key covers at least 20 colleges", () => {
  assert.ok(answerKey.length >= 20, `expected at least 20 answer-key entries, got ${answerKey.length}`);
});

test("every answer-key entry has a url and a checked date", () => {
  for (const e of answerKey) {
    assert.ok(e.url && e.url.startsWith("http"), `${e.unit_id} is missing a url`);
    assert.ok(e.checked, `${e.unit_id} is missing a checked date`);
    assert.ok(e.kind === "class-profile" || e.kind === "cds", `${e.unit_id} has an invalid kind: ${e.kind}`);
  }
});

test("none_found entries carry no figures (that's the point: nothing newer was found)", () => {
  for (const e of answerKey.filter((e) => e.none_found)) {
    assert.equal(e.applicants, null);
    assert.equal(e.admitted, null);
    assert.equal(e.enrolled, null);
    assert.equal(e.acceptance_rate, null);
  }
});

test("every numeric field in a found entry has a quote containing that number", () => {
  for (const e of answerKey.filter((e) => !e.none_found)) {
    assert.ok(e.quote && e.quote.length > 0, `${e.unit_id}: entries with numbers need a quote`);
    for (const [field, value] of [
      ["applicants", e.applicants],
      ["admitted", e.admitted],
      ["enrolled", e.enrolled],
    ] as const) {
      if (value === null) continue;
      assert.ok(
        quoteContainsNumber(e.quote!, value),
        `${e.unit_id}: quote does not contain ${field}=${value}\nquote: ${e.quote}`,
      );
    }
    // acceptance_rate is checked as a percentage (e.g. 0.042 -> "4.2") since that's how colleges state it.
    if (e.acceptance_rate !== null) {
      const asPercent = e.acceptance_rate * 100;
      const rounded1 = Math.round(asPercent * 10) / 10;
      const rounded2 = Math.round(asPercent * 100) / 100;
      const normalizedQuote = e.quote!.replace(/[ \s]+/g, " ");
      const found =
        normalizedQuote.includes(String(rounded1)) ||
        normalizedQuote.includes(String(rounded2)) ||
        normalizedQuote.includes(String(Math.round(asPercent)));
      assert.ok(found, `${e.unit_id}: quote does not contain acceptance_rate ${e.acceptance_rate} (~${asPercent}%)\nquote: ${e.quote}`);
    }
  }
});

test("funnel order holds: admitted <= applicants, enrolled <= admitted", () => {
  for (const e of answerKey) {
    if (e.applicants !== null && e.admitted !== null) {
      assert.ok(e.admitted <= e.applicants, `${e.unit_id}: admitted (${e.admitted}) > applicants (${e.applicants})`);
    }
    if (e.admitted !== null && e.enrolled !== null) {
      assert.ok(e.enrolled <= e.admitted, `${e.unit_id}: enrolled (${e.enrolled}) > admitted (${e.admitted})`);
    }
  }
});

test("acceptance_rate is within 0.1 pt of admitted / applicants when both are given", () => {
  for (const e of answerKey) {
    if (e.applicants === null || e.admitted === null || e.acceptance_rate === null) continue;
    const computed = e.admitted / e.applicants;
    const diffPts = Math.abs(computed - e.acceptance_rate) * 100;
    assert.ok(
      diffPts <= 0.1,
      `${e.unit_id}: stated rate ${e.acceptance_rate} vs admitted/applicants ${computed.toFixed(4)} differ by ${diffPts.toFixed(3)} pts`,
    );
  }
});
