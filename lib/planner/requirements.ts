/**
 * Stage 5's requirements list (specs/planner/applications.md "What the site knows per college"): what a college's
 * own data says it needs, each line cited back to `PlanSchool.cites`, and nothing invented. A college with no CDS
 * record falls back to the student's own deadline (`deadlineFor`, lib/list-rules.ts) and the federal application
 * fee, and says the rest isn't published. Pure; no I/O; safe for tests and client components.
 */
import { deadlineFor, type ListRound } from "../list-rules.ts";
import { POLICY_LABELS, variesText } from "../test-policy.ts";
import type { TestPolicyAnswer } from "../types.ts";
import type { StudentProfileData } from "../student-profile.ts";
import { interestLine, interviewImportanceLine } from "./actions.ts";
import { applyDate, aidFormNames, feeDetail, ROUND_SHORT, shortDay } from "./generators/college.ts";
import type { PlanItem, PlanSchool } from "./types.ts";

export type RequirementKey = "deadline" | "fee" | "test_policy" | "aid_forms" | "interest" | "interview" | "platform" | "essays" | "recommendations";

export interface Requirement {
  key: RequirementKey;
  label: string;
  text: string;
  /** The `PlanSchool.cites` key behind this line's ⓘ, when there is one. */
  cite: string | null;
  /** False when the college's own data doesn't cover this; shown as "not published", never as required. */
  published: boolean;
}

type ReportedPolicyShape = { cycle: number; policy: TestPolicyAnswer | null; sat_only: TestPolicyAnswer | null; act_only: TestPolicyAnswer | null };

/** `PlanSchool.testPolicy` is either the full CDS grid or just the federal headline answer; tell them apart. */
export function isReportedTestPolicy(v: unknown): v is ReportedPolicyShape {
  return typeof v === "object" && v !== null && "cycle" in v;
}

/** The headline answer, whichever shape `testPolicy` came in as. */
export function testPolicyAnswer(raw: unknown): TestPolicyAnswer | null {
  if (raw == null) return null;
  if (isReportedTestPolicy(raw)) return raw.policy;
  return raw as TestPolicyAnswer;
}

export const PLATFORM_LABELS: Record<NonNullable<PlanItem["application_platform"]>, string> = {
  common_app: "Common App",
  coalition: "Coalition App",
  uc: "UC Application",
  apply_texas: "ApplyTexas",
  own: "The college's own application",
  other: "Other",
};

export type Platform = NonNullable<PlanItem["application_platform"]>;

function applyHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The platforms a college can be applied through, from what the site knows (applications.md "Platforms",
 * common-app-build/brief.md U4): the University of California takes only its own application; ApplyTexas is for
 * Texas public colleges (and anyone whose apply link points there); the Common App is offered only to a college the
 * Requirements Grid marks as a member (`apply.common_app.member`), now that the site knows the member list, and the
 * Coalition application only to a college Scoir lists as taking it (`coalition.via_scoir`); any college may still
 * take its own site's form or "other". A platform already saved that isn't in the
 * list stays selectable, marked "(not offered)" (the picker's own rule, not this function's).
 */
export function platformsFor(
  school: Pick<PlanSchool, "state" | "type" | "name" | "links"> & Partial<Pick<PlanSchool, "apply" | "coalition">> | null | undefined,
): Platform[] {
  const host = applyHost(school?.links?.apply);
  const uc = (school?.state === "CA" && /^University of California\b/i.test(school.name ?? "")) || host?.endsWith("universityofcalifornia.edu") === true;
  if (uc) return ["uc", "other"];
  const out: Platform[] = [];
  if (school?.apply?.common_app.member === true) out.push("common_app");
  // The Coalition form only where Scoir lists the college as taking it (specs/data-expansion/coalition-app.md).
  if (school?.coalition?.via_scoir === true) out.push("coalition");
  if ((school?.state === "TX" && school.type === "public") || host?.endsWith("applytexas.org") === true) out.push("apply_texas");
  out.push("own", "other");
  return out;
}

/** The order "By platform" groups colleges in (applications.md "Display"). */
export const PLATFORM_ORDER: readonly (PlanItem["application_platform"] | null)[] = ["common_app", "coalition", "uc", "apply_texas", "own", "other", null];

/**
 * Whether a saved score suggests sending it, at a test-optional college only (applications.md "What the site
 * knows per college": the built `fitsScoreValues` wording). Null when there's no policy, score, or range to compare.
 */
