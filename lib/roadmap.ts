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
// states) was built 2026-10-04 on feature/national-trends; Study 7 (where the students went), the online-share field
// it needs, the state flows addition, and Study 3's campus-based toggle were built 2026-10-12 on
// feature/national-trends-2, so the "national-trends" group is gone until a new study is specified.
// Accounts and households (sign-in, households, student profile, saved lists, following colleges; group "accounts")
// was built 2026-10-05 on feature/accounts; Google sign-in and email sending wait for the new domain (specs/backlog.md).
// The group came back on 2026-10-06 with the owner's review of that build: the household hub (people by name, one
// list each), built the same day. The application plan written then became the planner's timeline on 2026-10-07,
// when the planner (specs/planner/) was specified: six stages from the first list to the deposit, with the
// award-letter analyzer moved in as its last stage. The planner was built 2026-10-08 on feature/planner (eight units
// on sub-branches), so the "planner" group is gone too; its overview page stays under ROADMAP_OVERVIEWS.
// The planner came back on 2026-10-09 as group "planner": the owner's review of the build (too much on the screen,
// buried in the profile menu, the ranking hated) became the redesign in specs/planner/redesign/, six parts, built
// 2026-10-10 on feature/plan-redesign (nine units on sub-branches), so the group is gone again.
// Admission chances (specs/chances/, seven parts) was built 2026-10-11 on feature/chances, so its group was gone; it
// came back the same day as group "chances" with the owner's review of the build: five levels instead of three, a
// selectivity tier per college, "applicants like you" wording, depth (course tracks and activities), and the inputs
// beyond the numbers (class standing, awards, work, legacy, recruiting, interest); parts 8–12 in specs/chances/,
// built 2026-10-12 on feature/chances (nine units on sub-branches), so the group is gone again.
// The compare redesign, the only spec in "Design and usability" (group "design"), was built 2026-10-05 (#84), so that
// group is gone until a new design spec.
// Next steps (specs/planner/next-steps/, seven parts) was specified 2026-10-14 from the owner's brief to drive actions
// from students and parents by season (group "next-steps") and built the same day on feature/next-steps (nine units on
// sub-branches, PR #160), so the group is gone; its overview page stays under ROADMAP_OVERVIEWS.
// Plan v3 (specs/planner/v3/, nine parts) was specified 2026-10-15 and built 2026-10-16 (PR #165) from the owner's
// review of the built Next steps: a Connections step in the profile, three cards instead of six, and a guide per task.
// Your record (specs/planner/record/, six parts: steps, majors, ranking, reading, less-text, docs) was built 2026-10-16
// on feature/plan-v3, so its group is gone; the overview stays under ROADMAP_OVERVIEWS.
// Roadmap review, 2026-10-25/26: every remaining entry was read against the built site. Retired as built elsewhere:
// chances-and-fit (the estimate, Explore-by-level, the fit chips), early-decision-strategy (lib/early.ts, the profile's
// "Applying early", the Common App filters, ED opportunities); retired as unneeded: metro-area. Folded into other
// entries: manual-collection and campus-sources-later into data-steward's To do list, scattergrams into the counselor
// portal (so the "high-school" group is gone). Rewritten against what exists: net-price-estimator, commercialization,
// near-and-far, worst-plausible-spring, cycle-watch, getting-into-the-major, and the three iPhone specs.
export type RoadmapGroupKey =
  | "essays"
  | "college-reported"
  | "campus-life"
  | "planning"
  | "platform"
  | "business"
  | "apps"
  | "ideas"
  | "later";

