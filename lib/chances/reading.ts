/**
 * How this college reads a record (specs/chances/how-colleges-read.md): one short block of plain sentences, written
 * from the college's own filings before any student numbers are involved. Seven lines, each shown only when its data
 * exists, in order: what the college says matters most (CDS C7, else the federal factors), how crowded the top GPA band
 * is (C11), a weighted reporter's caveat (C12), what it does with test scores, class rank (C10), whether the major
 * changes the review (lib/chances/reading-major.ts, passed in as `opts.major`), and the courses it expects (C5). The block is hidden when fewer
 * than two lines would show. Nothing here is a score, an index, or a ranking of colleges.
 *
 * The 50% line for "crowded" and the 15% line for a rank worth quoting are display rules about public college data
 * (not part of the estimate's method), so they live here. Pure: no server-only imports, so tests and client code can
 * load it. Every line names the registered fields it cites (`cites`); the component resolves them with `citeField`.
 */
import type { FieldPath } from "../fields.ts";
import type { TermKey } from "../glossary.ts";
import type { AdmissionFactor, C7Factor, FactorImportance, FactorUse, GpaBands, ReportedAdmissionProfile, School, UnitsBySubject } from "../types.ts";
import { bandMean } from "../planner/gpa-model.ts";
import { pct } from "../format.ts";

/** At this share of first-years in the top two GPA bands or more, a high GPA is "common here". */
export const CROWDED_SHARE = 0.5;
/** A class-rank line is worth quoting only when at least this share of first-years came from a high school that ranks. */
export const RANK_MIN_SUBMITTED = 0.15;
/** "Most first-years were admitted without scores" needs the SAT and ACT shares to add to less than this (a student may send both). */
export const MOSTLY_NO_SCORES_BELOW = 0.5;
/** The floor of the second-highest C11 band (3.75–3.99): "had a 3.75 or higher" counts it and the 4.0 band above. */
const TOP_BAND_FLOOR = "3.75";
/** A weighted reporter whose band mean is at least this has piled students into the top band. */
const PILED_BAND_MEAN = 3.9;

export type ReadingKey = "emphasis" | "crowding" | "weighted" | "tests" | "rank" | "major" | "courses";

/** A run of a line's text: plain, bold (a figure), italic (a rating word), or a glossary term. */
export interface ReadingPart {
  text: string;
  style?: "strong" | "em";
  term?: TermKey;
}

export interface ReadingLine {
  key: ReadingKey;
  parts: ReadingPart[];
  /** The line as plain text (Compare, tests, the iPhone API). */
  text: string;
  /** Registered fields the line's figures come from, in order; the component cites each distinct source once. */
  cites: FieldPath[];
  /** The major line cites a particular unit's page, not the college's first unit. */
  unitCites?: { path: FieldPath; unitId: string }[];
  /** Where more of the same lives on the page (the courses line points at the units table). */
  href?: string;
  /** Emphasis only: the short form a Compare card has room for ("Rigor and GPA very important"). */
  short?: string;
}

export interface ReadingBlock {
  /** "How Vanderbilt reads a record". */
  title: string;
  lines: ReadingLine[];
  /** Every field the lines cite, for the section's `fields` list. */
  fields: FieldPath[];
}

type ReadingSchool = Pick<School, "unit_id" | "name" | "admissions" | "reported">;

export const join = (names: readonly string[]) => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function line(key: ReadingKey, parts: ReadingPart[], cites: FieldPath[], extra: Partial<ReadingLine> = {}): ReadingLine {
  return { key, parts, text: parts.map((p) => p.text).join(""), cites, ...extra };
}

/* ------------------------------------------------------------------ */
/* What the college says matters most                                  */
/* ------------------------------------------------------------------ */

