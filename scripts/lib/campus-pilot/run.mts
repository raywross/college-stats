/**
 * One college through the campus-life pilot (specs/religious-life.md phase 2, greek-life.md phase 2, lgbtq-life.md
 * phase 4): discovery (or the saved recipe) → our code fetches each page and follows a few links from office pages →
 * extraction per domain (Haiku 4.5; Sonnet 5 when a quote isn't on its page, the schema call fails, or the model marks
 * low confidence) → every quote checked against its page → the second check (Sonnet 5) on every LGBTQ+ "no", every
 * conduct restriction, and every official religious composition (owner decision 3) → the facts to publish.
 *
 * Nothing unverified is published: a fact whose quote isn't on its page is dropped; a sensitive finding the second
 * check doesn't confirm is dropped and logged; tier A facts must come from the college's own domain.
 */
import { collegeDomain } from "../college-reported/probe.mts";
import { POLICY_KEYS, TRADITIONS, type Council, type PolicyCheck, type PolicyKey, type Tradition } from "../../../lib/directories.ts";
import type { CampusFaith, CampusGreek, CampusLgbtq, CompositionItem, GreekCouncilFact, PageRef } from "../../../lib/campus-pages.ts";
import { BudgetSpent, PILOT_MODELS, discoverDomain, extractDomain, verifyFinding, type CollegeRef, type Ctx, type PromptPage } from "./llm.mts";
import { fslLinks, groupPageLinks, keywordWindows, quoteOnPage, shortQuote, type PageFetcher, type Page } from "./pages.mts";
import { DOMAINS, SOURCE_TYPES, type Domain } from "./schema.mts";

/* ------------------------------------------------------------------ */
/* Recipes: data/campus-sources.json                                   */
/* ------------------------------------------------------------------ */

export interface CampusSource {
  domain: Domain;
  /** The source type discovery named, or "followed" for a page our code followed from an office page. */
  type: string;
  url: string;
  status: "ok" | "blocked" | "error";
  detail?: string;
  sha256?: string;
  etag?: string;
  last_modified?: string;
}

export interface CampusRecipe {
  unit_id: string;
  learned: string;
  model: string;
  /** Discovery's links per domain, as returned (re-used on later runs; pages re-fetched only when changed). */
  links: Partial<Record<Domain, Record<string, unknown>>>;
  sources: CampusSource[];
}

/* ------------------------------------------------------------------ */
/* What a run produces per college                                     */
/* ------------------------------------------------------------------ */

/** A tier B listing (named by the college's own page) or a tier C estimate (a group's own claim). */
export interface PilotListing {
  domain: "faith" | "lgbtq";
  kind: "group" | "estimate";
  tradition?: Tradition;
  name: string;
  /** The page that lists it (the credit's list URL). */
  url: string;
  /** Who publishes that page: the office for tier B, the group for tier C. */
  publisher: string;
  quote: string;
  fact?: string;
  checked: string;
}

export interface Dropped {
  domain: Domain;
  fact: string;
  reason: string;
  detail?: string;
}

export interface CheckLog {
  domain: Domain;
  fact: string;
  url: string;
  quote: string;
  confirmed: boolean;
  quote_on_page: boolean;
  reason: string;
}

export interface CollegeResult {
  unit_id: string;
  name: string;
  checked: string;
  greek: CampusGreek | null;
  faith: CampusFaith | null;
  lgbtq: CampusLgbtq | null;
  listings: PilotListing[];
  /** Every fact the extractor returned before the quote check and second check, for scoring the filters. */
  raw: Partial<Record<Domain, Record<string, unknown>>>;
  escalated: Domain[];
  dropped: Dropped[];
  checks: CheckLog[];
  errors: string[];
  stopped?: string;
}

/* ------------------------------------------------------------------ */
/* Page gathering                                                      */
/* ------------------------------------------------------------------ */

