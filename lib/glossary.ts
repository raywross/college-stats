/**
 * Single source of truth for terminology. Every <InfoTip> and <Term>
 * reads from here, and /glossary renders the full list.
 */

export type GlossaryCategory =
  | "Admissions"
  | "Test scores"
  | "Students & access"
  | "Cost & outcomes"
  | "School types"
  | "How we measure"
  | "Data sources";

export interface GlossaryEntry {
  term: string;
  /** One or two sentences, shown in the pop-over. */
  short: string;
  /** Longer explanation for the glossary page. */
  long?: string;
  /** "Why it matters" framing for students. */
  why?: string;
  category: GlossaryCategory;
  /** Keys of related entries (validated at render time via isTermKey). */
  related?: string[];
}

export const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  "Admissions",
  "Test scores",
  "Students & access",
  "Cost & outcomes",
  "School types",
  "How we measure",
  "Data sources",
];

const entries = {
  "acceptance-rate": {
    term: "Acceptance rate",
    short: "The share of applicants who were offered admission. Lower means harder to get in.",
    long: "Calculated as admitted ÷ applicants for a single admissions cycle. A 5% acceptance rate means roughly 1 in 20 applicants was admitted.",
    why: "It's the quickest signal of how competitive admission is, but it says nothing about fit, cost, or outcomes. Schools with many applicants can look more selective than they are for a well-prepared student.",
    category: "Admissions",
    related: ["applicants", "admitted", "selectivity"],
  },
  applicants: {
    term: "Applicants",
    short: "The number of first-year students who submitted a completed application.",
    category: "Admissions",
    related: ["acceptance-rate", "admitted"],
  },
  admitted: {
    term: "Admitted",
    short: "Applicants who received an offer of admission.",
    category: "Admissions",
    related: ["applicants", "enrolled", "yield"],
  },
  enrolled: {
    term: "Enrolled",
    short: "Admitted students who actually showed up and started classes that fall.",
    category: "Admissions",
    related: ["admitted", "yield"],
  },
  yield: {
    term: "Yield rate",
    short: "The share of admitted students who choose to enroll. High yield means students who get in tend to say yes.",
    long: "Calculated as enrolled ÷ admitted. Yield is often read as a signal of how much students want to attend once they have the offer.",
    why: "A high yield often reflects strong demand or many binding Early Decision admits. Low yield can mean the school is frequently a backup choice.",
    category: "Admissions",
    related: ["admitted", "enrolled"],
  },
  "open-admission": {
    term: "Open admission",
    short: "A policy of admitting essentially anyone with a high school diploma or equivalent. These colleges don't report an acceptance rate or test scores.",
    category: "Admissions",
    related: ["acceptance-rate"],
  },
  selectivity: {
    term: "Selectivity tier",
    short: "Our plain-English label for acceptance rate: Most selective (<10%), Highly selective (10–25%), Selective (25–50%), Broadly accessible (50%+).",
    category: "How we measure",
    related: ["acceptance-rate"],
  },
  "middle-50": {
    term: "Middle 50%",
    short: "The range between the 25th and 75th percentile scores of enrolled students. Half of students scored inside it.",
    long: "If a school's SAT middle 50% is 1400–1520, a quarter of enrolled students scored 1400 or below and a quarter scored 1520 or above.",
    why: "Landing inside the range means your score is typical for the school. Being below the 25th percentile doesn't rule you out; a quarter of students are there too.",
    category: "Test scores",
    related: ["percentile", "sat", "act", "test-submission"],
  },
  percentile: {
    term: "25th / 75th percentile",
    short: "The 25th percentile is the score that 25% of students scored at or below; the 75th percentile is the score 75% scored at or below.",
    category: "Test scores",
    related: ["middle-50"],
  },
  sat: {
    term: "SAT total",
    short: "The College Board's admissions test, scored 400–1600: Reading & Writing (200–800) plus Math (200–800).",
    long: "We estimate a school's SAT total range by adding the Reading & Writing and Math percentiles. That's an approximation, because the same student isn't always at the 25th percentile in both sections.",
    category: "Test scores",
    related: ["sat-ebrw", "sat-math", "middle-50", "act"],
  },
  "sat-ebrw": {
    term: "SAT Reading & Writing",
    short: "The Evidence-Based Reading and Writing section of the SAT, scored 200–800.",
    category: "Test scores",
    related: ["sat", "sat-math"],
  },
  "sat-math": {
    term: "SAT Math",
    short: "The Math section of the SAT, scored 200–800.",
    category: "Test scores",
    related: ["sat", "sat-ebrw"],
  },
  act: {
    term: "ACT composite",
    short: "The ACT's overall score, from 1 to 36, averaging English, Math, Reading, and Science.",
    category: "Test scores",
    related: ["sat", "middle-50"],
  },
  "test-optional": {
    term: "Test-optional",
    short: "A policy that lets applicants decide whether to submit SAT/ACT scores. Students who don't submit aren't penalized.",
    why: "At test-optional schools, reported score ranges only describe students who chose to submit, and those students usually scored higher.",
    category: "Test scores",
    related: ["test-submission", "middle-50"],
  },
  "test-policy": {
    term: "Test policy",
    short: "How a college uses SAT/ACT scores: required, recommended, considered if submitted (test-optional), or not considered at all (test-blind).",
    why: "At test-blind schools (like the University of California) you won't see score ranges, because scores aren't collected.",
    category: "Test scores",
    related: ["test-optional", "test-submission"],
  },
  "test-submission": {
    term: "Test submission rate",
    short: "The share of enrolled students who submitted a given test score. Below 50%, the reported range may not represent the whole class.",
    category: "Test scores",
    related: ["test-optional", "middle-50"],
  },
  "undergrad-enrollment": {
    term: "Undergraduate enrollment",
    short: "The total number of degree-seeking undergraduate students (not counting graduate students).",
    why: "Size shapes everyday life: class sizes, how many clubs there are, research opportunities, and how easy it is to find your people.",
    category: "Students & access",
    related: ["size-tier"],
  },
  "size-tier": {
    term: "Size tier",
    short: "Our grouping by undergrad count: Small (<5K), Medium (5–15K), Large (15–30K), Very large (30K+).",
    category: "How we measure",
    related: ["undergrad-enrollment"],
  },
  "pell-grant": {
    term: "Pell Grant",
    short: "A federal grant for undergraduates with significant financial need. The share of Pell recipients is a common measure of economic diversity.",
    long: "Pell Grants don't need to be repaid. Most recipients come from families earning under about $60,000 a year.",
    why: "A higher Pell share suggests a school enrolls and supports more lower-income students.",
    category: "Students & access",
    related: ["first-gen"],
  },
  "first-gen": {
    term: "First-generation student",
    short: "A student whose parents did not complete a four-year college degree.",
    why: "Schools with more first-gen students often have stronger support networks for navigating college for the first time.",
    category: "Students & access",
    related: ["pell-grant"],
  },
  "race-ethnicity": {
    term: "Race/ethnicity breakdown",
    short: "The share of undergraduates in each federal reporting category. International students are counted separately regardless of race.",
    category: "Students & access",
    related: ["diversity-index"],
  },
  "diversity-index": {
    term: "Diversity index",
    short: "The chance that two randomly chosen students are from different racial/ethnic groups. 0 = everyone is the same; closer to 1 = more mixed.",
    long: "We use Simpson's diversity index: 1 − Σ(share²) over all reported categories. It rewards both more groups and more even balance between them.",
    category: "How we measure",
    related: ["race-ethnicity"],
  },
  "net-price": {
    term: "Net price",
    short: "What a student actually pays per year after grants and scholarships: tuition, fees, housing, and books minus gift aid. Loans are not subtracted.",
    long: "The average net price shown is for first-time, full-time students who received grant or scholarship aid, as reported to the federal government.",
    why: "It's usually far below the sticker price, especially at wealthy private colleges with generous aid. Every college has a net price calculator for your family's exact estimate.",
    category: "Cost & outcomes",
    related: ["cost-of-attendance", "net-price-by-income"],
  },
  "cost-of-attendance": {
    term: "Cost of attendance (sticker price)",
    short: "The full published price of a year: tuition, fees, housing, food, books, and other expenses, before any financial aid.",
    why: "Few students pay this; compare it with net price to see how much aid typically covers.",
    category: "Cost & outcomes",
    related: ["net-price"],
  },
  "net-price-by-income": {
    term: "Net price by family income",
    short: "Average net price for aided students grouped by family income ($0–30K up to $110K+). Shows how much a college's aid depends on need.",
    why: "At colleges with strong need-based aid, lower-income families can pay far less than the average net price.",
    category: "Cost & outcomes",
    related: ["net-price", "pell-grant"],
  },
  "median-earnings": {
    term: "Median earnings",
    short: "The middle salary of former students 10 years after they first enrolled, whether or not they graduated. Covers students who received federal financial aid.",
    why: "Earnings reflect majors, location, and who enrolls as much as the college itself, so treat big gaps as clues rather than cause and effect.",
    category: "Cost & outcomes",
    related: ["payback", "graduation-rate"],
  },
  "graduation-rate": {
    term: "Graduation rate",
    short: "The share of full-time, first-time students who finish within 150% of normal time: six years for a four-year degree.",
    category: "Cost & outcomes",
    related: ["retention-rate"],
  },
  "retention-rate": {
    term: "Retention rate",
    short: "The share of full-time first-year students who come back for their second year. An early signal of student satisfaction and support.",
    category: "Cost & outcomes",
    related: ["graduation-rate"],
  },
  "median-debt": {
    term: "Median debt",
    short: "The middle amount of federal student loans owed by graduates when they finish. Private loans and parent PLUS loans aren't included.",
    why: "The monthly payment shown assumes a standard 10-year repayment plan.",
    category: "Cost & outcomes",
    related: ["net-price", "payback"],
  },
  payback: {
    term: "Payback estimate",
    short: "Four years of average net price divided by median earnings 10 years after entry: roughly how many years of a typical salary the degree costs.",
    why: "It's a rough comparison tool. It ignores taxes, living costs, interest, and time to graduate, and your own costs and earnings will differ.",
    category: "How we measure",
    related: ["net-price", "median-earnings"],
  },
  public: {
    term: "Public",
    short: "A college funded partly by a state government. Usually cheaper for in-state residents.",
    category: "School types",
    related: ["private-nonprofit"],
  },
  "private-nonprofit": {
    term: "Private nonprofit",
    short: "A privately run college that reinvests revenue into the institution. Sticker prices are high, but aid is often generous.",
    category: "School types",
    related: ["public", "private-forprofit"],
  },
  "private-forprofit": {
    term: "Private for-profit",
    short: "A college run as a business for its owners or shareholders.",
    category: "School types",
    related: ["private-nonprofit"],
  },
  "percentile-rank": {
    term: "National rank",
    short: "Where a college falls among every 4-year college that reports that measure. \"Higher than 80%\" means it's above 80% of them.",
    why: "Colleges that don't report a measure (for example, test-blind schools and SAT scores) are left out of that comparison rather than counted as zero.",
    category: "How we measure",
    related: ["median"],
  },
  median: {
    term: "Median",
    short: "The middle value when everything is lined up in order: half of colleges are above it, half below. Less skewed by outliers than an average. Our medians cover every 4-year college that reports the measure.",
    category: "How we measure",
    related: ["percentile-rank"],
  },
  ipeds: {
    term: "IPEDS",
    short: "The Integrated Postsecondary Education Data System: annual surveys every federally funded U.S. college must complete.",
    category: "Data sources",
    related: ["scorecard", "cds"],
  },
  scorecard: {
    term: "College Scorecard",
    short: "The U.S. Department of Education's public dataset and API covering costs, admissions, and outcomes for U.S. colleges.",
    category: "Data sources",
    related: ["ipeds"],
  },
  cds: {
    term: "Common Data Set",
    short: "A standardized survey colleges publish voluntarily, with detailed admissions, enrollment, and aid statistics.",
    category: "Data sources",
    related: ["ipeds"],
  },
  region: {
    term: "Region",
    short: "The part of the country a school is in: Northeast, Southeast, Midwest, Southwest, or West.",
    category: "School types",
  },
} satisfies Record<string, GlossaryEntry>;

export type TermKey = keyof typeof entries;

export const GLOSSARY: Record<TermKey, GlossaryEntry> = entries;

export function isTermKey(key: string): key is TermKey {
  return key in GLOSSARY;
}

export function termsByCategory(): { category: GlossaryCategory; terms: [TermKey, GlossaryEntry][] }[] {
  return GLOSSARY_CATEGORIES.map((category) => ({
    category,
    terms: (Object.entries(GLOSSARY) as [TermKey, GlossaryEntry][])
      .filter(([, e]) => e.category === category)
      .sort((a, b) => a[1].term.localeCompare(b[1].term)),
  }));
}