const C7_ACADEMIC: readonly { key: C7Factor; name: string; short: string; plural: boolean; term?: TermKey }[] = [
  { key: "rigor", name: "course rigor", short: "rigor", plural: false, term: "course-rigor" },
  { key: "gpa", name: "GPA", short: "GPA", plural: false },
  { key: "class_rank", name: "class rank", short: "rank", plural: false },
  { key: "test_scores", name: "tests", short: "tests", plural: true },
];
const LEVELS: readonly { level: FactorImportance; words: string }[] = [
  { level: "very_important", words: "very important" },
  { level: "important", words: "important" },
  { level: "considered", words: "considered" },
];

/** The federal survey's factors that bear on the academic record (tests are the test policy's, not a factor). */
const FEDERAL_ACADEMIC: readonly { key: AdmissionFactor; name: string; short: string }[] = [
  { key: "gpa", name: "GPA", short: "GPA" },
  { key: "hs_record", name: "the high school record", short: "school record" },
  { key: "class_rank", name: "class rank", short: "rank" },
  { key: "college_prep", name: "a college-prep program", short: "prep program" },
];
const FEDERAL_USES: readonly { use: FactorUse; words: string }[] = [
  { use: "required", words: "required" },
  { use: "considered", words: "considered" },
];

/** One group in the sentence: "Course rigor and GPA are both very important". */
function groupParts(names: { name: string; term?: TermKey; plural: boolean }[], words: string, quantifier: boolean): ReadingPart[] {
  const parts: ReadingPart[] = [];
  names.forEach((n, i) => {
    if (i > 0) parts.push({ text: i === names.length - 1 ? (names.length === 2 ? " and " : ", and ") : ", " });
    parts.push({ text: n.name, ...(n.term ? { term: n.term } : {}) });
  });
  const plural = names.length > 1 || names[0].plural;
  parts.push({ text: `${plural ? " are " : " is "}${quantifier && names.length > 1 ? (names.length === 2 ? "both " : "all ") : ""}` });
  parts.push({ text: words, style: "em" });
  return parts;
}

function emphasisLine(school: ReadingSchool): ReadingLine | null {
  const c7 = school.reported?.admission_profile?.factors;
  const rated = c7 ? C7_ACADEMIC.filter((f) => c7[f.key] === "very_important" || c7[f.key] === "important" || c7[f.key] === "considered") : [];
  if (c7 && rated.length > 0) {
    const groups = LEVELS.map((l) => ({ ...l, names: rated.filter((f) => c7[f.key] === l.level) })).filter((g) => g.names.length > 0);
    const parts: ReadingPart[] = [];
    groups.forEach((g, i) => {
      if (i > 0) parts.push({ text: "; " });
      parts.push(...groupParts(g.names, g.words, true));
    });
    parts.push({ text: "." });
    parts[0] = { ...parts[0], text: capitalize(parts[0].text) };
    const top = groups[0];
    return line("emphasis", parts, rated.map((f) => `reported.admission_profile.factors.${f.key}` as FieldPath), {
      short: `${capitalize(join(top.names.map((n) => n.short)))} ${top.words}`,
    });
  }
  const f = school.admissions?.factors;
  if (!f) return null;
  const groups = FEDERAL_USES.map((u) => ({ ...u, names: FEDERAL_ACADEMIC.filter((x) => f[x.key] === u.use) })).filter((g) => g.names.length > 0);
  if (groups.length === 0) return null;
  const parts: ReadingPart[] = [];
  groups.forEach((g, i) => {
    if (i > 0) parts.push({ text: "; " });
    parts.push(...groupParts(g.names.map((n) => ({ name: n.name, plural: false })), g.words, false));
  });
  parts.push({ text: "." });
  parts[0] = { ...parts[0], text: capitalize(parts[0].text) };
  const top = groups[0];
  return line("emphasis", parts, ["admissions.factors"], { short: `${capitalize(join(top.names.map((n) => n.short)))} ${top.words}` });
}

/* ------------------------------------------------------------------ */
/* GPA crowding and weighted reporters                                 */
/* ------------------------------------------------------------------ */

type GpaColumn = "all" | "with_test" | "without_test";
const COLUMNS: readonly GpaColumn[] = ["all", "with_test", "without_test"];

