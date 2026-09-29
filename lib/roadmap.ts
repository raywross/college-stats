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

export type RoadmapGroupKey = "wave-1" | "wave-2" | "wave-3" | "college-reported" | "campus-life" | "national-trends";

export const ROADMAP_GROUPS: { key: RoadmapGroupKey; title: string; description: string }[] = [
  {
    key: "wave-1",
    title: "Wave 1: data we already download",
    description: "Columns in federal files the site already reads, or fields on the existing College Scorecard call.",
  },
  {
    key: "wave-2",
    title: "Wave 2: one new federal file each",
    description: "Each adds one NCES file to the data sync and a focused set of new facts on every college.",
  },
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
];

export type RoadmapStatus = "planned" | "draft";

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  planned: "Planned",
  draft: "Early draft",
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
    slug: "admission-factors",
    file: "specs/data-expansion/admission-factors.md",
    group: "wave-1",
    summary: "What each college weighs in admission: GPA, class rank, essays, recommendations, and legacy status.",
    complexity: 2,
    complexityNote: "Data is already downloaded, but it builds the \"events\" history (policy changes over time) that later specs reuse.",
    status: "planned",
  },
  {
    slug: "housing-and-policies",
    file: "specs/data-expansion/housing-and-policies.md",
    group: "wave-1",
    summary: "Campus housing capacity, live-on rules, meal plans, application fees, and tuition guarantees.",
    complexity: 2,
    complexityNote: "Columns moved between files over the years, and it starts the new Campus life section.",
    status: "planned",
  },
  {
    slug: "loans-and-repayment",
    file: "specs/data-expansion/loans-and-repayment.md",
    group: "wave-1",
    summary: "How many students borrow, debt for lower-income students, and how graduates repay.",
    complexity: 2,
    complexityNote: "Scorecard fields, but repayment arrives as ranges that need their own parsing and chart.",
    status: "planned",
  },
  {
    slug: "campus-profile",
    file: "specs/data-expansion/campus-profile.md",
    group: "wave-2",
    summary: "City, suburb, town, or rural setting; research and Carnegie classes; HBCU and other designations; a map view.",
    complexity: 3,
    complexityNote: "A new directory file plus a new map view in Explore.",
    status: "planned",
  },
  {
    slug: "campus-services",
    file: "specs/data-expansion/campus-services.md",
    group: "wave-2",
    summary: "Athletics division and conference, ROTC, study abroad, undergraduate research, and AP credit.",
    complexity: 2,
    complexityNote: "A new file and a hand-kept conference-to-division table, reviewed yearly.",
    status: "planned",
  },
  {
    slug: "student-faculty-ratio",
    file: "specs/data-expansion/student-faculty-ratio.md",
    group: "wave-2",
    summary: "Students per faculty member, with more than 15 years of history.",
    complexity: 1,
    complexityNote: "One column from one new file.",
    status: "planned",
  },
  {
    slug: "residence",
    file: "specs/data-expansion/residence.md",
    group: "wave-2",
    summary: "Where first-years come from: in-state, out-of-state, international, and the top home states.",
    complexity: 3,
    complexityNote: "Home-state tables are too big for the main dataset, so it may build the per-college detail file.",
    status: "planned",
  },
  {
    slug: "outcome-measures",
    file: "specs/data-expansion/outcome-measures.md",
    group: "wave-2",
    summary: "Eight-year results for every student who starts, including transfers and part-timers.",
    complexity: 3,
    complexityNote: "A new file, and graduation becomes a fifth trend indicator across the site.",
    status: "planned",
  },
  {
    slug: "graduation-by-group",
    file: "specs/data-expansion/graduation-by-group.md",
    group: "wave-2",
    summary: "Graduation rates for Pell Grant recipients and by race and ethnicity.",
    complexity: 2,
    complexityNote: "Two sources, and gaps need care at small colleges.",
    status: "planned",
  },
  {
    slug: "finances",
    file: "specs/data-expansion/finances.md",
    group: "wave-2",
    summary: "Endowment per student and spending on instruction per student.",
    complexity: 2,
    complexityNote: "A new file; public and private colleges report finances on different forms, so they are never ranked together.",
    status: "planned",
  },
  {
    slug: "faculty",
    file: "specs/data-expansion/faculty.md",
    group: "wave-2",
    summary: "Average faculty salary and the share of faculty who are full-time.",
    complexity: 1,
    complexityNote: "One new file plus one Scorecard field.",
    status: "planned",
  },
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
    slug: "field-of-study",
    file: "specs/data-expansion/field-of-study.md",
    group: "wave-3",
    summary: "What graduates in each major earn and owe, at each college.",
    complexity: 3,
    complexityNote: "A large Scorecard dataset joined to the majors table.",
    status: "planned",
    after: ["majors"],
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
];

/** Readable background pages that aren't work items themselves (linked from the roadmap, not ranked). */
export const ROADMAP_OVERVIEWS: { slug: string; file: string; title: string }[] = [
  { slug: "data-expansion", file: "specs/data-expansion/README.md", title: "Data expansion overview" },
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
