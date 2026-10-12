/**
 * Depth: sequence and trajectory, read from the course list and the activities list (specs/chances/depth.md "Course
 * tracks", "Activities"). Pure and client-safe: no server import, no I/O. Two entry points:
 * - `courseTracks`: per subject family, how many years of an advanced course, whether the level rises, whether a
 *   senior-year course is on the list, the grades in them, and the reading (Deep/Steady/Light/not offered) against
 *   the intended major's expected families (data/reference/major-course-expectations.json).
 * - `activitiesReading`: the top two activities by years × role weight, the reading (Focused/Building/Sampling),
 *   recognition (the best tier across activities and awards), and work hours.
 * Depth never lowers a level (depth.md "Goal"); both readings are sentences first, catalog notes under `depth.*`
 * keys in notes.ts. Neither reading, nor its sentences, ever carries an activity's or course's name into a snapshot
 * (lib/chances/depth-snapshot.ts binds the words and counts only).
 */
import { catalogCourse } from "./catalog.ts";
import { courseName, SUBJECT_LABELS } from "./courses.ts";
import { expectationsFor, type ExpectedSubject } from "./major-course-expectations.ts";
import { majorFamilyName } from "../majors.ts";
import { markPoints, courseMark, type CoreAtTopLevel, CORE_SUBJECT_KEYS, CORE_YEARS, type CoreSubject, type CoreYear } from "../student-profile.ts";
import { noteText } from "./notes.ts";
import type { ActivityEntry, ActivityRole, AwardEntry, CourseEntry, CourseSubject, EstimateNote, HsYear, RecognitionTier, SchoolOffering, TrackReading, ActivitiesReading } from "./types.ts";

const note = (key: string, values: EstimateNote["values"] = {}): EstimateNote => ({ key, values });

/* ------------------------------------------------------------------ */
/* Course tracks                                                       */
/* ------------------------------------------------------------------ */

/** The families depth reads (depth.md "Course tracks"): every `CourseSubject` except "other". */
export const DEPTH_FAMILIES: readonly CourseSubject[] = ["english", "math", "science", "history", "language", "cs", "arts"];

/** regular 0 · honors 1 · IB SL 1.5 (one constant) · AP, IB HL, dual 2 (depth.md "Per family"). */
export const TRACK_LEVEL: Record<CourseEntry["kind"], number> = {
  regular: 0,
  honors: 1,
  ib_sl: 1.5,
  ap: 2,
  ib_hl: 2,
  dual: 2,
};

const isCoreSubject = (s: CourseSubject): s is CoreSubject => (CORE_SUBJECT_KEYS as readonly string[]).includes(s);

/** A course's level counts toward "years" (depth's own sense: honors counts, unlike rigor's `isAdvancedKind`). */
const isDepthAdvanced = (c: CourseEntry): boolean => TRACK_LEVEL[c.kind] > 0;

function average(points: readonly number[]): number | null {
  if (points.length === 0) return null;
  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100;
}

/** "Biology", "AP Chemistry (planned)", "Algebra II (honors)": the family's course list, as the sentence names it. */
function trackCourseLabel(c: CourseEntry): string {
  let label = courseName(c);
  if (c.kind === "honors") label = `${label} (honors)`;
  else if (c.kind === "dual") label = `${label} (dual enrollment)`;
  if (c.status === "planned") label = `${label} (planned)`;
  return label;
}

/** Whether the school offers nothing advanced in `subject` (the offering, as rigor.ts reads it) and the student has entered nothing there either. */
function nothingOfferedIn(subject: CourseSubject, offering: SchoolOffering | null, courses: readonly CourseEntry[]): boolean {
  if (courses.some((c) => c.subject === subject)) return false;
  if (!offering) return false;
  if (offering.apCount === 0 && offering.ib !== true && offering.dual !== true) return true;
  if (offering.apKeys && offering.ib !== true && offering.dual !== true) {
    return !offering.apKeys.some((k) => catalogCourse(k)?.subject === subject);
  }
  return false;
}

/** The checked years (depth.md: "11 and 12 where `coreAtTopLevel` is checked for that subject"); only `CoreSubject` families get this. */
function coreYearsFor(subject: CourseSubject, coreAtTopLevel: CoreAtTopLevel): CoreYear[] {
  if (!isCoreSubject(subject)) return [];
  return CORE_YEARS.filter((y) => coreAtTopLevel[y]?.[subject as CoreSubject] === true);
}