/** The C11 column the share reads: everyone's, else those who sent scores, else those who didn't. */
export function gpaColumn(gpa: NonNullable<ReportedAdmissionProfile["gpa"]> | undefined): { column: GpaColumn; bands: GpaBands } | null {
  if (!gpa) return null;
  for (const column of COLUMNS) {
    const bands = gpa.bands?.[column];
    if (bands && bands.length === 9) return { column, bands };
  }
  return null;
}

/** `derived.gpa_top_share`: first-years in the top two GPA bands (4.0 and 3.75–3.99), 0–1; null without bands. */
export function gpaTopShare(school: Pick<School, "reported">): number | null {
  const col = gpaColumn(school.reported?.admission_profile?.gpa);
  return col ? Math.min(1, Math.round((col.bands[0] + col.bands[1]) * 1e6) / 1e6) : null;
}

/** A college whose GPAs run above 4.0 (or says they are weighted): its bands can't show unweighted crowding. */
export function isWeightedReporter(school: Pick<School, "reported">): boolean {
  const gpa = school.reported?.admission_profile?.gpa;
  if (!gpa) return false;
  return gpa.scale === "weighted" || (gpa.average !== null && gpa.average > 4);
}

const COLUMN_WORDS: Record<GpaColumn, string> = {
  all: "of first-years",
  with_test: "of first-years who sent test scores",
  without_test: "of first-years who didn't send test scores",
};

const rigorAtLeastImportant = (school: ReadingSchool) => {
  const r = school.reported?.admission_profile?.factors?.rigor;
  return r === "very_important" || r === "important";
};

function crowdingLine(school: ReadingSchool): ReadingLine | null {
  const col = gpaColumn(school.reported?.admission_profile?.gpa);
  const top = gpaTopShare(school);
  if (!col || top === null) return null;
  const parts: ReadingPart[] = [
    { text: pct(top), style: "strong" },
    { text: ` ${COLUMN_WORDS[col.column]} had a ${TOP_BAND_FLOOR} or higher` },
  ];
  if (top >= CROWDED_SHARE) {
    parts.push({ text: ", so " }, { text: "a high GPA is common here", term: "gpa-crowding" });
    if (rigorAtLeastImportant(school)) parts.push({ text: " and rarely sets an applicant apart; the courses behind it carry more of the weight" });
  }
  parts.push({ text: "." });
  return line("crowding", parts, ["derived.gpa_top_share"]);
}

