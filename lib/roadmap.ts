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
export type RoadmapGroupKey = "wave-3" | "college-reported" | "campus-life" | "national-trends" | "later";

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
];

export function roadmapSpec(slug: string): RoadmapSpec | undefined {
  return ROADMAP.find((s) => s.slug === slug);
}

/** Every page under /roadmap/{slug}: specs and overviews. */
export function roadmapPages(): { slug: string; file: string }[] {
  return [...ROADMAP, ...ROADMAP_OVERVIEWS].map(({ slug, file }) => ({ slug, file }));
}
