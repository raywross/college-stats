/**
 * The public roadmap (/roadmap, specs/roadmap.md): which planned specs appear, how they're grouped, and how complex
 * each one is. The spec text itself stays in specs/*.md; tests/roadmap.test.mts checks that every planned spec is
 * listed here and every entry points at a real file.
 */

export type Complexity = 1 | 2 | 3 | 4;

export const COMPLEXITY: Record<Complexity, { label: string; description: string }> = {
  1: { label: "Small", description: "A few fields from a source we already read, shown in one or two places." },
  2: { label: "Medium", description: "A new source file or a new profile section, with filters and history." },
  3: { label: "Large", description: "New shared infrastructure or a new kind of view, used by later work." },
  4: { label: "Extra large", description: "A new system with its own pipeline, checks, and a pilot before launch." },
};

// Wave 1 (data the site already downloads) was built on 2026-09-29, wave 2 (one new federal file each) on
// 2026-10-02, and wave 3 (majors and earnings by major, in the per-college detail file) on 2026-10-02; see
// /release-notes. Metro area, deferred from wave 2, is under "later".
export type RoadmapGroupKey =
  | "college-reported"
  | "campus-life"
  | "national-trends"
  | "identity"
  | "design"
  | "accounts"
  | "planning"
  | "high-school"
  | "business"
  | "later";

export const ROADMAP_GROUPS: { key: RoadmapGroupKey; title: string; description: string }[] = [
  {
    key: "college-reported",
    title: "Newer figures from colleges",
    description:
      "Colleges' own Common Data Sets, read once in full by the agent that already collects their newer admissions figures: GPA, admit rates by residency, aid forms, deadlines, class sizes, and more.",
  },
  {
    key: "campus-life",
    title: "Campus life",
    description:
      "Faith communities, Greek life, and LGBTQ+ life, from federal data, Common Data Sets, campus offices, and colleges' own policies.",
  },
  {
    key: "national-trends",
    title: "National trends",
    description:
      "How college is changing across the country, not at one college: nationally, and by region, public or private, size, and selectivity.",
  },
  {
    key: "identity",
    title: "Links, names, and looks",
    description:
      "Each college's official pages and social accounts, the short names people actually use when they search, and its own colors and mark on its profile.",
  },
  {
    key: "design",
    title: "Design and usability",
    description:
      "Making what's already on the site easier to use: shorter pages, clearer paths to detail, and layouts that fit each device.",
  },
  {
    key: "accounts",
    title: "Accounts and households",
    description:
      "Sign in to keep your work. A parent sees each child's list and planning; a child never sees the parent's finances.",
  },
  {
    key: "planning",
    title: "Planning tools",
    description:
      "Where your numbers stand, what your family would pay, aid offers side by side, and whether applying early helps.",
  },
  {
    key: "high-school",
    title: "High school context",
    description:
      "A record for every high school, and what happened to applicants from yours, so national ranges get local context.",
  },
  {
    key: "business",
    title: "Platform, measurement, and business",
    description:
      "Usage measurement that respects minors, paid tiers that keep public data free, counselor accounts, and a developer API.",
  },
  {
    key: "later",
    title: "Later",
    description:
      "Worked out, then set aside: each is parked until another feature needs it, and gets built alongside that feature.",
  },
];

export type RoadmapStatus = "planned" | "draft" | "deferred";

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  planned: "Planned",
  draft: "Early draft",
  deferred: "Deferred",
};

export interface RoadmapSpec {
  /** URL segment: /roadmap/{slug}. */
  slug: string;
  /** Repo-relative path of the spec. */
  file: string;
  group: RoadmapGroupKey;
  /** One plain-language line: what readers of the site get. */
  summary: string;
  complexity: Complexity;
  /** Why it has that complexity. */
  complexityNote: string;
  status: RoadmapStatus;
  /** Slugs of specs that must ship first. */
  after?: string[];
}