function weightedLine(school: ReadingSchool): ReadingLine | null {
  if (!isWeightedReporter(school)) return null;
  const gpa = school.reported!.admission_profile!.gpa!;
  const mean = bandMean(gpa.bands);
  const piled = mean !== null && mean >= PILED_BAND_MEAN;
  const parts: ReadingPart[] = [{ text: "This college reports " }, { text: "weighted GPAs", term: "weighted-gpa" }];
  const cites: FieldPath[] = [];
  if (gpa.average !== null) {
    parts.push({ text: " (average " }, { text: gpa.average.toFixed(2), style: "strong" }, { text: ")" });
    cites.push("reported.admission_profile.gpa.average");
  }
  if (piled) {
    parts.push({ text: ", which pile most students into the top band; the bands can't show how crowded unweighted GPAs are." });
    cites.push("reported.admission_profile.gpa.bands.all");
  } else {
    parts.push({ text: ", so its GPA figures can't show how crowded unweighted GPAs are." });
  }
  return line("weighted", parts, cites);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const POLICY_SENTENCE: Record<string, string> = {
  required: "Scores are required.",
  "required-some": "Scores are required for some applicants.",
  recommended: "Scores are recommended.",
  considered: "Scores are optional.",
  "not-considered": "Scores aren't read.",
};

function testsLine(school: ReadingSchool): ReadingLine | null {
  const a = school.admissions;
  const policy = a?.test_policy ?? null;
  const c7Tests = school.reported?.admission_profile?.factors?.test_scores;
  const blind = policy === "not-considered" || (policy === null && c7Tests === "not_considered");
  const parts: ReadingPart[] = [];
  const cites: FieldPath[] = [];
  if (blind) {
    parts.push({ text: POLICY_SENTENCE["not-considered"] });
    cites.push(policy === null ? "reported.admission_profile.factors.test_scores" : "admissions.test_policy");
    return line("tests", parts, cites);
  }
  if (policy) {
    parts.push({ text: POLICY_SENTENCE[policy] });
    cites.push("admissions.test_policy");
  }
  const sat = a?.test_submission_rate_sat ?? null;
  const act = a?.test_submission_rate_act ?? null;
  if (sat !== null || act !== null) {
    if (parts.length) parts.push({ text: " " });
    if (sat !== null && act !== null) {
      parts.push({ text: pct(sat), style: "strong" }, { text: " of first-years sent an SAT and " }, { text: pct(act), style: "strong" }, { text: " an ACT." });
    } else if (sat !== null) {
      parts.push({ text: pct(sat), style: "strong" }, { text: " of first-years sent an SAT." });
    } else {
      parts.push({ text: pct(act!), style: "strong" }, { text: " of first-years sent an ACT." });
    }
    if (sat !== null) cites.push("admissions.test_submission_rate_sat");
    if (act !== null) cites.push("admissions.test_submission_rate_act");
    if (policy === "considered" && sat !== null && act !== null && sat + act < MOSTLY_NO_SCORES_BELOW) {
      parts.push({ text: " Most first-years were admitted without scores." });
    }
  }
  return parts.length ? line("tests", parts, cites) : null;
}

/* ------------------------------------------------------------------ */
/* Class rank                                                          */
/* ------------------------------------------------------------------ */

function rankLine(school: ReadingSchool): ReadingLine | null {
  const profile = school.reported?.admission_profile;
  const c7 = profile?.factors?.class_rank;
  // Only the college's own C7 rating (never the federal yes/no) decides: rank is quoted when considered at all.
  const considered = !!c7 && c7 !== "not_considered";
  const cr = profile?.class_rank;
  if (considered && cr && cr.submitted_share >= RANK_MIN_SUBMITTED) {
    const tenth = cr.top_tenth !== null;
    const share = tenth ? cr.top_tenth : cr.top_quarter;
    if (share === null) return null;
    return line(
      "rank",
      [
        { text: "Of the " },
        { text: pct(cr.submitted_share), style: "strong" },
        { text: " whose high school reported a rank, " },
        { text: pct(share), style: "strong" },
        { text: ` were in the top ${tenth ? "tenth" : "quarter"}.` },
      ],
      ["reported.admission_profile.class_rank.submitted_share", tenth ? "reported.admission_profile.class_rank.top_tenth" : "reported.admission_profile.class_rank.top_quarter"]
    );
  }
  if (c7 === "not_considered") {
    return line("rank", [{ text: "Most high schools no longer rank; this college doesn't lean on it." }], ["reported.admission_profile.factors.class_rank"]);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Courses expected                                                    */
/* ------------------------------------------------------------------ */

type UnitSubject = "english" | "math" | "science" | "foreign_language" | "social_studies" | "history";
/** Tie order when two subjects are recommended equally far above what's required. */
const SUBJECTS: readonly { key: UnitSubject; name: string }[] = [
  { key: "math", name: "math" },
  { key: "science", name: "science" },
  { key: "english", name: "English" },
  { key: "social_studies", name: "social studies" },
  { key: "foreign_language", name: "foreign language" },
  { key: "history", name: "history" },
];
const CORE: readonly UnitSubject[] = ["english", "math", "science", "social_studies"];

const years = (n: number) => (n === 1 ? "1 year" : `${n} years`);

function coursesLine(school: ReadingSchool): ReadingLine | null {
  const h = school.reported?.admissions_hs_prep;
  const req: Partial<UnitsBySubject> = h?.units_required ?? {};
  const rec: Partial<UnitsBySubject> = h?.units_recommended ?? {};
  if (!h || (!h.units_required && !h.units_recommended)) return null;
  const cites: FieldPath[] = [];
  const href = "#hs-prep";

  // Where the college recommends the most beyond what it requires, the two subjects with the biggest gaps.
  const gaps = SUBJECTS.flatMap((s) => {
    const r = rec[s.key];
    return r != null && r > (req[s.key] ?? 0) ? [{ ...s, rec: r, gap: r - (req[s.key] ?? 0) }] : [];
  }).sort((a, b) => b.gap - a.gap);
  if (gaps.length > 0) {
    const two = gaps.slice(0, 2);
    const names = two.map((g) => g.name);
    const same = two.length === 1 || two[0].rec === two[1].rec;
    let text = same ? `Recommends ${years(two[0].rec)} of ${join(names)}` : `Recommends ${years(two[0].rec)} of ${names[0]} and ${two[1].rec} of ${names[1]}`;
    const required = two.map((g) => req[g.key]).filter((r): r is number => r != null && r > 0);
    if (required.length === two.length) text += required.every((r) => r === required[0]) ? (two.length > 1 ? ` (${required[0]} of each required)` : ` (${required[0]} required)`) : ` (${join(required.map(String))} required)`;
    cites.push("reported.admissions_hs_prep.units_recommended");
    if (required.length > 0) cites.push("reported.admissions_hs_prep.units_required");
    return line("courses", [{ text: `${text}.` }], cites, { href });
  }

  // Otherwise the four core subjects at the years recommended, else at the years required.
  for (const [verb, units, path] of [
    ["Recommends", rec, "reported.admissions_hs_prep.units_recommended"],
    ["Requires", req, "reported.admissions_hs_prep.units_required"],
  ] as const) {
    const core = SUBJECTS.filter((s) => CORE.includes(s.key) && units[s.key] != null && units[s.key]! > 0);
    if (core.length < 2) continue;
    const ordered = CORE.flatMap((k) => core.filter((s) => s.key === k));
    const items = ordered.map((s, i) => (i === 0 ? `${years(units[s.key]!)} of ${s.name}` : `${units[s.key]} of ${s.name}`));
    return line("courses", [{ text: `${verb} ${join(items)}.` }], [path], { href });
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The block                                                           */
/* ------------------------------------------------------------------ */

/** Every line the college's data supports, in the spec's order (no two-line rule: Compare shows what each college has). */
export function readingLines(school: ReadingSchool, major: ReadingLine | null = null): ReadingLine[] {
  return [emphasisLine(school), weightedLine(school) ?? crowdingLine(school), testsLine(school), rankLine(school), major, coursesLine(school)].filter(
    (l): l is ReadingLine => l !== null
  );
}

/** The reading of a college's record (lines in the spec's order), or null when fewer than two lines have data. */
export function readingTheRecord(school: ReadingSchool, opts: { name?: string; major?: ReadingLine | null } = {}): ReadingBlock | null {
  const lines = readingLines(school, opts.major ?? null);
  if (lines.length < 2) return null;
  return {
    title: `How ${opts.name ?? school.name} reads a record`,
    lines,
    fields: [...new Set(lines.flatMap((l) => l.cites))],
  };
}

/**
 * What a Compare card shows for one college (the "How they read a record" row): the short emphasis phrase and the
 * crowding share. A weighted reporter has no unweighted share, so it carries a note instead. Independent of the
 * block's two-line rule: the row speaks for what the college has.
 */
export function readingSummary(school: ReadingSchool): { emphasis: string | null; topShare: number | null; weighted: boolean } | null {
  const emphasis = emphasisLine(school)?.short ?? null;
  const weighted = isWeightedReporter(school);
  const topShare = weighted ? null : gpaTopShare(school);
  return emphasis === null && topShare === null && !weighted ? null : { emphasis, topShare, weighted };
}
