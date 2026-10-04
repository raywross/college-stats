/**
 * Fixed schemas for the campus-life pilot's model calls (discovery links, extraction per domain, the second check).
 * Every extracted fact names the page it came from (P1, P2, …) and quotes it; our code checks each quote is on that
 * page before anything is kept (pages.mts quoteOnPage).
 */
import { COUNCILS, POLICY_KEYS, TRADITIONS } from "../../../lib/directories.ts";

export type Domain = "greek" | "faith" | "lgbtq";
export const DOMAINS: readonly Domain[] = ["greek", "faith", "lgbtq"];

const str = { type: "string" } as const;
const nstr = { type: ["string", "null"] } as const;
const nint = { type: ["integer", "null"] } as const;
const nnum = { type: ["number", "null"] } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const arr = (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });
const urls = (description: string) => arr(str, description);

/* ------------------------------------------------------------------ */
/* Discovery: links only                                               */
/* ------------------------------------------------------------------ */

/** Source types per domain, as discovery returns them (the hit-rate table counts these). */
export const SOURCE_TYPES = {
  greek: ["fsl_office", "fsl_reports", "recruitment", "greek_none"],
  faith: ["faith_office", "faith_groups", "religion_report", "faith_estimate"],
  lgbtq: ["lgbtq_center", "lgbtq_groups", "nondiscrimination", "housing", "name_policy", "health_plan", "restrooms", "trans_admission", "conduct_code"],
} as const satisfies Record<Domain, readonly string[]>;
export type SourceType = (typeof SOURCE_TYPES)[Domain][number];

export const DISCOVERY_SCHEMAS: Record<Domain, Record<string, unknown>> = {
  greek: obj({
    fsl_office: { ...nstr, description: "The college's fraternity & sorority life office page" },
    fsl_reports: urls("Pages or files with chapter size, community, or grade reports (newest term), or the page listing them"),
    recruitment: { ...nstr, description: "The page on recruitment / joining (when, deferred or not)" },
    greek_none: { ...nstr, description: "Only if the college states it has no fraternities or sororities: the page that says so" },
    notes: str,
  }),
  faith: obj({
    faith_office: { ...nstr, description: "The college's chaplaincy, campus ministry, or religious/spiritual life office page" },
    faith_groups: { ...nstr, description: "The college's own page listing faith communities or religious student groups (office page or student-org directory category)" },
    religion_report: { ...nstr, description: "A college-published report or page stating students' religious affiliation (institutional research fact book, admissions facts page)" },
    faith_estimate: urls("Up to 2 pages where a campus faith group (Hillel, Chabad, Newman Center, …) states how many students it serves"),
    notes: str,
  }),
  lgbtq: obj({
    lgbtq_center: { ...nstr, description: "The college's LGBTQ+ center, office, or staff page (or a page about its closure)" },
    lgbtq_groups: { ...nstr, description: "The college's page listing LGBTQ+ student groups" },
    nondiscrimination: { ...nstr, description: "The college's nondiscrimination statement or policy" },
    housing: { ...nstr, description: "Housing page on gender-inclusive / all-gender housing or roommate assignment by gender" },
    name_policy: { ...nstr, description: "Registrar or policy page on chosen/preferred name and pronouns in records" },
    health_plan: { ...nstr, description: "Student health insurance plan summary or page on gender-affirming / transition-related coverage" },
    restrooms: { ...nstr, description: "Campus list or map of all-gender / gender-inclusive restrooms" },
    trans_admission: { ...nstr, description: "Only at historically women's or men's colleges: the admission policy for transgender and nonbinary applicants" },
    conduct_code: { ...nstr, description: "Only at religious colleges: the student conduct code, honor code, community covenant, or statement on sexuality that applies to students" },
    notes: str,
  }),
};