/** Keywords each role's page is windowed around when it's long. */
const WINDOWS: Record<string, RegExp> = {
  nondiscrimination: /sexual orientation|gender identity|gender expression|discriminat/i,
  housing: /gender[- ]inclusive|gender[- ]neutral|all[- ]gender|mixed[- ]gender|open housing|roommate|transgender|gender identity/i,
  name_policy: /chosen name|preferred name|lived name|pronoun/i,
  health_plan: /transgender|gender[- ]affirming|gender dysphoria|transition|hormone|sex reassignment|gender reassignment/i,
  restrooms: /all[- ]gender|gender[- ]inclusive|gender[- ]neutral|single[- ]occupancy|restroom/i,
  trans_admission: /transgender|nonbinary|non-binary|gender identity|identif/i,
  conduct_code: /same[- ]sex|homosexual|sexual (intimacy|relations|immorality|conduct|orientation)|marriage|gender identity|biological sex|chast|cross[- ]dress|transgender|gender expression|romantic/i,
  religion_report: /religio|denomination|faith|catholic|baptist|christian|jewish|muslim|latter[- ]day|lds/i,
  fsl_reports: /total|chapter|council|members|panhellenic|interfraternity|recruit/i,
};
const ROLE_LABEL: Record<string, string> = {
  fsl_office: "fraternity & sorority life office",
  fsl_reports: "fraternity & sorority report or reports page",
  recruitment: "recruitment page",
  greek_none: "page on fraternities and sororities",
  faith_office: "religious/spiritual life office",
  faith_groups: "college's list of faith groups",
  religion_report: "college report on students' religious affiliation",
  faith_estimate: "a campus faith group's own page",
  lgbtq_center: "LGBTQ+ center or office",
  lgbtq_groups: "college's list of LGBTQ+ groups",
  nondiscrimination: "nondiscrimination statement",
  housing: "housing policy",
  name_policy: "chosen name and pronoun policy",
  health_plan: "student health plan",
  restrooms: "all-gender restroom list",
  trans_admission: "admission policy for transgender applicants",
  conduct_code: "conduct code / community covenant",
  followed: "page linked from the office page",
};

const PAGE_CHARS = 12_000;
const DOMAIN_CHARS = 90_000;
const MAX_PAGES: Record<Domain, number> = { greek: 14, faith: 8, lgbtq: 13 };

interface Gathered {
  prompt: PromptPage[];
  /** P number → the full page (for quote checks and the second check). */
  full: Map<number, Page>;
}

