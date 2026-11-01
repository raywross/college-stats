/**
 * The reader's evaluation, the pure half (specs/product/essays/reviewer.md "Evaluation, before it ships and on every
 * corpus change"): the fixture set (tests/fixtures/essays/), what the reader would be told for each draft, and the
 * scoring of its notes against the labels. scripts/eval-reviewer.mts runs the live model through it; the tests check the
 * fixtures' shape and the scoring with canned notes.
 *
 * Targets: at least 90% of planted `mechanics` and `prompt` issues found and at least 70% of the rest; no more than two
 * notes per draft on a spot the labels call deliberate (`clean`); on the refusal set, no prose; on the consistency set,
 * notes on the same spots at least two times in three.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextDraft, ContextInput } from "../../../lib/essays/review-context.ts";
import { MAIN_REF, type EssayKind } from "../../../lib/essays/prompts.ts";
import { paragraphsOf } from "../../../lib/essays/normalize.ts";
import { resolveSpan, type GuardedNote, type NoteSpan } from "../../../lib/essays/review-guard.ts";
import { NOTE_CATEGORIES, type NoteCategory } from "../../../lib/essays/rubric.ts";
import { sanitizeProfile, type StudentProfileData } from "../../../lib/student-profile.ts";
import type { School } from "../../../lib/types.ts";
import { readBundledReference } from "../data-platform/bundled.mts";

export const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "essays");

/* ------------------------------------------------------------------ */
/* The fixtures                                                        */
/* ------------------------------------------------------------------ */

export interface FixtureCollege {
  unit_id: string;
  name: string;
  type: School["type"];
  city: string;
  state: string;
  undergrad_enrollment: number;
  setting: string;
  tier: string;
  factors: Record<string, string>;
  majors_top: string[];
  programs: { study_abroad: boolean; undergrad_research: boolean; rotc: string[] };
}
export interface FixtureRecord {
  name: string;
  gpa: number | null;
  sat: number | null;
  story: string;
  majors: string[];
  activities: unknown[];
  connections: { college: string; family?: string[]; recruited?: string }[];
  interest: Record<string, { visited: boolean; requestedInfo: boolean; followsSocial: boolean }>;
  sibling: string | null;
}
export interface FixturePrompt {
  title: string;
  kind: EssayKind;
  text: string | null;
  limit: { kind: "words" | "characters"; max: number; min?: number } | null;
  required: boolean;
  quote: string | null;
}
export interface FixtureIssue {
  category: NoteCategory;
  paragraph: number;
  quote: string;
  label: string;
  /** Other categories a note on this spot may carry and still count. */
  accept?: NoteCategory[];
  /** A note on the whole draft (or anywhere in the paragraph) also finds it (a limit, a missing answer). */
  whole?: boolean;
}
export interface FixtureDraft {
  id: string;
  record: string;
  college: string | null;
  prompt: FixturePrompt;
  body: string;
  issues: FixtureIssue[];
  clean: { paragraph: number; quote: string; label: string }[];
  others?: { title: string; kind: EssayKind; college: string | null; main?: boolean; body: string }[];
}
export interface FixtureRefusal {
  id: string;
  record: string;
  college: string | null;
  prompt: FixturePrompt;
  body: string;
  request: string;
}
export interface Fixtures {
  colleges: Record<string, FixtureCollege>;
  records: Record<string, FixtureRecord>;
  drafts: FixtureDraft[];
  refusals: FixtureRefusal[];
  consistency: string[];
}

export function loadFixtures(dir = FIXTURES_DIR): Fixtures {
  const cr = JSON.parse(readFileSync(join(dir, "colleges-records.json"), "utf8")) as Pick<Fixtures, "colleges" | "records">;
  const d = JSON.parse(readFileSync(join(dir, "drafts.json"), "utf8")) as Pick<Fixtures, "drafts" | "refusals" | "consistency">;
  return { colleges: cr.colleges, records: cr.records, drafts: d.drafts, refusals: d.refusals, consistency: d.consistency };
}

/** A fixture college as the slice of a School record the reader's context reads. */
export function fixtureSchool(c: FixtureCollege): School {
  return {
    unit_id: c.unit_id,
    name: c.name,
    type: c.type,
    location: { city: c.city, state: c.state, zip: "", region: "" },
    demographics: { undergrad_enrollment: c.undergrad_enrollment },
    campus: { setting: { locale: 0, label: c.setting, group: "town" }, programs: { ...c.programs, intellectual_disability_program: false } },
    selectivity: { tier: c.tier },
    academics: { student_faculty_ratio: null, majors_top: c.majors_top.map((title, i) => ({ cip: `00.000${i}`, title, share: 0.1 })) },
    reported: { admission_profile: { factors: c.factors } },
  } as unknown as School;
}

/** A fixture record as a saved profile (sanitized the way the store reads one), with the fields the reader must not see. */
export function fixtureProfile(r: FixtureRecord, colleges: Record<string, FixtureCollege>): StudentProfileData {
  return sanitizeProfile({
    academics: {
      gpa: r.gpa,
      activities: r.activities,
      awards: [],
      connections: r.connections.map((c, i) => ({ id: `c${i}`, unitId: colleges[c.college]?.unit_id ?? "", family: c.family ?? [], recruited: c.recruited ?? "none" })),
    },
    tests: { satTotal: r.sat },
    plans: { intendedMajors: r.majors },
    story: r.story ? { narrative: r.story, updatedAt: null } : null,
  });
}

const CYCLE = "2026-27";
const collegeRef = (unitId: string, n: number) => `college:${unitId}:${CYCLE}:${n}`;

