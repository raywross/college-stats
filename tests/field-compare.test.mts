/**
 * Compare "Your major" by broad field (lib/field-compare.ts): only fields a compared college awards are offered, and
 * one college's numbers for a field (graduates, share, programs, 10-year change, graduate-weighted earnings and debt).
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { School } from "../lib/types";
import type { ProgramEarnings } from "../lib/field-of-study";
import { familiesOffered, fieldStat } from "../lib/field-compare.ts";

const academics = (by: Record<string, number> | null, total: number | null) => ({ academics: { bachelors_awarded: total, bachelors_by_family: by } }) as unknown as Pick<School, "academics">;

const program = (title: string, graduates: number | null, y1: number | null, y4: number | null, y4_national: number | null, debt: number | null): ProgramEarnings => ({
  title,
  graduates,
  earnings: { y1, y4, y4_national, y4_pell: null, y4_non_pell: null },
  debt_median: debt,
});

test("the picker offers only fields at least one college awards", () => {
  const offered = familiesOffered([academics({ "11": 40, "52": 0 }, 100), academics({ "26": 10 }, 50), academics(null, null)]);
  assert.deepEqual(offered, ["11", "26"]);
});

test("a field's numbers: graduates, share, programs, change, and weighted earnings", () => {
  const s = fieldStat(
    "11",
    academics({ "11": 60, "52": 40 }, 100),
    { "11.0701": [50, 5], "11.0101": [10, 0], "52.0201": [40, 2] },
    {
      "11.07": program("Computer Science", 300, 100_000, 150_000, 100_000, 20_000),
      "11.01": program("Computer and Information Sciences, General", 100, 80_000, 110_000, 90_000, 30_000),
      "11.10": program("Network Administration", null, null, null, null, null),
      "52.02": program("Business", 200, 60_000, 80_000, 70_000, 25_000),
    },
    { major_11: { start: 2014, values: [0.2, null, null, null, null, null, null, null, null, null, 0.6] } },
    [2014, 2024],
    (cip) => ({ "11.0701": "Computer Science", "11.0101": "Computer and Information Sciences, General", "11.07": "Computer Science", "11.01": "Computer and Information Sciences, General" })[cip] ?? null,
    (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`,
  );
  assert.equal(s.graduates, 60);
  assert.equal(s.share, 0.6);
  assert.equal(s.secondMajors, 5);
  assert.equal(s.programCount, 2);
  assert.deepEqual(s.topPrograms.map((p) => p.title), ["Computer Science", "Computer and Information Sciences, General"]);
  assert.deepEqual(s.shareChange, { from: { year: 2014, label: "2014-15", share: 0.2 }, to: { year: 2024, label: "2024-25", share: 0.6 } });
  // Weighted by graduates (300 and 100); the suppressed program and the other field don't count.
  assert.equal(s.earnings.y4, 140_000);
  assert.equal(s.earnings.y1, 95_000);
  assert.equal(s.earnings.y4National, 97_500);
  assert.equal(s.earnings.debt, 22_500);
  assert.equal(s.earnings.programsWithData, 2);
  assert.equal(s.earnings.programsReported, 3);
  assert.deepEqual(s.topEarner, { title: "Computer Science", value: 150_000, years: 4 });
});

test("a field a college doesn't offer is 0, and unreported majors stay null (never 0)", () => {
  const none = fieldStat("51", academics({ "11": 60 }, 60), { "11.0701": [60, 0] }, {}, null, null, () => null);
  assert.equal(none.graduates, 0);
  assert.equal(none.programCount, 0);
  assert.equal(none.earnings.y4, null);
  assert.equal(none.topEarner, null);
  const unreported = fieldStat("51", academics(null, null), null, null, null, null, () => null);
  assert.equal(unreported.graduates, null);
  assert.equal(unreported.share, null);
  assert.equal(unreported.programCount, null);
});

test("committed data: Vanderbilt's computer science field has graduates and earnings", { skip: !existsSync("data/detail/schools/221999.json") }, () => {
  const schools = JSON.parse(readFileSync("data/schools.json", "utf8")) as { schools: School[] } | School[];
  const list = Array.isArray(schools) ? schools : schools.schools;
  const vu = list.find((s) => s.unit_id === "221999")!;
  const detail = JSON.parse(readFileSync("data/detail/schools/221999.json", "utf8"));
  const s = fieldStat("11", vu, detail.tables.majors?.rows, detail.tables.programs?.rows, null, null, () => null);
  assert.ok(s.graduates && s.graduates > 0);
  assert.ok(s.earnings.y4 && s.earnings.y4 > 100_000);
  assert.ok(familiesOffered([vu]).includes("11"));
});