export const DISCOVERY_PROMPTS: Record<Domain, string> = {
  greek:
    "Find this college's fraternity & sorority life (Greek life) office and the pages where it publishes chapter or council size reports, community or grade reports (newest term), and recruitment rules. If the college states it has no fraternities or sororities, give that page instead.",
  faith:
    "Find this college's own office for religious or spiritual life (chaplaincy, campus ministry, interfaith office) and the college page that lists faith communities or religious student groups. If the college publishes students' religious affiliation (an institutional-research fact book or report, or an admissions page saying what share of students are of a faith), find it. Optionally, up to two pages where a campus faith group (campus Hillel, Chabad, Newman Center) states how many students it serves.",
  lgbtq:
    "Find this college's LGBTQ+ center or office page (or news of its closure), its page listing LGBTQ+ student groups, and its policy pages: nondiscrimination statement, housing (gender-inclusive or all-gender housing), chosen name and pronouns in student records, the student health insurance plan's coverage of transition-related care, a list of all-gender restrooms, and, only at a historically women's or men's college, its admission policy for transgender applicants. Only at a religious college: the student conduct code, honor code, community covenant, or statement on sexuality that students must follow.",
};

/** Which domain each discovery field belongs to. */
export const FIELD_DOMAIN: Record<string, Domain> = Object.fromEntries(
  (Object.entries(SOURCE_TYPES) as [Domain, readonly string[]][]).flatMap(([d, types]) => types.map((t) => [t, d]))
);

/**
 * Round 2's one paid discovery call per college: only the fields the free probes didn't find, all three domains in one
 * strict `save_links` schema (descriptions from DISCOVERY_SCHEMAS). `greek_none` rides along with `fsl_office`.
 */