/**
 * An activity's family match (depth.md "An activity marked `relatedToMajor` with 3+ years also counts as a year of
 * the major's course track where the family matches"): editorial, since `ActivityEntry` carries no subject of its
 * own. `research` matches the major's science family when it expects one (else its first expected family); a club
 * matches a STEM major's computer-science or science family. Anything else, or under 3 years, or not
 * `relatedToMajor`, matches nothing.
 */
export function activityFamilyMatch(a: ActivityEntry, expectedFamilies: readonly CourseSubject[]): CourseSubject | null {
  if (!a.relatedToMajor || a.years.length < 3) return null;
  if (a.kind === "research") return expectedFamilies.includes("science") ? "science" : expectedFamilies.includes("cs") ? "cs" : (expectedFamilies[0] ?? null);
  if (a.kind === "club") return expectedFamilies.includes("cs") ? "cs" : expectedFamilies.includes("science") ? "science" : null;
  return null;
}

export interface FamilyTrack {
  family: CourseSubject;
  reading: TrackReading;
  years: number;
  rising: boolean;
  senior: boolean;
  grades: number | null;
  /** Whether this family is one of the intended major's expected families (major-course-expectations.json). */
  expected: boolean;
  courses: string[];
  note: EstimateNote;
}

export interface CourseTracks {
  families: FamilyTrack[];
  /** Every one of the major's expected families reads Deep. */
  majorDeep: boolean;
  /** The major's expected families that read Light. */
  lightExpected: CourseSubject[];
}

export interface CourseTracksInput {
  courses: readonly CourseEntry[];
  coreAtTopLevel: CoreAtTopLevel;
  offering: SchoolOffering | null;
  /** Two-digit CIP families, most-interested first. */
  majors: readonly string[];
  activities: readonly ActivityEntry[];
}

/** The subject the family's AP-exam confirmation sentence appends, or "" without one (depth.md "Grades"). */
function examConfirmFragment(advanced: readonly CourseEntry[]): string {
  const taken = advanced.filter((c) => c.kind === "ap" && c.exam !== null);
  const high = taken.filter((c) => (c.exam ?? 0) >= 4).length;
  if (taken.length === 0 || high === 0) return "";
  return ` ${noteText(note("depth.courses.exam_confirms", { high, taken: taken.length }))}`;
}

function familyTrack(subject: CourseSubject, input: CourseTracksInput, expectedFamilies: readonly CourseSubject[], expected: ExpectedSubject | null): FamilyTrack {
  const { courses, coreAtTopLevel, offering, activities } = input;
  const inFamily = courses.filter((c) => c.subject === subject);
  const advanced = inFamily.filter(isDepthAdvanced);
  const isExpected = expected !== null;

  if (nothingOfferedIn(subject, offering, courses)) {
    return { family: subject, reading: "not_offered", years: 0, rising: false, senior: false, grades: null, expected: isExpected, courses: [], note: note("depth.courses.not_offered", { subject: SUBJECT_LABELS[subject] }) };
  }

  const advancedYears = [...new Set(advanced.map((c) => c.year))].sort((a, b) => a - b);
  const levelByYear = new Map<number, number>();
  for (const c of advanced) levelByYear.set(c.year, Math.max(levelByYear.get(c.year) ?? 0, TRACK_LEVEL[c.kind]));
  const rising = advancedYears.length > 0 && advancedYears.every((y, i) => i === 0 || (levelByYear.get(y) ?? 0) >= (levelByYear.get(advancedYears[i - 1]) ?? 0)) && (levelByYear.get(advancedYears[advancedYears.length - 1]) ?? 0) === 2;

  const activityMatch = activities.filter((a) => activityFamilyMatch(a, expectedFamilies) === subject);
  const activityYears = new Set<number>(activityMatch.flatMap((a) => a.years));

  const yearsSet = new Set<number>([...advancedYears, ...coreYearsFor(subject, coreAtTopLevel), ...activityYears]);
  const years = yearsSet.size;
  const senior = inFamily.some((c) => c.year === 12);

  const points = advanced.map((c) => markPoints(courseMark(c))).filter((p): p is number => p !== null);
  const grades = average(points);

  let reading: TrackReading;
  if (years >= 3 && rising && senior) reading = "deep";
  else if (years >= 2) reading = "steady";
  else reading = "light";

  const courseList = inFamily
    .slice()
    .sort((a, b) => a.year - b.year)
    .map(trackCourseLabel);

  const extra = activityMatch.length > 0 ? ` plus ${activityMatch.map((a) => `${a.years.length} year${a.years.length === 1 ? "" : "s"} of ${a.name}`).join(" and ")}.` : "";
  const examNote = examConfirmFragment(advanced);

  const subjectLabel = SUBJECT_LABELS[subject];
  let base: EstimateNote;
  if (reading === "deep") {
    base = isExpected
      ? note("depth.courses.deep_major", { subject: subjectLabel, courses: courseList.join(", "), extra, examNote })
      : note("depth.courses.deep", { subject: subjectLabel, courses: courseList.join(", "), extra, examNote });
  } else if (reading === "steady") {
    const top = expected ? (catalogCourse(expected.top)?.name ?? expected.text) : "";
    const majorName = majorFamilyName(input.majors[0])?.toLowerCase() ?? "";
    base =
      isExpected && expected
        ? note("depth.courses.steady_major", { subject: subjectLabel, courses: courseList.join(", "), major: majorName, course: top, extra, examNote })
        : note("depth.courses.steady", { subject: subjectLabel, courses: courseList.join(", "), extra, examNote });
  } else {
    base =
      isExpected && expected
        ? note("depth.courses.light_major", { subject: subjectLabel, courses: courseList.join(", "), major: majorFamilyName(input.majors[0])?.toLowerCase() ?? "", expects: expected.text, extra, examNote })
        : note("depth.courses.light", { subject: subjectLabel, courses: courseList.join(", "), extra, examNote });
  }

  return { family: subject, reading, years, rising, senior, grades, expected: isExpected, courses: courseList, note: base };
}

