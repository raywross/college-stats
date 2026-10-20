/**
 * The Health page's Estimate inputs view (specs/product/admin-health-views.md "View 1"): health as a function of the
 * college facts the admission estimate reads. The facts (`ESTIMATE_FACT_PATHS`) are grouped into inputs; five are
 * core and decide the status by their presence and age, the rest are listed with their sources but never change it.
 *
 * Lists *which* facts the estimate reads (already public: every one is cited on the estimate's panel), never how they
 * are combined. Pure: the citation reader, the GPA reading, and the published dates are passed in, so the tests run
 * it on fixtures and lib/admin/estimate-inputs-load.ts runs it on the dataset.
 */
import { FIELDS, type FieldPath } from "../fields.ts";
import { pct, pctSmart } from "../format.ts";
import { satTotal } from "../score-bands.ts";
import { admitRatesByResidency } from "../cds/residency-display.ts";
import { edRate } from "../cds/admissions.ts";
import { bandMean, type CollegeGpa } from "../planner/gpa-model.ts";
import { gpaTopShare } from "../chances/reading.ts";
import { programsFor } from "../chances/guaranteed.ts";
import { programLabel } from "../chances/pool-rate.ts";
import { majorUnitsFor, universityStatement } from "../chances/major-admission.ts";
import { SELECTIVITY_TIER_LABELS } from "../chances/levels.ts";
import { ESTIMATE_FACT_PATHS } from "../chances/what-went-in.ts";
import type { Cited } from "../lineage.ts";
import type { School } from "../types.ts";
import type { SelectivityTier } from "../chances/types.ts";
import { ESTIMATE_INPUT_RULES, HEALTH_STATUSES, statusRank, type EstimateInputRules, type HealthStatus } from "./health-rules.ts";

/* ------------------------------------------------------------------ */
/* The inputs                                                          */
/* ------------------------------------------------------------------ */

/**
 * The estimate's facts, plus fields that explain one of them without being read by the estimate: whether the college
 * is open admission says why it has no admit rate (lib/open-admission.ts).
 */
const CONTEXT_PATHS = ["admissions.open_admission"] as const;
type FactPath = (typeof ESTIMATE_FACT_PATHS)[number] | (typeof CONTEXT_PATHS)[number];

/** Paths an input may list that the estimate doesn't read (the grouping test allows them). */
export const INPUT_CONTEXT_PATHS: readonly string[] = CONTEXT_PATHS;

export const ESTIMATE_INPUTS = [
  { key: "admit_rate", label: "Admit rate", core: true, paths: ["admissions.acceptance_rate", "admissions.open_admission"] },
  { key: "tests", label: "Test scores", core: true, paths: ["derived.sat_total", "admissions.act_composite_25_75"] },
  {
    key: "gpa",
    label: "GPA",
    core: true,
    paths: ["reported.admission_profile.gpa.average", "derived.gpa_band_mean", "derived.gpa_middle_half", "derived.gpa_top_share", "derived.gpa_estimate"],
  },
  {
    key: "academic_factors",
    label: "Academic factors",
    core: true,
    paths: [
      "admissions.factors",
      "reported.admission_profile.factors.gpa",
      "reported.admission_profile.factors.rigor",
      "reported.admission_profile.factors.class_rank",
      "reported.admission_profile.factors.test_scores",
    ],
  },
  { key: "selectivity", label: "Selectivity tier", core: true, paths: ["selectivity.tier", "selectivity.in_state", "selectivity.out_of_state"] },
  { key: "test_policy", label: "Test policy", core: false, paths: ["admissions.test_policy"] },
  { key: "residency", label: "Admit rate by residency", core: false, paths: ["derived.admit_rate_in_state", "derived.admit_rate_out_of_state", "derived.admit_rate_international"] },
  { key: "early_decision", label: "Early decision", core: false, paths: ["derived.ed_admit_rate", "reported.admission_profile.early_decision.applicants"] },
  {
    key: "class_rank",
    label: "Class rank",
    core: false,
    paths: ["reported.admission_profile.class_rank.submitted_share", "reported.admission_profile.class_rank.top_tenth", "reported.admission_profile.class_rank.top_quarter"],
  },
  {
    key: "other_factors",
    label: "Other factors",
    core: false,
    paths: [
      "reported.admission_profile.factors.extracurriculars",
      "reported.admission_profile.factors.talent",
      "reported.admission_profile.factors.work_experience",
      "reported.admission_profile.factors.alumni_relation",
      "reported.admission_profile.factors.interest",
      "reported.admission_profile.factors.first_generation",
    ],
  },
  {
    key: "major",
    label: "Admission by major",
    core: false,
    paths: [
      "reported.major_admission.admit_rate",
      "reported.major_admission.review.major_considered",
      "reported.major_admission.review.emphasis",
      "reported.major_admission.review.required_courses",
      "reported.major_admission.review.gate",
    ],
  },
  {
    key: "guaranteed",
    label: "Guaranteed admission",
    core: false,
    paths: ["reference.guaranteed_admission.rule", "reference.guaranteed_admission.scope", "reference.guaranteed_admission.major_guaranteed"],
  },
] as const satisfies readonly { key: string; label: string; core: boolean; paths: readonly FactPath[] }[];