function linksOf(links: Record<string, unknown>, type: string): string[] {
  const v = links[type];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

export async function gather(fetcher: PageFetcher, domain: Domain, links: Record<string, unknown>, sources: CampusSource[]): Promise<Gathered> {
  const queue: { url: string; type: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string, type: string) => {
    const u = url.replace(/#.*$/, "");
    if (!/^https?:\/\//.test(u) || seen.has(u)) return;
    seen.add(u);
    queue.push({ url: u, type });
  };
  for (const type of SOURCE_TYPES[domain]) for (const u of linksOf(links, type)) push(u, type);

  const prompt: PromptPage[] = [];
  const full = new Map<number, Page>();
  let chars = 0;
  for (let i = 0; i < queue.length && prompt.length < MAX_PAGES[domain]; i++) {
    const { url, type } = queue[i];
    const r = await fetcher.get(url);
    if (!r.ok) {
      sources.push({ domain, type, url, status: r.blocked ? "blocked" : "error", detail: r.blocked ?? r.error });
      continue;
    }
    const p = r.page;
    sources.push({ domain, type, url, status: "ok", sha256: p.sha256, ...(p.etag ? { etag: p.etag } : {}), ...(p.last_modified ? { last_modified: p.last_modified } : {}) });
    // Follow a few links from office pages (code, no model): FSL report files and council/recruitment pages; the
    // office's own list of faith or LGBTQ+ groups.
    if (p.format === "html") {
      if (type === "fsl_office" || type === "fsl_reports") for (const l of fslLinks(p, type === "fsl_reports" ? 8 : 6)) push(l.url, "followed");
      if (type === "faith_office") for (const l of groupPageLinks(p, "faith", 2)) push(l.url, "followed");
      if (type === "lgbtq_center") for (const l of groupPageLinks(p, "lgbtq", 2)) push(l.url, "followed");
    }
    const window = WINDOWS[type] ?? (domain === "greek" ? WINDOWS.fsl_reports : undefined);
    let text = window ? keywordWindows(p.text, window, PAGE_CHARS) : p.text.slice(0, PAGE_CHARS);
    if (chars + text.length > DOMAIN_CHARS) text = text.slice(0, Math.max(0, DOMAIN_CHARS - chars));
    if (text.length < 40) continue;
    chars += text.length;
    const n = prompt.length + 1;
    prompt.push({ n, url: p.final_url, role: ROLE_LABEL[type] ?? type, text });
    full.set(n, p);
  }
  return { prompt, full };
}

/* ------------------------------------------------------------------ */
/* Normalizing an extraction                                           */
/* ------------------------------------------------------------------ */

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Norm {
  greek: CampusGreek | null;
  faith: CampusFaith | null;
  lgbtq: CampusLgbtq | null;
  listings: PilotListing[];
  /** Facts whose quote isn't on the cited page (escalation trigger; dropped if they persist). */
  quoteFailures: string[];
  /** Sensitive findings awaiting the second check. */
  pending: { fact: string; finding: string; ref: PageRef; page: Page; apply: (verifiedBy: string) => void }[];
  dropped: Dropped[];
}

const onCollegeSite = (url: string, domain: string) => {
  try {
    const h = new URL(url).host.toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

function normalize(domain: Domain, raw: Raw, g: Gathered, college: CollegeRef, today: string): Norm {
  const out: Norm = { greek: null, faith: null, lgbtq: null, listings: [], quoteFailures: [], pending: [], dropped: [] };
  const site = college.website ? collegeDomain(new URL(college.website).host) : null;

  /** A page ref for (page, quote), or null (and the reason logged). `own`: the page must be on the college's domain. */
  const refOf = (fact: string, pageNo: unknown, quote: unknown, o: { own?: boolean } = { own: true }): (PageRef & { page: Page }) | null => {
    const page = typeof pageNo === "number" ? g.full.get(pageNo) : undefined;
    if (!page) {
      out.dropped.push({ domain, fact, reason: "no page" });
      return null;
    }
    if (typeof quote !== "string" || !quote.trim()) {
      out.dropped.push({ domain, fact, reason: "no quote" });
      return null;
    }
    if (!quoteOnPage(quote, page.text)) {
      out.quoteFailures.push(fact);
      out.dropped.push({ domain, fact, reason: "quote not on page", detail: quote.slice(0, 120) });
      return null;
    }
    const url = page.final_url.startsWith("https://") ? page.final_url : page.final_url.replace(/^http:\/\//, "https://");
    if (o.own !== false && site && !onCollegeSite(url, site)) {
      out.dropped.push({ domain, fact, reason: "not the college's own page", detail: url });
      return null;
    }
    return { url, checked: today, quote: shortQuote(quote), page };
  };
  const strip = <T extends { page: Page }>(r: T): Omit<T, "page"> => {
    const { page: _p, ...rest } = r;
    void _p;
    return rest;
  };

  if (domain === "greek") {
    const gk: CampusGreek = {};
    if (raw.status?.value === "none_stated") {
      const r = refOf("greek.none_stated", raw.status.page, raw.status.quote);
      if (r) gk.none_stated = strip(r);
    }
    if (!gk.none_stated) {
      if (Number.isInteger(raw.members_total?.value) && raw.members_total.value > 0) {
        const r = refOf("greek.members_total", raw.members_total.page, raw.members_total.quote);
        if (r) gk.members_total = { ...strip(r), value: raw.members_total.value, term: raw.members_total.term || null };
      }
      const councils: GreekCouncilFact[] = [];
      for (const c of (raw.councils ?? []) as Raw[]) {
        if (c.chapters == null && c.members == null) continue;
        const r = refOf(`greek.council.${c.council}`, c.page, c.quote);
        if (!r) continue;
        if (councils.some((x) => x.council === c.council && x.name === c.name)) continue;
        councils.push({ ...strip(r), council: c.council as Council, name: String(c.name), chapters: c.chapters ?? null, members: c.members ?? null, term: c.term || null });
      }
      if (councils.length) gk.councils = councils;
      for (const k of ["housing", "deferred"] as const) {
        const v = raw[k];
        if (v?.value === "yes" || v?.value === "no") {
          const r = refOf(`greek.${k}`, v.page, v.quote);
          if (r) gk[k] = { ...strip(r), value: v.value };
        }
      }
      if (typeof raw.formal_term?.value === "string" && raw.formal_term.value.trim()) {
        const r = refOf("greek.formal_term", raw.formal_term.page, raw.formal_term.quote);
        if (r) gk.formal_term = { ...strip(r), value: raw.formal_term.value.trim() };
      }
    }
    out.greek = Object.keys(gk).length ? gk : null;
  }

  if (domain === "faith") {
    const f: CampusFaith = {};
    if (raw.office?.name) {
      const r = refOf("faith.office", raw.office.page, raw.office.quote);
      if (r) f.office = { ...strip(r), name: String(raw.office.name) };
    }
    const comp = raw.composition;
    if (comp?.items?.length) {
      const r = refOf("faith.composition", comp.page, comp.quote);
      if (r) {
        const total = Number.isInteger(comp.total) && comp.total > 0 ? comp.total : null;
        const items: CompositionItem[] = (comp.items as Raw[])
          .map((i) => {
            const count = Number.isInteger(i.count) && i.count >= 0 ? i.count : null;
            let share = typeof i.share === "number" ? (i.share > 1 ? i.share / 100 : i.share) : null;
            if (share === null && count !== null && total) share = Math.round((count / total) * 10000) / 10000;
            return { label: String(i.label), count, share };
          })
          .filter((i) => i.count !== null || i.share !== null);
        if (items.length) {
          const value = { ...strip(r), items, population: comp.population || null, as_of: comp.as_of || null };
          out.pending.push({
            fact: "faith.composition",
            finding: `The college publishes students' religious affiliation (${value.population ?? "population not stated"}, ${value.as_of ?? "date not stated"}): ${items
              .slice(0, 8)
              .map((i) => `${i.label} ${i.count ?? ""}${i.share !== null ? ` (${(i.share * 100).toFixed(1)}%)` : ""}`)
              .join("; ")}`,
            ref: value,
            page: r.page,
            apply: (by) => (f.composition = { ...value, verified_by: by }),
          });
        }
      }
    }
    for (const c of (raw.communities ?? []) as Raw[]) {
      if (!(c.tradition in TRADITIONS)) continue;
      const r = refOf(`faith.community.${c.tradition}`, c.page, c.quote);
      if (!r) continue;
      out.listings.push({ domain: "faith", kind: "group", tradition: c.tradition, name: String(c.name), url: r.url, publisher: college.name, quote: r.quote, checked: today });
    }
    for (const e of (raw.estimates ?? []) as Raw[]) {
      if (e.count == null && e.share == null) continue;
      if (!(e.tradition in TRADITIONS)) continue;
      const r = refOf(`faith.estimate.${e.tradition}`, e.page, e.quote, { own: false });
      if (!r) continue;
      const scope = e.population === "undergrads" ? "undergraduates" : e.population === "all_students" ? "students" : e.population === "several_campuses" ? "students at several campuses" : "students (scope not stated)";
      const what = e.measure === "population_estimate" ? `${TRADITIONS[e.tradition as Tradition]} ${scope}` : `${scope} (${String(e.measure).replace("_", " ")})`;
      const fact = `${e.count != null ? Number(e.count).toLocaleString("en-US") : `${Math.round(e.share * 100)}%`} ${what}${e.as_of ? ` (${e.as_of})` : ""}`;
      out.listings.push({ domain: "faith", kind: "estimate", tradition: e.tradition, name: String(e.publisher), url: r.url, publisher: String(e.publisher), quote: r.quote, fact, checked: today });
    }
    // Kept even when empty: the second check may still add the composition.
    out.faith = f;
  }

  if (domain === "lgbtq") {
    const l: CampusLgbtq = {};
    const policies: PolicyCheck[] = [];
    if ((raw.center?.status === "open" || raw.center?.status === "closed") && raw.center.name) {
      const r = refOf("lgbtq.center", raw.center.page, raw.center.quote);
      if (r) l.center = { ...strip(r), name: String(raw.center.name), status: raw.center.status, ...(raw.center.closed ? { closed: String(raw.center.closed) } : {}) };
    }
    for (const gr of (raw.groups ?? []) as Raw[]) {
      const r = refOf("lgbtq.group", gr.page, gr.quote);
      if (r) out.listings.push({ domain: "lgbtq", kind: "group", name: String(gr.name), url: r.url, publisher: college.name, quote: r.quote, checked: today });
    }
    for (const key of Object.keys(POLICY_KEYS) as PolicyKey[]) {
      const v = raw.policies?.[key];
      if (v?.value !== "yes" && v?.value !== "no") continue;
      if (key === "trans_admission" && !college.single_sex) continue;
      const r = refOf(`lgbtq.${key}`, v.page, v.quote);
      if (!r) continue;
      const check: PolicyCheck = { key, value: v.value, url: r.url, checked: today, quote: r.quote };
      if (v.value === "no") {
        out.pending.push({ fact: `lgbtq.${key}`, finding: `${POLICY_KEYS[key]}: NO (the college's page shows it does not)`, ref: r, page: r.page, apply: (by) => policies.push({ ...check, verified_by: by }) });
      } else policies.push(check);
    }
    const cd = raw.conduct;
    if (cd?.restricts === "yes") {
      const quotes = ((cd.quotes ?? []) as string[]).filter((q) => typeof q === "string" && q.trim());
      const ok = quotes.find((q) => g.full.get(cd.page) && quoteOnPage(q, g.full.get(cd.page)!.text));
      const r = refOf("lgbtq.conduct_restriction", cd.page, ok ?? quotes[0]);
      if (r) {
        const check: PolicyCheck = { key: "conduct_restriction", value: "yes", url: r.url, checked: today, quote: r.quote };
        out.pending.push({
          fact: "lgbtq.conduct_restriction",
          finding: `The student conduct policy${cd.document ? ` (${cd.document})` : ""} restricts same-sex relationships, gender expression, or transition, in these words`,
          ref: r,
          page: r.page,
          apply: (by) => policies.push({ ...check, verified_by: by }),
        });
      }
    }
    l.policies = policies;
    out.lgbtq = l;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One college                                                         */
/* ------------------------------------------------------------------ */

export interface RunCollegeOptions {
  today: string;
  /** A recipe from an earlier run: its links are re-used, no discovery call. */
  recipe?: CampusRecipe;
  log: (msg: string) => void;
}

/** Text around a quote for the second check (the whole page when it's short). */
function around(page: Page, quote: string, radius = 6000): string {
  const t = page.text;
  if (t.length <= radius * 2) return t;
  const probe = quote.split(/\.\.\.|…/)[0].trim().slice(0, 40).toLowerCase();
  const at = t.toLowerCase().indexOf(probe);
  const mid = at < 0 ? 0 : at;
  return t.slice(Math.max(0, mid - radius), mid + radius);
}

export async function runCollege(ctx: Ctx, fetcher: PageFetcher, college: CollegeRef, o: RunCollegeOptions): Promise<{ result: CollegeResult; recipe: CampusRecipe }> {
  const result: CollegeResult = { unit_id: college.unit_id, name: college.name, checked: o.today, greek: null, faith: null, lgbtq: null, listings: [], raw: {}, escalated: [], dropped: [], checks: [], errors: [] };
  const recipe: CampusRecipe = { unit_id: college.unit_id, learned: o.recipe?.learned ?? o.today, model: PILOT_MODELS.discovery, links: { ...(o.recipe?.links ?? {}) }, sources: [] };

  for (const domain of DOMAINS) {
    try {
      let links = recipe.links[domain];
      if (!links) {
        links = await discoverDomain(ctx, college, domain);
        recipe.links[domain] = links;
      }
      const g = await gather(fetcher, domain, links, recipe.sources);
      if (!g.prompt.length) {
        o.log(`  ${college.name}: ${domain}: no readable pages`);
        continue;
      }
      let raw: Raw;
      let job: "extraction" | "escalation" = "extraction";
      try {
        raw = await extractDomain(ctx, college, domain, g.prompt, "extraction");
      } catch (err) {
        if (err instanceof BudgetSpent) throw err;
        result.errors.push(`${domain} extraction: ${(err as Error).message}`);
        raw = await extractDomain(ctx, college, domain, g.prompt, "escalation");
        job = "escalation";
      }
      let norm = normalize(domain, raw, g, college, o.today);
      if (job === "extraction" && (norm.quoteFailures.length || raw.confidence === "low")) {
        try {
          const raw2 = await extractDomain(ctx, college, domain, g.prompt, "escalation");
          result.escalated.push(domain);
          raw = raw2;
          norm = normalize(domain, raw2, g, college, o.today);
        } catch (err) {
          if (err instanceof BudgetSpent) throw err;
          result.errors.push(`${domain} escalation: ${(err as Error).message}`);
        }
      }
      result.raw[domain] = raw;
      result.dropped.push(...norm.dropped);
      // The second check: every sensitive finding against its quote and page; only confirmed ones are kept.
      for (const p of norm.pending) {
        const v = await verifyFinding(ctx, college, domain, { finding: p.finding, quote: p.ref.quote, url: p.ref.url, pageText: around(p.page, p.ref.quote) });
        result.checks.push({ domain, fact: p.fact, url: p.ref.url, quote: p.ref.quote, confirmed: v.confirmed && v.quote_on_page, quote_on_page: v.quote_on_page, reason: v.reason });
        if (v.confirmed && v.quote_on_page) p.apply(PILOT_MODELS.verify);
        else result.dropped.push({ domain, fact: p.fact, reason: "second check did not confirm", detail: v.reason });
      }
      if (domain === "greek") result.greek = norm.greek;
      if (domain === "faith") result.faith = norm.faith && Object.keys(norm.faith).length ? norm.faith : null;
      if (domain === "lgbtq") result.lgbtq = norm.lgbtq && (norm.lgbtq.center || norm.lgbtq.policies?.length) ? { ...norm.lgbtq, ...(norm.lgbtq.policies?.length ? {} : { policies: undefined }) } : null;
      result.listings.push(...norm.listings);
    } catch (err) {
      if (err instanceof BudgetSpent) {
        result.stopped = err.message;
        break;
      }
      result.errors.push(`${domain}: ${(err as Error).message}`);
      o.log(`  ${college.name}: ${domain} failed: ${(err as Error).message}`);
    }
  }
  if (result.lgbtq && !result.lgbtq.policies) delete result.lgbtq.policies;
  return { result, recipe };
}