/** Per-family course tracks against the intended major's expected families (depth.md "Course tracks"). */
export function courseTracks(input: CourseTracksInput): CourseTracks {
  const majorCode = input.majors[0];
  const exp = expectationsFor(majorCode);
  const expectedBySubject = new Map<CourseSubject, ExpectedSubject>();
  for (const e of exp?.expects ?? []) if (!expectedBySubject.has(e.subject)) expectedBySubject.set(e.subject, e);
  const expectedFamilies = [...expectedBySubject.keys()];

  const withCourses = new Set(input.courses.map((c) => c.subject));
  const order: CourseSubject[] = [...expectedFamilies, ...DEPTH_FAMILIES.filter((f) => !expectedFamilies.includes(f) && withCourses.has(f))];

  const families = order.filter((f): f is CourseSubject => DEPTH_FAMILIES.includes(f)).map((subject) => familyTrack(subject, input, expectedFamilies, expectedBySubject.get(subject) ?? null));

  const majorDeep = expectedFamilies.length > 0 && expectedFamilies.every((f) => families.find((t) => t.family === f)?.reading === "deep");
  const lightExpected = families.filter((t) => t.expected && t.reading === "light").map((t) => t.family);

  return { families, majorDeep, lightExpected };
}

/* ------------------------------------------------------------------ */
/* Activities                                                          */
/* ------------------------------------------------------------------ */

const ROLE_RANK: Record<ActivityRole, number> = { member: 0, officer: 1, leader: 2 };
const ROLE_WEIGHT: Record<ActivityRole, number> = { member: 1, officer: 1.5, leader: 2 };
const ROLE_WORD: Record<ActivityRole, string> = { member: "member", officer: "officer", leader: "leader" };

/** The highest role the activity was held at, across its checked years ("member" when none is picked). */
function highestRole(a: ActivityEntry): ActivityRole {
  let best: ActivityRole = "member";
  for (const y of a.years) {
    const r = a.roles[y] ?? "member";
    if (ROLE_RANK[r] > ROLE_RANK[best]) best = r;
  }
  return best;
}

/** `years × roleWeight`, the highest role held (depth.md "The reading"). */
function activityScore(a: ActivityEntry): number {
  return a.years.length * ROLE_WEIGHT[highestRole(a)];
}

/** The role rises across the checked years, member → officer → leader (depth.md "Trajectory"). */
function hasTrajectory(a: ActivityEntry): boolean {
  const years = [...a.years].sort((x, y) => x - y);
  if (years.length < 2) return false;
  const ranks = years.map((y) => ROLE_RANK[a.roles[y] ?? "member"]);
  const nonDecreasing = ranks.every((r, i) => i === 0 || r >= ranks[i - 1]);
  return nonDecreasing && ranks[ranks.length - 1] > ranks[0];
}