export type EstimateInputKey = (typeof ESTIMATE_INPUTS)[number]["key"];
export const ESTIMATE_INPUT_KEYS: readonly EstimateInputKey[] = ESTIMATE_INPUTS.map((i) => i.key);
export const CORE_INPUT_KEYS: readonly EstimateInputKey[] = ESTIMATE_INPUTS.filter((i) => i.core).map((i) => i.key);
export const INPUT_LABELS = Object.fromEntries(ESTIMATE_INPUTS.map((i) => [i.key, i.label])) as Readonly<Record<EstimateInputKey, string>>;

/** Fact paths in no input (must be empty; the test fails otherwise, so a new estimate fact can't go unjudged). */
export function ungroupedFactPaths(paths: readonly string[] = ESTIMATE_FACT_PATHS): string[] {
  const grouped = new Set<string>(ESTIMATE_INPUTS.flatMap((i) => i.paths));
  return paths.filter((p) => !grouped.has(p));
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/** What the value readers need beyond the school: the GPA the estimate reads (lib/planner/gpa-model.ts collegeGpa). */
export interface ValueContext {
  gpa: CollegeGpa | null;
}

const gpaText = (v: number) => v.toFixed(2);
const range = (r: readonly [number, number] | null | undefined) => (r ? `${r[0]}–${r[1]}` : null);
const words = (v: string | null | undefined) => (v ? v.replace(/_/g, " ") : null);
const rate = (v: number | null | undefined) => (v === null || v === undefined ? null : pctSmart(v));
const share = (v: number | null | undefined) => (v === null || v === undefined ? null : pct(v));
const tier = (t: SelectivityTier | null | undefined) => (t ? SELECTIVITY_TIER_LABELS[t] : null);
const TEST_POLICY_WORDS: Record<string, string> = {
  required: "Required",
  "required-some": "Required for some applicants",
  recommended: "Recommended",
  considered: "Test-optional",
  "not-considered": "Test-blind",
};

function majorUnits(school: School) {
  const statement = universityStatement(school.unit_id);
  return [...(statement ? [statement] : []), ...majorUnitsFor(school.unit_id)];
}

/** "2 of 5 units" for the major fields: how many of the college's curated units carry the value. */
function unitsWith(school: School, has: (u: ReturnType<typeof majorUnits>[number]) => boolean): string | null {
  const units = majorUnits(school);
  const n = units.filter(has).length;
  return n ? `${n} of ${units.length} unit${units.length === 1 ? "" : "s"}` : null;
}

const profile = (s: School) => s.reported?.admission_profile;
const factor = (s: School, k: string) => words((profile(s)?.factors as Record<string, string | null> | undefined)?.[k]);

/** Each fact's value for one college, as text; null when the college has none. */
export const FACT_VALUES: Readonly<Record<FactPath, (school: School, ctx: ValueContext) => string | null>> = {
  "admissions.acceptance_rate": (s) => rate(s.admissions.acceptance_rate),
  "admissions.open_admission": (s) => (s.admissions.open_admission === true ? "Yes" : s.admissions.open_admission === false ? "No" : null),
  "derived.sat_total": (s) => range(satTotal(s)),
  "admissions.act_composite_25_75": (s) => range(s.admissions.act_composite_25_75),
  "reported.admission_profile.gpa.average": (s) => {
    const g = profile(s)?.gpa;
    return typeof g?.average === "number" ? `${gpaText(g.average)}${g.scale === "weighted" ? " (weighted)" : ""}` : null;
  },
  "derived.gpa_band_mean": (s) => {
    const m = bandMean(profile(s)?.gpa?.bands);
    return m === null ? null : gpaText(m);
  },
  "derived.gpa_middle_half": (_s, c) => (c.gpa?.middle?.kind === "bands" ? c.gpa.middle.shown.map(gpaText).join("–") : null),
  "derived.gpa_top_share": (s) => share(gpaTopShare(s)),
  "derived.gpa_estimate": (_s, c) =>
    c.gpa?.kind === "estimated" && c.gpa.point !== null
      ? `${gpaText(c.gpa.point)} (model)`
      : c.gpa?.middle?.kind === "estimated"
        ? `${c.gpa.middle.shown.map(gpaText).join("–")} (model)`
        : null,
  "admissions.factors": (s) => {
    const f = s.admissions.factors as Record<string, string | null> | undefined;
    if (!f) return null;
    const parts = [["GPA", f.gpa], ["record", f.hs_record], ["rank", f.class_rank]].filter(([, v]) => v).map(([k, v]) => `${k} ${words(v)}`);
    return parts.length ? parts.join(", ") : null;
  },
  "reported.admission_profile.factors.gpa": (s) => factor(s, "gpa"),
  "reported.admission_profile.factors.rigor": (s) => factor(s, "rigor"),
  "reported.admission_profile.factors.class_rank": (s) => factor(s, "class_rank"),
  "reported.admission_profile.factors.test_scores": (s) => factor(s, "test_scores"),
  "selectivity.tier": (s) => tier(s.selectivity?.tier),
  "selectivity.in_state": (s) => tier(s.selectivity?.in_state),
  "selectivity.out_of_state": (s) => tier(s.selectivity?.out_of_state),
  "admissions.test_policy": (s) => (s.admissions.test_policy ? (TEST_POLICY_WORDS[s.admissions.test_policy] ?? s.admissions.test_policy) : null),
  "derived.admit_rate_in_state": (s) => rate(admitRatesByResidency(s).in_state),
  "derived.admit_rate_out_of_state": (s) => rate(admitRatesByResidency(s).out_of_state),
  "derived.admit_rate_international": (s) => rate(admitRatesByResidency(s).international),
  "derived.ed_admit_rate": (s) => rate(edRate(profile(s)?.early_decision)),
  "reported.admission_profile.early_decision.applicants": (s) => {
    const n = profile(s)?.early_decision?.applicants;
    return typeof n === "number" ? n.toLocaleString("en-US") : null;
  },
  "reported.admission_profile.class_rank.submitted_share": (s) => share(profile(s)?.class_rank?.submitted_share),
  "reported.admission_profile.class_rank.top_tenth": (s) => share(profile(s)?.class_rank?.top_tenth),
  "reported.admission_profile.class_rank.top_quarter": (s) => share(profile(s)?.class_rank?.top_quarter),
  "reported.admission_profile.factors.extracurriculars": (s) => factor(s, "extracurriculars"),
  "reported.admission_profile.factors.talent": (s) => factor(s, "talent"),
  "reported.admission_profile.factors.work_experience": (s) => factor(s, "work_experience"),
  "reported.admission_profile.factors.alumni_relation": (s) => factor(s, "alumni_relation"),
  "reported.admission_profile.factors.interest": (s) => factor(s, "interest"),
  "reported.admission_profile.factors.first_generation": (s) => factor(s, "first_generation"),
  "reported.major_admission.admit_rate": (s) => unitsWith(s, (u) => !!u.admit_rate || !!u.published_rate),
  "reported.major_admission.review.major_considered": (s) => unitsWith(s, (u) => u.review?.major_considered !== undefined && u.review?.major_considered !== null),
  "reported.major_admission.review.emphasis": (s) => unitsWith(s, (u) => !!u.review?.emphasis),
  "reported.major_admission.review.required_courses": (s) => unitsWith(s, (u) => !!u.review?.required_courses?.length),
  "reported.major_admission.review.gate": (s) => unitsWith(s, (u) => !!u.review?.gate),
  "reference.guaranteed_admission.rule": (s) => programsFor(s.unit_id).map(programLabel).join("; ") || null,
  "reference.guaranteed_admission.scope": (s) => [...new Set(programsFor(s.unit_id).map((p) => p.scope))].join(", ") || null,
  "reference.guaranteed_admission.major_guaranteed": (s) => {
    const p = programsFor(s.unit_id);
    return p.length ? (p.some((x) => x.major_guaranteed) ? "Yes" : "No") : null;
  },
};

/* ------------------------------------------------------------------ */
/* One college                                                         */
/* ------------------------------------------------------------------ */

export interface InputField {
  path: FactPath;
  label: string;
  /** Null: the college has no value ("Not reported"); source and dates are then null too. */
  value: string | null;
  /** The citation's label; for a value derived from several sources, null and `from` lists them. */
  source: string | null;
  /** A derived value's input sources, each with its year. */
  from: { label: string; year: string | null }[] | null;
  /** The year the data describes. */
  describes: string | null;
  /** When the source published it: a file date (ISO), or a document's edition in words. */
  published: string | null;
  /** When we collected it (ISO). */
  collected: string | null;
  url: string | null;
  /** The source keys behind the value (its own, or its inputs'), so the Files view can say which inputs a file feeds. */
  sourceKeys: string[];
}

export interface InputHealth {
  key: EstimateInputKey;
  label: string;
  core: boolean;
  /** Null for a supporting input: never judged. */
  status: HealthStatus | null;
  reason: string;
  /** The year the status is judged by (the deciding field's), for the table cell. */
  year: string | null;
  fields: InputField[];
}

export interface CollegeInputs {
  unitId: string;
  overall: HealthStatus;
  inputs: InputHealth[];
}

type Cite = (path: FieldPath, school?: School) => Cited;

/** The fall a year label describes: the first four-digit year in it ("Fall 2025", "2025–26", "Entered fall 2018"). */
export function fallOf(year: string | null | undefined): number | null {
  const m = year?.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/** When a source published a value: the file's date for a published file, the edition for a college's document. */
export type PublishedFor = (cite: Cited) => string | null;

/** The default: a document's edition, else nothing (the loader adds the published files' dates). */
export const editionPublished: PublishedFor = (c) => {
  const edition = c.cdsEdition ?? c.label.match(/Common Data Set (\d{4}[–-]\d{2})/)?.[1];
  return edition ? `${edition} edition` : null;
};

/**
 * A citation's label without the college's own name, which every row would repeat: "Common Data Set 2025–26"; a
 * college's own page cited by its class ("Harvard University (Fall 2025)") becomes "The college's own figures (Fall 2025)".
 */
export function shortSource(label: string, collegeName: string): string {
  if (!label.startsWith(collegeName)) return label;
  const rest = label.slice(collegeName.length).trim();
  if (!rest) return label;
  return rest.startsWith("(") ? `The college's own figures ${rest}` : rest;
}

function fieldOf(path: FactPath, school: School, ctx: ValueContext, cite: Cite, publishedFor: PublishedFor): InputField {
  const value = FACT_VALUES[path](school, ctx);
  const label = (FIELDS[path] as { label: string }).label;
  if (value === null) return { path, label, value, source: null, from: null, describes: null, published: null, collected: null, url: null, sourceKeys: [] };
  const c = cite(path, school);
  const inputs = c.inputs ?? [];
  const sources = new Set(inputs.map((i) => i.label));
  // A value derived from several sources is cited by its primary input when it names one (Quad's selectivity, by the
  // admit rate it read); otherwise it lists them, since the field's own label would name a default source.
  const hasPrimary = Boolean((FIELDS[path] as { derived?: { primary?: string } }).derived?.primary);
  const several = sources.size > 1 && !hasPrimary;
  const short = (l: string) => shortSource(l, school.name);
  const from = inputs.length ? [...new Map(inputs.map((i) => [`${i.label}|${i.year ?? ""}`, { label: short(i.label), year: i.year }])).values()] : null;
  const describes = several ? null : c.year;
  return {
    path,
    label,
    value,
    source: several ? null : short(c.label),
    from: several || (from && from.length > 1) ? from : null,
    describes,
    published: several ? null : publishedFor(c),
    collected: c.retrieved || null,
    url: c.url || null,
    sourceKeys: [...new Set([c.key, ...inputs.map((i) => i.key)])],
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Fresh / Watch / Stale from how many cycles a year label is behind the current one. */
function byAge(field: InputField, rules: EstimateInputRules): { status: HealthStatus; reason: string; year: string | null } {
  const fall = fallOf(field.describes);
  const source = field.source ?? "Derived";
  if (fall === null) return { status: "watch", reason: `${source}: the source states no year.`, year: null };
  const behind = rules.currentFall - fall;
  const year = field.describes;
  const what = year && !source.includes(year) ? `${source}, ${year}` : source;
  if (behind <= 0) return { status: "fresh", reason: `${what}: the current cycle.`, year };
  const status: HealthStatus = behind >= rules.staleCyclesBehind ? "stale" : behind >= rules.watchCyclesBehind ? "watch" : "fresh";
  return { status, reason: `${what}: ${plural(behind, "cycle")} behind the current one.`, year };
}

const present = (fields: InputField[], ...paths: string[]) => fields.filter((f) => paths.includes(f.path) && f.value !== null);

/** The newest of the given fields by the fall it describes (an undated field counts as oldest). */
function newest(fields: InputField[]): InputField | null {
  return fields.reduce<InputField | null>((best, f) => (best === null || (fallOf(f.describes) ?? -1) > (fallOf(best.describes) ?? -1) ? f : best), null);
}

/** An open-admission college with no admit rate: the estimate answers Likely without reading anything else. */
const readsNothingElse = (school: School) => school.admissions.open_admission === true && school.admissions.acceptance_rate === null;

function judge(key: EstimateInputKey, fields: InputField[], school: School, ctx: ValueContext, rules: EstimateInputRules): { status: HealthStatus; reason: string; year: string | null } {
  if (key !== "admit_rate" && readsNothingElse(school)) {
    return { status: "fresh", reason: "Not needed: the college is open admission, so the estimate doesn't read it.", year: null };
  }
  switch (key) {
    case "admit_rate": {
      const f = present(fields, "admissions.acceptance_rate")[0];
      if (f) return byAge(f, rules);
      const open = school.admissions.open_admission;
      const said = present(fields, "admissions.open_admission")[0];
      const by = said ? ` (${said.source}, ${said.describes})` : "";
      if (open === true) return { status: "fresh", reason: `Open admission${by}: it admits everyone who applies, so it has no admit rate.`, year: said?.describes ?? null };
      if (open === false) {
        return { status: "failing", reason: `No admit rate, though the college says it isn't open admission${by}: the estimate reads it as open admission.`, year: null };
      }
      return { status: "watch", reason: "No admit rate, and IPEDS doesn't say whether the college is open admission: the estimate reads it as open admission.", year: null };
    }
    case "tests": {
      const f = newest(present(fields, "derived.sat_total", "admissions.act_composite_25_75"));
      if (!f) {
        return school.admissions.test_policy === "not-considered"
          ? { status: "fresh", reason: "Test-blind: the college doesn't consider scores, so it reports none.", year: null }
          : { status: "watch", reason: "No SAT or ACT range.", year: null };
      }
      return byAge(f, rules);
    }
    case "gpa": {
      const kind = ctx.gpa?.kind ?? "none";
      if (kind === "reported") return byAge(present(fields, "reported.admission_profile.gpa.average")[0] ?? fields[0], rules);
      if (kind === "bands") {
        const f = present(fields, "derived.gpa_band_mean", "derived.gpa_middle_half")[0];
        if (f) return byAge(f, rules);
      }
      if (kind === "estimated" || ctx.gpa?.middle?.kind === "estimated") {
        return { status: "watch", reason: "Only the model's estimate: the college publishes no unweighted GPA the estimate can use.", year: null };
      }
      return { status: "watch", reason: "No GPA, reported or estimated.", year: null };
    }
    case "academic_factors": {
      const cds = newest(present(fields, "reported.admission_profile.factors.gpa", "reported.admission_profile.factors.rigor", "reported.admission_profile.factors.class_rank", "reported.admission_profile.factors.test_scores"));
      const f = cds ?? present(fields, "admissions.factors")[0];
      if (!f) return { status: "watch", reason: "No admission-factor ratings.", year: null };
      return byAge(f, rules);
    }
    case "selectivity": {
      const f = present(fields, "selectivity.tier")[0];
      return f ? { status: "fresh", reason: `Rated ${f.value}.`, year: f.describes } : { status: "watch", reason: "Not rated.", year: null };
    }
    default:
      return { status: "fresh", reason: "", year: null };
  }
}

/** A supporting input's line: what it has, never a status. */
function supportingReason(fields: InputField[]): string {
  const have = fields.filter((f) => f.value !== null);
  if (!have.length) return "Not reported.";
  const years = [...new Set(have.map((f) => f.describes).filter(Boolean))];
  return `${have.length} of ${fields.length} on record${years.length ? `, ${years.join(", ")}` : ""}.`;
}

/**
 * One college's estimate inputs and their health. Overall is the worst core input (Failing > Stale > Watch > Fresh); a
 * supporting input never changes it.
 */
export function collegeInputs(
  school: School,
  cite: Cite,
  ctx: ValueContext,
  publishedFor: PublishedFor = editionPublished,
  rules: EstimateInputRules = ESTIMATE_INPUT_RULES,
): CollegeInputs {
  const inputs: InputHealth[] = ESTIMATE_INPUTS.map((input) => {
    const fields = input.paths.map((p) => fieldOf(p, school, ctx, cite, publishedFor));
    if (!input.core) return { key: input.key, label: input.label, core: false, status: null, reason: supportingReason(fields), year: null, fields };
    const j = judge(input.key, fields, school, ctx, rules);
    return { key: input.key, label: input.label, core: true, status: j.status, reason: j.reason, year: j.year, fields };
  });
  const overall = inputs.reduce<HealthStatus>((worst, i) => (i.status && statusRank(i.status) > statusRank(worst) ? i.status : worst), "fresh");
  return { unitId: school.unit_id, overall, inputs };
}

/* ------------------------------------------------------------------ */
/* Every college                                                       */
/* ------------------------------------------------------------------ */

export interface InputCounts {
  total: number;
  overall: Record<HealthStatus, number>;
  /** Per core input, colleges by status. */
  inputs: Record<string, Record<HealthStatus, number>>;
}

export function countInputs(colleges: readonly CollegeInputs[]): InputCounts {
  const zero = () => Object.fromEntries(HEALTH_STATUSES.map((s) => [s, 0])) as Record<HealthStatus, number>;
  const inputs: Record<string, Record<HealthStatus, number>> = Object.fromEntries(CORE_INPUT_KEYS.map((k) => [k, zero()]));
  const overall = zero();
  for (const c of colleges) {
    overall[c.overall]++;
    for (const i of c.inputs) if (i.core && i.status) inputs[i.key][i.status]++;
  }
  return { total: colleges.length, overall, inputs };
}

/** Worst overall first, then more core inputs not Fresh, then unit id. */
export function sortInputsWorstFirst<T extends { inputs: CollegeInputs }>(rows: readonly T[]): T[] {
  const notFresh = (c: CollegeInputs) => c.inputs.filter((i) => i.core && i.status && i.status !== "fresh").length;
  return [...rows].sort(
    (a, b) =>
      statusRank(b.inputs.overall) - statusRank(a.inputs.overall) ||
      notFresh(b.inputs) - notFresh(a.inputs) ||
      a.inputs.unitId.localeCompare(b.inputs.unitId, "en", { numeric: true }),
  );
}

/** The core input of a college by key. */
export const coreInput = (c: CollegeInputs, key: EstimateInputKey) => c.inputs.find((i) => i.key === key) ?? null;
