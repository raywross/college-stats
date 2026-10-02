/**
 * Finances (specs/data-expansion/finances.md): the DRVF reader, the never-mix-sectors rule, sector-scoped
 * benchmarking, and history. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import { INSTRUCTION_METRIC, endowmentMetricFor, endowmentOnForm, financesFrom, instructionOnForm, instructionSpending } from "../lib/finances.ts";
import type { SchoolHistory } from "../lib/history.ts";
import { FINANCE_BREAK } from "../lib/history.ts";

const ROOT = join(import.meta.dirname, "..");
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const byId = (id: string) => schools.find((s) => s.unit_id === id)!;

test("instruction spending of 0 is unreported, since a college that teaches can't spend nothing on it", () => {
  assert.equal(instructionSpending(0), null);
  assert.equal(instructionSpending(null), null);
  assert.equal(instructionSpending(undefined), null);
  assert.equal(instructionSpending(34184), 34184);
});

test("a DRVF row reports exactly one accounting form; the other forms' columns are ignored", () => {
  // Vanderbilt fiscal 2023-24 (DRVF2024): F2 (FASB, private nonprofit) only.
  const vandyRow = { F2TUFEPC: "20", F2INSTFT: "34184", F2ACSPFT: "16416", F2STSVFT: "19798", F2ENDMFT: "827497" };
  assert.deepEqual(financesFrom(vandyRow, 2023), {
    fiscal_year: 2023,
    form: "fasb",
    endowment_per_student: 827497,
    instruction_per_student: 34184,
    student_services_per_student: 19798,
    academic_support_per_student: 16416,
    tuition_share_of_revenue: 0.2,
  });
  // Michigan: F1 (GASB, public) only.
  const michiganRow = { F1TUFEPC: "24", F1INSTFT: "29014", F1ACSPFT: "11757", F1STSVFT: "3328", F1ENDMFT: "357260" };
  const michigan = financesFrom(michiganRow, 2023)!;
  assert.equal(michigan.form, "gasb");
  assert.equal(michigan.endowment_per_student, 357260);
  // For-profit: F3 only, and for-profits have no endowment column.
  const forprofitRow = { F3TUFEPC: "60", F3INSTFT: "5000", F3ACSPFT: "1200", F3STSVFT: "800" };
  const fp = financesFrom(forprofitRow, 2023)!;
  assert.equal(fp.form, "forprofit");
  assert.equal(fp.endowment_per_student, null, "for-profits don't report an endowment");
  // Unreported: no form has any value.
  assert.equal(financesFrom({}, 2023), null);
  assert.equal(financesFrom(undefined, 2023), null);
  // Two forms both populated would mean NCES changed the file's shape: fail loudly, not silently.
  assert.throws(() => financesFrom({ F1INSTFT: "1", F2INSTFT: "2" }, 2023));
});

test("every college in the snapshot reports exactly one form, and it's usually consistent with its sector", () => {
  const withFinances = schools.filter((s) => s.finances != null);
  assert.ok(withFinances.length > 0.95 * schools.length, "almost every college reports finances");
  for (const s of withFinances) {
    const f = s.finances!;
    assert.ok(["gasb", "fasb", "forprofit"].includes(f.form), s.name);
    assert.ok(f.instruction_per_student === null || f.instruction_per_student > 0, s.name);
    if (f.form === "forprofit") assert.equal(f.endowment_per_student, null, `${s.name}: for-profit shouldn't report an endowment`);
  }
  // Vanderbilt and Michigan, verified against the spec's research (DRVF2024).
  assert.deepEqual(byId("221999").finances, {
    fiscal_year: 2023,
    form: "fasb",
    endowment_per_student: 827497,
    instruction_per_student: 34184,
    student_services_per_student: 19798,
    academic_support_per_student: 16416,
    tuition_share_of_revenue: 0.2,
  });
  assert.equal(byId("170976").finances!.form, "gasb");
  assert.equal(meta.vintages["ipeds-f"], "2023–24");
});

test("benchmarking never mixes accounting forms: each sector-scoped value exists only on its own form", () => {
  const forms = ["gasb", "fasb", "forprofit"] as const;
  for (const s of schools) {
    for (const form of forms) {
      if (s.finances?.form === form) {
        assert.equal(instructionOnForm(s, form), s.finances.instruction_per_student, s.name);
        assert.equal(endowmentOnForm(s, form), s.finances.endowment_per_student, s.name);
      } else {
        assert.equal(instructionOnForm(s, form), null, `${s.name}: no ${form} instruction value`);
        assert.equal(endowmentOnForm(s, form), null, `${s.name}: no ${form} endowment value`);
      }
    }
  }
  const of = (form: string) => schools.find((s) => s.finances?.form === form)!;
  assert.equal(endowmentMetricFor(of("gasb")), "endowmentGasb");
  assert.equal(endowmentMetricFor(of("fasb")), "endowmentFasb");
  assert.equal(endowmentMetricFor(of("forprofit")), null, "for-profits report no endowment");
  assert.deepEqual(INSTRUCTION_METRIC, { gasb: "instructionGasb", fasb: "instructionFasb", forprofit: "instructionForprofit" });
});

test("the big-endowment standout ranks within the sector, and every endowment belongs to exactly one sector", () => {
  // Share of a sector's reporters at or below a value: what lib/dataset.ts rankOf computes for the sector metric.
  const shareAtOrBelow = (values: number[], v: number) => values.filter((x) => x <= v).length / values.length;
  const sector = (form: "gasb" | "fasb") => schools.map((s) => endowmentOnForm(s, form)).filter((v): v is number => v !== null);
  const publics = sector("gasb");
  const privates = sector("fasb");
  assert.ok(publics.length > 300 && privates.length > 800, `${publics.length} publics, ${privates.length} private nonprofits`);
  const richestPublic = Math.max(...publics);
  assert.ok(shareAtOrBelow(publics, richestPublic) >= 0.95);
  // Neither sector's ranking includes the other's colleges.
  assert.equal(publics.length + privates.length, schools.filter((s) => s.finances?.endowment_per_student != null).length);
});

test("history: instruction spending per student has a break where NCES redefined the measure, and ends on the snapshot's value", () => {
  assert.equal(FINANCE_BREAK[0].year, 2015);
  const h: SchoolHistory = JSON.parse(readFileSync(join(ROOT, "data", "history", "schools", "221999.json"), "utf8"));
  const s = h.series.instruction_per_student;
  assert.ok(s, "Vanderbilt has an instruction-spending history");
  assert.ok(s!.start <= 2004, "starts by fiscal 2004-05 (Scorecard key 2005)");
  const vandy = byId("221999");
  assert.equal(s!.values.at(-1), vandy.finances!.instruction_per_student, "last history point matches the snapshot (rule 1)");
  // Endowment per student is snapshot-only (no FTE-consistent historical denominator): not a registered series at all.
  assert.ok(!("endowment_per_student" in h.series));
});
