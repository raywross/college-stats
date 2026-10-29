/**
 * What the reader knows besides the draft (specs/product/essays/reviewer.md "What the reader knows"): the prompt, the
 * student's story and the depth reading's summary, the titles and first lines of the student's other drafts for this
 * college and the main essay's, the college's stated factors, tier, and (for a "why us" or a program prompt) its facts,
 * and the plan's major, connections, and interest acts.
 *
 * Never sent (the same section, "Not sent"): the student's name (taken out of the story and the openings too), grades,
 * scores, the activities list beyond the depth reading's top two, finances, anything about other students in the
 * household, or any other college's drafts. `reviewContext` builds the object from typed pieces and copies only the
 * fields named below, so a new field on the record can't slip in; tests/essays-review-context.test.mts walks the result
 * for every forbidden value on a fixture record that has them all.
 *
 * Pure; safe in server code and tests (the route reads the record, the drafts, and the school, then calls this).
 */
import { activitiesReading, courseThemes } from "../chances/depth.ts";
import { groupWords } from "../chances/depth-groups.ts";
import type { ActivityEntry, ActivityRole, RecognitionTier } from "../chances/types.ts";
import { majorFamilyName } from "../majors.ts";
import { connectionFor, connectionSentence, type StudentProfileData } from "../student-profile.ts";
import type { School } from "../types.ts";
import type { EssayLimit } from "./count.ts";
import { paragraphsOf } from "./normalize.ts";
import { KIND_LABEL, MAIN_REF, parsePromptRef, type EssayKind } from "./prompts.ts";
import type { NoteCategory } from "./rubric.ts";

/** The prompt as the workspace resolved it (lib/essays/prompts.ts ResolvedPrompt's fields the reader needs). */
export interface ContextPrompt {
  title: string;
  text: string | null;
  /** The Common App's seven, for the main essay. */
  options: readonly string[];
  kind: EssayKind;
  limit: EssayLimit | null;
  required: boolean | null;
  college: { unit_id: string; name: string } | null;
  /** The college's own sentence about the prompt ("what this college says it looks for"). */
  quote: string | null;
}

/** A draft of the student's, as the route reads it. */
export interface ContextDraft {
  id: string;
  title: string;
  prompt_ref: string;
  /** Every prompt the draft serves (its own and its links). */
  refs: readonly string[];
  kind: EssayKind;
  body: string;
}

export interface ContextInput {
  /** The draft being read. */
  essayId: string;
  prompt: ContextPrompt;
  /** The prompt's college's record (null for the platforms' prompts and free drafts). */
  school: School | null;
  profile: StudentProfileData | null;
  /** The student's display name, taken out of everything sent. */
  studentName: string | null;
  /** Every draft of the student's; only this college's and the main essay are kept. */
  drafts: readonly ContextDraft[];
  /** The plan's interest acts for this college (from the list row and its visits). */
  interest: { visited: boolean; requestedInfo: boolean; followsSocial: boolean } | null;
  /** The earlier notes on this draft and what the student did with them. */
  priorNotes: readonly { category: NoteCategory; observation: string; state: "open" | "done" | "ignored" }[];
}

