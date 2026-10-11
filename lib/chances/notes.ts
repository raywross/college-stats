/**
 * The note catalog (specs/chances/estimate.md "Protecting the method"): every sentence the estimate, the rigor
 * reading, the pool rate, and the major review can show, reviewed like any copy. The model picks keys and fills in
 * cited values; it never returns free text. Client-safe and public: sentences name inputs and the colleges' own
 * facts, never a weight, threshold, or rule of the method (specs/chances/method/). Values arrive already formatted
 * ("71%", "fall 2025", "3.82"); a sentence never formats or compares numbers itself.
 *
 * Units add keys additively; a key, once shipped, keeps its meaning (outcome snapshots record keys).
 */
import type { EstimateNote, NoteKey } from "./types.ts";

export type NoteValues = Record<string, string | number>;
type Note = (v: NoteValues) => string;

const s = (v: NoteValues, k: string): string => String(v[k] ?? "");
/** "s" after a count other than 1 ("1 course", "2 courses"). */
const plural = (v: NoteValues, k: string, word: string): string => `${s(v, k)} ${word}${Number(v[k]) === 1 ? "" : "s"}`;

export const NOTES: Record<NoteKey, Note> = {
  /* ---- The rigor reading (rigor-in-context.md "The reading") ---- */
  "rigor.most": (v) => `You've taken or planned ${s(v, "taken")} of the ${plural(v, "offered", "AP course")} your school offers, about as demanding a schedule as it allows.`,
  "rigor.much": (v) => `You've taken or planned ${s(v, "taken")} of your school's ${plural(v, "offered", "AP course")}.`,
  "rigor.much_weak_grades": (v) =>
    `You've taken or planned ${s(v, "taken")} of your school's ${plural(v, "offered", "AP course")}; colleges look for strong grades in demanding courses, and your grades in them (${s(v, "gpa")}) matter as much as how many you take.`,
  "rigor.some": (v) =>
    `You've taken or planned ${s(v, "taken")} of your school's ${plural(v, "offered", "AP course")}. At colleges that rate rigor very important, the courses behind a GPA matter as much as the GPA.`,
  "rigor.few_offered": (v) =>
    `Your school offers ${plural(v, "offered", "AP course")} and you've taken ${Number(v.offered) === 2 ? "both" : Number(v.offered) === 1 ? "it" : "them all"}. Colleges read rigor against what your school offers; your counselor's report says so.`,
  "rigor.none_offered": () => "Your school doesn't offer AP courses. Colleges read rigor against what your school offers; your counselor's report says so.",
  "rigor.cant_place": () => "Add your high school to see your courses against what it offers.",
  /** Appended to a reading: "plus 4 honors courses". */
  "rigor.honors": (v) => `plus ${plural(v, "count", "honors course")}`,
  /** Dual enrollment and IB named alongside AP: "including 2 dual-enrollment courses". */
  "rigor.other_kinds": (v) => `including ${s(v, "list")}`,
  "rigor.planned_marker": () => "planned",
  "rigor.grades": (v) => `A's in ${s(v, "a")} of your ${plural(v, "finished", "finished advanced course")} (${s(v, "gpa")} in them).`,
  "rigor.exams": (v) => `4s or 5s on ${s(v, "high")} of the ${plural(v, "taken", "AP exam")} you've taken.`,
  "rigor.college_tie": (v) => `${s(v, "college")} rates course rigor ${s(v, "rating")}, and ${s(v, "share")} of its first-years had a 3.75 or higher.`,
  "rigor.on_hs_page": (v) => `You've taken or planned ${s(v, "taken")} of these.`,

  /* ---- The school's offering (rigor-in-context.md "The school's offering") ---- */
  "offering.profile": (v) => `Your school's profile lists ${plural(v, "count", "AP course")}.`,
  "offering.pooled": () => "Students at your school have listed these.",
  "offering.student": () => "The courses you marked as offered at your school.",
  "offering.crdc": (v) => `Your school offers ${plural(v, "count", "AP course")}.`,
  "offering.none": () => "Your school doesn't offer AP courses.",
  "offering.pick_prompt": (v) => `Your school offers these ${plural(v, "count", "AP course")}. Tap the ones you've taken, are taking, or plan to take.`,

  /* ---- The pool's rate (base-rates.md) ---- */
  "pool.guaranteed": (v) => `Guaranteed for you: ${s(v, "program")}.`,
  "pool.may_qualify": (v) => `You may qualify for ${s(v, "program")} if you're in the top ${s(v, "pct")} of your class.`,
  "pool.system_scope": (v) => `${s(v, "program")} guarantees a place in the ${s(v, "system")} system, not at a campus you choose.`,
  "pool.major_not_guaranteed": (v) => `Automatic admission to ${s(v, "college")} doesn't include a major; ${s(v, "unit")} admits separately.`,
  "pool.residency_in": (v) => `Applicants from ${s(v, "state")} were admitted at ${s(v, "rate")} (${s(v, "year")}).`,
  "pool.residency_out": (v) => `Applicants from outside ${s(v, "state")} were admitted at ${s(v, "rate")} (${s(v, "year")}).`,
  "pool.major_rate": (v) => `${s(v, "unit")} admitted ${s(v, "rate")} of its applicants (${s(v, "year")}).`,
  "pool.major_separate": (v) => `${s(v, "unit")} admits separately here and is more selective than the university overall.`,
  "pool.overall": (v) => `${s(v, "rate")} of applicants were admitted (${s(v, "year")}).`,
  "pool.ed_fact": (v) =>
    `Early decision admitted ${s(v, "ed")} here against ${s(v, "overall")} overall (${s(v, "year")}); much of that gap is recruited athletes and other students with an inside track.`,
  "pool.direct_admissions": () => "Some colleges admit students before they apply, through programs like Common App's Direct Admissions; it's one more way to find colleges.",
  "pool.kind.guaranteed": () => "guaranteed",
  "pool.kind.major": () => "rate for your major",
  "pool.kind.residency_in": () => "in-state rate",
  "pool.kind.residency_out": () => "out-of-state rate",
  "pool.kind.overall": () => "overall rate",
  /* Added by the pool rate (lib/chances/pool-rate.ts): programs with a GPA rule, international applicants, an undated rate. */
  "pool.may_qualify_gpa": (v) => `You may qualify for ${s(v, "program")} with a GPA of ${s(v, "gpa")} or higher.`,
  "pool.may_qualify_rank_or_gpa": (v) => `You may qualify for ${s(v, "program")} if you're in the top ${s(v, "pct")} of your class or have a GPA of ${s(v, "gpa")} or higher.`,
  "pool.may_qualify_rank_and_gpa": (v) => `You may qualify for ${s(v, "program")} if you're in the top ${s(v, "pct")} of your class with a GPA of ${s(v, "gpa")} or higher.`,
  "pool.residency_international": (v) => `International applicants were admitted at ${s(v, "rate")} (${s(v, "year")}).`,
  "pool.kind.residency_international": () => "international rate",
  "pool.overall_undated": (v) => `${s(v, "rate")} of applicants were admitted.`,

  /* ---- The major (major-and-grades.md "What the estimate does with it") ---- */
  "major.not_considered": (v) => `The major you list doesn't affect admission here (${s(v, "college")} says so).`,
  "major.pool": (v) => `${s(v, "unit")} admits separately here; you're compared with other ${s(v, "applicants")} applicants.`,
  "major.emphasis": (v) => `${s(v, "unit")} applicants here get an extra look at ${s(v, "subjects")} grades. Yours: ${s(v, "yours")}.`,
  "major.required_met": (v) => `${s(v, "unit")} expects ${s(v, "course")}: on your list.`,
  "major.required_missing": (v) => `${s(v, "unit")} expects ${s(v, "course")}; it isn't on your list.`,
  "major.gate_met": (v) => `You meet ${s(v, "college")}'s ${s(v, "subject")} requirement for ${s(v, "major")} through ${s(v, "route")}.`,
  "major.gate_not_yet": (v) => `To be considered for ${s(v, "major")} at ${s(v, "college")} you'll need one of: ${s(v, "routes")}.`,
  "major.gate_closed": (v) => `${s(v, "major")} at ${s(v, "college")} isn't open to this application.`,
  "major.gate_alternate": (v) => `${s(v, "college")} describes another route: ${s(v, "alternate")}`,
  "major.undecided": (v) => `You're undecided; at ${s(v, "college")} you'd apply to a specific college, and that choice is compared within its own pool.`,
  "major.add_grades": (v) => `Adding your math and science grades would help at ${s(v, "colleges")}.`,
  "major.unit_requires": (v) => `${s(v, "unit")} also requires: ${s(v, "courses")}.`,
  /* Added by the major review (lib/chances/major-review.ts). */
  "major.emphasis_no_grades": (v) => `${s(v, "unit")} applicants here get an extra look at ${s(v, "subjects")} grades; add yours to see them here.`,
  /* The Major line in "How this college reads a record" (how-colleges-read.md), for everyone. */
  "major.line.not_considered": () => "The major you list doesn't affect admission.",
  "major.line.pool": () => "Applicants are compared within the college or major they apply to.",
  "major.line.pool_and_emphasis": (v) => `Applicants are compared within the college they apply to; ${s(v, "unit")} applicants get an extra look at ${s(v, "subjects")} grades.`,

  /* ---- Quad's estimate (estimate.md "What families see", method/standing.md "The two lines") ---- */
  "estimate.label": () => "Quad's estimate",
  "estimate.panel_title": () => "What went into this estimate",
  "estimate.disclaimer": (v) =>
    `Quad's estimate is our own assessment from these inputs and outcomes reported by students. It isn't a prediction from ${s(v, "college")}, and holistic admission weighs things no estimate can see: essays, recommendations, and the college's needs that year.`,
  "estimate.reach_for_everyone": () => "Reach for everyone: no student's numbers make this college predictable.",
  "estimate.guaranteed": (v) => `Guaranteed for you: ${s(v, "program")}.`,
  "estimate.open_admission": () => "Admits everyone who applies.",
  "estimate.academics": (v) => `Your academics: ${s(v, "position")}.`,
  "estimate.pool": (v) => `Your pool: ${s(v, "pool")}.`,
  "estimate.position.above": () => "above most admitted students",
  "estimate.position.in": () => "in the middle of admitted students",
  "estimate.position.below": () => "below most admitted students",
  "estimate.gpa_meets_bar": (v) => `Your GPA (${s(v, "gpa")}) meets the bar here; ${s(v, "share")} of first-years had a 3.75 or higher, so your courses carry more of the weight.`,
  "estimate.score_inside": (v) => `Your ${s(v, "test")} is inside the middle 50% of enrolled students here.`,
  "estimate.score_above": (v) => `Your ${s(v, "test")} is above the middle 50% of enrolled students here.`,
  "estimate.score_below": (v) => `Your ${s(v, "test")} is below the middle 50% of enrolled students here.`,
  "estimate.scores_optional": () => "Scores are optional here; you might apply without yours.",
  "estimate.rank_reason": (v) => `Of the first-years whose high school reported a rank, ${s(v, "share")} were in the top tenth.`,
  "estimate.missing_courses": () => "Adding your courses could change this estimate.",
  "estimate.missing_input": (v) => `Adding your ${s(v, "input")} could change this estimate.`,
  "estimate.most_useful_input": (v) => `Adding your ${s(v, "input")} would sort ${plural(v, "count", "more college")}.`,
  "estimate.not_used": (v) => `Not used here: ${s(v, "input")} (${s(v, "college")} doesn't weigh it).`,
  "estimate.your_numbers": (v) => `Your numbers: ${s(v, "list")}`,
  "estimate.college_numbers": (v) => `${s(v, "college")}'s numbers: ${s(v, "list")}`,
  "estimate.move_up": (v) => `A ${s(v, "score")} on the ${s(v, "test")} would make ${s(v, "college")} a ${s(v, "group")}.`,
  "estimate.group_change": (v) => `At ${s(v, "college")}: ${s(v, "from")} → ${s(v, "to")}, if your grades stay strong.`,
  "estimate.balance_guaranteed": (v) => `including ${plural(v, "count", "guaranteed college")}`,
};

/** The input kinds in words, for "Adding your … could change this estimate" and the "what went into it" panel. */
export const INPUT_WORDS: Record<string, string> = {
  gpa: "GPA",
  test: "test score",
  sections: "section scores",
  class_rank: "class rank",
  courses: "courses",
  subject_grades: "math and science grades",
  state: "state",
  major: "intended major",
  round: "application round",
  high_school: "high school",
};

export function isNoteKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(NOTES, key);
}

/** A note's sentence with its values filled in; empty for a key the catalog doesn't have (never free text). */
export function noteText(note: Pick<EstimateNote, "key" | "values">): string {
  return isNoteKey(note.key) ? NOTES[note.key](note.values) : "";
}
