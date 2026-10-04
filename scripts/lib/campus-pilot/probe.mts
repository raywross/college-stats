/**
 * Free discovery for the campus-life pilot (round 2, specs/college-reported-data.md "Round 2 plan"): before any paid web
 * search, our code looks for each source type on the college's own site with plain HTTP, through the same robots-aware
 * PageFetcher (robots.txt, Crawl-delay, ≥ 2 s per host): the sitemaps robots.txt lists (or /sitemap.xml), the home page
 * and a few student-life hub pages it links to, well-known subdomains (fsl., chaplain., lgbtq., housing., registrar., …),
 * well-known paths (/fraternity-sorority-life, /religious-life, /lgbtq, /nondiscrimination, /title-ix, …), and the
 * site's own search page for whatever is still missing. Every candidate is matched by URL and link text, then the best
 * one per type is fetched and kept only if its text is about that thing (a catch-all redirect to the home page, or a
 * news story that merely mentions it, doesn't count).
 *
 * Probe refusals (robots.txt) are not blocks for the owner's list: a disallowed guess is just a miss.
 */
import { collegeDomain } from "../college-reported/probe.mts";
import { parseSitemap } from "../college-reported/probe.mts";
import type { FoundLink } from "../college-reported/documents.mts";
import type { Page, PageFetcher } from "./pages.mts";
import type { Domain } from "./schema.mts";

/** The source types free probes look for, with the domain each belongs to. */
export const PROBE_TYPES = {
  fsl_office: "greek",
  recruitment: "greek",
  faith_office: "faith",
  faith_groups: "faith",
  lgbtq_center: "lgbtq",
  lgbtq_groups: "lgbtq",
  nondiscrimination: "lgbtq",
  housing: "lgbtq",
  name_policy: "lgbtq",
  restrooms: "lgbtq",
  trans_admission: "lgbtq",
  conduct_code: "lgbtq",
} as const satisfies Record<string, Domain>;
export type ProbeType = keyof typeof PROBE_TYPES;

/** URL (path + host) and link-text patterns per type. */
const FSL = /fraternit|sororit|greek[-_ ]?(life|affairs|community)?\b|\bgreeks?\b|\b[o]?fsl\b|\bsfl\b|\bofsl\b|panhellenic/i;
const FAITH = /\breligio(us|n)\b|spiritual[-_ ]?(life|engagement)|spirituality|chaplain|chapel|campus[-_ ]?ministr|university[-_ ]?ministr|interfaith|multi[-_ ]?faith|\bfaith\b|\brssl\b/i;
const LGBTQ = /lgbt|glbt|bglt|queer|pride[-_ ]?(center|resource)|gender[-_ ]?(and|&)?[-_ ]?sexuality|sexuality[-_ ]?(and|&)?[-_ ]?gender|spectrum[-_ ]?center|rainbow|stonewall|\bqrc\b|gender[-_ ]?identity/i;
const GROUPS = /groups|organi[sz]ations|\borgs?\b|communities|clubs|directory|get[-_ ]?involved/i;