const RECOGNITION_WORD: Record<RecognitionTier, string> = {
  1: "national-level recognition",
  2: "state-level recognition",
  3: "school-level recognition",
  4: "recognition",
};

/** "Soccer, four years, captain this year" / "Robotics, three years, officer this year" / "Chess club, two years". */
function activityFragment(a: ActivityEntry): string {
  const years = a.years.length;
  const yearsWord = `${years} year${years === 1 ? "" : "s"}`;
  const finalYear: HsYear | null = a.years.length ? (Math.max(...a.years) as HsYear) : null;
  const finalRole: ActivityRole = finalYear !== null ? a.roles[finalYear] ?? "member" : "member";
  const best = highestRole(a);
  if (finalRole !== "member") return `${a.name}, ${yearsWord}, ${ROLE_WORD[finalRole]} this year`;
  if (best !== "member") return `${a.name}, ${yearsWord}, ${ROLE_WORD[best]}`;
  return `${a.name}, ${yearsWord}`;
}

export interface ActivitiesResult {
  reading: ActivitiesReading | null;
  topTwo: ActivityEntry[];
  recognition: RecognitionTier | null;
  trajectory: boolean;
  workHours: number | null;
  workInTopTwo: boolean;
  notes: EstimateNote[];
}

/** The top two activities by `years × roleWeight`, the reading, recognition, and work hours (depth.md "Activities"). */
export function activitiesReading(activities: readonly ActivityEntry[], awards: readonly AwardEntry[]): ActivitiesResult {
  if (activities.length === 0) {
    return { reading: null, topTwo: [], recognition: null, trajectory: false, workHours: null, workInTopTwo: false, notes: [note("depth.activities.none")] };
  }

  const ranked = activities.map((a, i) => ({ a, i, score: activityScore(a) })).sort((x, y) => y.score - x.score || x.i - y.i);
  const topTwo = ranked.slice(0, 2).map((r) => r.a);
  const [top1, top2] = topTwo;

  const qualifies3 = (a: ActivityEntry) => a.years.length >= 3;
  const isStrong = (a: ActivityEntry) => highestRole(a) === "leader" || (a.recognition !== null && a.recognition <= 2);
  const trajectory = topTwo.some(hasTrajectory);

  let reading: ActivitiesReading;
  if (top2 && qualifies3(top1) && qualifies3(top2) && (isStrong(top1) || isStrong(top2))) reading = "focused";
  else if (qualifies3(top1) || (top2 && top1.years.length >= 2 && top2.years.length >= 2 && trajectory)) reading = "building";
  else reading = "sampling";

  const recTiers: { tier: RecognitionTier; name: string }[] = [
    ...activities.filter((a) => a.recognition !== null).map((a) => ({ tier: a.recognition as RecognitionTier, name: a.name })),
    ...awards.map((a) => ({ tier: a.tier, name: a.name })),
  ];
  const best = recTiers.sort((a, b) => a.tier - b.tier)[0] ?? null;

  const workLike = activities.filter((a) => a.kind === "work" || a.kind === "family");
  const workHours = workLike.length ? Math.max(...workLike.map((a) => a.hoursPerWeek ?? 0)) : null;
  const workInTopTwo = topTwo.some((a) => a.kind === "work" || a.kind === "family");

  const notes: EstimateNote[] = [];
  if (reading === "focused") notes.push(note("depth.activities.focused", { a1: activityFragment(top1), a2: activityFragment(top2) }));
  else if (reading === "building") notes.push(note("depth.activities.building", { a1: activityFragment(top1) }));
  else notes.push(note("depth.activities.sampling", { count: activities.length }));
  if (best) notes.push(note("depth.activities.recognition", { activity: best.name, tier: RECOGNITION_WORD[best.tier] }));

  return { reading, topTwo, recognition: best?.tier ?? null, trajectory, workHours: workHours === 0 ? null : workHours, workInTopTwo, notes };
}

/* ------------------------------------------------------------------ */
/* Themes: depth across what we track (method/standing.md Revision 2)  */
/* ------------------------------------------------------------------ */

/** Track readings that can anchor a theme. */
export const THEME_TRACKS: readonly TrackReading[] = ["deep", "steady"];
/** An activity joins a theme when it was kept up at least this many years. */
export const THEME_ACTIVITY_YEARS = 2;

/** A family in the words a theme sentence uses ("Your art courses and your art activities line up"). */
const THEME_WORDS: Record<CourseSubject, string> = {
  english: "English",
  math: "math",
  science: "science",
  history: "history",
  language: "world language",
  cs: "computer science",
  arts: "art",
  other: "other",
};