export function sendScoreAdvice(
  policy: TestPolicyAnswer | null,
  satRange: [number, number] | null | undefined,
  actRange: [number, number] | null | undefined,
  scores: { sat: number | null; act: number | null },
): string | null {
  if (policy !== "considered") return null;
  const check =
    scores.sat !== null && satRange ? { which: "SAT", score: scores.sat, range: satRange } : scores.act !== null && actRange ? { which: "ACT", score: scores.act, range: actRange } : null;
  if (!check) return null;
  if (check.score > check.range[1]) return `Your ${check.which} is above this college's middle 50%: consider sending.`;
  if (check.score < check.range[0]) return `Your ${check.which} is below this college's middle 50%: sending may not help.`;
  return `Your ${check.which} is within this college's middle 50%: consider sending.`;
}

function scoresFrom(profile: StudentProfileData | null): { sat: number | null; act: number | null } {
  return { sat: profile?.tests.satTotal ?? null, act: profile?.tests.actComposite ?? null };
}

function testPolicyRequirement(school: PlanSchool, profile: StudentProfileData | null): Requirement {
  const raw = school.testPolicy;
  const cite = school.cites["reported.test_policy"] !== undefined ? "reported.test_policy" : school.cites["admissions.test_policy"] !== undefined ? "admissions.test_policy" : null;
  if (raw == null) return { key: "test_policy", label: "Test policy", text: "The college hasn't published a test policy this cycle.", cite: null, published: false };
  if (isReportedTestPolicy(raw) && !raw.policy) {
    return { key: "test_policy", label: "Test policy", text: `Varies by test: ${variesText(raw)}.`, cite, published: true };
  }
  const answer = testPolicyAnswer(raw);
  if (!answer) return { key: "test_policy", label: "Test policy", text: "The college hasn't published a test policy this cycle.", cite: null, published: false };
  const cycle = isReportedTestPolicy(raw) ? raw.cycle : null;
  const advice = sendScoreAdvice(answer, school.satRange, school.actRange, scoresFrom(profile));
  const headline = `${POLICY_LABELS[answer]}${cycle ? ` for fall ${cycle}` : ""}.`;
  return { key: "test_policy", label: "Test policy", text: advice ? `${headline} ${advice}` : headline, cite, published: true };
}

/**
 * The Common App Requirements Grid's own fee-waiver wording ("takes the Common App fee waiver" / "U.S. applicants
 * only" / "doesn't take it", applications.md's U4 addition), when the college has a grid row. Null without one.
 */
function gridWaiverText(school: Pick<PlanSchool, "apply">): string | null {
  switch (school.apply?.fee_waiver ?? null) {
    case "accepted":
      return "Takes the Common App fee waiver.";
    case "us_only":
      return "Takes the Common App fee waiver, U.S. applicants only.";
    case "not_accepted":
      return "Doesn't take the Common App fee waiver.";
    default:
      return null;
  }
}

function feeRequirement(school: PlanSchool, profile: StudentProfileData | null): Requirement {
  const detail = feeDetail(school);
  const gridWaiver = gridWaiverText(school);
  if (!detail && !gridWaiver) return { key: "fee", label: "Application fee", text: "The college hasn't published its fee.", cite: null, published: false };
  const waiver = school.logistics?.fee?.waiver ?? null;
  const note =
    profile?.basics.feeWaiverEligible === true
      ? waiver === true
        ? " You said you're eligible for a waiver."
        : " You said you're eligible for a fee waiver; ask the admissions office, even where none is listed."
      : "";
  const cite = school.logistics?.fee
    ? "reported.admissions_logistics.fee"
    : school.cites["admissions.application_fee"] !== undefined
      ? "admissions.application_fee"
      : gridWaiver
        ? "apply.fee_waiver"
        : null;
  const text = [detail, gridWaiver].filter((p): p is string => p !== null).join(" ");
  return { key: "fee", label: "Application fee", text: `${text}${note}`, cite, published: true };
}

function aidFormsRequirement(school: PlanSchool): Requirement {
  const forms = aidFormNames(school);
  const dates = school.aid?.dates;
  const hasDates = Boolean(dates && (dates.priority || dates.deadline));
  if (!forms.length && !hasDates) return { key: "aid_forms", label: "Aid forms", text: "The college hasn't published its aid forms.", cite: null, published: false };
  return { key: "aid_forms", label: "Aid forms", text: forms.length ? forms.join(", ") : "Listed on the college's aid page.", cite: "reported.aid.forms", published: true };
}

