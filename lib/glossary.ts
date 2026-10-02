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
  "admission-factor": {
    term: "Admission factors",
    short: "What a college looks at when deciding: whether each item, like GPA or an essay, is required, considered, or not considered at all.",
    long: "Colleges report these to the federal government each year. \"Considered\" means it can help but isn't required. \"Not considered\" means the college doesn't use it, even if you send it.",
    why: "It tells you where to spend your effort: a required essay matters; a factor that isn't considered won't change the decision.",
    category: "Admissions",
    related: ["legacy-status", "secondary-school-record", "test-policy"],
  },
  "legacy-status": {
    term: "Legacy status",
    short: "Whether an applicant's parent (or other relative) attended the college. Some colleges consider it in admission; many have stopped.",
    category: "Admissions",
    related: ["admission-factor"],
  },
  "secondary-school-record": {
    term: "High school record",
    short: "The courses a student took in high school and how challenging they were, as shown on the transcript, beyond the GPA alone.",
    category: "Admissions",
    related: ["admission-factor", "college-prep-program"],
  },
  "college-prep-program": {
    term: "College-prep program",
    short: "Finishing a set of high school courses that prepare students for college, such as several years of math, science, English, and a language.",
    category: "Admissions",
    related: ["secondary-school-record"],
  },
  "admit-rate-by-sex": {
    term: "Acceptance rate by sex",
    short: "The share of men who applied who were admitted, and the same for women, as colleges report them to the federal government.",
    long: "Applicants who reported another gender or none count in the overall rate but aren't shown as a separate rate: the numbers are too small. A gap is compared only when both men and women number at least 200 applicants.",
    why: "At some colleges one sex applies in much larger numbers than the other. A gap can reflect who applies as much as how the college chooses; the numbers alone don't say which.",
    category: "Admissions",
    related: ["acceptance-rate", "gender-balance"],
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
  "median-vs-midpoint": {
    term: "Median vs. midpoint",
    short: "The median is the score in the middle of all enrolled students who submitted one. The midpoint is halfway between the 25th and 75th percentiles.",
    long: "Colleges only recently began reporting true medians to the federal government, so older years have the midpoint alone. When scores bunch up near the top of the range, the median sits above the midpoint. The SAT total median here adds the two section medians, an approximation like the SAT total range.",
    why: "The median says where the typical student actually scored; the midpoint is only the center of the range.",
    category: "Test scores",
    related: ["middle-50", "percentile"],
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
  "gender-balance": {
    term: "Men and women",
    short: "The share of degree-seeking undergraduates who are men and who are women, as colleges report them to the federal government.",
    why: "Nationally, more women than men attend four-year colleges, so a campus near 50/50 is less common than it sounds.",
    category: "Students & access",
    related: ["degree-seeking", "undergrad-enrollment"],
  },
  "part-time-student": {
    term: "Part-time student",
    short: "An undergraduate taking fewer credits than a full course load, usually under 12 credit hours a term.",
    why: "Where many students study part-time, often while working, campus life and class schedules look different from a mostly full-time college.",
    category: "Students & access",
    related: ["degree-seeking", "adult-students"],
  },
  "adult-students": {
    term: "Students 25 and older",
    short: "The share of undergraduates aged 25 or older. The federal survey asks about age every other fall, so this figure is a year older than enrollment.",
    why: "A high share usually means many students are returning to college or working while they study, so classes and services are built around them.",
    category: "Students & access",
    related: ["part-time-student"],
  },
  // Where first-years come from (specs/data-expansion/residence.md).
  "in-state-student": {
    term: "In-state, out-of-state, and international students",
    short: "Where a first-year lived when they applied: the college's own state, another U.S. state, DC, or territory (out-of-state), or another country (international). Shares here are of every first-year, including the few whose residence wasn't reported.",
    long: "Colleges report each first-year's home state to the federal government every fall; reporting is required in even-numbered years and optional in odd ones, so the site uses even years. A Common Data Set's \"percent from out of state\" leaves international students out of both the count and the total, so it reads higher than the out-of-state share here.",
    why: "A college that draws mostly from its own state feels different from one with students from across the country, and at a public university, out-of-state students usually pay a higher tuition.",
    category: "Students & access",
    related: ["first-time-student", "in-state-tuition"],
  },
  "first-time-student": {
    term: "First-time student",
    short: "A student starting college for the first time (usually right after high school), as opposed to a transfer student. The federal \"first-years\" counted for residence are first-time students seeking a degree or certificate.",
    category: "Students & access",
    related: ["in-state-student", "degree-seeking"],
  },
  "degree-seeking": {
    term: "Degree-seeking undergraduate",
    short: "A student enrolled toward a bachelor's or associate degree, as opposed to someone taking classes without pursuing a degree. The site's undergraduate counts and shares include only degree-seeking students.",
    category: "Students & access",
    related: ["undergrad-enrollment"],
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
  "average-cost": {
    term: "Average cost (all students)",
    short: "Our estimate of what the average first-year actually paid in a year for everything: tuition and fees, housing, food, books, and other expenses, after grants. Students with grants pay the full price minus their grant; students without grants pay the full price.",
    long: "Calculated from same-year federal data: the sticker price (tuition and fees for each student's residency rate, plus books, on-campus room and board, and other expenses), weighted by the share of first-years paying each rate, minus the share who received grants times their average grant. Loans aren't subtracted, since they're still paid back.",
    why: "Published \"average net price\" figures only cover students who got aid, so they understate what a typical student pays, often by tens of thousands of dollars at colleges where many students pay full price. It assumes on-campus living, so it runs high at commuter-heavy schools.",
    category: "Cost & outcomes",
    related: ["net-price", "cost-of-attendance", "in-state-tuition", "grant-aid"],
  },
  "aid-generosity": {
    term: "Aid generosity",
    short: "How much of the full price (tuition, housing, food, books and other costs) grants cover, averaged over every first-year, counting students who get no grants as 0%.",
    long: "Calculated as total grant dollars ÷ number of first-years ÷ full price. Tiers: Very generous (55%+), Generous (40–55%), Moderate (25–40%), Limited (under 25%). It's similar to the \"tuition discount rate\" colleges track, but measured against the full cost of attendance.",
    why: "Two colleges with the same sticker price can cost very different amounts. At generous colleges the sticker price overstates what most students pay; at colleges with limited aid, most students pay close to it.",
    category: "Cost & outcomes",
    related: ["average-cost", "grant-aid", "cost-of-attendance", "need-met"],
  },
  "in-state-tuition": {
    term: "In-state vs. out-of-state tuition",
    short: "Public universities charge state residents a lower rate, often half or less of what out-of-state students pay. Some also have an in-district rate for local residents.",
    category: "Cost & outcomes",
    related: ["average-cost", "cost-of-attendance"],
  },
  "net-price": {
    term: "Net price",
    short: "What a student actually pays per year after grants and scholarships: tuition, fees, housing, and books minus gift aid. Loans are not subtracted. The average covers only students who received grants.",
    long: "The average net price shown is for first-time, full-time students who received grant or scholarship aid, as reported to the federal government. Students who got no grants aren't included, so full-paying families pay more than the average. At public colleges it covers in-state students only.",
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
    short: "Average net price by family income ($0–30K up to $110K+) for students receiving federal (Title IV) aid, meaning those who filed the FAFSA and received federal grants or loans. Shows how much a college's aid depends on need.",
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
    related: ["net-price", "payback", "federal-loan-rate"],
  },
  locale: {
    term: "Setting (city, suburb, town, rural)",
    short: "Where the campus sits, using the federal government's locale codes: a city, a suburb, a town, or a rural area, each split by size or distance.",
    long: "\"Town: Remote\" means a town more than 35 miles from a city; \"Rural: Fringe\" is countryside within about 5 miles of a city.",
    category: "School types",
    related: ["carnegie-classification"],
  },
  "carnegie-classification": {
    term: "Carnegie Classification",
    short: "A standard way to group U.S. colleges by what they do: the mix of degrees they award, their size, how much research they do, and more. The 2025 edition is the newest.",
    category: "School types",
    related: ["r1", "student-access-and-earnings"],
  },
  r1: {
    term: "R1, R2 (research universities)",
    short: "Carnegie's research designations. R1 universities spend the most on research and award the most research doctorates; R2 is the next tier.",
    why: "Research universities offer chances to join faculty research, but classes can be larger and some teaching falls to graduate students.",
    category: "School types",
    related: ["carnegie-classification"],
  },
  "student-access-and-earnings": {
    term: "Student Access and Earnings",
    short: "A 2025 Carnegie grouping of colleges by how well they enroll students from their area's lower-income families (access) and what graduates later earn (earnings).",
    long: "\"Opportunity Colleges and Universities\" pair higher access with higher earnings. This is Carnegie's label, shown as reported, not the site's verdict.",
    category: "School types",
    related: ["carnegie-classification", "pell-grant"],
  },
  hbcu: {
    term: "HBCU",
    short: "A Historically Black College or University: founded before 1964 with the mission of educating Black Americans, and recognized as such under federal law.",
    category: "School types",
    related: ["hsi"],
  },
  hsi: {
    term: "Hispanic-Serving and other minority-serving institutions",
    short: "Colleges eligible for federal funding because many of their students are from a particular group, such as Hispanic-Serving Institutions, where at least a quarter of undergraduates are Hispanic.",
    long: "Eligibility is recalculated each year from enrollment, so a college can gain or lose a designation. The site shows the College Scorecard's flags.",
    category: "School types",
    related: ["hbcu", "tribal-college"],
  },
  "single-sex": {
    term: "Women's and men's colleges",
    short: "Colleges that admit only women or only men to their undergraduate programs. Many men's colleges are religious seminaries.",
    category: "School types",
    related: ["hsi"],
  },
  "tribal-college": {
    term: "Tribal college",
    short: "A college chartered by a Native American tribe or the federal government to serve Native students and communities.",
    category: "School types",
    related: ["hsi"],
  },
  "land-grant": {
    term: "Land-grant university",
    short: "A college designated by its state to receive federal support under the Morrill Acts, originally to teach agriculture, engineering, and the practical sciences. Every state has at least one.",
    category: "School types",
    related: ["carnegie-classification"],
  },
  "student-faculty-ratio": {
    term: "Student-to-faculty ratio",
    short: "Full-time-equivalent undergraduates and graduate students for each full-time-equivalent instructional faculty member, not counting faculty who teach only graduate or professional students. Written \"8 to 1\".",
    long: "It is not the average class size: a college with a low ratio can still have large lecture courses, and faculty time also goes to research and advising. Colleges compute it themselves, so definitions vary, for example in whether research faculty count.",
    why: "A rough signal of how much faculty attention there is to go around. For class sizes, look at a college's Common Data Set (section I).",
    category: "Students & access",
  },
  "ncaa-division": {
    term: "NCAA division",
    short: "The NCAA's three levels of college sports. Division I has the biggest athletic budgets and most athletic scholarships; Division II offers partial scholarships; Division III offers none, and athletes' aid comes the same way as other students'.",
    long: "Division I football splits in two: the Football Bowl Subdivision (FBS: the bowl games and the College Football Playoff) and the Football Championship Subdivision (FCS). The NAIA is a separate association of mostly smaller colleges, with its own scholarships and championships.",
    why: "It sets how big a part sports play in campus life, and whether athletic scholarships exist.",
    category: "School types",
    related: ["athletic-conference"],
  },
  "athletic-conference": {
    term: "Athletic conference",
    short: "The league a college's teams play in, such as the Big Ten or the Ivy League. A college can play football in one conference and its other sports in another.",
    why: "Conferences change as colleges realign, usually for TV money; a move can change travel, rivals, and a college's profile.",
    category: "School types",
    related: ["ncaa-division"],
  },
  rotc: {
    term: "ROTC",
    short: "Reserve Officers' Training Corps: military officer training alongside a regular degree, run by the Army, Navy (including the Marine Corps), or Air Force (including the Space Force). Scholarships pay tuition in exchange for service after graduation.",
    long: "A college listed here offers ROTC itself or through an arrangement with a nearby college; students may travel to another campus for some training.",
    category: "School types",
  },
  "study-abroad": {
    term: "Study abroad",
    short: "The college offers ways to earn credit while studying in another country, through its own programs or partners.",
    category: "School types",
  },
  "undergrad-research": {
    term: "Undergraduate research",
    short: "The college runs a program for undergraduates to do research with faculty, outside regular courses.",
    why: "Research experience helps with graduate school and some jobs. Many colleges offer it informally without listing a program.",
    category: "School types",
  },
  "academic-calendar": {
    term: "Academic calendar",
    short: "How the college divides the year: semesters (two terms), quarters (three terms plus an optional summer), trimesters, or 4-1-4 (two terms with a short January term between).",
    category: "School types",
  },
  "ap-credit": {
    term: "AP credit",
    short: "The college grants credit for Advanced Placement exams. Which scores count, and for which courses, varies by college and subject.",
    why: "Credit can let you skip introductory courses or graduate early; check each college's AP policy for the scores it accepts.",
    category: "Admissions",
  },
  "disability-services": {
    term: "Registered with disability services",
    short: "The share of undergraduates formally registered with the college's disability services office for accommodations. Colleges report the exact share only when it's over 3%.",
    why: "A higher share can mean an office that's easy to use, but it also depends on who enrolls; it isn't a rating of services.",
    category: "Students & access",
  },
  "housing-capacity": {
    term: "Housing capacity",
    short: "How many students the college can house in residence halls or other college-controlled housing, on or off campus.",
    long: "It's a count of beds, and at universities it can include housing for graduate students. So \"beds for every 100 undergrads\" is a rough guide, not a promise of a room.",
    category: "Cost & outcomes",
    related: ["live-on-requirement"],
  },
  "live-on-requirement": {
    term: "First-years must live on campus",
    short: "The college requires every full-time first-year to live in college housing, with no exceptions for commuters.",
    why: "Few colleges answer yes to the federal survey's strict version; many more require it with exceptions, such as for students living with family nearby.",
    category: "Cost & outcomes",
    related: ["housing-capacity"],
  },
  "application-fee": {
    term: "Application fee",
    short: "What the college charges to process an undergraduate application. Many colleges waive it for students who qualify.",
    category: "Admissions",
    related: ["applicants"],
  },
  "tuition-guarantee": {
    term: "Tuition guarantee",
    short: "A promise that the tuition rate a student starts at stays the same for a set time, usually four years.",
    why: "It makes the four-year cost easier to plan: the price you see in your first year is the price you keep.",
    category: "Cost & outcomes",
    related: ["promise-program"],
  },
  "promise-program": {
    term: "Promise program",
    short: "A state or local scholarship that covers tuition for residents who meet its rules, often graduates of local high schools.",
    why: "If you qualify, tuition at a participating college can cost little or nothing. Check your state's or city's program for the rules.",
    category: "Cost & outcomes",
    related: ["tuition-guarantee", "net-price"],
  },
  "federal-loan-rate": {
    term: "Share with a federal loan",
    short: "The share of all undergraduates who took out a federal student loan that school year. Private loans and parent PLUS loans aren't counted.",
    why: "Colleges with generous grants, or with \"no-loan\" aid policies, often have few students borrowing at all.",
    category: "Cost & outcomes",
    related: ["median-debt", "repayment-status"],
  },
  "repayment-status": {
    term: "Repayment status",
    short: "Where a college's former students stand on their federal loans three years after leaving: paid off, paying down, paused, not paying down, behind, or in default.",
    long: "\"Making progress\" means the balance is lower than when repayment began. \"Paused\" covers deferment and forbearance, when payments are officially put on hold. Some shares are published as a small range rather than an exact number, to protect privacy.",
    why: "It shows whether former students can actually pay back what they borrowed, which says something about both cost and outcomes.",
    category: "Cost & outcomes",
    related: ["in-default", "median-debt"],
  },
  "in-default": {
    term: "In default",
    short: "A federal student loan with no payment for about nine months. Default hurts credit and can lead to wages or tax refunds being taken.",
    category: "Cost & outcomes",
    related: ["repayment-status"],
  },
  "grant-aid": {
    term: "Grant aid",
    short: "Money for college that doesn't have to be repaid: federal, state, and local grants plus the college's own scholarships. Loans and work-study don't count.",
    category: "Cost & outcomes",
    related: ["net-price", "institutional-aid", "pell-grant"],
  },
  "institutional-aid": {
    term: "Institutional aid",
    short: "Grants and scholarships paid by the college itself, from its own budget or endowment. At wealthy private colleges this is usually the largest source of aid.",
    category: "Cost & outcomes",
    related: ["grant-aid", "need-based-aid", "merit-aid"],
  },
  "need-based-aid": {
    term: "Need-based aid",
    short: "Aid awarded because a family can't cover the full cost, based on financial information such as the FAFSA or CSS Profile.",
    category: "Cost & outcomes",
    related: ["need-met", "merit-aid"],
  },
  "merit-aid": {
    term: "Merit aid",
    short: "Scholarships awarded for academics, talent, or athletics regardless of financial need.",
    why: "Many highly selective colleges offer little or no merit aid; others use it heavily to attract students.",
    category: "Cost & outcomes",
    related: ["need-based-aid", "institutional-aid"],
  },
  "need-met": {
    term: "Percent of need met",
    short: "How much of a student's demonstrated financial need the college covers with aid, on average. 100% means the college fills the whole gap (though sometimes partly with loans).",
    category: "Cost & outcomes",
    related: ["need-based-aid"],
  },
  "federal-aid": {
    term: "Federal (Title IV) aid",
    short: "Federal grants, loans, and work-study, which require filing the FAFSA. Income-level breakdowns cover only students who received this aid.",
    why: "Families who don't file the FAFSA (often higher-income ones) aren't in those breakdowns.",
    category: "Cost & outcomes",
    related: ["pell-grant", "net-price-by-income"],
  },
  "net-price-calculator": {
    term: "Net price calculator",
    short: "A tool every college that takes federal aid must post on its website. Enter your family's finances to get a personalized estimate of what you'd pay.",
    why: "It's far more accurate for your family than any average on this site.",
    category: "Cost & outcomes",
    related: ["net-price"],
  },
  payback: {
    term: "Payback estimate",
    short: "Four years of average cost (all students) divided by median earnings 10 years after entry: roughly how many years of a typical salary the degree costs.",
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
  "inflation-adjusted": {
    term: "After inflation",
    short: "Past dollars converted to the latest year's dollars with the Consumer Price Index, so a change shows what's really more or less expensive, not just rising prices everywhere.",
    long: "We use CPI-U from the Bureau of Labor Statistics, averaged over each school year (July to June), the way the National Center for Education Statistics adjusts college prices.",
    why: "If a college's price rose 20% while prices across the economy rose 30%, it got cheaper in real terms. Switch charts to \"As reported\" to see the original dollars.",
    category: "How we measure",
    related: ["provisional-data"],
  },
  "provisional-data": {
    term: "Provisional data",
    short: "The newest year of a federal survey, before colleges' corrections are folded in. NCES publishes a revised version about a year later; values usually change little.",
    category: "How we measure",
    related: ["ipeds"],
  },
  "entering-cohort": {
    term: "Entering class",
    short: "Graduation rates follow the students who started in the same fall: \"entered fall\" years show the share of that class who finished within six years, measured six years later.",
    why: "A graduation rate always describes students who arrived years ago, so it moves slowly and lags changes a college makes today.",
    category: "How we measure",
    related: ["graduation-rate"],
  },
  "trend-direction": {
    term: "10-year direction",
    short: "Whether a college's cost, applications, diversity, and selectivity went up, held steady, or went down over its last 10 years of federal data.",
    long: "Cost is the average total cost after inflation; steady means within 5%. Applications count applicants; steady is within 10%. Diversity is the diversity index; steady is within 0.03. Selectivity follows the acceptance rate: a rate that fell by more than 3 percentage points means more selective. Applications and selectivity need at least 200 applicants at both ends. Diversity needs at least 300 undergrads at both ends, and is left out when the share of students whose race is unknown (counted with other groups) moved more than 10 points, since that is a change in reporting rather than in who enrolls.",
    why: "Up isn't good and down isn't bad: a rising cost after inflation means students pay more, while growing applications usually mean a college is in demand. Each indicator shows its number so you can judge the size of the change.",
    category: "How we measure",
    related: ["inflation-adjusted", "diversity-index", "selectivity"],
  },
  "trend-break": {
    term: "Break in a series",
    short: "A year when a measure's definition changed, so values before and after it aren't comparable. Charts stop the line there and don't report a change across it.",
    long: "The clearest case is the SAT: it was redesigned with a new scoring scale, so scores reported before the switch aren't comparable with scores after it.",
    category: "How we measure",
    related: ["sat"],
  },
  "fixed-panel": {
    term: "Fixed panel",
    short: "A national trend measured over the same colleges in every year: only those that report both the first and last year. Otherwise colleges opening, closing, or starting to report would look like change.",
    category: "How we measure",
    related: ["median"],
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
