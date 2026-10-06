/**
 * The public roadmap (/roadmap, specs/roadmap.md): which planned specs and ideas appear, how they're grouped, and how
 * complex each one is. The spec text itself stays in specs/*.md; tests/roadmap.test.mts checks that every planned spec is
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
// 2026-10-02, wave 3 (majors and earnings by major, in the per-college detail file) on 2026-10-02, and wave 4
// (the round-3 CDS pipeline and its nine display specs, group "college-reported") on 2026-10-03; see /release-notes.
// Metro area, deferred from wave 2, is under "later". Campus life (religious, Greek, and LGBTQ+ life, group
// "campus-life") was built 2026-10-03/04 (#72, #73, #75, #76); its remaining work is under "later":
// campus-pilot-accuracy and campus-sources-later. National trends (the /trends hub, Studies 1–6, movers, conferences,
// states) was built 2026-10-04 on feature/national-trends; Study 7 (where the students went) and the online-share
// field it needs were specified 2026-10-05 and sit under "national-trends".
// Accounts and households (sign-in, households, student profile, saved lists, following colleges; group "accounts")
// was built 2026-10-05 on feature/accounts; Google sign-in and email sending wait for the new domain (specs/backlog.md).
// The compare redesign, the only spec in "Design and usability" (group "design"), was built 2026-10-05 (#84), so that
// group is gone until a new design spec.
export type RoadmapGroupKey =
  | "national-trends"
  | "college-reported"
  | "campus-life"
  | "planning"
  | "high-school"
  | "business"
  | "ideas"
  | "later";

export const ROADMAP_GROUPS: { key: RoadmapGroupKey; title: string; description: string }[] = [
  {
    key: "national-trends",
    title: "National trends",
    description:
      "Questions about the whole landscape of colleges, not one college: where students went over ten years, and the data that keeps online colleges from standing in for campuses.",
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
    key: "ideas",
    title: "Ideas",
    description:
      "Not yet planned: fresh directions from research into competing sites and guide-and-advisor sites in other fields, each written up far enough to judge. An idea becomes a plan when its data is verified and it gets a place in the build order.",
  },
  {
    key: "later",
    title: "Later",
    description:
      "Worked out, then set aside: each is parked until another feature needs it, and gets built alongside that feature.",
  },
];

/** "idea": written up far enough to judge, not planned work; always in the "ideas" group (the test checks). */
export type RoadmapStatus = "planned" | "draft" | "deferred" | "idea";

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  planned: "Planned",
  draft: "Early draft",
  deferred: "Deferred",
  idea: "Idea",
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
    slug: "online-share",
    file: "specs/data-expansion/online-share.md",
    group: "national-trends",
    summary:
      "How much of each college's undergraduate enrollment is entirely online, from the federal distance-education counts: a line on the profile, an Explore filter, and the stored rule that keeps online colleges out of growth lists and campus-based trends.",
    complexity: 1,
    complexityNote: "One more IPEDS file the sync reads, two fields and one history series, and a filter; the online-first rule already exists as a reviewed list.",
    status: "planned",
  },
  {
    slug: "where-students-go",
    file: "specs/trends/where-students-go.md",
    group: "national-trends",
    summary:
      "Where undergraduates went over ten years, as shares of all students then and now: toward the biggest campuses and research universities, toward publics and the Sun Belt, and not toward cheaper colleges; and whether the pandemic sped that up or is reversing it.",
    complexity: 2,
    complexityNote:
      "One study on the existing trends machinery, but it classifies colleges as they were at the start of the window, adds a campus-based panel, a state map by share change, and a chart of price change against enrollment change.",
    status: "planned",
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
  },
  {
    slug: "award-letter-analyzer",
    file: "specs/product/award-letter-analyzer.md",
    group: "planning",
    summary: "Real aid offers in one standard layout: what you pay, what you borrow, and the four-year total, side by side.",
    complexity: 3,
    complexityNote: "A standard offer model, four-year math, flags and questions, and later a document upload read by a model.",
    status: "planned",
    after: ["net-price-estimator"],
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
    after: ["commercialization"],
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
  // Ideas (specs/ideas/README.md): not planned; in the order they could be built.
  {
    slug: "guides",
    file: "specs/ideas/guides.md",
    group: "ideas",
    summary:
      "Common questions answered as living lists (\"where merit aid is the norm\", \"four years means four\"): each a published query with its criteria shown, recomputed with every data release.",
    complexity: 2,
    complexityNote: "A typed registry of queries, a build step at publish, one page template, a recompute test, and a personal variant.",
    status: "idea",
  },
  {
    slug: "cost-to-a-degree",
    file: "specs/ideas/cost-to-a-degree.md",
    group: "ideas",
    summary:
      "What a degree costs here, not one year of it: the four-year plan beside the typical time to finish, and the debt of those who leave without one.",
    complexity: 1,
    complexityNote: "Arithmetic on fields the site already has, a cost block, a Compare row, and an Explore sort.",
    status: "idea",
  },
  {
    slug: "near-and-far",
    file: "specs/ideas/near-and-far.md",
    group: "ideas",
    summary:
      "A map view with drive-time rings, nearest airports, what getting home costs, and the colleges on your list grouped into visit trips. The home address, Explore's distance filter, and distance on lists are already built (specs/product/home-and-distance.md).",
    complexity: 3,
    complexityNote:
      "A new kind of view (the map), an airport table, and lines in Compare and the estimator; the home and the ZIP table exist now.",
    status: "idea",
    // Also uses each college's visit link (specs/school-identity/links.md, built 2026-10-04).
  },
  {
    slug: "worst-plausible-spring",
    file: "specs/ideas/worst-plausible-spring.md",
    group: "ideas",
    summary:
      "If every Reach says no: what your list leaves you with, what it would cost, and what's missing, as facts rather than a grade.",
    complexity: 1,
    complexityNote: "One pure function over the saved list's rows and a panel; the figures come from the specs it builds on.",
    status: "idea",
  },
  {
    slug: "would-compete-for-you",
    file: "specs/ideas/would-compete-for-you.md",
    group: "ideas",
    summary:
      "Colleges where your numbers sit above the admitted range, merit awards without need are routine, and demand has softened, with the reasons.",
    complexity: 2,
    complexityNote: "A query over standing, merit, and history fields, one page, one Explore chip, and a hand-checked pilot.",
    status: "idea",
    // Also needs the CDS merit awards (cds-financial-aid), built 2026-10-03 and so no longer on the roadmap.
    after: ["chances-and-fit"],
  },
  {
    slug: "cycle-watch",
    file: "specs/ideas/cycle-watch.md",
    group: "ideas",
    summary:
      "What changed for the coming application cycle at every college: test policy, early rounds, deadlines, fees, and aid forms, each in the college's own words.",
    complexity: 2,
    complexityNote: "A change table built at publish from the agent's editions, one public page, a digest kind, and an email variant.",
    status: "idea",
    // Also needs the CDS policy, early-round, and logistics records, built 2026-10-03 and so no longer on the roadmap.
  },
  {
    slug: "getting-into-the-major",
    file: "specs/ideas/getting-into-the-major.md",
    group: "ideas",
    summary:
      "Whether a college admits to the major or to the university, which programs admit directly, what it takes to get in after year one, and whether you can change in later.",
    complexity: 3,
    complexityNote: "A new recipe type for the agent with checks and review, new fields, a profile block, two filters, and a pilot.",
    status: "idea",
    // Also needs the round-3 agent (college-reported-round-3), built 2026-10-03 and so no longer on the roadmap.
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
  {
    slug: "campus-sources-later",
    file: "specs/campus-sources-later.md",
    group: "later",
    summary:
      "More campus-life sources once we can read them: national chapter directories now rendered only by JavaScript, pages sitting behind a login or bot challenge, and facts only the organization itself can give us.",
    complexity: 2,
    complexityNote:
      "Several independent fixes, not one project: a headless-browser renderer for JavaScript-only pages, hand reading for challenge-protected ones, and data-partnership requests to about a dozen organizations.",
    status: "deferred",
  },
  {
    slug: "campus-pilot-accuracy",
    file: "specs/campus-pilot-accuracy.md",
    group: "later",
    summary:
      "Reading every college's own fraternity, faith, and LGBTQ+ pages accurately enough to show the results everywhere, not just at the 75 colleges we tested.",
    complexity: 3,
    complexityNote:
      "Fixes for the fact types three scored rounds got wrong (policies, centers, membership tables), a re-score of 75 colleges, then one full run of about $300.",
    status: "deferred",
  },
  {
    slug: "identity-follow-ups",
    file: "specs/school-identity/follow-ups.md",
    group: "later",
    summary:
      "Find the campus visit page for the 492 colleges whose admissions page doesn't name one plainly, with one small paid run of a picker that's already built.",
    complexity: 1,
    complexityNote: "Built and tested behind a flag; left are one paid run (about $1.50), keeping its finds through the monthly refresh, and a look at its picks.",
    status: "deferred",
  },
];

/** Readable background pages that aren't work items themselves (linked from the roadmap, not ranked). */
export const ROADMAP_OVERVIEWS: { slug: string; file: string; title: string }[] = [
  { slug: "data-expansion", file: "specs/data-expansion/README.md", title: "Data expansion overview" },
  { slug: "product", file: "specs/product/README.md", title: "Product overview: accounts, planning tools, high schools, business" },
  { slug: "school-identity", file: "specs/school-identity/README.md", title: "School identity overview: links, accounts, short names, colors and marks" },
  { slug: "ideas", file: "specs/ideas/README.md", title: "Ideas overview: the research and the smaller additions proposed for existing specs" },
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