export const TYPE_URL: Record<ProbeType, (hay: string) => boolean> = {
  fsl_office: (h) => FSL.test(h),
  recruitment: (h) => FSL.test(h) && /recruit|\bjoin|rush|intake|membership|prospective/i.test(h),
  faith_office: (h) => FAITH.test(h),
  faith_groups: (h) => FAITH.test(h) && GROUPS.test(h),
  lgbtq_center: (h) => LGBTQ.test(h),
  lgbtq_groups: (h) => LGBTQ.test(h) && GROUPS.test(h),
  nondiscrimination: (h) => /non[-_ ]?discriminat|anti[-_ ]?discriminat|discrimination[-_ ]?(policy|statement|notice)|equal[-_ ]?(opportunity|employment)|\beeo\b|\beoaa\b|title[-_ ]?ix|notice[-_ ]?of[-_ ]?non/i.test(h),
  housing: (h) => /gender[-_ ]?(inclusive|neutral|open)|gender.{0,14}housing|housing.{0,24}gender|all[-_ ]?gender[-_ ]?(housing|living|rooms?)|open[-_ ]?housing|mixed[-_ ]?gender|inclusive[-_ ]?(housing|living)/i.test(h),
  name_policy: (h) => /(chosen|preferred|lived|display)[-_ ]?(first[-_ ]?)?name|pronoun|name[-_ ]?(and[-_ ]?)?(id[-_ ]?)?change/i.test(h),
  restrooms: (h) => /(all[-_ ]?gender|gender[-_ ]?(inclusive|neutral)|single[-_ ]?(user|occupancy)|unisex)[-_ ]?(restroom|bathroom|washroom|toilet)|restroom|bathroom/i.test(h),
  trans_admission: (h) => /trans(gender)?[-_ ]?(applicant|student|admission|polic)|gender[-_ ]?(identity|policy)|mission[-_ ]?and[-_ ]?gender|admission[-_ ]?polic/i.test(h),
  conduct_code: (h) => /code[-_ ]?of[-_ ]?conduct|student[-_ ]?(conduct|code|handbook)|honou?r[-_ ]?code|community[-_ ]?(standards|covenant|expectations|life[-_ ]?covenant)|lifestyle[-_ ]?(covenant|statement|expectations)|statement[-_ ]?on[-_ ]?sexuality|human[-_ ]?sexuality/i.test(h),
};

/** What a fetched page's text must say for it to count as that type. */
export const TYPE_TEXT: Record<ProbeType, RegExp[]> = {
  fsl_office: [/fraternit|sororit/i],
  recruitment: [/fraternit|sororit|panhellenic|interfraternity/i, /recruit|join|intake|rush/i],
  faith_office: [/chaplain|religious|spiritual|ministry|faith/i],
  faith_groups: [/chaplain|religious|spiritual|ministry|faith/i, /group|organi[sz]ation|communit|club/i],
  lgbtq_center: [/lgbt|queer|transgender|sexual orientation|gender identity|gender and sexuality/i],
  lgbtq_groups: [/lgbt|queer|transgender|pride/i, /group|organi[sz]ation|club/i],
  nondiscrimination: [/discriminat/i, /sexual orientation|gender identity|national origin|race,|color,/i],
  housing: [/gender[- ]inclusive|all[- ]gender|gender[- ]neutral|mixed[- ]gender|open housing|gender identity|transgender/i],
  name_policy: [/(chosen|preferred|lived|display) (first )?name|pronoun/i],
  restrooms: [/(all[- ]gender|gender[- ]inclusive|gender[- ]neutral|single[- ](user|occupancy)|unisex)/i, /restroom|bathroom|washroom/i],
  trans_admission: [/transgender|nonbinary|non-binary|gender identity/i, /admi(t|ssion)|appl(y|icant)/i],
  conduct_code: [/conduct|honou?r code|covenant|community standards|handbook/i],
};

/** Which types matter for a college (single-sex and religious items only where they apply). */
export function typesFor(c: { single_sex: boolean; affiliation: string | null }): ProbeType[] {
  return (Object.keys(PROBE_TYPES) as ProbeType[]).filter((t) => (t === "trans_admission" ? c.single_sex : t === "conduct_code" ? !!c.affiliation : true));
}

