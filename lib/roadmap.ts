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
// The group came back on 2026-10-06 with the owner's review of that build: the household hub (people by name, one
// list each), built the same day. The application plan written then became the planner's timeline on 2026-10-07,
// when the planner (group "planner", specs/planner/) was specified: six stages from the first list to the deposit,
// with the award-letter analyzer moved in as its last stage. So the "accounts" group is gone until a new spec.
// The compare redesign, the only spec in "Design and usability" (group "design"), was built 2026-10-05 (#84), so that
// group is gone until a new design spec.
export type RoadmapGroupKey =
  | "planner"
  | "national-trends"
  | "college-reported"
  | "campus-life"
  | "planning"
  | "high-school"
  | "business"
  | "apps"
  | "ideas"
  | "later";

export const ROADMAP_GROUPS: { key: RoadmapGroupKey; title: string; description: string }[] = [
  {
    key: "planner",
    title: "The planner: from the first list to the deposit",
    description:
      "Six stages for a family: build and sort the list with a Dream, decide who gets the early application, follow and visit, work a timeline of dated tasks, track every application, then read the offers and choose; with a parent's view throughout.",
  },
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
      "Where your numbers stand, what your family would pay, and whether applying early helps; the planner builds on all three.",
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
    key: "apps",
    title: "Native apps",
    description:
      "Quad as an iPhone app with everything the site does: a screen API computed by the same code as the pages, a native SwiftUI app that never computes a number itself, and a page-by-page parity map.",
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
  // The planner (specs/planner/, 2026-10-07): the model first, then the six stages in the order a family meets them,
  // then the parent's view over all of it. Builds on the household hub (built 2026-10-06, no longer on the roadmap).
  {
    slug: "planner-model",
    file: "specs/planner/model.md",
    group: "planner",
    summary:
      "The plan's foundation: a Plan tab on each student's page, the six stages computed from the list itself, and one set of tasks, visits, and offers that every stage reads and writes.",
    complexity: 3,
    complexityNote:
      "New tables with policies around the existing list, a stage machine, idempotent task generation with lineage on every date, the Plan tab's frame, and the entitlement hooks the stages share.",
    status: "planned",
  },
  {
    slug: "list-building",
    file: "specs/planner/list-building.md",
    group: "planner",
    summary:
      "Sort the list by the numbers: the site's suggested Reach, Target, or Likely beside the student's choice with the reason shown, one Dream, sorts by what matters, and a balance line that says what's missing.",
    complexity: 2,
    complexityNote: "A suggestion rule over fields the site has, a Dream flag with its trigger, a sort menu, drag ordering, and a finding rail; standing plugs in when chances is built.",
    status: "planned",
    after: ["planner-model"],
  },
  {
    slug: "early-rounds",
    file: "specs/planner/early-rounds.md",
    group: "planner",
    summary:
      "Who gets the one binding early application: each college's rounds and dates, last year's early-round advantage with its caveats, the conflicts between rounds, what a binding offer would cost this family, and a proposed plan the student edits.",
    complexity: 3,
    complexityNote:
      "A ranking step, a proposal with published rules, live conflict checks across rounds, the money question from the estimator, and tasks written for the timeline.",
    status: "planned",
    after: ["planner-model", "list-building", "early-decision-strategy"],
  },
  {
    slug: "planner-actions",
    file: "specs/planner/actions.md",
    group: "planner",
    summary:
      "Follow the admissions office in one click where a network allows it, request information, book and log visits with notes that are useful in April, and know at which colleges interest is counted.",
    complexity: 2,
    complexityNote: "Follow intents and deep links per network, a visit log with prompts and calendar files, the interest line from CDS C7, and a small links follow-up for request-information pages.",
    status: "planned",
    after: ["planner-model"],
  },
  {
    slug: "timeline",
    file: "specs/planner/timeline.md",
    group: "planner",
    summary:
      "The project plan: every dated task from the college's published dates, the cycle's dates, and the stage the student is in, with an owner, grouped by month or by college, in a calendar feed, a weekly email, and texts for those who turn them on.",
    complexity: 3,
    complexityNote:
      "Task generators from the college-reported dates, a versioned cycle file with windows and the summer list, a grade-aware fold, a calendar feed, reminders through the existing digest plus a new weekly email, and text messages with consent, quiet hours, and a provider behind one interface.",
    status: "planned",
    after: ["planner-model", "early-rounds"],
  },
  {
    slug: "applications",
    file: "specs/planner/applications.md",
    group: "planner",
    summary:
      "One checklist across every application: what the college requires (fee and waiver, test policy, aid forms), what's submitted and complete, the portal link, and the follow-ups a deferral or a wait list creates.",
    complexity: 2,
    complexityNote: "A requirements list from fields the site has, a status progression with dates on the existing columns, generated sub-tasks, and the deferral and wait-list rules.",
    status: "planned",
    after: ["timeline"],
  },
  {
    slug: "offers",
    file: "specs/planner/offers.md",
    group: "planner",
    summary:
      "Record each decision in a tap, enter every aid offer in one standard layout with four-year totals beside your estimate and the college's outcomes, compare the admits, choose, and get the deposit, withdrawal, and summer tasks.",
    complexity: 3,
    complexityNote:
      "A standard offer model, four-year math, flags and questions, the choice's generated tasks, and a share-your-letter step that collects the set a later upload-and-read path is built on.",
    status: "planned",
    after: ["applications", "net-price-estimator"],
  },
  {
    slug: "planner-parents",
    file: "specs/planner/parents.md",
    group: "planner",
    summary:
      "What a parent sees without asking: a summary line per student, the same plan read-only, a nudge on any task that can't turn into nagging, the parent's own tasks in one place, and a weekly email.",
    complexity: 2,
    complexityNote: "Views over the stages under the existing household grants, a rate-limited nudge with its table, the parent's task list, stuck signals, and one more email on the digest job.",
    status: "planned",
    after: ["planner-model", "timeline"],
  },
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
  // The award-letter analyzer moved into the planner on 2026-10-07 as its last stage (slug "offers").
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
    slug: "common-app",
    file: "specs/data-expansion/common-app.md",
    group: "planning",
    summary:
      "Deadlines, fees, essays, recommendations, and this cycle's test policy for the thousand colleges that take the Common App, plus how the application season is going nationally months before federal data, once Common App agrees to the use.",
    complexity: 2,
    complexityNote:
      "A PDF grid parsed by column, a name-to-id join, a block of fields and a source, one profile card, six filters, and a permission letter that sets the start date.",
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
  {
    slug: "manual-collection",
    file: "specs/manual-collection.md",
    group: "business",
    summary:
      "An inventory of public documents our crawlers can't read (sites that block automated reading), prioritized and paced, worked through in a supervised browser session that feeds the same extractors.",
    complexity: 2,
    complexityNote:
      "An inventory built from the existing blocked lists, a wave scheduler with per-host pacing, from-file entry points for each extractor, and a Claude in Chrome skill; one access-rule decision for the owner.",
    status: "planned",
  },
  // The serving architecture (specs/serving-architecture.md) was planned and built on 2026-10-07 (#98), so it is
  // no longer listed.
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
  // Native apps (specs/iphone-app/, 2026-10-06): the API first, then the app, measured against the screen map.
  {
    slug: "app-api",
    file: "specs/iphone-app/api.md",
    group: "apps",
    summary:
      "Every screen of the site as JSON for the iPhone app, computed by the same code as the pages, with a citation on every value.",
    complexity: 3,
    complexityNote:
      "About forty public endpoints and the signed-in ones built over existing lib code, a fixed block catalog, an OpenAPI document the Swift models are generated from, and the Server Actions' logic moved into lib so both clients share it.",
    status: "planned",
  },
  {
    slug: "ios-app",
    file: "specs/iphone-app/app.md",
    group: "apps",
    summary:
      "A native iPhone app with everything the site does: the same charts, words, and citations, plus Face ID sign-in, offline reading, and share links that open the site.",
    complexity: 4,
    complexityNote:
      "A SwiftUI codebase with a renderer per block kind, Supabase Auth with Sign in with Apple, universal links, an offline cache, design tokens generated from the site's CSS, and an App Store release with its own tests and CI job.",
    status: "planned",
    after: ["app-api"],
  },
  {
    slug: "ios-screens",
    file: "specs/iphone-app/screens.md",
    group: "apps",
    summary:
      "The page-by-page map of what each part of the site becomes in the app, so nothing the site does is left out.",
    complexity: 3,
    complexityNote:
      "Every route and control of the site mapped to a screen and an API call in two phases, and a check that a new site route must be added to the map in the same change.",
    status: "planned",
    after: ["app-api", "ios-app"],
  },
];

/** Readable background pages that aren't work items themselves (linked from the roadmap, not ranked). */
export const ROADMAP_OVERVIEWS: { slug: string; file: string; title: string }[] = [
  { slug: "planner", file: "specs/planner/README.md", title: "Planner overview: the six stages from the first list to the deposit, the research, the tiers, and the build order" },
  { slug: "data-expansion", file: "specs/data-expansion/README.md", title: "Data expansion overview" },
  { slug: "product", file: "specs/product/README.md", title: "Product overview: accounts, planning tools, high schools, business" },
  { slug: "school-identity", file: "specs/school-identity/README.md", title: "School identity overview: links, accounts, short names, colors and marks" },
  { slug: "ideas", file: "specs/ideas/README.md", title: "Ideas overview: the research and the smaller additions proposed for existing specs" },
  { slug: "iphone-app", file: "specs/iphone-app/README.md", title: "iPhone app overview: the app API, the native app, and the screen-by-screen parity map" },
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
