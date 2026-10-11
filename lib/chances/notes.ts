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
  "rigor.most": (v) => `You've taken or planned ${s(v, "taken")} of the ${plural(v, "offered", "AP course")} your school offers${s(v, "extra")}, about as demanding a schedule as it allows.`,
  "rigor.much": (v) => `You've taken or planned ${s(v, "taken")} of your school's ${plural(v, "offered", "AP course")}${s(v, "extra")}.`,
  "rigor.much_weak_grades": (v) =>
    `You've taken or planned ${s(v, "taken")} of your school's ${plural(v, "offered", "AP course")}${s(v, "extra")}; colleges look for strong grades in demanding courses, and your grades in them (${s(v, "gpa")}) matter as much as how many you take.`,
  "rigor.some": (v) =>
    `You've taken or planned ${s(v, "taken")} of your school's ${plural(v, "offered", "AP course")}${s(v, "extra")}. At colleges that rate rigor very important, the courses behind a GPA matter as much as the GPA.`,
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
  /* Added by the rigor unit (additive). Fragments join the lead sentence; the rest are sentences of their own. */
  /** Fragment: IB and dual enrollment named beside AP ("along with 2 dual-enrollment courses"). */
  "rigor.plus_kinds": (v) => `along with ${s(v, "list")}`,
  /** Fragment, in parentheses after the count: how many of the advanced courses are only planned. */
  "rigor.planned_count": (v) => `${s(v, "count")} planned`,
  /** Fragment: the same for a senior, whose planned courses are already on the schedule. */
  "rigor.scheduled_count": (v) => `${s(v, "count")} scheduled`,
  "rigor.counts": (v) => `You've listed ${plural(v, "count", "advanced course")}, taken or planned.`,
  "rigor.no_courses": () => "Add your courses to see them against what your school offers.",
  "rigor.no_offering_data": () => "We don't have your school's course list yet, so we can't place your courses against it.",
  "rigor.grades_avg": (v) => `Your ${plural(v, "finished", "finished advanced course")} average ${s(v, "gpa")}.`,
  "rigor.college_rating": (v) => `${s(v, "college")} rates course rigor ${s(v, "rating")}.`,
  "rigor.prompt_signed_out": () => "Check your courses against what your school offers.",
  "rigor.prompt_signed_in": () => "Add your courses to see them against what your school offers.",
  "rigor.you_unknown": () => "add your courses to compare",

  /* ---- The school's offering (rigor-in-context.md "The school's offering") ---- */
  "offering.profile": (v) => `Your school's profile lists ${plural(v, "count", "AP course")}.`,
  "offering.pooled": () => "Students at your school have listed these.",
  "offering.student": () => "The courses you marked as offered at your school.",
  "offering.crdc": (v) => `Your school offers ${plural(v, "count", "AP course")}.`,
  "offering.none": () => "Your school doesn't offer AP courses.",
  /** The other kinds of advanced course the school offers, after the AP line: "IB and dual enrollment are offered too." */
  "offering.also": (v) => `${s(v, "list")} ${Number(v.count) === 1 ? "is" : "are"} offered too.`,
  "offering.unknown": () => "We don't have a course list for your school yet.",
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

  /* ---- The course plan (course-plan.md "The rules"), added by the course-plan unit ---- */
  /** A college's unit requires a course level ("Cornell Engineering requires physics."). */
  "course_plan.required": (v) => `${s(v, "who")} requires ${s(v, "level")}. ${s(v, "course")} is offered at your school and fits next year.`,
  /** A college's unit asks for a score a course's exam can give. */
  "course_plan.gate": (v) => `${s(v, "who")} asks applicants for a ${s(v, "what")} score. ${s(v, "course")} is offered at your school and fits next year, and its exam is one way to show it.`,
  "course_plan.recommended": (v) =>
    `${s(v, "count")} of your ${s(v, "total")} colleges recommend ${plural(v, "years", "year")} of ${s(v, "subject")}; you're on track for ${s(v, "have")}. ${s(v, "course")} would make it ${s(v, "years")}.`,
  /** The same with no course named: a fourth year of the subject. */
  "course_plan.recommended_subject": (v) =>
    `${s(v, "count")} of your ${s(v, "total")} colleges recommend ${plural(v, "years", "year")} of ${s(v, "subject")}; you're on track for ${s(v, "have")}. ${s(v, "ordinal")} year of ${s(v, "subject")} would make it ${s(v, "years")}.`,
  /** One college on the list (the Dream) recommends it. */
  "course_plan.recommended_dream": (v) =>
    `${s(v, "college")} recommends ${plural(v, "years", "year")} of ${s(v, "subject")}; you're on track for ${s(v, "have")}. ${s(v, "course")} would make it ${s(v, "years")}.`,
  "course_plan.recommended_dream_subject": (v) =>
    `${s(v, "college")} recommends ${plural(v, "years", "year")} of ${s(v, "subject")}; you're on track for ${s(v, "have")}. ${s(v, "ordinal")} year of ${s(v, "subject")} would make it ${s(v, "years")}.`,
  "course_plan.top_level": (v) => `${s(v, "course")} would put your ${s(v, "subject")} at your school's top level next year.`,
  "course_plan.next_step": (v) => `${s(v, "course")} is the next advanced ${s(v, "subject")} course at your school.`,
  /** The school's count is known but not which courses. */
  "course_plan.top_level_subject": (v) =>
    `Your school offers AP courses. A course in ${s(v, "subject")} at its top level would be an advanced choice next year; your counselor can tell you which one.`,
  /** `tail`: "is next in your science sequence" or "fits next year". */
  "course_plan.major": (v) => `${s(v, "major")} programs commonly expect ${s(v, "expects")}; ${s(v, "course")} ${s(v, "tail")}.`,
  "course_plan.weak_grades": (v) => `Strong grades in the advanced courses you have count for more than adding another. Your grades in them: ${s(v, "gpa")}.`,
  "course_plan.weak_grades_recent": () => "Strong grades in the advanced courses you have count for more than adding another.",
  "course_plan.already": () => "Your schedule is already about as demanding as your school allows. Keep the grades up.",
  "course_plan.full_load": () => "Next year already has a full load of advanced courses. Depth in a few counts for more than another.",
  "course_plan.late": () => "Senior grades still count: colleges see midyear grades, and an offer can depend on finishing the year well.",
  "course_plan.set": () => "Nothing to add for next year. Your schedule looks set.",
  "course_plan.dismissed": () => "You've set these aside for this season.",
  "course_plan.not_offered": () => "If your school doesn't offer it, colleges know. Dual enrollment or an online course is an option, not an expectation.",
  "course_plan.no_school": () => "Add your high school to see which advanced courses are offered there.",
  "course_plan.no_list": () => "We don't have your school's course list yet. Mark the courses it offers to see suggestions.",
  "course_plan.path": (v) => `To take ${s(v, "course")} as a ${s(v, "senior")}, take ${s(v, "steps")}.`,
  /** "It would make your schedule most of what your school offers." */
  "course_plan.reading_moves": (v) => `It would make your schedule ${s(v, "label")}.`,
  /** The You column's line on the college profile. */
  "course_plan.profile_line": (v) => `${s(v, "subject")}: ${s(v, "recommended")} recommended, you're on track for ${s(v, "have")}. See next year's options in your plan.`,
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