/** Well-known subdomains (hubs) and what a live one is evidence of (null: a hub to read links from). */
export const HUB_SUBDOMAINS: Record<string, ProbeType | null> = {
  fsl: "fsl_office",
  ofsl: "fsl_office",
  sfl: "fsl_office",
  greeklife: "fsl_office",
  greek: "fsl_office",
  greeks: "fsl_office",
  chaplain: "faith_office",
  chaplains: "faith_office",
  chapel: "faith_office",
  religiouslife: "faith_office",
  spirituallife: "faith_office",
  campusministry: "faith_office",
  ministry: "faith_office",
  lgbtq: "lgbtq_center",
  lgbt: "lgbtq_center",
  pride: "lgbtq_center",
  queer: "lgbtq_center",
  studentlife: null,
  studentaffairs: null,
  campuslife: null,
  dos: null,
  deanofstudents: null,
  housing: null,
  reslife: null,
  registrar: null,
  policy: null,
  policies: null,
  titleix: null,
  equity: null,
  diversity: null,
  inclusion: null,
};

/** Well-known paths on the main site, each tried once. */
export const WELL_KNOWN_PATHS: Record<string, ProbeType> = {
  "/fraternity-sorority-life": "fsl_office",
  "/fraternity-and-sorority-life": "fsl_office",
  "/greek-life": "fsl_office",
  "/fsl": "fsl_office",
  "/greeks": "fsl_office",
  "/student-life/fraternity-sorority-life": "fsl_office",
  "/religious-life": "faith_office",
  "/spiritual-life": "faith_office",
  "/chaplain": "faith_office",
  "/chaplaincy": "faith_office",
  "/campus-ministry": "faith_office",
  "/student-life/religious-life": "faith_office",
  "/student-life/spiritual-life": "faith_office",
  "/lgbtq": "lgbtq_center",
  "/lgbtq-center": "lgbtq_center",
  "/pride": "lgbtq_center",
  "/gender-sexuality": "lgbtq_center",
  "/student-life/lgbtq": "lgbtq_center",
  "/nondiscrimination": "nondiscrimination",
  "/non-discrimination": "nondiscrimination",
  "/nondiscrimination-statement": "nondiscrimination",
  "/policies/nondiscrimination": "nondiscrimination",
  "/title-ix": "nondiscrimination",
  "/titleix": "nondiscrimination",
  "/housing/gender-inclusive": "housing",
  "/housing/gender-inclusive-housing": "housing",
  "/gender-inclusive-housing": "housing",
  "/registrar/chosen-name": "name_policy",
  "/registrar/preferred-name": "name_policy",
  "/chosen-name": "name_policy",
  "/preferred-name": "name_policy",
  "/all-gender-restrooms": "restrooms",
  "/student-handbook": "conduct_code",
  "/community-standards": "conduct_code",
  "/code-of-conduct": "conduct_code",
};

/** Words a site search is asked for, per type (only for types still missing; at most `PROBE_LIMITS.searches`). */
const SEARCH_WORDS: Partial<Record<ProbeType, string>> = {
  nondiscrimination: "nondiscrimination statement",
  lgbtq_center: "LGBTQ center",
  faith_office: "religious life",
  fsl_office: "fraternity sorority life",
  housing: "gender inclusive housing",
  name_policy: "chosen name",
  conduct_code: "student handbook conduct",
};

export const PROBE_LIMITS = { sitemapFiles: 6, hubSitemaps: 3, hubLinks: 4, perType: 2, searches: 2 } as const;

const NOISE = /\/(news|stories|story|events?|calendar|blog|posts?|press|magazine|media|people|profiles?|directory\/person|tag|category|author)\/|\/20\d\d\/\d\d\/|\.(jpg|png|gif|mp4|docx?|xlsx?|zip)($|\?)/i;
const HUB_LINK = /student[-_ ]?(life|affairs|experience|engagement)|campus[-_ ]?life|life[-_ ]?at|dean[-_ ]?of[-_ ]?students|diversity|inclusion|belonging|about|policies|offices[-_ ]?(and[-_ ]?)?services/i;