/** "a", "a and b", "a, b, and c". */
function listWords(words: readonly string[]): string {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/** The course family an activity's own family names, or null (athletics, service, leadership…, or none picked). */
function activityCourseFamily(a: ActivityEntry): CourseSubject | null {
  const f = a.family ?? null;
  return f !== null && (DEPTH_FAMILIES as readonly string[]).includes(f) ? (f as CourseSubject) : null;
}

export interface ThemesResult {
  /** Families where the course track reads Deep or Steady and an activity of two or more years shares the family. */
  themes: CourseSubject[];
  /** Deep or Steady tracks with no activity in the family. */
  trackOnly: CourseSubject[];
  /** Families of activities (two or more years) with no Deep or Steady track behind them. */
  activityOnly: CourseSubject[];
  /** Activities of two or more years with no family picked (they can't line up with anything). */
  unclassified: number;
  /** The theme sentence, then at most one suggestion of each kind (depth.theme.*). */
  notes: EstimateNote[];
}

/**
 * Depth across what we track (owner, 2026-10-12: "someone taking a lot of art courses and doing art clubs would
 * increase depth"): a theme is a course family whose track reads Deep or Steady and that at least one activity of
 * two or more years shares through `ActivityEntry.family`. An activity without a family never counts. Words only
 * reach the sentences (the families' names), never the activities' names.
 */
export function courseThemes(tracks: CourseTracks, activities: readonly ActivityEntry[]): ThemesResult {
  const kept = activities.filter((a) => a.years.length >= THEME_ACTIVITY_YEARS);
  const activityFamilies = new Set<CourseSubject>();
  for (const a of kept) {
    const f = activityCourseFamily(a);
    if (f) activityFamilies.add(f);
  }
  const strong = tracks.families.filter((t) => THEME_TRACKS.includes(t.reading)).map((t) => t.family);
  const themes = strong.filter((f) => activityFamilies.has(f));
  const trackOnly = strong.filter((f) => !activityFamilies.has(f));
  const activityOnly = [...activityFamilies].filter((f) => !strong.includes(f));
  const unclassified = kept.filter((a) => !a.family).length;

  const notes: EstimateNote[] = [];
  if (themes.length > 0) {
    const words = listWords(themes.map((f) => THEME_WORDS[f]));
    notes.push(note("depth.theme", { subjects: words }));
  }
  if (activityOnly.length > 0) notes.push(note("depth.theme.activity_only", { subject: THEME_WORDS[activityOnly[0]] }));
  if (trackOnly.length > 0 && activities.length > 0) notes.push(note("depth.theme.track_only", { subject: THEME_WORDS[trackOnly[0]] }));
  if (themes.length === 0 && unclassified > 0) notes.push(note("depth.theme.add_family"));
  return { themes, trackOnly, activityOnly, unclassified, notes };
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a snapshot may hold of Depth (depth.md "Files": "readings binned as their words; counts of activities and
 * years; never names"): the course readings by family (words, not the course list), whether the major's track is
 * fully Deep, how many expected families read Light, the activities reading, how many activities were entered, the
 * top two activities' year counts (never their names or roles), whether a trajectory was found, the best
 * recognition tier, and work hours. No course name, activity name, or award name anywhere in the shape.
 */
export interface DepthSnapshot {
  courseReadings: Partial<Record<CourseSubject, TrackReading>>;
  majorDeep: boolean;
  lightExpectedCount: number;
  activitiesReading: ActivitiesReading | null;
  activitiesCount: number;
  topTwoYears: number[];
  trajectory: boolean;
  recognition: RecognitionTier | null;
  workHours: number | null;
}

/** Builds the names-free shape above from `courseTracks`'s and `activitiesReading`'s results. */
export function depthSnapshot(tracks: CourseTracks, activities: readonly ActivityEntry[], result: ActivitiesResult): DepthSnapshot {
  const courseReadings: Partial<Record<CourseSubject, TrackReading>> = {};
  for (const f of tracks.families) courseReadings[f.family] = f.reading;
  return {
    courseReadings,
    majorDeep: tracks.majorDeep,
    lightExpectedCount: tracks.lightExpected.length,
    activitiesReading: result.reading,
    activitiesCount: activities.length,
    topTwoYears: result.topTwo.map((a) => a.years.length),
    trajectory: result.trajectory,
    recognition: result.recognition,
    workHours: result.workHours,
  };
}
