/**
 * "Who you're compared with" (specs/chances/pool-explainer.md): the panel behind the stage-2 sentence's ⓘ, built
 * once so it can never disagree with the sentence `poolRateFor` already produces. Pure and client-safe: every row
 * is a rate or guarantee the college already publishes, with its citation; nothing here is the estimate's method.
 *
 * Rows, in order: the guarantee (when one applies), the major rate (or "publishes no rate by major"), every
 * residency rate the grid has (in-state, out-of-state, international), the overall rate, and the early-decision
 * fact where the CDS has its counts. The row that applies to the student moves first; the rest keep this order.
 */
import { admitRatesByResidency, rateForStudent } from "../cds/residency-display.ts";
import { pctSmart } from "../format.ts";
import { stateName } from "../states.ts";
import { earlyDecisionNote, isOutsideUs, poolRateFor, POOL_FIELDS, type PoolSchool, type PoolStudent } from "./pool-rate.ts";
import { majorUnitFor, unitAdmitRate } from "./major-admission.ts";
import { noteText } from "./notes.ts";

export interface ComparedRow {
  /** "From Indiana (you)", "Everyone", "Texas automatic admission (top 5%)", "Early decision". */
  label: string;
  /** Formatted share admitted ("71%"), or null for a guarantee or a fact shown in words only. */
  rate: string | null;
  /** The year or edition beside the rate, when there is one. */
  year: string | null;
  /** Whether this is the rate that applies to the student (shown bold, first). */
  applies: boolean;
  /** The field path to cite, or null for a row with nothing published to cite. */
  cite: string | null;
  /** Words instead of (or beside) a rate: "admits every applicant who qualifies", the ED gap's caveat, "publishes no rate by major". */
  note?: string;
}

export interface ComparedWith {
  rows: ComparedRow[];
  /** "Colleges admit different groups at different rates, so we use the most specific rate {college} publishes for applicants like you." */
  intro: string;
  /** "Change your state in Household to see another rate." */
  changeState: string;
}

/** The rows "Who you're compared with" shows, and the sentence the panel opens from (pool-explainer.md "Who you're compared with"). */
export function comparedWith(student: PoolStudent, school: PoolSchool): ComparedWith {
  const reading = poolRateFor(student, school);
  const rows: ComparedRow[] = [];

  // The guarantee, only when one actually applies (never a "may qualify" program here).
  const guaranteeNote = reading.notes.find((n) => n.key === "pool.guaranteed");
  if (guaranteeNote) {
    rows.push({
      label: String(guaranteeNote.values.program ?? ""),
      rate: null,
      year: null,
      applies: reading.kind === "guaranteed",
      cite: POOL_FIELDS.guaranteedRule,
      note: noteText({ key: "pool.panel_guaranteed_note", values: {} }),
    });
  }

  // The major rate, when the first intended major maps to a unit that admits separately.
  const family = student.majors[0] ?? null;
  const unit = family ? majorUnitFor(school.unit_id, family) : null;
  if (unit) {
    const published = unitAdmitRate(unit);
    if (published) {
      rows.push({ label: unit.name, rate: pctSmart(published.rate), year: published.year, applies: reading.kind === "major", cite: POOL_FIELDS.majorRate });
    } else {
      rows.push({
        label: unit.name,
        rate: null,
        year: null,
        applies: false,
        cite: null,
        note: noteText({ key: "pool.panel_major_none", values: { college: school.name, unit: unit.name } }),
      });
    }
  }

  // Every residency rate the grid publishes, with the student's own group named "(you)" when their state is known.
  if (school.reported?.admissions_by_residency) {
    const rates = admitRatesByResidency(school);
    const year = school.reported.admissions_by_residency.entering_term;
    const state = stateName(school.location.state);
    const studentGroup = student.state ? rateForStudent(school, isOutsideUs(student.state) ? "outside-us" : student.state).group : null;
    if (rates.in_state !== null) {
      rows.push({
        label: `From ${state}${studentGroup === "in_state" ? " (you)" : ""}`,
        rate: pctSmart(rates.in_state),
        year,
        applies: reading.kind === "residency" && studentGroup === "in_state",
        cite: POOL_FIELDS.inState,
      });
    }
    if (rates.out_of_state !== null) {
      rows.push({
        label: `From outside ${state}${studentGroup === "out_of_state" ? " (you)" : ""}`,
        rate: pctSmart(rates.out_of_state),
        year,
        applies: reading.kind === "residency" && studentGroup === "out_of_state",
        cite: POOL_FIELDS.outOfState,
      });
    }
    if (rates.international !== null) {
      rows.push({
        label: `International${studentGroup === "international" ? " (you)" : ""}`,
        rate: pctSmart(rates.international),
        year,
        applies: reading.kind === "residency" && studentGroup === "international",
        cite: POOL_FIELDS.international,
      });
    }
  }

  // The overall rate, always shown when the college publishes one.
  const overallRate = school.admissions?.acceptance_rate ?? null;
  if (overallRate !== null) {
    const year = school.lineage?.[POOL_FIELDS.overall]?.year ?? null;
    rows.push({ label: "Everyone", rate: pctSmart(overallRate), year, applies: reading.kind === "overall", cite: POOL_FIELDS.overall });
  }

  // Early decision, as a fact, never as the pool's rate.
  const ed = earlyDecisionNote(student, school);
  if (ed) {
    rows.push({
      label: "Early decision",
      rate: String(ed.values.ed ?? ""),
      year: String(ed.values.year ?? ""),
      applies: false,
      cite: POOL_FIELDS.earlyDecision,
      note: `against ${ed.values.overall} overall; much of that gap is recruited athletes and other students with an inside track.`,
    });
  }

  // The applying row first; everything else keeps the order it was added in (Array#sort is stable).
  rows.sort((a, b) => Number(b.applies) - Number(a.applies));

  return {
    rows,
    intro: noteText({ key: "pool.panel_intro", values: { college: school.name } }),
    changeState: noteText({ key: "pool.panel_change_state", values: {} }),
  };
}