/** Pages that match a type's words but are something else (an employee accommodation policy, an academic department). */
const NOT_TYPE: Partial<Record<ProbeType, RegExp>> = {
  faith_office: /accommodat|holiday|observance|employee|\/hr\/|human[-_ ]resources|calendar|academics?\/|religious[-_ ]studies|department/,
  lgbtq_center: /academics?\/|departments?|courses|program[s]?[-_]courses|studies|registrar|in-focus|ministry|employee|\/hr\//,
  name_policy: /employee|\/hr\/|human[-_ ]resources|faculty|teaching/,
  housing: /employee|faculty[-_ ]housing|staff[-_ ]housing/,
  fsl_office: /alumni|giving|athletic/,
};
/** Words that make a candidate the likelier page of its type. */
const PREFER: Partial<Record<ProbeType, RegExp>> = {
  nondiscrimination: /non[-_ ]?discriminat/,
  name_policy: /name/,
  housing: /gender[-_ ]?inclusive|all[-_ ]?gender/,
  lgbtq_center: /center|centre|resource|office/,
  faith_office: /chaplain|religious[-_ ]?(and[-_ ]?spiritual[-_ ]?)?life|spiritual[-_ ]?life|ministry|interfaith/,
};

export interface Candidate {
  url: string;
  type: ProbeType;
  score: number;
  via: "sitemap" | "home" | "hub" | "subdomain" | "path" | "search";
}

const decode = (u: string) => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};