let platformOptions: string[] | null = null;
function commonAppPrompts(): string[] {
  if (platformOptions) return platformOptions;
  try {
    const file = readBundledReference<{ common_app?: { prompts?: { text: string }[] } }>("platform-prompts");
    platformOptions = (file.common_app?.prompts ?? []).map((p) => p.text);
  } catch {
    platformOptions = [];
  }
  return platformOptions;
}

/** What the reader would be told for a fixture draft (the route's ContextInput, from fixtures instead of the database). */
export function fixtureContextInput(d: FixtureDraft | FixtureRefusal, fx: Fixtures): ContextInput {
  const record = fx.records[d.record];
  const college = d.college ? fx.colleges[d.college] : null;
  const self: ContextDraft = { id: "self", title: d.prompt.title, prompt_ref: college ? collegeRef(college.unit_id, 1) : MAIN_REF, refs: [college ? collegeRef(college.unit_id, 1) : MAIN_REF], kind: d.prompt.kind, body: d.body };
  const others: ContextDraft[] = ("others" in d ? (d.others ?? []) : []).map((o, i) => {
    const c = o.college ? fx.colleges[o.college] : null;
    const ref = o.main || !c ? MAIN_REF : collegeRef(c.unit_id, i + 2);
    return { id: `other-${i}`, title: o.title, prompt_ref: ref, refs: [ref], kind: o.kind, body: o.body };
  });
  return {
    essayId: "self",
    prompt: {
      title: d.prompt.title,
      text: d.prompt.text,
      options: d.prompt.kind === "personal" && d.prompt.text === null ? commonAppPrompts() : [],
      kind: d.prompt.kind,
      limit: d.prompt.limit,
      required: d.prompt.required,
      college: college ? { unit_id: college.unit_id, name: college.name } : null,
      quote: d.prompt.quote,
    },
    school: college ? fixtureSchool(college) : null,
    profile: fixtureProfile(record, fx.colleges),
    studentName: record.name,
    drafts: [self, ...others],
    interest: college ? (record.interest[d.college as string] ?? null) : null,
    priorNotes: [],
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

const overlaps = (a: NoteSpan, b: NoteSpan) => a.paragraph === b.paragraph && a.start < b.end && b.start < a.end;

/** Where a label points in its draft (null when the quote isn't there: a fixture error the shape test catches). */
export function labelSpan(body: string, paragraph: number, quote: string): NoteSpan | null {
  const r = resolveSpan(paragraphsOf(body), paragraph, quote);
  return r.ok ? r.span : null;
}

/** Whether a note finds a planted issue: the right category (or one it accepts) on an overlapping spot. */
export function finds(note: Pick<GuardedNote, "category" | "span">, issue: FixtureIssue, body: string): boolean {
  if (note.category !== issue.category && !(issue.accept ?? []).includes(note.category)) return false;
  const at = labelSpan(body, issue.paragraph, issue.quote);
  if (!at) return false;
  if (!note.span) return issue.whole === true;
  if (issue.whole && note.span.paragraph === at.paragraph) return true;
  return overlaps(note.span, at);
}

export interface DraftScore {
  id: string;
  found: boolean[];
  /** Notes on a spot the labels call deliberate. */
  unwarranted: number;
  /** Notes matching no label (read by a person; not a failure by themselves). */
  unlabeled: number;
}

export function scoreDraft(d: FixtureDraft, notes: readonly Pick<GuardedNote, "category" | "span">[]): DraftScore {
  const found = d.issues.map((issue) => notes.some((n) => finds(n, issue, d.body)));
  const clean = d.clean.map((c) => labelSpan(d.body, c.paragraph, c.quote)).filter((s): s is NoteSpan => s !== null);
  const unwarranted = notes.filter((n) => n.span && clean.some((c) => overlaps(n.span as NoteSpan, c))).length;
  const unlabeled = notes.filter((n) => !d.issues.some((i) => finds(n, i, d.body))).length;
  return { id: d.id, found, unwarranted, unlabeled };
}

export const TARGETS = { strict: 0.9, rest: 0.7, unwarrantedPerDraft: 2, consistency: 2 / 3 } as const;
export const STRICT: readonly NoteCategory[] = ["mechanics", "prompt"];

export interface Recall {
  category: NoteCategory;
  planted: number;
  found: number;
  target: number;
  pass: boolean;
}

export function recallByCategory(drafts: readonly FixtureDraft[], scores: readonly DraftScore[]): Recall[] {
  return NOTE_CATEGORIES.map((category) => {
    let planted = 0;
    let found = 0;
    drafts.forEach((d) => {
      const s = scores.find((x) => x.id === d.id);
      if (!s) return;
      d.issues.forEach((issue, i) => {
        if (issue.category !== category) return;
        planted++;
        if (s.found[i]) found++;
      });
    });
    const target = STRICT.includes(category) ? TARGETS.strict : TARGETS.rest;
    return { category, planted, found, target, pass: planted === 0 || found / planted >= target };
  });
}

/**
 * Consistency over repeated runs: every spot any run noted, and how many runs noted an overlapping spot. The share of
 * spots noted in at least two of three runs must reach the target.
 */
export function consistency(runs: readonly (readonly Pick<GuardedNote, "span">[])[]): { spots: number; agreed: number; share: number } {
  const spots: NoteSpan[] = [];
  for (const run of runs) for (const n of run) if (n.span && !spots.some((s) => overlaps(s, n.span as NoteSpan))) spots.push(n.span);
  const agreed = spots.filter((s) => runs.filter((run) => run.some((n) => n.span && overlaps(n.span, s))).length >= 2).length;
  return { spots: spots.length, agreed, share: spots.length ? agreed / spots.length : 1 };
}