function interestRequirement(school: PlanSchool): Requirement {
  const v = school.profile?.factors?.interest ?? null;
  return { key: "interest", label: "Interest", text: interestLine(v), cite: v != null ? "reported.admission_profile.factors.interest" : null, published: v != null };
}

function interviewRequirement(school: PlanSchool): Requirement {
  const v = school.profile?.factors?.interview ?? null;
  return { key: "interview", label: "Interview", text: interviewImportanceLine(v), cite: v != null ? "reported.admission_profile.factors.interview" : null, published: v != null };
}

/**
 * The platform line (applications.md "Platforms"): the student's own pick when they've made one, else, for a
 * Common App member, the known fact "Takes the Common App" (cited to `apply.common_app`) rather than "Not set yet."
 * — the student hasn't chosen a platform, but the college's membership is already known. A non-member with no pick
 * stays "Not set yet." (U4: "non-members: unchanged").
 */
function platformRequirement(item: Pick<PlanItem, "application_platform">, school: Pick<PlanSchool, "apply" | "coalition">): Requirement {
  const p = item.application_platform ?? null;
  if (p) return { key: "platform", label: "Platform", text: PLATFORM_LABELS[p], cite: null, published: true };
  const commonApp = school.apply?.common_app.member === true;
  const coalition = school.coalition?.via_scoir === true;
  // Coalition application (specs/data-expansion/coalition-app.md "Display"): the known facts before the student picks.
  if (commonApp && coalition) return { key: "platform", label: "Platform", text: "Takes the Common App and the Coalition application.", cite: "apply.common_app", published: true };
  if (commonApp) return { key: "platform", label: "Platform", text: "Takes the Common App.", cite: "apply.common_app", published: true };
  if (coalition) return { key: "platform", label: "Platform", text: "Takes the Coalition application, through Scoir.", cite: "coalition.via_scoir", published: true };
  return { key: "platform", label: "Platform", text: "Not set yet.", cite: null, published: true };
}

/**
 * The essay line (applications.md "Essays and recommendations"; U4): the grid's own personal-essay, writing-
 * supplement, and Courses & Grades facts first (each mentioned only when it applies — a writing supplement or
 * Courses & Grades section that isn't required stays unmentioned, not "not required", per the 2026-27 grid having
 * no row that marks a writing supplement), then the student's own planned counts.
 */
function essaysRequirement(item: Pick<PlanItem, "recommendations_count" | "supplements_count">, school: Pick<PlanSchool, "apply">): Requirement {
  const apply = school.apply;
  const gridParts: string[] = [];
  let cite: string | null = null;
  if (apply?.essay_required != null) {
    gridParts.push(apply.essay_required ? "Personal essay required" : "No personal essay required");
    cite = "apply.essay_required";
  }
  if (apply?.writing_supplement === true) {
    gridParts.push("a writing supplement is required");
    cite = "apply.writing_supplement";
  }
  if (apply?.courses_grades_required === true) {
    gridParts.push("self-reported Courses & Grades required");
    cite = "apply.courses_grades_required";
  }
  const gridText = gridParts.length ? `${gridParts.join("; ")}.` : null;

  const recs = item.recommendations_count ?? 0;
  const supps = item.supplements_count ?? 0;
  const countParts: string[] = [];
  if (supps) countParts.push(`${supps} supplement${supps === 1 ? "" : "s"}`);
  if (recs) countParts.push(`${recs} recommendation${recs === 1 ? "" : "s"}`);
  const countText = countParts.length ? countParts.join(" · ") : null;

  const text = [gridText, countText].filter((p): p is string => p !== null).join(" ") || "Set your counts once you know them.";
  return { key: "essays", label: "Essays and recommendations", text, cite, published: true };
}

const NUMBER_WORDS: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four" };
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** "Two teacher evaluations, a counselor recommendation, and a mid-year report.", the grid's own words joined as a sentence. */
function toRequirementSentence(parts: string[]): string {
  const sentence = parts.length <= 1 ? parts.join("") : parts.length === 2 ? `${parts[0]} and ${parts[1]}` : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * The recommendations line (U4, new key): what the Requirements Grid says this college requires beyond the
 * student's own application (`apply.recommendations`: teacher evaluations, other evaluations, a counselor
 * recommendation, a mid-year report) — distinct from `essays`'s student-entered progress counts. Unpublished
 * without a grid row.
 */