export const ROADMAP_GROUPS: { key: RoadmapGroupKey; title: string; description: string }[] = [
  {
    key: "essays",
    title: "Essays",
    description:
      "The prompts a college never publishes: a likely tier from one permitted source, a person's read of the form, and families confirming the questions they meet, each marked for what it is.",
  },
  {
    key: "planning",
    title: "Planning tools",
    description:
      "What your family would pay at each college, from your own numbers, on the cost curve the site already shows.",
  },
  {
    key: "platform",
    title: "The data platform",
    description:
      "Where the college data lives and how a change becomes live: the database as the source of truth with history and revert, a published snapshot the site reads, and an admin console that edits values directly.",
  },
  {
    key: "business",
    title: "Platform, measurement, and business",
    description:
      "The production database, an assistant that clears the data review queue and keeps the list of documents a person has to fetch, the advisor as the one paid product with public data free, and free counselor accounts.",
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
  // Essays part 6 (2026-10-30): the owner's question about Florida's missing prompts; parts 4–5 were built the same day.
  {
    slug: "essays-sources",
    file: "specs/product/essays/sources.md",
    group: "essays",
    summary:
      "Prompts the college never publishes: likely (College Essay Guy, under permission), confirmed (a person's read of the form, or two families reporting the same question and the owner approving), each marked for what it is and never shown as the college's own words.",
    complexity: 2,
    complexityNote: "One more recipe in the college-reported engine, two small tables with a consent box and a consensus rule, and a review row in the Data Steward's queue.",
    status: "planned",
  },
  {
    slug: "net-price-estimator",
    file: "specs/product/net-price-estimator.md",
    group: "planning",
    summary:
      "Your family's own numbers on each college's cost curve: the federal Student Aid Index and Pell, a range per college, the line for what you can pay, and a four-year total.",
    complexity: 3,
    complexityNote:
      "The federal aid formula as versioned data, guardian-only inputs placed on the built cost curve, and a hand-checked pilot against colleges' own calculators.",
    status: "planned",
  },
  // The award-letter analyzer moved into the planner on 2026-10-07 as its last stage (slug "offers").
  // common-app (specs/data-expansion/common-app.md) was built 2026-10-25 on feature/common-app after Common App agreed
  // to the use; see the spec's "As built" section.
  // visit-events (specs/product/visit-events.md) was planned and built the same day, 2026-10-13, on feature/visit-events
  // as a four-college pilot; the research is in specs/ideas/visit-events.md (promoted).
  // Essays (specs/product/essays/: the prompts, the workspace, the reviewer) were planned 2026-10-28 and built the next
  // day on feature/essays; see each spec's "As built" section. The Google Drive connection waits for Google sign-in.
  // Essays parts 4 and 5 (the move and the tab, group "essays") were built 2026-10-30 on feature/essays-next (PR
  // #194); see each spec's "As built" section.
  // The data platform (specs/data-platform/rollout.md, group "platform") was built 2026-10-31 to 2026-11-01 in four
  // phases (PRs #201, #203, #204, #205): pipelines write layers to the database, a published snapshot is what the site
  // reads, change sets carry history and revert, admins edit any value in the console, and data/ left the repository.
  // See each part's "As built" sections; the overview stays in ROADMAP_OVERVIEWS.
  {
    slug: "launch-database",
    file: "specs/launch-database.md",
    group: "business",
    summary:
      "Just before launch, a production database in the same region as the site's servers (today's only database is in Canada and the servers are in Virginia), with the schema, accounts to keep, and settings moved across.",
    complexity: 2,
    complexityNote:
      "A new Supabase project, every migration in one tested script, an account dump and restore, auth settings, and swapping the keys in Vercel; mostly careful steps, little new code.",
    status: "planned",
  },
  {
    slug: "data-steward",
    file: "specs/product/data-steward.md",
    group: "business",
    summary:
      "Behind the scenes: an assistant that works through the figures our checks hold back, proves each fix against the college's own document, asks before anything changes on the site, and keeps the list of documents only a person can fetch.",
    complexity: 3,
    complexityNote:
      "An agent run in GitHub Actions with a budget and no power to merge, clustering of the review queue, a document archive it can read, a To do list for documents a person must fetch, and a redesigned Operations page.",
    status: "planned",
  },
  {
    slug: "advisor",
    file: "specs/product/advisor.md",
    group: "business",
    summary:
      "The plan is Quad Advisor now, and a visitor sees exactly what they'd get before they sign up (both built); left: the 14-day free trial with your card on file and the yearly price after.",
    complexity: 1,
    complexityNote:
      "The name, the redirects, and the page are built; what remains is the trial flow on Stripe Checkout with one reminder email, which lands with commercialization.",
    status: "planned",
  },
  {
    slug: "commercialization",
    file: "specs/product/commercialization.md",
    group: "business",
    summary:
      "The advisor: the plan as the one paid product, $20 a year for a student or $30 for a family, with everything else on the site free, including the counselor's portal.",
    complexity: 3,
    complexityNote:
      "Stripe billing for two yearly products, webhooks, the entitlement map behind the planner's built capability hook, a pricing page, and the legal setup before launch.",
    status: "planned",
    after: ["advisor"],
  },
  {
    slug: "counselor-portal",
    file: "specs/product/counselor-portal.md",
    group: "business",
    summary:
      "Free organization accounts for counselors and consultants: a caseload dashboard over students' plans, co-branded reports, and, as its last phase, scattergrams uploaded from the school's own records.",
    complexity: 4,
    complexityNote:
      "A second kind of account with its own grants, dashboards, PDF reports, data agreements for schools, and the scattergram upload with its scrubbing and thresholds.",
    status: "planned",
    after: ["commercialization"],
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
      "Drive-time rings on Explore's map, the nearest airport, the colleges on your plan grouped into visit trips with their next tours, and what getting home costs. The home, the distance filter, the map view, and distance on the plan are already built.",
    complexity: 2,
    complexityNote:
      "Two reference files (airports, fares), rings on the built map, a clustering function over the plan, and a line in the family's price.",
    status: "idea",
    // Also uses each college's visit link (specs/school-identity/links.md, built 2026-10-04).
  },
  {
    slug: "worst-plausible-spring",
    file: "specs/ideas/worst-plausible-spring.md",
    group: "ideas",
    summary:
      "If every Reach says no: what your plan leaves you with at each level, what it would cost, and what's missing, as facts rather than a grade. The plan's list shape already counts the gaps; this names what's left.",
    complexity: 1,
    complexityNote: "One pure function over the plan's rows and a fold under the balance notice; the figures come from the specs it builds on.",
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
    // Also needs the CDS merit awards (cds-financial-aid), built 2026-10-03, and Quad's estimate (chances/, built
    // 2026-10-12), so no longer on the roadmap; the signals read the five levels and the selectivity tier.
  },
  {
    slug: "cycle-watch",
    file: "specs/ideas/cycle-watch.md",
    group: "ideas",
    summary:
      "What changed for the coming application cycle at every college: test policy, early rounds, deadlines, fees, and requirements, from one edition of the Common App Requirements Grid to the next, with the CDS for the rest.",
    complexity: 1,
    complexityNote: "A diff over grid editions the site already stores, one trends page, a digest kind, and a move on the plan.",
    status: "idea",
    // Also needs the CDS policy, early-round, and logistics records, built 2026-10-03 and so no longer on the roadmap.
  },
  {
    slug: "getting-into-the-major",
    file: "specs/ideas/getting-into-the-major.md",
    group: "ideas",
    summary:
      "What it takes to get into the major after year one and whether you can change in later, at 200 colleges read by the agent; which unit admits and who admits directly is already in Quad's estimate for the first colleges.",
    complexity: 2,
    complexityNote: "A recipe for the agent with checks and review, two fields on a built record, a profile block, two filters, and a pilot.",
    status: "idea",
    // Also needs the round-3 agent (college-reported-round-3), built 2026-10-03 and so no longer on the roadmap.
  },
  // visit-events was an idea here until 2026-10-13, when the desktop research (UF and Duke traced) and the owner's
  // decisions made it a planned product spec under "planning" (specs/product/visit-events.md); the idea file keeps the
  // research and is marked promoted.
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
    slug: "greek-known-for",
    file: "specs/greek-known-for.md",
    group: "later",
    summary:
      "Colleges where fraternity and sorority life is a big part of campus get a \"Known for: Big Greek life\" tag, now that 102 colleges report it.",
    complexity: 1,
    complexityNote:
      "The display module and the partial-coverage guard already exist; left are the top-decile rule, the Known for wiring, and lifting the guard for this one use.",
    status: "planned",
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
      "Every screen of the site as JSON for the iPhone app, computed by the same code as the pages, with a citation on every value and the plan's moves and guides as actions.",
    complexity: 3,
    complexityNote:
      "A second route family on the built Data API library: the public screens, the plan's screens and actions, a fixed block catalog, an OpenAPI document the Swift models are generated from, and the Server Actions' logic moved into lib so both clients share it.",
    status: "planned",
  },
  {
    slug: "ios-app",
    file: "specs/iphone-app/app.md",
    group: "apps",
    summary:
      "A native iPhone app with everything the site does, the plan first: the same charts, words, levels, and citations, plus Face ID sign-in, offline reading, push for visit alerts and deadlines, and share links that open the site.",
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
      "The route-by-route map of what each page of the site becomes in the app, so nothing the site does is left out.",
    complexity: 3,
    complexityNote:
      "Every page route of the site mapped to a screen, its owning spec, and an API call in two phases, and a check that a new site route must be added to the map in the same change.",
    status: "planned",
    after: ["app-api", "ios-app"],
  },
];

