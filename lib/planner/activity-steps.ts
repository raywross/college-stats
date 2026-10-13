/**
 * The intake's four activity steps (specs/planner/redesign/intake.md "Activities, four steps"): Sports, Clubs &
 * organizations, Work & internships, and Other (awards, volunteering, projects). Every rule the cards follow lives here
 * so the intake (components/planner/intake/ActivitiesStep.tsx) and `/me` (components/me/ActivitiesForm.tsx) behave the
 * same: which step an entry belongs to, the entry a catalog pick or a typed name starts as, the one-tap year chips and
 * the title per year (each title's role tier from data/reference/activity-roles.json), the family pick for a typed
 * club, the recognition chips per step, the awards search, and the summaries. Pure and client-safe.
 */
import { activityByKey, roleForTitle, searchActivities, titlesFor, type CatalogActivity } from "../chances/activity-catalog.ts";
import { allAwards, type AwardCatalogEntry } from "../chances/awards-catalog.ts";
import type { ActivityEntry, ActivityFamily, ActivityKind, AwardEntry, HsYear, RecognitionTier } from "../chances/types.ts";

export type ActivityStep = "sports" | "clubs" | "work" | "other";
export const ACTIVITY_STEPS: readonly ActivityStep[] = ["sports", "clubs", "work", "other"];
export const HS_YEARS: readonly HsYear[] = [9, 10, 11, 12];

/* ------------------------------------------------------------------ */
/* Which step an entry belongs to                                      */
/* ------------------------------------------------------------------ */

/**
 * The step that shows an entry, from its kind (and, for research and service, whether it came from the clubs catalog):
 * sport → Sports; club and arts → Clubs; a catalog research or service entry (Science Research Program, Key Club) →
 * Clubs; typed research, work, and family → Work; typed service (volunteering) and other → Other. Deterministic, so
 * an entry saved on `/me` or by the old single form always lands on exactly one step.
 */
export function stepOfActivity(a: Pick<ActivityEntry, "kind" | "catalogKey">): ActivityStep {
  const fromCatalog = Boolean(a.catalogKey && activityByKey(a.catalogKey));
  switch (a.kind) {
    case "sport":
      return "sports";
    case "club":
    case "arts":
      return "clubs";
    case "research":
      return fromCatalog ? "clubs" : "work";
    case "service":
      return fromCatalog ? "clubs" : "other";
    case "work":
    case "family":
      return "work";
    default:
      return "other";
  }
}

/** The entries one step shows, in list order. */
export function activitiesIn(list: readonly ActivityEntry[], step: ActivityStep): ActivityEntry[] {
  return list.filter((a) => stepOfActivity(a) === step);
}

/* ------------------------------------------------------------------ */
/* New entries                                                         */
/* ------------------------------------------------------------------ */