export interface ReviewContext {
  prompt: {
    title: string;
    kind: string;
    text: string | null;
    choices: string[];
    limit: string | null;
    required: boolean | null;
    college: string | null;
    college_says: string | null;
  };
  story: string | null;
  depth: { reading: string | null; went_deepest_in: string[]; recognition: string | null; themes: string[] } | null;
  writing: { main_essay: { title: string; opening: string } | null; other_drafts_for_this_college: { title: string; kind: string; opening: string }[] };
  college: {
    name: string;
    selectivity: string | null;
    factors: Record<string, string>;
    facts: { where: string; type: string; undergraduates: string | null; setting: string | null; top_majors: string[]; programs: string[] } | null;
  } | null;
  plan: { intended_majors: string[]; connections: string[]; interest_shown: string[] };
  prior_notes: { category: NoteCategory; observation: string; state: string }[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const OPENING_MAX = 200;
const STORY_SENT_MAX = 2000;

/** The student's name taken out of a text ("Maya" → "[name]"), each part of it, whole words only. */
export function withoutName(text: string, name: string | null): string {
  const parts = (name ?? "")
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((p) => p.length >= 2);
  let out = text;
  for (const p of parts) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"), "[name]");
  return out;
}

/** A draft's first line, cut at a word under 200 characters. */
export function openingOf(body: string): string {
  const first = paragraphsOf(body)[0] ?? "";
  if (first.length <= OPENING_MAX) return first;
  const cut = first.slice(0, OPENING_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1))}…`;
}

const limitWords = (l: EssayLimit | null): string | null =>
  l ? `${l.min ? `${l.min.toLocaleString("en-US")} to ` : "up to "}${l.max.toLocaleString("en-US")} ${l.kind}` : null;

const YEAR_WORDS = ["no years", "one year", "two years", "three years", "four years"];
const ROLE_RANK: Record<ActivityRole, number> = { member: 0, officer: 1, leader: 2 };
const ROLE_WORD: Record<ActivityRole, string> = { member: "", officer: "an officer", leader: "a leader" };
const RECOGNITION_WORD: Record<RecognitionTier, string> = { 1: "national-level recognition", 2: "state-level recognition", 3: "school-level recognition", 4: "recognition" };
const READING_WORD: Record<string, string> = {
  focused: "focused: two activities kept up three or more years, with a leading role or recognition",
  building: "building: one activity kept up three or more years, or two growing ones",
  sampling: "sampling: activities tried for shorter stretches",
};

/** "Robotics, four years, a leader" (the activity's name as typed, its years, its highest role). */
function activityLine(a: ActivityEntry, name: string | null): string {
  const years = YEAR_WORDS[a.years.length] ?? `${a.years.length} years`;
  const best = (Object.values(a.roles).filter(Boolean) as ActivityRole[]).sort((x, y) => ROLE_RANK[y] - ROLE_RANK[x])[0] ?? "member";
  return [withoutName(a.name, name), years, ROLE_WORD[best]].filter(Boolean).join(", ");
}

const FACTOR_WORD: Record<string, string> = { very_important: "very important", important: "important", considered: "considered", not_considered: "not considered", required: "required" };
const TIER_WORD: Record<string, string> = {
  elite: "among the most selective",
  highly_selective: "highly selective",
  very_selective: "very selective",
  selective: "selective",
  accessible: "admits most applicants",
  open: "open admission",
};
const TYPE_WORD: Record<string, string> = { public: "public", "private-nonprofit": "private nonprofit", "private-forprofit": "private for-profit" };

/** The CDS factors the reader cares about (the essay, character, talent, interest, activities), else the federal essay line. */
function factorsOf(school: School): Record<string, string> {
  const out: Record<string, string> = {};
  const c7 = school.reported?.admission_profile?.factors;
  const keys = [
    ["essay", "the essay"],
    ["character", "character and personal qualities"],
    ["talent", "talent or ability"],
    ["extracurriculars", "activities"],
    ["interest", "the applicant's interest in the college"],
  ] as const;
  for (const [k, label] of keys) {
    const v = c7?.[k];
    if (v && FACTOR_WORD[v]) out[label] = FACTOR_WORD[v];
  }
  const federal = school.admissions?.factors?.essay;
  if (!out["the essay"] && federal && FACTOR_WORD[federal]) out["the essay"] = FACTOR_WORD[federal];
  return out;
}

const sizeWord = (n: number | null | undefined): string | null => {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  const rounded = n >= 10000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10;
  return `about ${rounded.toLocaleString("en-US")}`;
};

function factsOf(school: School): NonNullable<ReviewContext["college"]>["facts"] {
  const programs: string[] = [];
  const p = school.campus?.programs;
  if (p?.study_abroad) programs.push("study abroad");
  if (p?.undergrad_research) programs.push("undergraduate research");
  if (p?.rotc?.length) programs.push("ROTC");
  return {
    where: [school.location?.city, school.location?.state].filter(Boolean).join(", "),
    type: TYPE_WORD[school.type] ?? school.type,
    undergraduates: sizeWord(school.demographics?.undergrad_enrollment),
    setting: school.campus?.setting?.label ?? null,
    top_majors: (school.academics?.majors_top ?? []).map((m) => m.title).filter(Boolean).slice(0, 5),
    programs,
  };
}

/** Whether a draft serves this college (one of its refs is the college's) or is the main essay. */
const servesCollege = (d: ContextDraft, unitId: string) => d.refs.some((r) => {
  const p = parsePromptRef(r);
  return p?.kind === "college" && p.unitId === unitId;
});
const isMain = (d: ContextDraft) => d.refs.includes(MAIN_REF);

/* ------------------------------------------------------------------ */
/* The context                                                         */
/* ------------------------------------------------------------------ */

export function reviewContext(input: ContextInput): ReviewContext {
  const { prompt, school, profile, studentName: name } = input;
  const unitId = prompt.college?.unit_id ?? null;

  // The story and the depth reading.
  const story = profile?.story?.narrative?.trim() ? withoutName(profile.story.narrative.trim(), name).slice(0, STORY_SENT_MAX) : null;
  let depth: ReviewContext["depth"] = null;
  if (profile) {
    const activities = profile.academics.activities ?? [];
    const reading = activitiesReading(activities, profile.academics.awards ?? []);
    const themes = courseThemes({ courses: profile.academics.courses ?? [], coreAtTopLevel: profile.academics.coreAtTopLevel, activities });
    if (activities.length || themes.themes.length) {
      depth = {
        reading: reading.reading ? READING_WORD[reading.reading] : null,
        went_deepest_in: reading.topTwo.map((a) => activityLine(a, name)),
        recognition: reading.recognition ? RECOGNITION_WORD[reading.recognition] : null,
        themes: themes.themes.map(groupWords),
      };
    }
  }

  // The rest of the writing: this college's other drafts and the main essay, never another college's.
  const others = input.drafts.filter((d) => d.id !== input.essayId);
  const main = prompt.kind === "personal" ? null : (others.find(isMain) ?? null);
  const forCollege = unitId ? others.filter((d) => servesCollege(d, unitId) && d !== main) : [];
  const writing: ReviewContext["writing"] = {
    main_essay: main ? { title: withoutName(main.title || "The personal essay", name), opening: withoutName(openingOf(main.body), name) } : null,
    other_drafts_for_this_college: forCollege.slice(0, 10).map((d) => ({ title: withoutName(d.title || KIND_LABEL[d.kind], name), kind: KIND_LABEL[d.kind], opening: withoutName(openingOf(d.body), name) })),
  };

  // The college.
  const college: ReviewContext["college"] =
    school && prompt.college
      ? {
          name: prompt.college.name,
          selectivity: school.selectivity?.tier ? (TIER_WORD[school.selectivity.tier] ?? null) : null,
          factors: factorsOf(school),
          facts: prompt.kind === "why_us" || prompt.kind === "program" ? factsOf(school) : null,
        }
      : null;

  // The plan.
  const majors = (profile?.plans.intendedMajors ?? []).map((m) => majorFamilyName(m)).filter((m): m is string => !!m);
  const conn = profile && unitId ? connectionFor(profile, unitId) : null;
  const connections = conn ? connectionSentence(conn).split(" · ").filter(Boolean) : [];
  const interest = input.interest && unitId
    ? [input.interest.visited ? "visited" : null, input.interest.requestedInfo ? "asked for information" : null, input.interest.followsSocial ? "follows the college online" : null].filter((x): x is string => !!x)
    : [];

  return {
    prompt: {
      title: prompt.title,
      kind: KIND_LABEL[prompt.kind],
      text: prompt.text,
      choices: [...prompt.options],
      limit: limitWords(prompt.limit),
      required: prompt.required,
      college: prompt.college?.name ?? null,
      college_says: prompt.quote,
    },
    story,
    depth,
    writing,
    college,
    plan: { intended_majors: majors, connections, interest_shown: interest },
    prior_notes: input.priorNotes.slice(0, 24).map((n) => ({ category: n.category, observation: n.observation, state: n.state })),
  };
}

/** The draft as the reader sees it: each paragraph numbered as the notes' spans number them. */
export function draftForReader(body: string): string {
  return paragraphsOf(body)
    .map((p, i) => `[¶${i}] ${p}`)
    .join("\n\n");
}

/** The user turn: the context as JSON, then the draft. */
export function userTurn(ctx: ReviewContext, body: string): string {
  return [
    "<context>",
    JSON.stringify(ctx, null, 1),
    "</context>",
    "",
    "<draft>",
    draftForReader(body) || "(empty)",
    "</draft>",
    "",
    "Read the draft for this prompt and this college and return your notes.",
  ].join("\n");
}