export function combinedDiscovery(missing: readonly string[]): { schema: Record<string, unknown>; prompt: string } {
  const fields = [...new Set(missing.flatMap((t) => (t === "fsl_office" ? ["fsl_office", "greek_none"] : [t])))].filter((t) => FIELD_DOMAIN[t]);
  const props: Record<string, unknown> = {};
  for (const f of fields) props[f] = (DISCOVERY_SCHEMAS[FIELD_DOMAIN[f]] as { properties: Record<string, unknown> }).properties[f];
  props.notes = str;
  const lines = fields.map((f) => `- ${f}: ${String((props[f] as { description?: string }).description ?? f)}`);
  return {
    schema: obj(props),
    prompt: `Our program already looked on this college's site and found the other pages it needs. Find only these, on the college's own site:\n${lines.join("\n")}\nUse as few searches as you can (one search can find several). Leave a field null when you don't find it.`,
  };
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

// Unions are capped per request (16; specs/college-reported-round-3.md, #64), so "not stated" is 0 / "" rather than null
// everywhere except the counts.
const ref = { page: { type: "integer", description: "The P number of the page; 0 if none" }, quote: { type: "string", description: 'Exact words copied from that page; "" if none' } };
const estr = { type: "string", description: '"" if not stated' } as const;
// Round 2: "not_stated" is its own answer, so a page that doesn't say isn't forced into a yes or a no.
const yesNo = (extra: readonly string[] = []) => ({ type: "string", enum: ["yes", "no", "not_stated", ...extra] });
const councilEnum = { type: "string", enum: Object.keys(COUNCILS) };
const traditionEnum = { type: "string", enum: Object.keys(TRADITIONS) };
const confidence = { type: "string", enum: ["high", "low"], description: "low if any fact is a judgment call" };

export const EXTRACTION_SCHEMAS: Record<Domain, Record<string, unknown>> = {
  greek: obj({
    status: obj({ value: { type: "string", enum: ["present", "none_stated", "unknown"] }, ...ref }),
    office_name: estr,
    members_total: obj({ value: nint, term: estr, ...ref }),
    councils: arr(obj({ council: councilEnum, name: str, chapters: nint, members: nint, term: estr, page: { type: "integer" }, quote: str })),
    housing: obj({ value: yesNo(), ...ref }),
    deferred: obj({ value: yesNo(), ...ref }),
    formal_term: obj({ value: estr, ...ref }),
    confidence,
  }),
  faith: obj({
    office: obj({ name: estr, ...ref }),
    communities: arr(obj({ name: str, tradition: traditionEnum, page: { type: "integer" }, quote: str })),
    composition: obj({
      items: arr(obj({ label: str, count: nint, share: nnum })),
      total: nint,
      population: estr,
      as_of: estr,
      ...ref,
    }),
    estimates: arr(
      obj({
        publisher: str,
        level: { type: "string", enum: ["local", "national"] },
        tradition: traditionEnum,
        count: nint,
        share: nnum,
        measure: { type: "string", enum: ["population_estimate", "members", "participants", "weekly_attendance", "class_enrollment", "unknown"] },
        population: { type: "string", enum: ["undergrads", "all_students", "several_campuses", "unknown"] },
        method: estr,
        as_of: estr,
        page: { type: "integer" },
        quote: str,
      })
    ),
    confidence,
  }),
  lgbtq: obj({
    center: obj({ status: { type: "string", enum: ["open", "closed", "none_found"] }, name: estr, closed: estr, ...ref }),
    groups: arr(obj({ name: str, page: { type: "integer" }, quote: str })),
    policies: obj(Object.fromEntries(Object.keys(POLICY_KEYS).map((k) => [k, obj({ value: { type: "string", enum: ["yes", "no", "not_found"] }, ...ref })]))),
    conduct: obj({ restricts: { type: "string", enum: ["yes", "no", "not_found"] }, document: estr, page: { type: "integer" }, quotes: arr(str) }),
    confidence,
  }),
};

export const EXTRACTION_SYSTEM = `You read pages a U.S. college published about campus life and record facts against a fixed schema. Each page is marked "### P<n>". Rules:
- Record only what the pages state. Never infer from a college's religious affiliation, reputation, or general knowledge.
- Every fact names the page it came from (its P number) and a quote: words copied exactly from that page (no paraphrase), short (one sentence or one table line, under 200 characters). Use "..." only to join two exact pieces of the same page.
- Use "" / 0 / null (counts) / "not_stated" / "not_found" / [] when the pages don't say. A missing page is not a "no".
- The quote must state the fact itself, in its own words: a sentence that is true but about something else (a housing rule quoted for recruitment, a news story quoted for a group) is not a quote for it. If no sentence states the fact, answer "not_stated" / "not_found" rather than inferring it.
- Counts are whole numbers exactly as printed. Never add up numbers yourself unless asked.
- Set confidence "low" if any recorded fact needed judgment.`;

export const EXTRACTION_PROMPTS: Record<Domain, string> = {
  greek: `Fraternity and sorority (Greek) life.
- status: "present" if the college has fraternities/sororities; "none_stated" only if a page says the college has none.
- office_name: the office's name as written.
- members_total: the total number of fraternity and sorority members the college states, from the NEWEST report or page, with the term it describes ("Spring 2026", "Fall 2025"). The quote must contain the number and say what it counts. Skip a figure for a term more than a year old, a percentage, or a number you would have to add up.
- councils: one row per governing council the pages describe (Panhellenic/NPC → npc; Interfraternity/IFC/NIC → nic; National Pan-Hellenic/NPHC → nphc; Latino/NALFO → nalfo; Asian/NAPA → napa; Multicultural/MGC/NMGC → nmgc; LGBTQ+ → lgbtq; anything else → professional). chapters and members only when printed for that council (a size report's council total line). Quote the line that has the number and names the council. Pages marked "fraternity & sorority report" are size, community, or grade reports (often tables): use the newest one, take a council's total row (not one chapter's), and give its term.
- housing: "yes" only if a sentence says chapters have houses or chapter facilities where members live (college-owned or private); "no" only if a sentence says there is no fraternity or sorority housing; otherwise "not_stated". A rule about who may live in a house is a "yes" for housing, nothing more.
- deferred: about WHEN students may first join. "yes" only if a sentence says first-year students cannot join (or recruitment is not open to them) until a later term, or that students must complete a semester or credits first; "no" only if a sentence says first-year or new students join (or recruitment happens) in their first term; otherwise "not_stated". A rule about living in a chapter house says nothing about recruitment: never use it here.
- formal_term: when formal (primary) recruitment happens, in a few words starting with the season ("Fall, before classes start", "Spring"), only if a sentence about recruitment names the season or month; otherwise "".`,
  faith: `Religious and spiritual life.
- office: the college's own office for religious/spiritual life (chaplaincy, campus ministry) if a page is that office's own page.
- communities: faith communities or religious student groups that the COLLEGE'S OWN pages name (its office or student-org directory), each with its tradition (christian for Protestant/evangelical/nondenominational groups; catholic; orthodox for Orthodox Christian; jewish; muslim; hindu; sikh; buddhist; latter_day_saint; bahai; nonreligious for secular/humanist; interfaith; other). Skip offices, events, and services that aren't communities or groups. Not from a faith group's own site. Quote the line that names the group; give the tradition only when the name or that line shows it, else "other".
- composition: students' religious affiliation as the COLLEGE publishes it (an institutional-research report or official page): each label with its count and/or share (share as a fraction, 80% → 0.8) exactly as printed, the total if printed, which students (population: "all students", "undergraduates", "first-year class"), and the term or year (as_of). Empty items if none.
- estimates: a faith group's own claim of how many students it serves or how many students of its faith are at the college (publisher, local or national, the number, what it counts, which students, method if stated, as_of if dated). Only from a page in the list.`,
  lgbtq: `LGBTQ+ life.
- center: the college's LGBTQ+ center or staffed office: "open" if the page shows it operating; "closed" if a page says it closed (with the closure date if stated); "none_found" otherwise.
- groups: LGBTQ+ student groups the college's own pages name AS student groups or organizations (a list of groups, a directory entry, "the student group X"). Not offices, programs, events, alumni networks, or names that only appear in a news story; quote the line that names the group.
- policies, each "yes", "no", or "not_found", with the quote:
  - nondiscrimination_orientation / nondiscrimination_identity: "yes" if the nondiscrimination statement lists sexual orientation / gender identity or expression; "no" only if a nondiscrimination statement listing the protected categories is on the page and does not include it (quote the list).
  - inclusive_housing: "yes" if the college offers gender-inclusive / all-gender / mixed-gender rooming; "no" only if a housing page says roommates or halls are assigned strictly by sex with no such option.
  - name_on_records: "yes" if students can use a chosen/preferred name in campus records or systems; "no" only if a page says they cannot.
  - inclusive_restrooms: "yes" if the college publishes a list or map of all-gender restrooms; "no" only if a page says there is none.
  - health_plan_transition: "yes" only if the student health INSURANCE plan says it covers transition-related or gender-affirming care (quote the coverage line); "no" only if the plan document excludes it (quote the exclusion). A health center offering care, or a page on how to get care, is "not_found".
  - trans_admission: only at a historically women's or men's college: "yes" if it states a policy admitting transgender or nonbinary applicants; else "not_found".
- conduct: whether the college's conduct code, honor code, or community covenant that students must follow restricts same-sex relationships, gender expression, or transition. "yes" with the exact sentences (quotes) that say so and the document's name; "no" if the code was on the pages and has no such rule; "not_found" if no such code is on the pages.`,
};

/* ------------------------------------------------------------------ */
/* The second check (owner decision 3)                                 */
/* ------------------------------------------------------------------ */

export const VERIFY_SCHEMA = obj({
  quote_on_page: { type: "boolean", description: "The quote appears on the page text (allowing spacing differences)" },
  confirmed: { type: "boolean", description: "The page, read in full context, supports the finding exactly as stated" },
  reason: { type: "string", description: "One sentence" },
});

export const VERIFY_SYSTEM = `You check one finding another model extracted from a U.S. college's own page. You get the finding, the quote it relied on, and the page text. Confirm it only if the quote is on the page AND the page, read in context, supports the finding exactly as stated: right college, current policy (not a historical, proposed, or other institution's text), and the right meaning (for example, a nondiscrimination list really omits the category; a conduct rule really applies to students and really restricts what the finding says). When in doubt, do not confirm.`;
