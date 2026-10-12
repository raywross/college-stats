/**
 * What the selectivity chip's ⓘ lists (specs/chances/selectivity-index.md "Where it shows"): the published figures
 * Quad's selectivity reads for one college, as plain facts with the field each one cites. Never the weights, the
 * index, the percentiles, or the cutoffs: only values the college's own profile already shows. Server-side (it reads
 * the inputs through lib/selectivity.ts so the panel and the build can't drift); the chip passes the rows, already
 * worded, to its client popover.
 */
import type { School } from "./types";
import type { FieldPath } from "./fields";
import { rawInputs, FACTORS_COUNTED } from "./selectivity.ts";
import { satTotal } from "./score-bands.ts";
import { detailText, indicatorOf } from "./indicators.ts";
import { num, pct, pctSmart } from "./format.ts";

export interface SelectivityFact {
  label: string;
  value: string;
  /** A short note after the value ("of admitted students enroll"). */
  note?: string;
  /** The registered field the fact cites (its source and year in the panel). */
  field: FieldPath;
}

const FACTOR_WORDS: Record<(typeof FACTORS_COUNTED)[number] | "rigor", string> = {
  rigor: "rigor",
  essay: "essay",
  recommendations: "recommendations",
  interview: "interview",
  extracurriculars: "activities",
  talent: "talent",
  character: "character",
};

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
  if (raw.gpaTopShare !== null) facts.push({ label: "GPA 3.75 or higher", value: pct(raw.gpaTopShare), note: "of first-years", field: "derived.gpa_top_share" });
  if (raw.yield !== null) facts.push({ label: "Yield", value: pct(raw.yield), note: "of admitted students enroll", field: "derived.yield" });
  if (raw.edShare !== null) facts.push({ label: "Early decision", value: pct(raw.edShare), note: "of the first-year class admitted early", field: "reported.admission_profile.early_decision.admitted" });
  const sel = indicatorOf(school, "selectivity");
  if (sel) facts.push({ label: "Ten years", value: sel.def.words[sel.direction], note: `${detailText(sel)}, since fall ${sel.trend.since}`, field: "trends" });
  const apps = indicatorOf(school, "applications");
  if (apps) facts.push({ label: "Applications", value: apps.def.words[apps.direction], note: `${detailText(apps)}, since fall ${apps.trend.since}`, field: "trends" });
  const factors = school.reported?.admission_profile?.factors;
  if (raw.factorsRead !== null && factors) {
    const named = (["rigor", ...FACTORS_COUNTED] as const).filter((f) => factors[f] === "very_important").map((f) => FACTOR_WORDS[f]);
    facts.push({
      label: "Rated very important",
      value: named.length ? `${named.length} of ${FACTORS_COUNTED.length + 1}` : "None",
      note: named.length ? named.join(", ") : "of rigor, essay, recommendations, interview, activities, talent, character",
      field: "reported.admission_profile.factors.rigor",
    });
    if (school.admissions.test_policy === "required") facts.push({ label: "Test scores", value: "Required", field: "admissions.test_policy" });
  }
  const offered = school.reported?.admission_profile?.wait_list?.offered;
  if (raw.waitlistShare !== null && offered != null) facts.push({ label: "Waitlist", value: num(offered), note: "offered a place", field: "reported.admission_profile.wait_list.offered" });
  return facts;
}
