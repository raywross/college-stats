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

export type RequirementKey = "deadline" | "fee" | "test_policy" | "aid_forms" | "interest" | "interview" | "platform" | "essays";

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
 * The platforms a college can be applied through, from what the site knows (applications.md "Platforms"): the
 * University of California takes only its own application; ApplyTexas is for Texas public colleges (and anyone
 * whose apply link points there); every other college may take the Common App or the Coalition (the site has no
 * member list yet, so neither is ruled out), its own site, or "other". The picker offers only these; a platform
 * already saved that isn't in the list stays selectable, marked "(not offered)".
 */
export function platformsFor(school: Pick<PlanSchool, "state" | "type" | "name" | "links"> | null | undefined): Platform[] {
  const host = applyHost(school?.links?.apply);
  const uc = (school?.state === "CA" && /^University of California\b/i.test(school.name ?? "")) || host?.endsWith("universityofcalifornia.edu") === true;
  if (uc) return ["uc", "other"];
  const out: Platform[] = ["common_app", "coalition"];
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

function feeRequirement(school: PlanSchool, profile: StudentProfileData | null): Requirement {
  const detail = feeDetail(school);
  if (!detail) return { key: "fee", label: "Application fee", text: "The college hasn't published its fee.", cite: null, published: false };
  const waiver = school.logistics?.fee?.waiver ?? null;
  const note =
    profile?.basics.feeWaiverEligible === true
      ? waiver === true
        ? " You said you're eligible for a waiver."
        : " You said you're eligible for a fee waiver; ask the admissions office, even where none is listed."
      : "";
  const cite = school.logistics?.fee ? "reported.admissions_logistics.fee" : school.cites["admissions.application_fee"] !== undefined ? "admissions.application_fee" : null;
  return { key: "fee", label: "Application fee", text: `${detail}${note}`, cite, published: true };
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

function platformRequirement(item: Pick<PlanItem, "application_platform">): Requirement {
  const p = item.application_platform ?? null;
  return { key: "platform", label: "Platform", text: p ? PLATFORM_LABELS[p] : "Not set yet.", cite: null, published: true };
}

function essaysRequirement(item: Pick<PlanItem, "recommendations_count" | "supplements_count">): Requirement {
  const recs = item.recommendations_count ?? 0;
  const supps = item.supplements_count ?? 0;
  const parts: string[] = [];
  if (supps) parts.push(`${supps} supplement${supps === 1 ? "" : "s"}`);
  if (recs) parts.push(`${recs} recommendation${recs === 1 ? "" : "s"}`);
  return { key: "essays", label: "Essays and recommendations", text: parts.length ? parts.join(" · ") : "Set your counts once you know them.", cite: null, published: true };
}

/** The deadline line: the college's own date for the chosen round (the timeline's apply task), else the student's own override, else "not published". */
export function deadlineRequirement(item: Pick<PlanItem, "round" | "deadline_date" | "deadline_text">, school: PlanSchool): Requirement {
  const round = item.round ?? null;
  const roundLabel = round ? ` (${ROUND_SHORT[round]})` : "";
  const apply = applyDate(school, round);
  if (apply) return { key: "deadline", label: "Deadline", text: `Apply by ${shortDay(apply.date)}${roundLabel}`, cite: apply.field, published: true };
  const resolved = deadlineFor(round, school.logistics, school.profile, school.cycleStartYear, { text: item.deadline_text ?? null, date: item.deadline_date ?? null });
  if (resolved.date) return { key: "deadline", label: "Deadline", text: `Apply by ${shortDay(resolved.date)}${roundLabel} (your date)`, cite: null, published: true };
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
    platformRequirement(item),
    essaysRequirement(item),
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