let counter = 0;
/** A fresh id (at most 40 characters, as the sanitizer keeps). */
export function newActivityId(prefix = "act"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter}`;
}

/** The longest name an entry keeps (student-profile.ts ACTIVITY_NAME_MAX). */
const NAME_MAX = 60;

/** A catalog entry's name as the card shows it: a long "(e.g. …)" aside dropped so it fits the profile's 60 characters. */
export function catalogEntryName(cat: Pick<CatalogActivity, "name">): string {
  let name = cat.name.replace(/\s*\(e\.g\.[^)]*\)\s*$/, "").trim();
  if (name.length > NAME_MAX) name = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return name.slice(0, NAME_MAX).trim();
}

function blank(name: string, kind: ActivityKind): ActivityEntry {
  return { id: newActivityId(), name: name.trim().slice(0, NAME_MAX), kind, years: [], roles: {}, catalogKey: null, family: null, titles: {}, hoursPerWeek: null, recognition: null, relatedToMajor: false };
}

/** A catalog pick (sport or club): its own name, kind, and family; no years yet. */
export function activityFromCatalog(cat: CatalogActivity): ActivityEntry {
  return { ...blank(catalogEntryName(cat), cat.kind), catalogKey: cat.key, family: cat.family };
}

/**
 * A typed entry on a step: a sport (family athletics), a club (family left for the one-tap pick), a job, internship,
 * research position, or family responsibility (its type guessed from the words: "intern", "lab", "babysitting"), or
 * an Other entry (volunteering when the words say so, else other).
 */
export function typedActivity(step: ActivityStep, name: string): ActivityEntry {
  if (step === "sports") return { ...blank(name, "sport"), family: "athletics" };
  if (step === "clubs") return blank(name, "club");
  if (step === "work") {
    return blank(name, WORK_TYPE_KIND[guessWorkType(name)]);
  }
  const type = guessOtherType(name);
  const a = blank(name, OTHER_TYPE_KIND[type]);
  if (type === "service") a.family = "service";
  return a;
}

/* ------------------------------------------------------------------ */
/* Work and Other: the type pick                                       */
/* ------------------------------------------------------------------ */

export type WorkType = "job" | "research" | "family";
export const WORK_TYPES: readonly { type: WorkType; label: string }[] = [
  { type: "job", label: "Job or internship" },
  { type: "research", label: "Research" },
  { type: "family", label: "Family" },
];
const WORK_TYPE_KIND: Record<WorkType, ActivityKind> = { job: "work", research: "research", family: "family" };

/** "Lab assistant" → research; "Babysitting my brothers" → family; anything else → a job or internship. */
export function guessWorkType(name: string): WorkType {
  const n = name.toLowerCase();
  if (/\b(research|lab|laboratory)\b/.test(n)) return "research";
  if (/\b(family|famil|sibling|siblings|brother|brothers|sister|sisters|caregiv\w*|caretak\w*|babysit\w*|grandparent\w*|grandma|grandpa|household|translat\w*)\b/.test(n)) return "family";
  return "job";
}

export function workTypeOf(a: Pick<ActivityEntry, "kind">): WorkType {
  return a.kind === "research" ? "research" : a.kind === "family" ? "family" : "job";
}

export type OtherType = "service" | "other";
export const OTHER_TYPES: readonly { type: OtherType; label: string }[] = [
  { type: "service", label: "Volunteering" },
  { type: "other", label: "Project or other" },
];
const OTHER_TYPE_KIND: Record<OtherType, ActivityKind> = { service: "service", other: "other" };

/** "Food bank volunteer" → volunteering; anything else → other. */
export function guessOtherType(name: string): OtherType {
  return /\b(volunteer\w*|service|tutor\w*|food bank|shelter|hospital|church|mission|community)\b/i.test(name) ? "service" : "other";
}

export function otherTypeOf(a: Pick<ActivityEntry, "kind">): OtherType {
  return a.kind === "service" ? "service" : "other";
}

/** An entry switched to another kind: titles that kind doesn't offer fall back to its first title, roles follow. */
export function withKind(a: ActivityEntry, kind: ActivityKind): ActivityEntry {
  if (a.kind === kind) return a;
  const offered = new Set(titlesFor(kind).map((t) => t.title));
  const titles: Partial<Record<HsYear, string>> = {};
  const roles: ActivityEntry["roles"] = {};
  for (const y of a.years) {
    const was = a.titles?.[y];
    const title = was && offered.has(was) ? was : defaultTitle(kind);
    titles[y] = title;
    roles[y] = roleForTitle(kind, title);
  }
  return { ...a, kind, titles, roles };
}

export function setWorkType(a: ActivityEntry, type: WorkType): ActivityEntry {
  return withKind(a, WORK_TYPE_KIND[type]);
}

export function setOtherType(a: ActivityEntry, type: OtherType): ActivityEntry {
  const next = withKind(a, OTHER_TYPE_KIND[type]);
  return { ...next, family: type === "service" ? "service" : next.family === "service" ? null : next.family };
}

/* ------------------------------------------------------------------ */
/* Clubs: the family pick for a typed club                             */
/* ------------------------------------------------------------------ */

/** The one-tap "What's it about?" chips for a club typed freely, so depth can tie it to a subject. */
export const CLUB_FAMILY_PICKS: readonly { family: ActivityFamily; label: string }[] = [
  { family: "business", label: "Business" },
  { family: "science", label: "Science" },
  { family: "math", label: "Math" },
  { family: "cs", label: "Computer science" },
  { family: "engineering", label: "Engineering & robotics" },
  { family: "health", label: "Health & medicine" },
  { family: "arts", label: "Arts & music" },
  { family: "english", label: "Writing" },
  { family: "history", label: "Debate, law & politics" },
  { family: "language", label: "Languages & culture" },
  { family: "media", label: "Media & journalism" },
  { family: "service", label: "Service" },
  { family: "leadership", label: "Leadership" },
  { family: "faith", label: "Faith" },
  { family: "other", label: "Something else" },
];

/** Whether a card asks "What's it about?": a club typed freely (no catalog entry). */
export function asksFamily(a: Pick<ActivityEntry, "kind" | "catalogKey">): boolean {
  return stepOfActivity(a) === "clubs" && !(a.catalogKey && activityByKey(a.catalogKey));
}

/** A typed club's family pick: an arts pick makes it an arts entry (its titles: section leader, lead role), any other a club. */
export function setClubFamily(a: ActivityEntry, family: ActivityFamily | null): ActivityEntry {
  if (!asksFamily(a)) return a;
  const kind: ActivityKind = family === "arts" ? "arts" : "club";
  return { ...withKind(a, kind), family };
}

export function familyLabel(family: ActivityFamily | null | undefined): string | null {
  return CLUB_FAMILY_PICKS.find((f) => f.family === family)?.label ?? null;
}

/* ------------------------------------------------------------------ */
/* Years and titles                                                    */
/* ------------------------------------------------------------------ */

/**
 * The title chips each kind shows first; the rest sit behind "More". Sports read JV · Varsity · Captain (owner: "captain
 * as opposed to calling it a leader"); clubs Member · Vice President · President · Founder.
 */
const PRIMARY_TITLES: Partial<Record<ActivityKind, readonly string[]>> = {
  sport: ["JV", "Varsity", "Captain"],
  club: ["Member", "Vice President", "President", "Founder"],
  service: ["Member", "Vice President", "President", "Founder"],
  arts: ["Member", "Section leader", "Lead role"],
};

/** The title chips for a kind: the first ones shown, then the ones behind "More" (every title in activity-roles.json is in one of the two). */
export function titleChoices(kind: ActivityKind): { primary: string[]; more: string[] } {
  const all = titlesFor(kind).map((t) => t.title);
  const want = PRIMARY_TITLES[kind];
  if (!want) return { primary: all, more: [] };
  const primary = want.filter((t) => all.includes(t));
  return { primary, more: all.filter((t) => !primary.includes(t)) };
}

/** The title a newly checked year starts with when no other year has one: the kind's first chip (JV, Member, Employee). */
export function defaultTitle(kind: ActivityKind): string {
  return titleChoices(kind).primary[0] ?? titlesFor(kind)[0]?.title ?? "Member";
}

/** The first checked year's title: the kind's default, except a job whose name says "intern" starts as Intern. */
export function startingTitle(a: Pick<ActivityEntry, "kind" | "name">): string {
  if (a.kind === "work" && /intern/i.test(a.name) && titlesFor("work").some((t) => t.title === "Intern")) return "Intern";
  return defaultTitle(a.kind);
}

/**
 * A year's title as the card shows it: the picked title, else (an entry saved before titles) the kind's first title
 * with the saved role tier, else the kind's default. Null when the year isn't checked.
 */
export function yearTitle(a: Pick<ActivityEntry, "kind" | "years" | "roles" | "titles">, year: HsYear): string | null {
  if (!a.years.includes(year)) return null;
  const picked = a.titles?.[year];
  if (picked) return picked;
  const role = a.roles[year] ?? "member";
  return titlesFor(a.kind).find((t) => t.role === role)?.title ?? defaultTitle(a.kind);
}

/**
 * One tap on a year chip: a checked year turns off; an unchecked one turns on with the title of the nearest earlier
 * checked year (a varsity junior is likely a varsity senior), else the nearest later one, else the kind's default.
 */
export function toggleYear(a: ActivityEntry, year: HsYear): ActivityEntry {
  if (a.years.includes(year)) {
    const titles = { ...(a.titles ?? {}) };
    const roles = { ...a.roles };
    delete titles[year];
    delete roles[year];
    return { ...a, years: a.years.filter((y) => y !== year), titles, roles };
  }
  const earlier = [...a.years].filter((y) => y < year).sort((x, y) => y - x)[0];
  const later = [...a.years].filter((y) => y > year).sort((x, y) => x - y)[0];
  const near = earlier ?? later;
  const title = (near !== undefined ? yearTitle(a, near) : null) ?? startingTitle(a);
  return setYearTitle(a, year, title);
}

/** A year's title picked (checking the year if it wasn't); its role tier comes from the roles file. */
export function setYearTitle(a: ActivityEntry, year: HsYear, title: string): ActivityEntry {
  const years = a.years.includes(year) ? a.years : [...a.years, year].sort((x, y) => x - y);
  // Keep every other year's displayed title explicit, so an entry saved before titles reads the same after one edit.
  const titles: Partial<Record<HsYear, string>> = {};
  for (const y of years) titles[y] = y === year ? title : yearTitle({ ...a, years }, y) ?? defaultTitle(a.kind);
  const roles: ActivityEntry["roles"] = {};
  for (const y of years) roles[y] = roleForTitle(a.kind, titles[y]!);
  return { ...a, years, titles, roles };
}

/* ------------------------------------------------------------------ */
/* Hours and recognition                                               */
/* ------------------------------------------------------------------ */

/** Hours a week as typed: a whole number 1–60, else null (the sanitizer's own bounds). */
export function parseHours(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 60 ? n : null;
}

/** The hours field's hint: null when empty or valid, else the range. */
export function hoursHint(s: string): string | null {
  return s.trim() === "" || parseHours(s) !== null ? null : "A number from 1 to 60.";
}

export interface RecognitionChoice {
  tier: RecognitionTier;
  label: string;
  example: string;
}

/** The recognition chips per step (the four tiers of depth.md, worded for the step; "took part" is the default, so it isn't a chip). Work has none. */
export function recognitionChoices(step: ActivityStep): RecognitionChoice[] {
  if (step === "work") return [];
  if (step === "sports") {
    return [
      { tier: 3, label: "School award", example: "MVP, varsity letter" },
      { tier: 2, label: "All-conference or all-state", example: "all-region, state champion" },
      { tier: 1, label: "National", example: "All-American, national team" },
    ];
  }
  if (step === "clubs") {
    return [
      { tier: 3, label: "School award", example: "a school award, a lead role" },
      { tier: 2, label: "State or regional", example: "DECA or HOSA states placing, all-state band" },
      { tier: 1, label: "National", example: "a nationals placing, a national award" },
    ];
  }
  return [
    { tier: 3, label: "School", example: "a school award" },
    { tier: 2, label: "State or regional", example: "a state or regional award" },
    { tier: 1, label: "National", example: "a national award, a published paper" },
  ];
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** What the Sports and Clubs search shows before anything is typed. */
export const POPULAR_SPORTS: readonly string[] = ["soccer", "basketball", "track_and_field", "cross_country", "volleyball", "swimming_and_diving", "football", "tennis", "baseball", "softball"];
export const POPULAR_CLUBS: readonly string[] = ["national_honor_society", "student_government", "key_club", "deca", "model_un", "speech_and_debate", "first_robotics_competition", "science_olympiad", "marching_band", "theater"];

/**
 * The search chips for Sports or Clubs: with no query, the popular ones; with one, the catalog's matches (acronyms
 * work: "DECA", "HOSA", "MUN"). Catalog entries already on the list never appear.
 */
export function searchStep(step: "sports" | "clubs", query: string, excludeKeys: readonly string[], limit = 8): CatalogActivity[] {
  const skip = new Set(excludeKeys);
  if (!query.trim()) {
    return (step === "sports" ? POPULAR_SPORTS : POPULAR_CLUBS)
      .map((k) => activityByKey(k))
      .filter((c): c is CatalogActivity => c !== null && !skip.has(c.key))
      .slice(0, limit);
  }
  return searchActivities(step === "sports" ? "sport" : "club", query, limit + skip.size)
    .filter((c) => !skip.has(c.key))
    .slice(0, limit);
}

/** The typed name a search would add as its own entry, or null when it's empty or exactly a match's name. */
export function typedCandidate(query: string, matches: readonly Pick<CatalogActivity, "name" | "aliases">[]): string | null {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) return null;
  const lower = q.toLowerCase();
  const exact = matches.some((m) => m.name.toLowerCase() === lower || catalogEntryName(m).toLowerCase() === lower);
  return exact ? null : q.slice(0, NAME_MAX);
}

/** What Enter adds from a search: an exact alias or name match first ("DECA", "MUN"), else the first match, else the typed name. */
export function enterPick(query: string, matches: readonly CatalogActivity[]): CatalogActivity | string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = matches.find((m) => m.name.toLowerCase() === q || m.aliases.some((al) => al.toLowerCase() === q));
  if (exact) return exact;
  if (matches[0]) return matches[0];
  return typedCandidate(query, matches);
}

/* ------------------------------------------------------------------ */
/* Awards (the Other step)                                             */
/* ------------------------------------------------------------------ */

export const POPULAR_AWARDS: readonly string[] = ["honor_roll", "ap_scholar", "varsity_letter", "school_subject_award", "national_merit_semifinalist", "eagle_scout", "aime_qualifier", "all_state_ensemble"];

/** Words students type for an award that its name doesn't contain. */
const AWARD_NICKNAMES: Readonly<Record<string, readonly string[]>> = {
  national_merit_semifinalist: ["nmsf", "merit", "psat"],
  national_merit_finalist: ["nmf", "merit", "psat"],
  national_merit_scholar: ["merit", "psat"],
  usamo_qualifier: ["math olympiad", "amc"],
  usajmo_qualifier: ["math olympiad", "amc", "jmo"],
  aime_qualifier: ["amc", "math"],
  regeneron_sts_finalist: ["sts", "science"],
  isef_finalist: ["science fair", "science"],
  state_science_fair_winner: ["science"],
  all_state_ensemble: ["band", "orchestra", "choir", "music"],
  state_athletic_champion: ["sports", "team"],
  eagle_scout: ["boy scouts", "scouts", "scouting"],
  girl_scout_gold_award: ["scouts", "scouting"],
  nsda_national_champion: ["debate", "nsda"],
  state_debate_champion: ["debate", "nsda"],
  presidential_volunteer_service_gold: ["pvsa", "volunteer"],
  presidential_volunteer_service_bronze_silver: ["pvsa", "volunteer"],
  national_honor_society: ["nhs"],
  national_junior_honor_society: ["njhs"],
};

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim().split(" ").filter(Boolean);

/**
 * The awards search (the catalog the `/me` award picker reads, data/reference/awards.json): with no query, the popular
 * awards; with one, every award whose nickname starts with it or whose name words each start with a query word, best
 * tier first then file order. Awards already on the list never appear.
 */
export function searchAwards(query: string, excludeKeys: readonly string[], limit = 8): AwardCatalogEntry[] {
  const skip = new Set(excludeKeys);
  const all = allAwards().filter((a) => !skip.has(a.key));
  const q = words(query);
  if (q.length === 0) return POPULAR_AWARDS.map((k) => all.find((a) => a.key === k)).filter((a): a is AwardCatalogEntry => Boolean(a)).slice(0, limit);
  const joined = q.join(" ");
  const ranked = all.flatMap((a, i) => {
    const nick = AWARD_NICKNAMES[a.key] ?? [];
    const nameWords = words(a.name);
    let rank: number | null = null;
    if (nick.some((n) => n === joined)) rank = 0;
    else if (q.every((p) => nameWords.some((w) => w.startsWith(p)))) rank = 1;
    else if (nick.some((n) => n.startsWith(joined))) rank = 2;
    return rank === null ? [] : [{ a, rank, i }];
  });
  return ranked.sort((x, y) => x.rank - y.rank || x.i - y.i).slice(0, limit).map((r) => r.a);
}

export function awardFromCatalog(entry: AwardCatalogEntry): AwardEntry {
  return { id: newActivityId("award"), key: entry.key, name: entry.name, tier: entry.tier, year: null };
}

/** "Something else": the typed name, school-level until the student picks another tier. */
export function typedAward(name: string): AwardEntry {
  return { id: newActivityId("award"), key: null, name: name.trim().slice(0, NAME_MAX), tier: 3, year: null };
}

/** The tier chips a typed award offers (the same four tiers; "took part" kept so an honor-roll-like entry fits). */
export const AWARD_TIER_CHOICES: readonly { tier: RecognitionTier; label: string }[] = [
  { tier: 3, label: "School" },
  { tier: 2, label: "State or regional" },
  { tier: 1, label: "National" },
  { tier: 4, label: "Took part" },
];

export function tierLabel(tier: RecognitionTier): string {
  return tier === 1 ? "National" : tier === 2 ? "State or regional" : tier === 3 ? "School" : "Took part";
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

const YEAR_SHORT: Record<HsYear, string> = { 9: "9th", 10: "10th", 11: "11th", 12: "12th" };
const yy = (y: number) => String(y % 100).padStart(2, "0");

/** The four year chips: "9th"…"12th", each with its school year ("24–25") once the class is known. */
export function yearChips(classYear: number | null): { year: HsYear; label: string; sub: string | null }[] {
  return HS_YEARS.map((year) => {
    const start = classYear === null ? null : classYear - 13 + year;
    return { year, label: YEAR_SHORT[year], sub: start === null ? null : `${yy(start)}–${yy(start + 1)}` };
  });
}

/**
 * A card's header pill: "Pick years" (nothing checked; the card stays open), else the years and the latest year's
 * title ("3 years · Captain", "11th · Intern"). `incomplete` also marks a typed club with no family picked yet.
 */
export function activitySummary(a: ActivityEntry): { text: string; incomplete: boolean } {
  if (a.years.length === 0) return { text: "Pick years", incomplete: true };
  const last = a.years[a.years.length - 1];
  const span = a.years.length === 1 ? YEAR_SHORT[last] : `${a.years.length} years`;
  const title = yearTitle(a, last);
  const text = title && title !== "Member" && title !== "Employee" ? `${span} · ${title}` : span;
  return { text, incomplete: asksFamily(a) && !a.family };
}

/** An award card's pill: "11th · State or regional", or the tier alone. */
export function awardSummary(a: AwardEntry): string {
  return a.year ? `${YEAR_SHORT[a.year]} · ${tierLabel(a.tier)}` : tierLabel(a.tier);
}

function names(list: readonly { name: string }[]): string {
  const shown = list.slice(0, 2).map((a) => a.name);
  const rest = list.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest} more` : shown.join(", ");
}