/** Host + path of a URL as one lower-case string, for matching. */
function hay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host} ${decode(u.pathname)}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const onSite = (url: string, domain: string) => {
  try {
    const h = new URL(url).host.toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

/** Candidates for every type a link matches, scored: URL match beats text match; short paths (office roots) win. */
export function classifyLinks(links: readonly FoundLink[], domain: string, types: readonly ProbeType[], via: Candidate["via"]): Candidate[] {
  const out: Candidate[] = [];
  for (const l of links) {
    if (!onSite(l.url, domain) || NOISE.test(l.url)) continue;
    const h = hay(l.url);
    const text = l.text.toLowerCase();
    let depth = 0;
    try {
      depth = new URL(l.url).pathname.split("/").filter(Boolean).length;
    } catch {
      continue;
    }
    for (const t of types) {
      const inUrl = TYPE_URL[t](h);
      const inText = text.length > 2 && text.length < 120 && TYPE_URL[t](text);
      if (!inUrl && !inText) continue;
      if (NOT_TYPE[t]?.test(`${h} ${text}`)) continue;
      // Policy pages live deep; office pages are near a root.
      const office = t === "fsl_office" || t === "faith_office" || t === "lgbtq_center";
      const score =
        (inUrl ? 4 : 0) +
        (inText ? 3 : 0) +
        (office ? Math.max(0, 3 - depth) : 1) +
        (PREFER[t]?.test(`${h} ${text}`) ? 2 : 0) -
        (/\.pdf($|\?)/i.test(l.url) && t !== "conduct_code" && t !== "nondiscrimination" ? 2 : 0);
      out.push({ url: l.url.replace(/#.*$/, ""), type: t, score, via });
    }
  }
  return out;
}

/** Sitemap children most likely to list office and policy pages first. */
function rankSitemaps(locs: readonly string[]): string[] {
  const score = (u: string) => (/page|student|life|polic|about|office|depart/i.test(u) ? 2 : 0) - (/news|event|post|people|person|profile|image|video|media|product|tag|author|story|blog/i.test(u) ? 3 : 0);
  return [...locs].sort((a, b) => score(b) - score(a));
}

export interface ProbeResult {
  /** Links per domain in the discovery schema's shape (fields a probe can't fill are null / []). */
  links: Record<Domain, Record<string, unknown>>;
  /** Types found and confirmed by a page's own text. */
  found: Partial<Record<ProbeType, string>>;
  /** Pages fetched for the probe (cache hits included). */
  tried: number;
  log: string[];
}

export interface ProbeCollege {
  unit_id: string;
  website: string | null;
  single_sex: boolean;
  affiliation: string | null;
}

/** The empty discovery-shaped link objects. */
export function emptyLinks(): Record<Domain, Record<string, unknown>> {
  return {
    greek: { fsl_office: null, fsl_reports: [], recruitment: null, greek_none: null, notes: "" },
    faith: { faith_office: null, faith_groups: null, religion_report: null, faith_estimate: [], notes: "" },
    lgbtq: { lgbtq_center: null, lgbtq_groups: null, nondiscrimination: null, housing: null, name_policy: null, health_plan: null, restrooms: null, trans_admission: null, conduct_code: null, notes: "" },
  };
}

function origin(website: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  } catch {
    return null;
  }
}

/** True when a fetched page is a catch-all (redirected to the site root) rather than the page asked for. */
function isCatchAll(requested: string, page: Page): boolean {
  try {
    const f = new URL(page.final_url);
    return new URL(requested).pathname.length > 1 && (f.pathname === "/" || f.pathname === "") ;
  } catch {
    return false;
  }
}

export function textConfirms(type: ProbeType, page: Page): boolean {
  const t = page.text.slice(0, 60_000);
  return t.length > 200 && TYPE_TEXT[type].every((re) => re.test(t));
}

/**
 * Probes one college's site for every type in `typesFor(college)`. `fetcher` must be the run's robots-aware
 * PageFetcher; `quiet` requests keep robots refusals off the owner's blocked list.
 */
export async function probeCollege(fetcher: PageFetcher, college: ProbeCollege): Promise<ProbeResult> {
  const links = emptyLinks();
  const found: ProbeResult["found"] = {};
  const log: string[] = [];
  let tried = 0;
  const site = college.website ? origin(college.website) : null;
  if (!site) return { links, found, tried, log: ["no website"] };
  const domain = collegeDomain(site.host);
  const types = typesFor(college);
  const cands: Candidate[] = [];
  const get = async (url: string) => {
    tried++;
    return fetcher.get(url, { quiet: true });
  };

  // 1. Sitemaps (robots.txt's, else /sitemap.xml), index children ranked, a few files at most.
  {
    const listed = await fetcher.sitemaps(site.origin);
    const queue = listed.length ? [...listed] : [`${site.origin}/sitemap.xml`];
    const seen = new Set<string>();
    let files = 0;
    while (queue.length && files < PROBE_LIMITS.sitemapFiles) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      files++;
      tried++;
      const body = await fetcher.raw(url, { quiet: true });
      if (!body) continue;
      const { index, locs } = parseSitemap(body);
      if (index) queue.push(...rankSitemaps(locs).filter((l) => !seen.has(l)));
      else cands.push(...classifyLinks(locs.map((u) => ({ url: u, text: "" })), domain, types, "sitemap"));
    }
    log.push(`sitemaps: ${files} file(s)`);
  }

  // 2. Home page, and a few student-life / about hubs it links to.
  const hubs: string[] = [];
  {
    const home = await get(site.toString());
    if (home.ok) {
      cands.push(...classifyLinks(home.page.links, domain, types, "home"));
      for (const l of home.page.links) {
        if (hubs.length >= PROBE_LIMITS.hubLinks) break;
        if (onSite(l.url, domain) && !NOISE.test(l.url) && HUB_LINK.test(`${hay(l.url)} ${l.text}`) && !hubs.includes(l.url)) hubs.push(l.url);
      }
    }
  }

  // 3. Well-known subdomains (different hosts, so they run side by side; dead hosts fail at DNS).
  const subResults = await Promise.all(
    Object.entries(HUB_SUBDOMAINS).map(async ([sub, type]) => {
      const url = `https://${sub}.${domain}/`;
      const r = await get(url);
      return { sub, type, url, r };
    })
  );
  const liveHubs = new Set<string>();
  for (const { type, url, r } of subResults) {
    if (!r.ok || !onSite(r.page.final_url, domain)) continue;
    if (type && types.includes(type)) cands.push({ url: r.page.final_url || url, type, score: 12, via: "subdomain" });
    cands.push(...classifyLinks(r.page.links, domain, types, "hub"));
    if (!type) liveHubs.add(new URL(r.page.final_url).origin);
  }
  // A live hub's own sitemap: housing, registrar, and policy sites keep their policy pages deep.
  await Promise.all(
    [...liveHubs].map(async (o) => {
      const listed = await fetcher.sitemaps(o);
      const queue = listed.length ? listed.slice(0, 2) : [`${o}/sitemap.xml`];
      for (let n = 0; n < queue.length && n < PROBE_LIMITS.hubSitemaps; n++) {
        tried++;
        const body = await fetcher.raw(queue[n], { quiet: true });
        if (!body) continue;
        const { index, locs } = parseSitemap(body);
        if (index) queue.push(...rankSitemaps(locs).slice(0, 2));
        else cands.push(...classifyLinks(locs.map((u) => ({ url: u, text: "" })), domain, types, "sitemap"));
      }
    })
  );
  for (const h of hubs) {
    const r = await get(h);
    if (r.ok) cands.push(...classifyLinks(r.page.links, domain, types, "hub"));
  }

  // 4. Well-known paths on the main site.
  for (const [path, type] of Object.entries(WELL_KNOWN_PATHS)) {
    if (!types.includes(type)) continue;
    if (cands.some((c) => c.type === type && c.score >= 7)) continue;
    const url = `${site.origin}${path}`;
    const r = await get(url);
    if (r.ok && !isCatchAll(url, r.page)) {
      cands.push({ url: r.page.final_url, type, score: 8, via: "path" });
      cands.push(...classifyLinks(r.page.links, domain, types, "hub"));
    }
  }

  // 5. Confirm the best candidates per type by their text.
  const confirm = async () => {
    for (const t of types) {
      if (found[t]) continue;
      const byUrl = new Map<string, Candidate>();
      for (const c of cands) if (c.type === t && (byUrl.get(c.url)?.score ?? -99) < c.score) byUrl.set(c.url, c);
      const best = [...byUrl.values()].sort((a, b) => b.score - a.score || a.url.length - b.url.length);
      for (const c of best.slice(0, PROBE_LIMITS.perType)) {
        const r = await get(c.url);
        if (r.ok && !isCatchAll(c.url, r.page) && textConfirms(t, r.page)) {
          found[t] = r.page.final_url;
          log.push(`${t}: ${c.via} ${r.page.final_url}`);
          // An office page's own links feed the other types (its group list, its recruitment page).
          cands.push(...classifyLinks(r.page.links, domain, types, "hub"));
          break;
        }
      }
    }
  };
  await confirm();

  // 6. The site's own search page, for what's still missing (only if robots.txt allows it).
  let searches = 0;
  for (const t of types) {
    if (found[t] || !SEARCH_WORDS[t] || searches >= PROBE_LIMITS.searches) continue;
    searches++;
    const r = await get(`${site.origin}/search?q=${encodeURIComponent(SEARCH_WORDS[t]!)}`);
    if (r.ok) cands.push(...classifyLinks(r.page.links, domain, types, "search"));
  }
  if (searches) await confirm();

  for (const [t, url] of Object.entries(found) as [ProbeType, string][]) links[PROBE_TYPES[t]][t] = url;
  return { links, found, tried, log };
}

/** Types still missing that justify a paid search (the ones the pilot scores and publishes). */
export const PAID_TYPES: readonly ProbeType[] = ["fsl_office", "faith_office", "lgbtq_center", "nondiscrimination", "housing", "name_policy", "trans_admission", "conduct_code"];

export function missingForPaid(college: ProbeCollege, found: ProbeResult["found"]): ProbeType[] {
  const types = typesFor(college);
  return PAID_TYPES.filter((t) => types.includes(t) && !found[t]);
}