/** In build order within each group (the backlog's order, specs/backlog.md). */
export const ROADMAP: RoadmapSpec[] = [
  {
    slug: "college-reported-round-3",
    file: "specs/college-reported-round-3.md",
    group: "college-reported",
    summary:
      "Every college's Common Data Set read once and kept, so the newer figures in every item below come from one run at a fraction of the earlier cost.",
    complexity: 4,
    complexityNote: "A document archive, code-keyed readers for every CDS section, batched extraction, cheaper discovery, and a measured pilot before the full run.",
    status: "planned",
  },
  {
    slug: "cds-admissions",
    file: "specs/data-expansion/cds-admissions.md",
    group: "college-reported",
    summary:
      "First-years' high school GPA with a GPA checker, how much each part of an application counts, early decision and early action numbers, and wait-list odds.",
    complexity: 2,
    complexityNote: "A new admissions section with a checker, one filter, and two history series, built on records the one run already captures.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-residency-admissions",
    file: "specs/data-expansion/cds-residency-admissions.md",
    group: "college-reported",
    summary: "How often a college admits applicants from its own state, from other states, and from abroad, and how many of each enroll.",
    complexity: 2,
    complexityNote: "One Common Data Set grid from the records, a new admissions block, Compare rows, two Explore filters, and a per-edition series.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-test-scores-and-policy",
    file: "specs/data-expansion/cds-test-scores-and-policy.md",
    group: "college-reported",
    summary:
      "Whether each college requires the SAT or ACT for the cycle you're applying in, its own SAT total range, how many students sent scores, and what share of the class scored in each band.",
    complexity: 3,
    complexityNote: "Extends the newest-everywhere machinery to three new replaceable blocks with restore and guards, plus a policy filter, events, and a score-band view on the profile and Compare.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-application-logistics",
    file: "specs/data-expansion/cds-application-logistics.md",
    group: "college-reported",
    summary:
      "Application deadlines, when you'll hear back, the reply date and housing deposit, whether a gap year is allowed, and the high school courses a college expects.",
    complexity: 2,
    complexityNote: "A dozen new items in section C, a shared date parser, two profile blocks, and boolean filters.",
    status: "planned",
    after: ["college-reported-round-3", "cds-admissions"],
  },
  {
    slug: "cds-financial-aid",
    file: "specs/data-expansion/cds-financial-aid.md",
    group: "college-reported",
    summary:
      "Whether a college requires the CSS Profile and the noncustodial parent's form, its aid deadlines, how much of first-years' need it meets, how much of its scholarship money is merit, and what it gives international students.",
    complexity: 3,
    complexityNote:
      "Two cost-page blocks and a rebuilt aid panel, a detail table, supersession of the hand-imported aid figures, the first per-aid-year series, and estimator and saved-list changes.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-student-body-and-outcomes",
    file: "specs/data-expansion/cds-student-body-and-outcomes.md",
    group: "college-reported",
    summary:
      "Enrollment, gender balance, race and ethnicity, retention, and graduation by Pell status a year newer than federal data, plus how many in each group finish in four years.",
    complexity: 3,
    complexityNote: "Extends the newest-everywhere rule from admissions to demographics and outcomes, in shared code that later CDS specs reuse, plus four items with their checks.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-academics",
    file: "specs/data-expansion/cds-academics.md",
    group: "college-reported",
    summary: "Class sizes by section size, the college's own student-faculty ratio, and program and curriculum facts such as honors, double majors, and open curricula.",
    complexity: 2,
    complexityNote: "A new profile section with one Explore filter, built on records the one run already captures.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-transfer",
    file: "specs/data-expansion/cds-transfer.md",
    group: "college-reported",
    summary: "Transfer applicants, admits, and what transfer students need to get in: a chance at transferring, not just a headcount.",
    complexity: 1,
    complexityNote: "One Common Data Set section, almost entirely deterministic reads.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "cds-cost-and-debt",
    file: "specs/data-expansion/cds-cost-and-debt.md",
    group: "college-reported",
    summary: "Next year's price before federal data has it, and graduates' total debt including private loans.",
    complexity: 2,
    complexityNote: "Next year's price must stay apart from federal figures in ranks, comparisons, and history; a five-row debt table with its own display.",
    status: "planned",
    after: ["college-reported-round-3"],
  },
  {
    slug: "religious-life",
    file: "specs/religious-life.md",
    group: "campus-life",
    summary: "Whether a college is religious, how much faith shapes it, and which faith communities are on campus.",
    complexity: 4,
    complexityNote: "Federal affiliation first, then per-college sources and faith-organization directories.",
    status: "planned",
  },
  {
    slug: "greek-life",
    file: "specs/greek-life.md",
    group: "campus-life",
    summary: "How big Greek life is, which kinds of chapters there are, housing, and when students can join.",
    complexity: 3,
    complexityNote: "Common Data Set share first, then fraternity and sorority office reports at pilot colleges.",
    status: "planned",
  },
  {
    slug: "lgbtq-life",
    file: "specs/lgbtq-life.md",
    group: "campus-life",
    summary:
      "LGBTQ+ centers and student groups, gender-inclusive housing and other policies, conduct rules, and gender identity counts, each dated.",
    complexity: 3,
    complexityNote:
      "Federal counts are quick; policies need a check of each college's own pages, and sensitive findings a person's review.",
    status: "planned",
  },
  {
    slug: "national-trends",
    file: "specs/national-trends.md",
    group: "national-trends",
    summary:
      "Studies of how college is changing nationally, with where it's happening. First: men and women in admissions, by region, type, size, and selectivity.",
    complexity: 3,
    complexityNote: "A new Trends page and a shared way to compute and chart breakdowns; each later study reuses it.",
    status: "planned",
  },
  {
    slug: "trends-test-optional",
    file: "specs/trends/test-optional.md",
    group: "national-trends",
    summary:
      "How test requirements all but disappeared, who still submits scores, and why published SAT ranges rose where tests became optional.",
    complexity: 1,
    complexityNote: "Series already stored; one study page from the shared layout, plus Explore's test-policy filter.",
    status: "planned",
    after: ["national-trends"],
  },
  {
    slug: "trends-shrinking-colleges",
    file: "specs/trends/shrinking-colleges.md",
    group: "national-trends",
    summary: "Half of colleges have a tenth fewer undergraduates than ten years ago. Which kinds shrank, and which grew instead.",
    complexity: 1,
    complexityNote: "One series, the shared breakdowns, a histogram, and a colleges-or-students switch.",
    status: "planned",
    after: ["national-trends"],
  },
  {
    slug: "trends-price-gap",
    file: "specs/trends/price-gap.md",
    group: "national-trends",
    summary: "Full price versus what students actually pay, group by group: where discounting deepened and where prices simply rose.",
    complexity: 2,
    complexityNote: "Several money series after inflation, income-band net prices, and agreement with the Home fact to the number.",
    status: "planned",
    after: ["national-trends"],
  },
  {
    slug: "trends-out-of-state",
    file: "specs/trends/out-of-state.md",
    group: "national-trends",
    summary: "Public colleges enrolling more first-years from other states: how much, where, and what the out-of-state premium looks like.",
    complexity: 1,
    complexityNote: "A biennial series with the shared breakdowns, a premium companion, and a sending-state map from the detail file.",
    status: "planned",
    after: ["national-trends"],
  },
  {
    slug: "trends-pell-gap",
    file: "specs/trends/pell-gap.md",
    group: "national-trends",
    summary: "Pell Grant recipients graduate less often than classmates with neither Pell nor loans, and the gap has widened. Where, and where not.",
    complexity: 1,
    complexityNote: "Two graduation series by entering class, the shared breakdowns, and small-class floors.",
    status: "planned",
    after: ["national-trends"],
  },
  {
    slug: "trends-top-10-lists",
    file: "specs/trends/top-10-lists.md",
    group: "national-trends",
    summary: "Ten colleges per measure that changed most in ten years, with the floors and exclusions that keep online growth and closures from crowding the lists.",
    complexity: 2,
    complexityNote: "A list registry and build step, reviewed exclusion files, Explore floor params, and a new page; a data item for online share.",
    status: "planned",
    after: ["national-trends"],
  },
  {
    slug: "trends-conferences",
    file: "specs/trends/conferences.md",
    group: "national-trends",
    summary: "A page for every athletic conference: its members compared, how the conference changed over ten years, and who joined or left.",
    complexity: 2,
    complexityNote: "Per-conference medians under two membership rules, a realignment timeline from stored events, an index and 130 pages.",
    status: "planned",
    after: ["national-trends", "trends-top-10-lists"],
  },
  {
    slug: "trends-states",
    file: "specs/trends/states.md",
    group: "national-trends",
    summary: "A page for every state: how its colleges changed, publics against privates, where its students come from, and its biggest movers.",
    complexity: 2,
    complexityNote: "Per-state panels with a relaxed floor, the tile map colored by measure, and reuse of the movers lists.",
    status: "planned",
    after: ["national-trends", "trends-top-10-lists"],
  },
  {
    slug: "school-links",
    file: "specs/school-identity/links.md",
    group: "identity",
    summary:
      "Links to each college's website, admissions office, application, financial aid office, and the page where you book a campus visit.",
    complexity: 2,
    complexityNote:
      "Seven columns from a file already downloaded, plus a crawl of each college's admissions page to find its visit link, with a liveness check.",
    status: "planned",
  },
  {
    slug: "social-accounts",
    file: "specs/school-identity/social-accounts.md",
    group: "identity",
    summary: "Each college's Instagram, YouTube, TikTok, X, Facebook, and LinkedIn, one tap from its profile.",
    complexity: 2,
    complexityNote: "A new source (Wikidata, joined by IPEDS id) with its own sync script and checks, a homepage scan for the rest, and one hero row.",
    status: "planned",
    after: ["school-links"],
  },
  {
    slug: "school-aliases",
    file: "specs/school-identity/aliases.md",
    group: "identity",
    summary: "Search for UGA, Vandy, Georgia Tech, or Ole Miss and get the right college, with the short name shown so you know why.",
    complexity: 2,
    complexityNote: "A table of short names from four sources with their own cleaning rules, a shared scorer for search and Explore, and the first value-indexed Supabase table.",
    status: "planned",
    after: ["social-accounts"],
  },
  {
    slug: "school-brand",
    file: "specs/school-identity/brand.md",
    group: "identity",
    summary: "A college's own colors on its profile, and its mark in place of the lettered tile, with a plain summary of what the law allows for the owner to decide.",
    complexity: 3,
    complexityNote:
      "Cited brand colors joined through Wikipedia, a per-theme tint derived at sync time, icons fetched and resized into the repo, opt-out and removal files, and a legal decision before marks ship.",
    status: "planned",
    after: ["school-links", "social-accounts"],
  },
  {
    slug: "compare-redesign",
    file: "specs/compare-redesign.md",
    group: "design",
    summary:
      "Comparing colleges the way profiles now work: an overview of topic cards with a bar per college, and a page per topic, with the full table one tap away.",
    complexity: 3,
    complexityNote:
      "Eight routes reusing the profile's frame and pills, comparative takeaways, and a table with a differences-only switch.",
    status: "planned",
  },
  {
    slug: "accounts",
    file: "specs/product/accounts.md",
    group: "accounts",
    summary: "Sign in with email or Google; link a parent to one or more students; the parent's finances stay private.",
    complexity: 3,
    complexityNote: "Auth, households, and row-level privacy rules that every later feature depends on and tests prove.",
    status: "planned",
  },
  {
    slug: "student-profile",
    file: "specs/product/student-profile.md",
    group: "accounts",
    summary: "Your GPA, scores, major, state, and preferences, entered once and used by every tool and filter.",
    complexity: 2,
    complexityNote: "One form and one table, but GPA scales and missing data need care, and Explore gains fit filters.",
    status: "planned",
    after: ["accounts"],
  },
  {
    slug: "saved-lists",
    file: "specs/product/saved-lists.md",
    group: "accounts",
    summary: "Keep your colleges as Reach, Target, or Likely, with status, notes, deadlines, sharing, and export.",
    complexity: 2,
    complexityNote: "A new section of the site with its own tables, a guardian view, and CSV and PDF export.",
    status: "planned",
    after: ["accounts", "student-profile"],
  },
  {
    slug: "follow-colleges",
    file: "specs/product/follow-colleges.md",
    group: "accounts",
    summary:
      "Follow the colleges you care about and get one email when their numbers change, saying what moved and which years.",
    complexity: 3,
    complexityNote:
      "Change detection at publish time, an email provider with unsubscribe handling, a daily send job, and a public What changed panel.",
    status: "planned",
    after: ["accounts"],
  },
  {
    slug: "chances-and-fit",
    file: "specs/product/chances-and-fit.md",
    group: "planning",
    summary: "Where your numbers stand at each college, with the reasons spelled out and never a made-up percentage.",
    complexity: 3,
    complexityNote:
      "Published rules across several data sources, a pilot against real outcomes, and new views on profiles, lists, and Explore.",
    status: "planned",
    after: ["student-profile", "saved-lists"],
  },
  {
    slug: "net-price-estimator",
    file: "specs/product/net-price-estimator.md",
    group: "planning",
    summary: "What your family would likely pay at each college, as a range with its reasoning, and over four years.",
    complexity: 3,
    complexityNote:
      "The federal aid formula as versioned data, three grant estimates combined, and a hand-checked pilot against colleges' own calculators.",
    status: "planned",
    after: ["accounts"],
  },
  {
    slug: "award-letter-analyzer",
    file: "specs/product/award-letter-analyzer.md",
    group: "planning",
    summary: "Real aid offers in one standard layout: what you pay, what you borrow, and the four-year total, side by side.",
    complexity: 3,
    complexityNote: "A standard offer model, four-year math, flags and questions, and later a document upload read by a model.",
    status: "planned",
    after: ["net-price-estimator", "saved-lists"],
  },
  {
    slug: "early-decision-strategy",
    file: "specs/product/early-decision-strategy.md",
    group: "planning",
    summary:
      "Early decision and early action admit rates against regular decision, how much of the class is filled early, and a checklist before you commit.",
    complexity: 2,
    complexityNote: "Measures from Common Data Set numbers the agent already collects, plus a profile section and filters.",
    status: "planned",
    after: ["cds-admissions"],
  },
  {
    slug: "high-school-data",
    file: "specs/product/high-school-data.md",
    group: "high-school",
    summary:
      "A page for every public high school: AP access, graduation and college-going rates, grading scale, and where graduates go.",
    complexity: 4,
    complexityNote:
      "A second dataset (24,000 schools) with federal, state, and crawled sources, its own sync, tables, pages, and a pilot.",
    status: "planned",
  },
  {
    slug: "scattergrams",
    file: "specs/product/scattergrams.md",
    group: "high-school",
    summary:
      "Past applicants from your high school to each college, scrubbed of names and shown over the national ranges with you on the chart.",
    complexity: 3,
    complexityNote: "A counselor upload with client-side scrubbing, small-count thresholds, name matching, and a new chart.",
    status: "planned",
    after: ["high-school-data", "accounts", "saved-lists"],
  },
  {
    slug: "telemetry",
    file: "specs/product/telemetry.md",
    group: "business",
    summary: "Measure how the site is used, without cookies and without ever recording a student's numbers, and report on it.",
    complexity: 2,
    complexityNote: "One analytics provider, a typed event registry with a guard test, and a set of dashboards.",
    status: "planned",
  },
  {
    slug: "commercialization",
    file: "specs/product/commercialization.md",
    group: "business",
    summary: "Free, Plus, and Pro: what each includes, how billing works, and a pricing page, with the public data always free.",
    complexity: 3,
    complexityNote: "Stripe billing, webhooks, an entitlement map every gated feature reads, and the legal setup before launch.",
    status: "planned",
    after: ["accounts", "saved-lists"],
  },
  {
    slug: "counselor-portal",
    file: "specs/product/counselor-portal.md",
    group: "business",
    summary:
      "Organization accounts for counselors and consultants: a caseload dashboard, co-branded reports, and scattergram uploads.",
    complexity: 4,
    complexityNote: "A second kind of account with its own grants, dashboards, PDF reports, and data agreements for schools.",
    status: "planned",
    after: ["accounts", "saved-lists", "commercialization"],
  },
  {
    slug: "data-api",
    file: "specs/product/data-api.md",
    group: "business",
    summary: "A keyed API and bulk downloads for the dataset, its history, and the lineage of every field.",
    complexity: 2,
    complexityNote: "Versioned routes over the existing dataset, API keys with limits, and generated documentation.",
    status: "planned",
  },
  {
    slug: "metro-area",
    file: "specs/data-expansion/metro-area.md",
    group: "later",
    summary: "Each college's metro area and county, for a \"nearby colleges\" list, a metro filter, and metro-level trends.",
    complexity: 1,
    complexityNote: "Columns from a file the site already reads, plus a table of metro names.",
    status: "deferred",
  },
];

/** Readable background pages that aren't work items themselves (linked from the roadmap, not ranked). */
export const ROADMAP_OVERVIEWS: { slug: string; file: string; title: string }[] = [
  { slug: "data-expansion", file: "specs/data-expansion/README.md", title: "Data expansion overview" },
  { slug: "product", file: "specs/product/README.md", title: "Product overview: accounts, planning tools, high schools, business" },
  { slug: "school-identity", file: "specs/school-identity/README.md", title: "School identity overview: links, accounts, short names, colors and marks" },
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