/** Readable background pages that aren't work items themselves (linked from the roadmap, not ranked). */
export const ROADMAP_OVERVIEWS: { slug: string; file: string; title: string }[] = [
  { slug: "data-platform-overview", file: "specs/data-platform/README.md", title: "Data platform overview: the owner's brief and decisions, what lives where today, the design in one paragraph, the six parts, principles" },
  { slug: "record", file: "specs/planner/record/README.md", title: "Your record overview: the owner's review of the plan v3 preview, the name, the four parts, and the build order" },
  { slug: "plan-v3", file: "specs/planner/v3/README.md", title: "Plan v3 overview: the owner's review of Next steps, the nine parts, the design principles, and the build order" },
  { slug: "next-steps", file: "specs/planner/next-steps/README.md", title: "Next steps overview: the research into how advisors run the process, the design principles, the seven parts, and the build order" },
  { slug: "planner-redesign", file: "specs/planner/redesign/README.md", title: "Planner redesign overview: the owner's review, the research, the design principles, and what stays and goes" },
  { slug: "planner", file: "specs/planner/README.md", title: "Planner overview: the six stages from the first list to the deposit, the research, the tiers, and the build order" },
  { slug: "data-expansion", file: "specs/data-expansion/README.md", title: "Data expansion overview" },
  { slug: "product", file: "specs/product/README.md", title: "Product overview: accounts, planning tools, high schools, business" },
  { slug: "school-identity", file: "specs/school-identity/README.md", title: "School identity overview: links, accounts, short names, colors and marks" },
  { slug: "ideas", file: "specs/ideas/README.md", title: "Ideas overview: the research and the smaller additions proposed for existing specs" },
  { slug: "iphone-app", file: "specs/iphone-app/README.md", title: "iPhone app overview: the app API, the native app, and the screen-by-screen parity map" },
  { slug: "chances", file: "specs/chances/README.md", title: "Admission chances overview: Quad's estimate is proprietary; its inputs, the seven parts, and where they show" },
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
