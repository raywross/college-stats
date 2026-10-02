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

// Wave 1 (data the site already downloads) was built on 2026-09-29, and wave 2 (one new federal file each) on
// 2026-10-02; see /release-notes. Metro area, deferred from wave 2, is under "later".
export type RoadmapGroupKey =
  | "wave-3"
  | "college-reported"
  | "campus-life"
  | "national-trends"
  | "accounts"
  | "planning"
  | "high-school"
  | "business"
  | "later";

export const ROADMAP_GROUPS: { key: RoadmapGroupKey; title: string; description: string }[] = [
  {
    key: "wave-3",
    title: "Wave 3: majors and earnings by major",
    description: "Large per-college tables that need a new detail file alongside the main dataset.",
  },
  {
    key: "college-reported",
    title: "Newer figures from colleges",
    description:
      "An agent that reads colleges' own Common Data Sets and class profiles, then the data only those documents have.",
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
    slug: "majors",
    file: "specs/data-expansion/majors.md",
    group: "wave-3",
    summary: "What students actually study: top majors, how big each program is, and which are growing.",
    complexity: 4,
    complexityNote: "Builds the per-college detail file, its database table, and the field-of-study taxonomy.",
    status: "planned",
  },
  {
    slug: "college-reported-data",
    file: "specs/college-reported-data.md",
    group: "college-reported",
    summary: "Newer admissions figures from colleges' own reports, checked automatically before they're published.",
    complexity: 4,
    complexityNote: "An AI extraction pipeline with automated checks, an accuracy report, and a 50-college pilot.",
    status: "planned",
  },
  {
    slug: "cds-admissions",
    file: "specs/data-expansion/cds-admissions.md",
    group: "college-reported",
    summary: "High school GPA of admitted students, early decision and wait-list numbers, and weighted admission factors.",
    complexity: 2,
    complexityNote: "Straightforward once the agent reads Common Data Sets at scale.",
    status: "draft",
    after: ["college-reported-data"],
  },
  {
    slug: "cds-academics",
    file: "specs/data-expansion/cds-academics.md",
    group: "college-reported",
    summary: "How big classes are: the share of sections under 20 students and over 50.",
    complexity: 1,
    complexityNote: "A handful of Common Data Set cells.",
    status: "draft",
    after: ["college-reported-data"],
  },
  {
    slug: "cds-transfer",
    file: "specs/data-expansion/cds-transfer.md",
    group: "college-reported",
    summary: "Transfer applicants, admits, and what transfer students need to get in.",
    complexity: 1,
    complexityNote: "One Common Data Set section.",
    status: "draft",
    after: ["college-reported-data"],
  },
  {
    slug: "cds-cost-and-debt",
    file: "specs/data-expansion/cds-cost-and-debt.md",
    group: "college-reported",
    summary: "Next year's price before federal data has it, and graduates' total debt including private loans.",
    complexity: 2,
    complexityNote: "Newer prices must stay apart from federal figures in ranks and comparisons.",
    status: "draft",
    after: ["college-reported-data"],
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
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
