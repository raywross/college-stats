/**
 * Does the quote state the fact? (round 2, specs/college-reported-data.md "Round 2 plan"). The quote check
 * (pages.mts quoteOnPage) proves the words are on the page; this proves the words are about the fact recorded. Each
 * rule names the terms a quote for that field must contain, so a true sentence about something else can't carry a
 * fact: round 1 published Alabama's "Freshmen … are not allowed to live in a fraternity or sorority house" as "no
 * deferred recruitment" (it says nothing about when students may join). Pure; returns null when the quote supports the
 * fact, else the reason it doesn't (logged as a dropped fact).
 */
import type { PolicyKey, Tradition } from "../../../lib/directories.ts";
import { foldText } from "./pages.mts";

const GREEK = /fraternit|sororit|greek|panhellenic|interfraternity|\bifc\b|\bnphc\b|\bmgc\b|chapter/;
const RECRUIT = /recruit|\brush\b|\bjoin|intake|bid\b|bids\b|new member|membership|pledg|affiliat/;
const FIRST_YEAR = /first[- ]year|freshm[ae]n|first[- ](semester|quarter|term)|new students|incoming|entering students|sophomore|second (semester|quarter|year)|deferred|credit hours|completed (one|a|their first)|spring semester|winter quarter/;
const SEASON = /\b(fall|autumn|spring|winter|summer|january|february|march|august|september|october|november|december)\b/;
const NEGATION = /\bno\b|\bnot\b|\bnone\b|\bwithout\b|n't\b|\bnever\b|\bprohibit|\bonly\b/;
const MEMBERS = /member|students|greeks?\b|affiliated|involved|community|undergraduates|men and women/;
const WHOLE = /(fraternit|frats?\b).*(sororit)|(sororit).*(fraternit)|\bgreeks?\b|greek (life|community|system)|fsl community|councils\b|chapters\b|community/;

/** The newest four-digit year (2000–2099) in `s`, or null. */
export function newestYear(s: string): number | null {
  const ys = [...s.matchAll(/\b20\d\d\b/g)].map((m) => Number(m[0]));
  return ys.length ? Math.max(...ys) : null;
}

