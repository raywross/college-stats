/**
 * What the selectivity chip's ⓘ lists (specs/chances/selectivity-index.md "Where it shows"): the published figures
 * Quad's selectivity reads for one college, as plain facts with the field each one cites. Never the weights, the
 * index, the percentiles, or the cutoffs: only values the college's own profile already shows. Server-side (it reads
 * the inputs through lib/selectivity.ts so the panel and the build can't drift); the chip passes the rows, already
 * worded, to its client popover.
 */
import type { School } from "./types";
import type { FieldPath } from "./fields";
import { rawInputs } from "./selectivity.ts";
import { satTotal } from "./score-bands.ts";
import { pct, pctSmart } from "./format.ts";

export interface SelectivityFact {
  label: string;
  value: string;
  /** A short note after the value ("of admitted students enroll"). */
  note?: string;
  /** The registered field the fact cites (its source and year in the panel). */
  field: FieldPath;
}

/** The facts for one college, in the spec's order; a figure the college doesn't publish is left out. */
export function selectivityFacts(school: School): SelectivityFact[] {
  const raw = rawInputs(school);
  const facts: SelectivityFact[] = [];
  if (raw.admitRate !== null) facts.push({ label: "Admit rate", value: pctSmart(raw.admitRate), note: "all applicants", field: "admissions.acceptance_rate" });
  if (raw.inStateRate !== null && raw.outOfStateRate !== null) {
    facts.push({ label: "Admit rate", value: pctSmart(raw.inStateRate), note: `from ${school.location.state}`, field: "derived.admit_rate_in_state" });
    facts.push({ label: "Admit rate", value: pctSmart(raw.outOfStateRate), note: "from other states", field: "derived.admit_rate_out_of_state" });
  }
  const sat = satTotal(school);
  const act = school.admissions.act_composite_25_75;
  if (sat) facts.push({ label: "SAT, 75th percentile", value: String(sat[1]), note: "of enrolled first-years", field: "derived.sat_total" });
  else if (act) facts.push({ label: "ACT, 75th percentile", value: String(act[1]), note: "of enrolled first-years", field: "admissions.act_composite_25_75" });
  if (raw.yield !== null) facts.push({ label: "Yield", value: pct(raw.yield), note: "of admitted students enroll", field: "derived.yield" });
  if (raw.retention !== null) facts.push({ label: "Retention", value: pct(raw.retention), note: "of first-years return for a second year", field: "outcomes.retention_rate" });
  if (raw.graduation !== null) facts.push({ label: "Graduation rate", value: pct(raw.graduation), note: "finish within six years", field: "outcomes.graduation_rate" });
  if (raw.admitted !== null) facts.push({ label: "Admitted", value: raw.admitted.toLocaleString("en-US"), note: "students in the class", field: "admissions.admitted" });
  return facts;
}
