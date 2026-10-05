/**
 * Comparative takeaways for the compare overview's topic cards (specs/compare-redesign.md#overview-page): one sentence
 * per card, two clauses at most, from the figures the card shows (plus yield and the selectivity trend, which the topic
 * pages show): "Harvard admits 4.2%, UCLA 9.0%, Ohio State 61%; Harvard's yield is highest at 84%." A clause names only
 * the colleges that report its figure, reads ties as ties, and compares the colleges with each other, never with the
 * nation: no rank or percentile is claimed. Pure (runtime imports only from other pure modules), so tests load it
 * directly; lib/insights.ts#keyDifferences writes the overview's list in the same voice.
 */
import type { School } from "./types";
import type { TopicKey } from "./profile-topics";
import { METRICS } from "./metrics.ts";
import { indicatorOf, type Direction, type IndicatorKey } from "./indicators.ts";
import { shortName } from "./brand.ts";
import { moneyCompact, num, pct, pctSmart } from "./format.ts";

export interface TakeawayContext {
  /** The longest sentence a card takes (characters); a second clause that would pass it is left out. Default 170. */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 170;

/** The card's sentence for these colleges, or undefined with fewer than two or nothing to compare. */
export function compareTakeaway(topic: TopicKey, schools: readonly School[], ctx: TakeawayContext = {}): string | undefined {
  if (schools.length < 2) return undefined;
  const max = ctx.maxLength ?? DEFAULT_MAX_LENGTH;
  switch (topic) {
    case "admissions":
      return sentence(admissionsClauses(schools), max);
    case "students":
      return sentence(studentsClauses(schools), max);
    case "academics":
      return sentence(academicsClauses(schools), max);
    case "cost":
      return sentence(costClauses(schools), max);
    case "outcomes":
      return sentence(outcomesClauses(schools), max);
    case "history":
      return sentence(historyClauses(schools), max);
  }
}

/* ------------------------------------------------------------------ */
/* Wording helpers                                                      */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "Harvard", "Harvard and UCLA", "Harvard, UCLA, and Ohio State". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Clauses that themselves contain "and": "A leads at X and Y, and B at Z". */
function listClauses(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** "both", "all three", "all four". */
function everyOne(n: number): string {
  return n === 2 ? "both" : `all ${NUMBER_WORDS[n] ?? n}`;
}

/** The colleges in a group by name, or "both" / "all three" when the group is every college compared. */
function who(group: readonly School[], all: readonly School[]): string {
  return group.length === all.length && all.length > 1 ? everyOne(all.length) : listNames(group.map(shortName));
}

const possessive = (s: School) => `${shortName(s)}'s`;

/** First clause, then the first later one that fits in `max` characters; capitalized, with a period. */
function sentence(clauses: readonly (string | null)[], max: number): string | undefined {
  const [first, ...rest] = clauses.filter((c): c is string => !!c);
  if (!first) return undefined;
  const second = rest.find((c) => first.length + c.length + 3 <= max);
  const text = second ? `${first}; ${second}` : first;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

interface Entry {
  s: School;
  v: number;
}

/** The colleges that report a figure, in compare order. */
function entries(schools: readonly School[], get: (s: School) => number | null): Entry[] {
  return schools.flatMap((s) => {
    const v = get(s);
    return v === null ? [] : [{ s, v }];
  });
}

/** The lowest and highest (the first in compare order on a tie). */
function extremes(list: readonly Entry[]): { lo: Entry; hi: Entry } {
  return list.reduce((acc, e) => ({ lo: e.v < acc.lo.v ? e : acc.lo, hi: e.v > acc.hi.v ? e : acc.hi }), { lo: list[0], hi: list[0] });
}

/**
 * Who leads on a figure, as the figure is printed (two colleges at 84% tie): "one" leader, "some" tied at the top, or
 * "all" of those reporting it the same. Null when fewer than two report it.
 */
function leader(list: readonly Entry[], format: (v: number) => string): { kind: "one" | "some" | "all"; top: School[]; value: string } | null {
  if (list.length < 2) return null;
  const value = format(Math.max(...list.map((e) => e.v)));
  const top = list.filter((e) => format(e.v) === value).map((e) => e.s);
  return { kind: top.length === list.length ? "all" : top.length === 1 ? "one" : "some", top, value };
}

/** "only Harvard reports a graduation rate (98%)": a figure one college reports. */
function onlyOne(e: Entry, what: string, value: string): string {
  return `only ${shortName(e.s)} reports ${what} (${value})`;
}

/** The superlative among three or more, the comparative between two: "highest" / "higher". */
function most(count: number, superlative: string, comparative: string): string {
  return count > 2 ? superlative : comparative;
}

/* ------------------------------------------------------------------ */
/* Getting in                                                           */
/* ------------------------------------------------------------------ */

/** Each college's acceptance rate, most selective first; who doesn't report one; whose yield is highest. */
function admissionsClauses(schools: readonly School[]): (string | null)[] {
  const rates = entries(schools, METRICS.acceptance.get).sort((a, b) => a.v - b.v);
  const missing = schools.filter((s) => METRICS.acceptance.get(s) === null);
  if (!rates.length) return [schools.length === 2 ? "neither reports an acceptance rate" : `none of the ${NUMBER_WORDS[schools.length]} reports an acceptance rate`];
  const listed = rates.map((e, i) => (i === 0 ? `${shortName(e.s)} admits ${pctSmart(e.v)}` : `${shortName(e.s)} ${pctSmart(e.v)}`)).join(", ");
  const unrated = missing.length ? `${listNames(missing.map(shortName))} ${missing.length === 1 ? "doesn't" : "don't"} report an acceptance rate` : null;
  const withYield = entries(schools, METRICS.yield.get);
  const yields = leader(withYield, (v) => pct(v));
  const yieldClause =
    !yields
      ? null
      : yields.kind === "one"
        ? withYield.length > 2
          ? `${possessive(yields.top[0])} yield is highest at ${yields.value}`
          : `${possessive(yields.top[0])} yield is higher, at ${yields.value}`
        : yields.kind === "some"
          ? `${listNames(yields.top.map(shortName))} share the highest yield, ${yields.value}`
          : `${who(yields.top, schools)} have the same yield, ${yields.value}`;
  return [listed, unrated ?? yieldClause];
}

/* ------------------------------------------------------------------ */
/* Students                                                             */
/* ------------------------------------------------------------------ */

/** "twice", "six times": a size ratio in words when it is a whole number to one decimal; null otherwise. */
export function timesInWords(ratio: number): string | null {
  const tenths = Math.round(ratio * 10);
  if (tenths % 10 !== 0) return null;
  const n = tenths / 10;
  if (n < 2) return null;
  return n === 2 ? "twice" : `${NUMBER_WORDS[n] ?? num(n)} times`;
}

/**
 * How the largest compares with the smallest ("six times", "4.4× as many", or the two counts when the gap is beyond
 * words), then who has the largest Pell share, joined into one clause when it's the same college.
 */
function studentsClauses(schools: readonly School[]): (string | null)[] {
  const sizes = entries(schools, METRICS.enrollment.get).filter((e) => e.v > 0);
  let size: string | null = null;
  let subject: School | null = null;
  if (sizes.length >= 2) {
    const { lo, hi } = extremes(sizes);
    const ratio = hi.v / lo.v;
    const words = timesInWords(ratio);
    subject = ratio < 1.1 ? null : ratio >= 20 ? lo.s : hi.s;
    size =
      ratio >= 20
        ? `${shortName(lo.s)} has ${num(lo.v)} undergrads to ${possessive(hi.s)} ${num(hi.v)}`
        : ratio >= 1.5
          ? words
            ? `${shortName(hi.s)} is ${words} ${possessive(lo.s)} size`
            : `${shortName(hi.s)} has ${ratio.toFixed(1)}× as many undergrads as ${shortName(lo.s)}`
          : ratio < 1.1
            ? `${sizes.length === 2 ? listNames(sizes.map((e) => shortName(e.s))) : who(sizes.map((e) => e.s), schools)} are about the same size`
            : `${shortName(hi.s)} is a bit larger than ${shortName(lo.s)} (${num(hi.v)} vs. ${num(lo.v)} undergrads)`;
  }
  const withPell = entries(schools, METRICS.pell.get);
  const pell = leader(withPell, (v) => pct(v));
  const largest = most(withPell.length, "largest", "larger");
  if (size && pell?.kind === "one" && pell.top[0] === subject) return [`${size} and has the ${largest} Pell share`];
  const pellClause = !pell
    ? withPell.length === 1
      ? onlyOne(withPell[0], "a Pell share", pct(withPell[0].v))
      : null
    : pell.kind === "one"
      ? `${shortName(pell.top[0])} has the ${largest} Pell share`
      : pell.kind === "some"
        ? `${listNames(pell.top.map(shortName))} have the largest Pell shares`
        : `${who(pell.top, schools)} have the same Pell share, ${pell.value}`;
  return [size, pellClause];
}

/* ------------------------------------------------------------------ */
/* Academics                                                            */
/* ------------------------------------------------------------------ */

/**
 * A program title for a sentence: "Finance, General" reads "Finance", and "Research and Experimental Psychology, Other"
 * reads "Research and Experimental Psychology" (the card's row keeps the exact title).
 */
export function majorInSentence(title: string): string {
  return title.replace(/\s+/g, " ").trim().replace(/, (General|Other)$/, "");
}

/** "7 students per faculty member", "1 student per faculty member". */
function perFaculty(n: number): string {
  return `${num(n)} ${n === 1 ? "student" : "students"} per faculty member`;
}

/** Which major leads where, then the fewest and most students per faculty member. */
function academicsClauses(schools: readonly School[]): (string | null)[] {
  const groups: { title: string; schools: School[] }[] = [];
  for (const s of schools) {
    const top = s.academics?.majors_top?.[0];
    if (!top) continue;
    const title = majorInSentence(top.title);
    const group = groups.find((g) => g.title === title);
    if (group) group.schools.push(s);
    else groups.push({ title, schools: [s] });
  }
  const majors = !groups.length
    ? null
    : groups.length === 1
      ? `${groups[0].title} leads at ${who(groups[0].schools, schools)}`
      : listClauses(groups.map((g, i) => `${g.title}${i === 0 ? " leads" : ""} at ${listNames(g.schools.map(shortName))}`));

  const ratios = entries(schools, METRICS.studentFaculty.get);
  let ratio: string | null = null;
  if (ratios.length === 1) ratio = onlyOne(ratios[0], "a student-to-faculty ratio", METRICS.studentFaculty.format(ratios[0].v));
  else if (ratios.length >= 2) {
    const { lo, hi } = extremes(ratios);
    ratio =
      lo.v === hi.v
        ? `${who(ratios.map((e) => e.s), schools)} have ${perFaculty(lo.v)}`
        : `${shortName(lo.s)} has ${perFaculty(lo.v)} to ${possessive(hi.s)} ${num(hi.v)}`;
  }
  return [majors, ratio];
}

/* ------------------------------------------------------------------ */
/* Cost & aid                                                           */
/* ------------------------------------------------------------------ */

/**
 * How much less the cheapest costs than the most expensive, then whose grants cover the most of its price, joined into
 * one clause when it's the same college.
 */
function costClauses(schools: readonly School[]): (string | null)[] {
  const costs = entries(schools, METRICS.avgCost.get);
  let cost: string | null = null;
  let subject: School | null = null;
  if (costs.length === 1) cost = onlyOne(costs[0], "an average cost", moneyCompact(costs[0].v));
  else if (costs.length >= 2) {
    const { lo, hi } = extremes(costs);
    if (hi.v - lo.v < 1000) cost = `${costs.length === 2 ? listNames(costs.map((e) => shortName(e.s))) : who(costs.map((e) => e.s), schools)} cost about the same a year on average`;
    else {
      cost = `${shortName(lo.s)} costs about ${moneyCompact(hi.v - lo.v)} less a year than ${shortName(hi.s)} on average`;
      subject = lo.s;
    }
  }
  const withAid = entries(schools, METRICS.aidGenerosity.get);
  const aid = leader(withAid, (v) => pct(v));
  const largest = most(withAid.length, "largest", "larger");
  if (cost && aid?.kind === "one" && aid.top[0] === subject) return [`${cost}, and its grants cover the ${largest} share of its price`];
  const aidClause = !aid
    ? null
    : aid.kind === "one"
      ? `${possessive(aid.top[0])} grants cover the ${largest} share of its price`
      : aid.kind === "some"
        ? `grants cover the largest share of the price at ${listNames(aid.top.map(shortName))}`
        : `grants cover the same share of the price at ${who(aid.top, schools)}, ${aid.value}`;
  return [cost, aidClause];
}

/* ------------------------------------------------------------------ */
/* Outcomes                                                             */
/* ------------------------------------------------------------------ */

/** Where former students earn the most, then graduation within six years (a shared floor, or the range). */
function outcomesClauses(schools: readonly School[]): (string | null)[] {
  const earnings = entries(schools, METRICS.earnings.get);
  const top = leader(earnings, moneyCompact);
  const after = "ten years after enrolling";
  const earn =
    earnings.length === 1
      ? `${possessive(earnings[0].s)} former students earn a median ${moneyCompact(earnings[0].v)} ${after}`
      : !top
        ? null
        : top.kind === "one"
          ? `${possessive(top.top[0])} former students earn ${most(earnings.length, "the most", "more")}, a median ${top.value} ${after}`
          : top.kind === "some"
            ? `former students earn the most at ${listNames(top.top.map(shortName))}, a median ${top.value} ${after}`
            : `former students earn about the same at ${who(top.top, schools)}, a median ${top.value} ${after}`;

  const rates = entries(schools, METRICS.gradRate.get);
  let grad: string | null = null;
  if (rates.length === 1) grad = onlyOne(rates[0], "a graduation rate", pct(rates[0].v));
  else if (rates.length >= 2) {
    const { lo, hi } = extremes(rates);
    const group = rates.map((e) => e.s);
    const subject = group.length === schools.length ? everyOne(group.length) : `${listNames(group.map(shortName))} ${group.length === 2 ? "both" : "all"}`;
    // A floor every college clears, in tens of the rates as printed: "more than 80%" (or "at least 80%" when the lowest
    // prints as 80%).
    const floor = Math.floor(Math.round(lo.v * 100) / 10 + 1e-9) / 10;
    if (hi.v - lo.v <= 0.2 && floor >= 0.5) grad = `${subject} graduate ${pct(lo.v) === pct(floor) ? "at least" : "more than"} ${pct(floor)} within six years`;
    else if (pct(hi.v) === pct(lo.v)) grad = `${subject} graduate ${pct(hi.v)} within six years`;
    else grad = `six-year graduation runs from ${pct(hi.v)} at ${shortName(hi.s)} to ${pct(lo.v)} at ${shortName(lo.s)}`;
  }
  return [earn, grad];
}

/* ------------------------------------------------------------------ */
/* Over time                                                            */
/* ------------------------------------------------------------------ */

/** Colleges by the direction of one ten-year indicator, in compare order; colleges without it are left out. */
function byDirection(schools: readonly School[], key: IndicatorKey): Record<Direction, School[]> {
  const out: Record<Direction, School[]> = { up: [], steady: [], down: [] };
  for (const s of schools) {
    const i = indicatorOf(s, key);
    if (i) out[i.direction].push(s);
  }
  return out;
}

/** Where applications grew, held, or fell; then who got more or less selective. */
function historyClauses(schools: readonly School[]): (string | null)[] {
  const apps = byDirection(schools, "applications");
  const appVerbs: Record<Direction, string> = { up: "grew", steady: "held steady", down: "fell" };
  const appGroups = (["up", "steady", "down"] as const).filter((d) => apps[d].length);
  const applications =
    appGroups.length === 0
      ? null
      : appGroups.length === 1
        ? `applications ${appVerbs[appGroups[0]]} at ${who(apps[appGroups[0]], schools)}`
        : appGroups.length === 2
          ? `applications ${appVerbs[appGroups[0]]} at ${listNames(apps[appGroups[0]].map(shortName))} but ${appVerbs[appGroups[1]]} at ${listNames(apps[appGroups[1]].map(shortName))}`
          : `applications grew at ${listNames(apps.up.map(shortName))}, held steady at ${listNames(apps.steady.map(shortName))}, and fell at ${listNames(apps.down.map(shortName))}`;

  const sel = byDirection(schools, "selectivity");
  const names = (d: Direction) => listNames(sel[d].map(shortName));
  const selGroups = (["up", "down", "steady"] as const).filter((d) => sel[d].length);
  // One college with history: one clause about it ("Applications grew at Harvard, whose selectivity held steady").
  const only = appGroups.length === 1 && apps[appGroups[0]].length === 1 ? apps[appGroups[0]][0] : null;
  if (applications && only && selGroups.length === 1 && sel[selGroups[0]].length === 1 && sel[selGroups[0]][0] === only) {
    const d = selGroups[0];
    return [`${applications}, ${d === "steady" ? "whose selectivity held steady" : `which got ${d === "up" ? "more" : "less"} selective`}`];
  }
  let selectivity: string | null = null;
  if (selGroups.length === 1) {
    const [d] = selGroups;
    const group = who(sel[d], schools);
    selectivity = d === "steady" ? `selectivity held steady at ${group}` : `${group} got ${d === "up" ? "more" : "less"} selective`;
  } else if (selGroups.length === 2) {
    if (sel.steady.length) {
      const moved = selGroups[0];
      selectivity = `${names(moved)} got ${moved === "up" ? "more" : "less"} selective while ${names("steady")} held steady`;
    } else {
      // The smaller group first (more selective on a tie): "Ohio State got less selective while Harvard and UCLA got more".
      const [first, second] = sel.down.length < sel.up.length ? (["down", "up"] as const) : (["up", "down"] as const);
      selectivity = `${names(first)} got ${first === "up" ? "more" : "less"} selective while ${names(second)} got ${second === "up" ? "more" : "less"}`;
    }
  } else if (selGroups.length === 3) {
    selectivity = `${names("up")} got more selective, ${names("down")} less, and ${names("steady")} held steady`;
  }
  return [applications, selectivity];
}