/** Numbers as printed in a quote ("1,200" → 1200), for checking a count is the quote's own. */
export function numbersIn(s: string): number[] {
  const digits = [...s.matchAll(/\d[\d,]*(\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter((n) => Number.isFinite(n));
  const tokens = s.toLowerCase().match(/[a-z]+/g) ?? [];
  const words = tokens.flatMap((w, i) => {
    const a = WORD_NUMBERS[w];
    if (a === undefined) return [];
    const b = WORD_NUMBERS[tokens[i + 1] ?? ""];
    return a >= 20 && b !== undefined && b > 0 && b < 10 ? [a + b, a] : [a];
  });
  return [...digits, ...words];
}

/** Counts written as words ("nine IFC fraternities", "Eight of these organizations"). */
const WORD_NUMBERS: Record<string, number> = Object.fromEntries(
  ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    .map((w, i) => [w, i] as [string, number])
    .concat([["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50], ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90]])
);

const fold = (s: string) => foldText(s ?? "");

export type GreekField = "status_none" | "members_total" | "council" | "housing" | "deferred" | "formal_term";

/**
 * Greek facts. `value` is the recorded value ("yes"/"no", a count, a term); `today` (YYYY-MM-DD) dates the
 * staleness rule for the members total (a figure for a term more than a year before this one is not "the newest").
 */
/**
 * Words that name each council (round 3). A report table prints many numbers on one line, so a council's count must
 * come from a quote that names that council (or the council's own name as the extractor gave it).
 */
const COUNCIL_TERMS: Record<string, RegExp> = {
  npc: /panhellenic|pan-hellenic|\bnpc\b|\bcpc\b|\bphc\b|\bupc\b/,
  nic: /interfraternity|inter-fraternity|\bifc\b|\bnic\b/,
  nphc: /pan[- ]?hellenic|\bnphc\b|divine nine|historically black/,
  nalfo: /latin|\bnalfo\b|hispanic/,
  napa: /asian|\bnapa\b/,
  nmgc: /multicultural|multi-cultural|\bmgc\b|\bnmgc\b|\bumgc\b|\bmcgc\b|\bcgc\b|cultural/,
  lgbtq: /lgbt|queer|gay|lesbian/,
  professional: /./,
};

export function greekSupport(field: GreekField, value: unknown, quote: string, o: { term?: string; today: string; council?: string; name?: string; page?: string; file?: string }): string | null {
  const q = fold(quote);
  switch (field) {
    case "status_none":
      return GREEK.test(q) && NEGATION.test(q) ? null : "quote doesn't say the college has no fraternities or sororities";
    case "members_total": {
      if (!numbersIn(q).includes(Number(value))) return "the count isn't in the quote";
      if (!MEMBERS.test(q)) return "quote doesn't say what the count counts";
      // The whole community, not one council's page ("5,113 total active members" on the Panhellenic page).
      if (!WHOLE.test(q)) return "quote doesn't say the count is all fraternity and sorority members";
      const y = newestYear(`${o.term ?? ""} ${quote}`);
      if (y !== null && y < Number(o.today.slice(0, 4)) - 2) return `figure is for ${y}, not the newest`;
      return null;
    }
    case "council": {
      if (!numbersIn(q).includes(Number(value))) return "the count isn't in the quote";
      // Round 3: an old report (Texas A&M's office still links its 2020–2021 community reports) is not today's count.
      const y = newestYear(`${o.term ?? ""} ${quote} ${o.file ?? ""}`);
      if (y !== null && y < Number(o.today.slice(0, 4)) - 2) return `figure is for ${y}, not the newest`;
      if (!o.council) return null;
      // The council's own page ("The council currently oversees 11 recognized chapters" on Wake Forest's /ifc/ page)
      // names it in its address, and a page's sentence may lean on the one before it (UT Austin: "Eight of these
      // organizations…" after the NPHC's own paragraph): `page` carries the address and, for HTML pages only, the
      // words just before the quote. A report table's line (a PDF) must name the council itself.
      const where = `${q} ${fold((o.page ?? "").replace(/[-_/.]+/g, " "))}`;
      const name = fold(o.name ?? "");
      // "19 social sororities" names the Panhellenic side and "nine IFC fraternities" the IFC side; a line about
      // "fraternities and sororities" names neither.
      const side = (o.council === "npc" && /sororit/.test(q) && !/fraternit/.test(q)) || (o.council === "nic" && /fraternit/.test(q) && !/sororit/.test(q));
      const named = side || (COUNCIL_TERMS[o.council] ?? /./).test(where) || (name.length > 2 && where.includes(name));
      return named ? null : "quote doesn't name the council the count is for";
    }
    case "housing":
      if (!GREEK.test(q)) return "quote isn't about fraternities or sororities";
      if (!/hous|live|living|residen|facilit|lodge|home/.test(q)) return "quote isn't about chapter housing";
      if (value === "no" && !NEGATION.test(q)) return "quote doesn't say there is no chapter housing";
      return null;
    case "deferred":
      if (!RECRUIT.test(q)) return "quote isn't about recruitment or joining";
      if (!FIRST_YEAR.test(q)) return "quote doesn't say when first-year students may join";
      return null;
    case "formal_term": {
      if (!RECRUIT.test(q)) return "quote isn't about recruitment";
      const v = fold(String(value));
      const vs = SEASON.exec(v)?.[1];
      if (!vs) return "term names no season or month";
      if (!SEASON.test(q)) return "quote names no season or month";
      const season = (s: string) => (["august", "september", "october", "november", "autumn", "fall"].includes(s) ? "fall" : ["january", "february", "march", "winter", "spring"].includes(s) ? "spring" : s);
      const qs = new Set([...q.matchAll(new RegExp(SEASON.source, "g"))].map((m) => season(m[1])));
      return qs.has(season(vs)) ? null : "the quote's season isn't the recorded term";
    }
  }
}

/** Terms a faith group's name or quote must contain for its tradition ("other" and "interfaith" are looser). */
const TRADITION_TERMS: Record<Tradition, RegExp> = {
  christian: /christ|baptist|methodist|lutheran|presbyterian|episcopal|anglican|evangelical|reformed|wesley|canterbury|intervarsity|\bcru\b|navigators|chi alpha|young life|\bfca\b|fellowship of christian|campus outreach|ministr|church|bible|gospel|protestant|pentecostal|nondenominational|quaker|friends|mennonite|adventist|\bucc\b|disciples/,
  catholic: /catholic|newman|jesuit|\bmass\b|parish|aquinas|focus\b|knights of columbus/,
  orthodox: /orthodox|\bocf\b|coptic/,
  jewish: /jewish|hillel|chabad|judai|jews|shabbat|kosher|torah|\bjsu\b|meor/,
  muslim: /muslim|islam|\bmsa\b|ahmadiyya/,
  hindu: /hindu|vedic|krishna|\bhyv\b|hindu yuva|\bhsc\b|sanatan/,
  sikh: /sikh/,
  buddhist: /buddh|\bzen\b|dharma|sangha/,
  latter_day_saint: /latter[- ]day|\blds\b|institute of religion|mormon/,
  bahai: /baha/,
  nonreligious: /secular|humanis|atheis|freethink|agnostic|skeptic/,
  interfaith: /interfaith|multi[- ]?faith|inter[- ]religious|religious life|spiritual|\bfaiths?\b/,
  other: /./,
};

export function faithGroupSupport(tradition: Tradition, name: string, quote: string): string | null {
  const q = fold(quote);
  const n = fold(name);
  if (n.length < 2) return "no name";
  if (!q.includes(n) && !n.split(" ").filter((w) => w.length > 3).some((w) => q.includes(w))) return "the group's name isn't in the quote";
  return TRADITION_TERMS[tradition].test(`${n} ${q}`) ? null : `nothing in the name or quote says ${tradition}`;
}

const GROUP_WORDS = /student (groups?|organi[sz]ations?|orgs?|clubs?)|\bclubs?\b|registered|\bmeets?\b|meetings|join us|chapter of|\bgroups?\b|organi[sz]ation/;
const LGBTQ_WORDS = /lgbt|queer|gay|lesbian|bisexual|trans\b|transgender|pride|\bgsa\b|gender|sexuality|spectrum|rainbow|\bally\b|allies|out\b/;

/**
 * An LGBTQ+ group the college's own page names. `listPage`: the page is the college's list of groups or its center
 * (discovery's lgbtq_groups or lgbtq_center, or a group page followed from the center); elsewhere (a news story, a
 * center's history) the quote must itself present the name as a group, and the name or quote must be about LGBTQ+
 * students.
 */
export function lgbtqGroupSupport(name: string, quote: string, listPage: boolean): string | null {
  const q = fold(quote);
  const n = fold(name);
  if (n.length < 2 || !q.includes(n)) return "the group's name isn't in the quote";
  // On a list (the groups page, or the center's own page), an entry is the name and a short line at most; a long
  // sentence there is prose (a news item on the center's site) and has to present the name as a group itself.
  if (listPage && q.length <= n.length + 80) return null;
  const rest = q.split(n).join(" ");
  if (!GROUP_WORDS.test(rest)) return "quote doesn't present it as a student group";
  if (!LGBTQ_WORDS.test(`${n} ${rest}`)) return "nothing in the name or quote is about LGBTQ+ students";
  return null;
}

const PROTECTED = /\brace\b|\bcolou?r\b|religio|national origin|\bsex\b|\bage\b|disabilit|veteran|marital|genetic|ethnic|pregnan|ancestry|creed/g;
const CARE = /gender[- ]affirming|transition[- ]related|gender transition|gender dysphoria|sex reassignment|gender reassignment|hormone|gender confirmation|transgender (services|surgery|care)/;
const COVER = /\bcover(s|ed|age)?\b|\bbenefits?\b|\bexclu|\bnot covered\b|\blimitations?\b|\beligible expenses\b/;

/** A policy "yes" or "no". `quote` may join parts with "…"; the coverage rule needs both terms in one part. */
export function policySupport(key: PolicyKey, value: "yes" | "no", quote: string): string | null {
  const q = fold(quote);
  const parts = quote.split(/\.\.\.|…/).map(fold);
  switch (key) {
    case "nondiscrimination_orientation":
    case "nondiscrimination_identity": {
      const term = key === "nondiscrimination_orientation" ? /sexual orientation/ : /gender identity|gender expression/;
      if (value === "yes") return term.test(q) ? null : `quote doesn't list ${key === "nondiscrimination_orientation" ? "sexual orientation" : "gender identity"}`;
      if (term.test(q)) return "quote lists the category it is said to omit";
      return (q.match(PROTECTED) ?? []).length >= 3 && /discriminat|equal opportunity/.test(q) ? null : "quote isn't the list of protected categories";
    }
    case "inclusive_housing":
      if (value === "yes") return /gender[- ]inclusive|all[- ]gender|gender[- ]neutral|mixed[- ]gender|open housing|any gender|regardless of (sex|gender)|gender[- ]open|co-?ed rooms?/.test(q) ? null : "quote doesn't name gender-inclusive housing";
      return /single[- ]sex|same[- ]sex|same gender|by (biological )?sex|by gender|male and female/.test(q) && /room|hall|hous|assign/.test(q) ? null : "quote doesn't say rooms are assigned by sex";
    case "name_on_records":
      if (!/(chosen|preferred|lived|display) (first )?name|name change/.test(q)) return "quote isn't about chosen names";
      if (value === "no" && !NEGATION.test(q)) return "quote doesn't say students can't use a chosen name";
      return null;
    case "inclusive_restrooms":
      if (!/(all[- ]gender|gender[- ]inclusive|gender[- ]neutral|single[- ](user|occupancy|stall)|unisex)/.test(q) || !/restroom|bathroom|washroom|toilet/.test(q)) return "quote isn't about all-gender restrooms";
      if (value === "no" && !NEGATION.test(q)) return "quote doesn't say there are none";
      return null;
    case "health_plan_transition":
      if (!parts.some((p) => CARE.test(p) && COVER.test(p))) return "no part of the quote says the plan covers or excludes transition care";
      if (value === "no" && !/exclu|not covered|limitation/.test(q)) return "quote doesn't exclude transition care";
      return null;
    case "trans_admission":
      return /transgender|trans\b|nonbinary|non-binary|gender identity|identif(y|ies) as (a )?wom[ae]n|identif(y|ies) as (a )?m[ae]n/.test(q) && /admi|appl|consider|eligible|enroll/.test(q) ? null : "quote isn't an admission policy for transgender applicants";
    default:
      return null;
  }
}

/** A conduct-code restriction: the quote itself names what it restricts. */
export function conductSupport(quote: string): string | null {
  return /same[- ]sex|homosexual|man and a woman|one man and one woman|sexual (intimacy|relations|activity|immorality|behavior|conduct)|gender identity|biological sex|birth sex|cross[- ]dress|transgender|gender expression|sex (assigned|at birth)|romantic|chastity/.test(fold(quote)) ? null : "quote doesn't say what the code restricts";
}

/** An LGBTQ+ center: the name or quote is about LGBTQ+ students; a closure quote says it closed. */
export function centerSupport(status: "open" | "closed", name: string, quote: string): string | null {
  const t = fold(`${name} ${quote}`);
  if (!/lgbt|queer|gender|sexuality|pride|rainbow|spectrum|trans|stonewall/.test(t)) return "nothing in the name or quote is about LGBTQ+ students";
  if (status === "closed" && !/clos|eliminat|dissolv|restructur|no longer|shut|consolidat/.test(fold(quote))) return "quote doesn't say it closed";
  return null;
}