function recommendationsRequirement(school: Pick<PlanSchool, "apply">): Requirement {
  const rec = school.apply?.recommendations ?? null;
  if (!rec) return { key: "recommendations", label: "Recommendations", text: "The college hasn't published its recommendation requirements.", cite: null, published: false };
  const parts: string[] = [];
  if (rec.teacher > 0) parts.push(`${numberWord(rec.teacher)} teacher evaluation${rec.teacher === 1 ? "" : "s"}`);
  if (rec.other > 0) parts.push(`${numberWord(rec.other)} other evaluation${rec.other === 1 ? "" : "s"}`);
  if (rec.counselor) parts.push("a counselor recommendation");
  if (rec.mid_year_report) parts.push("a mid-year report");
  const text = parts.length ? toRequirementSentence(parts) : "No recommendations required.";
  return { key: "recommendations", label: "Recommendations", text, cite: "apply.recommendations", published: true };
}

/** The deadline line: the college's own date for the chosen round (the timeline's apply task), else the student's own override, else "not published". */
export function deadlineRequirement(item: Pick<PlanItem, "round" | "deadline_date" | "deadline_text">, school: PlanSchool): Requirement {
  const round = item.round ?? null;
  const roundLabel = round ? ` (${ROUND_SHORT[round]})` : "";
  const apply = applyDate(school, round);
  if (apply) return { key: "deadline", label: "Deadline", text: `Apply by ${shortDay(apply.date)}${roundLabel}`, cite: apply.field, published: true };
  const resolved = deadlineFor(
    round,
    school.logistics,
    school.profile,
    school.cycleStartYear,
    { text: item.deadline_text ?? null, date: item.deadline_date ?? null },
    school.apply,
  );
  if (resolved.source === "common-app" && resolved.text === "Rolling") {
    return { key: "deadline", label: "Deadline", text: `Rolling${roundLabel}`, cite: "apply.deadlines", published: true };
  }
  if (resolved.date) {
    return {
      key: "deadline",
      label: "Deadline",
      text: `Apply by ${shortDay(resolved.date)}${roundLabel}${resolved.source === "student" ? " (your date)" : ""}`,
      cite: resolved.source === "common-app" ? "apply.deadlines" : null,
      published: true,
    };
  }
  if (resolved.text) return { key: "deadline", label: "Deadline", text: `${resolved.text}${roundLabel} (your date)`, cite: null, published: true };
  return { key: "deadline", label: "Deadline", text: "The college hasn't published this; add your own date.", cite: null, published: false };
}

/** Every requirements line for one college (applications.md's table, in its order). */
export function requirementsFor(
  item: Pick<PlanItem, "round" | "deadline_date" | "deadline_text" | "application_platform" | "recommendations_count" | "supplements_count">,
  school: PlanSchool,
  profile: StudentProfileData | null,
): Requirement[] {
  return [
    deadlineRequirement(item, school),
    feeRequirement(school, profile),
    testPolicyRequirement(school, profile),
    aidFormsRequirement(school),
    interestRequirement(school),
    interviewRequirement(school),
    platformRequirement(item, school),
    essaysRequirement(item, school),
    recommendationsRequirement(school),
  ];
}

/** Cards in deadline order, next due first; undated colleges last, then by list position (applications.md "Display"). */
export function orderForApply<T extends PlanItem>(items: readonly T[], schools: Record<string, PlanSchool>): T[] {
  const dated = items.map((item) => {
    const school = schools[item.unit_id];
    const date = school ? applyDate(school, item.round ?? null)?.date ?? null : null;
    return { item, date };
  });
  dated.sort((a, b) => {
    if (a.date === b.date) return a.item.position - b.item.position;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  });
  return dated.map((d) => d.item);
}

/** The "By platform" grouping (applications.md "Display"): Common App, Coalition, UC, ApplyTexas, own, other, not set. */
export function groupByPlatform<T extends Pick<PlanItem, "application_platform">>(items: readonly T[]): { platform: PlanItem["application_platform"] | null; items: T[] }[] {
  return PLATFORM_ORDER.map((platform) => ({ platform, items: items.filter((i) => (i.application_platform ?? null) === platform) })).filter((g) => g.items.length > 0);
}

export type { ListRound };