/** A step's Review value: the names ("Soccer, Track and Field +1 more"), or "None"; Other leads with the awards count. */
export function stepReviewValue(step: ActivityStep, activities: readonly ActivityEntry[], awards: readonly AwardEntry[], none = false): string {
  // "None" only when the student chose it (owner, 2026-10-12); an empty step they haven't answered says so.
  const empty = none ? "None" : "Not added";
  const mine = activitiesIn(activities, step);
  if (step !== "other") return mine.length === 0 ? empty : names(mine);
  const parts: string[] = [];
  if (awards.length > 0) parts.push(`${awards.length} award${awards.length === 1 ? "" : "s"}`);
  if (mine.length > 0) parts.push(names(mine));
  return parts.length === 0 ? empty : parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* "None" on a step (owner, 2026-10-12)                                */
/* ------------------------------------------------------------------ */

/** Whether a step has anything entered (the Other step counts its awards too). */
export function stepHasEntries(step: ActivityStep, activities: readonly ActivityEntry[], awards: readonly AwardEntry[]): boolean {
  return activitiesIn(activities, step).length > 0 || (step === "other" && awards.length > 0);
}

export interface StepAnswers {
  activities: ActivityEntry[];
  awards: AwardEntry[];
  activitiesNone: Partial<Record<ActivityStep, true>>;
}

/**
 * Choosing "None" on a step: removes that step's entries (the caller confirms first when there are any) and marks it
 * answered. Choosing it again un-marks it, leaving the step unanswered.
 */
export function toggleStepNone<T extends StepAnswers>(a: T, step: ActivityStep): T {
  if (a.activitiesNone[step]) {
    const rest = { ...a.activitiesNone };
    delete rest[step];
    return { ...a, activitiesNone: rest };
  }
  return {
    ...a,
    activities: a.activities.filter((x) => stepOfActivity(x) !== step),
    awards: step === "other" ? [] : a.awards,
    activitiesNone: { ...a.activitiesNone, [step]: true },
  };
}

/**
 * Whether the student has answered all four activity steps, each with an entry or "None" (owner, 2026-10-12): the
 * estimate then reads activities as answered for completeness (a student with truly no activities isn't counted as a
 * gap), though an empty list still earns no depth.
 */
export function allActivityStepsAnswered(activities: readonly ActivityEntry[], awards: readonly AwardEntry[], none: Partial<Record<ActivityStep, true>> | null | undefined): boolean {
  return ACTIVITY_STEPS.every((step) => none?.[step] === true || stepHasEntries(step, activities, awards));
}

/** Any step that has entries can't also be "None": adding an entry clears it. */
export function reconcileStepNone(activities: readonly ActivityEntry[], awards: readonly AwardEntry[], none: Partial<Record<ActivityStep, true>>): Partial<Record<ActivityStep, true>> {
  const out: Partial<Record<ActivityStep, true>> = {};
  for (const step of ACTIVITY_STEPS) if (none[step] && !stepHasEntries(step, activities, awards)) out[step] = true;
  return out;
}

/** A step's rail line on desktop ("2 sports", "1 award · 1 more"), or null with nothing added. */
export function stepRailSummary(step: ActivityStep, activities: readonly ActivityEntry[], awards: readonly AwardEntry[], none = false): string | null {
  if (none && !stepHasEntries(step, activities, awards)) return "None";
  const n = activitiesIn(activities, step).length;
  if (step === "sports") return n ? `${n} sport${n === 1 ? "" : "s"}` : null;
  if (step === "clubs") return n ? `${n} club${n === 1 ? "" : "s"}` : null;
  if (step === "work") return n ? `${n} added` : null;
  const parts = [awards.length ? `${awards.length} award${awards.length === 1 ? "" : "s"}` : null, n ? `${n} more` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
