# Ideas: Fresh Directions From the Competitive and Cross-Vertical Research

> Status: **ideas** (not planned work). Written 2026-10-03 from a competitive analysis of CollegeIQ and College
> Kickstart and a survey of guide-and-advisor sites in other verticals (travel, real estate, camps, cars, measured
> product reviews). Each idea is its own page on the [roadmap](../roadmap.md) with the status **Idea**. An idea becomes
> **planned** when its data is verified, its open questions are answered, and it has a place in the build order.
> Smaller proposals that belong inside existing specs are listed at the end and have not been applied.

## What this section is
The roadmap's other groups are work the site has decided to do. This group is for directions worth judging: each
written up far enough (the question, the data, the display, the tier, the open questions) that the owner can say yes,
no, or later without a second research pass.

Three rules kept every idea honest:
- **Build on what only Quad has.** Twenty-plus years of history per college, a source and year on every value, an
  agent that can read any college page for a fraction of a cent, households where a parent's finances stay private,
  standing from published rules, and no lead generation. An idea that another site could ship tomorrow from the same
  federal files isn't fresh.
- **Borrow patterns, not features.** Other verticals solved "help me choose among a thousand options" years ago; what
  transfers is the shape of the tool, not its content. Nothing here copies CollegeIQ's filters or College Kickstart's
  engines.
- **The refusals still hold.** No letter grades, no probabilities, no composite scores, no political scoring, no
  featured listings, no leads sold to colleges.

## Research basis (2026-10-03)

### The two competitors
| | CollegeIQ (collegeiq.com, 2024) | College Kickstart (collegekickstart.com, 2013) |
|---|---|---|
| What it is | A free search site over ~1,580 colleges with the widest "what is it like there" filter set (climate, coastline, walkability, Greek life, state laws, politics) and a merit-aid shorthand (Merit Price, Merit Meter) | A paid list-planning tool over 790+ colleges: Likely / Target / Reach / Long Shot, a list grade, an early-admission engine, test-optional advice, an action plan, counselor dashboards and branded PDFs |
| Model | Free; no pricing page; a "Featured" flag in search, lead-capture forms and a scholarship; revenue undisclosed | $50 / $80 / $125 per family per season; $625 to $3,800 per consultant by caseload; schools by student count; board reports $750 / $1,250 |
| Data | IPEDS, licensed Peterson's and CDS collations (cannot be redistributed), Census, EPA, NOAA; three years of history; years rarely shown | CDS enriched by hand with current-year admit rates, 600+ department admit profiles at 80+ colleges, residency rates at 30+ publics |
| Its edge over Quad | Fit filters; a quotable merit figure; fresher CDS figures today; marketing reach | Current-year data; decision engines; a counselor sales channel with relationship managers; proven willingness to pay |
| Quad's edge over it | Citations and years, 20+ years of history, Compare, trends, outcomes by major, breadth, redistributable data, no lead generation, the planned planning tools | Free and open, 2.4× the coverage, the family money tools, transparent standing instead of a grade, price, households, an API |

### Patterns from other verticals
| Vertical | Site | Pattern | What transfers to Quad |
|---|---|---|---|
| Real estate | Zillow | Map-first search; saved searches with instant alerts; a Zestimate with a published median error (about 2.4% on-market, 7% off-market in 2026); climate-risk scores added in 2024 and **removed in December 2025 after agents complained of lost sales** | A map view ([near-and-far.md](near-and-far.md)); follow a search; publish the estimator's error; a warning about who the customer is |
| Real estate | Redfin | Compete Score (0 to 100 from competing offers, waived contingencies, sale-to-list ratio, days on market): "what it takes to win" | Show the ingredients, never the score: standing reasons, the stress test ([worst-plausible-spring.md](worst-plausible-spring.md)) |
| Travel | Google Flights | Price history; "low / typical / high" labels; "cheapest time to book" from years of data, shown only where there is enough data | "Typical for this college" context; a what-changed page ([cycle-watch.md](cycle-watch.md)); silence where data is thin |
| Travel | Hopper | Buy-or-wait predictions with a claimed 95% accuracy | The contrast: Quad shows the range and the history and does not predict |
| Travel | Wanderlog | A list of places becomes a route with drive times; collaborative trips | Visit trips from the saved list ([near-and-far.md](near-and-far.md)) |
| Travel | Lonely Planet (2026 app) | The guidebook becomes expert guides plus a trip builder, membership tiers, an assistant trained on its own content | Guides as living pages ([guides.md](guides.md)); membership rather than ads |
| Travel | Airbnb Guest Favorites | A label computed daily from stated criteria (ratings, cancellations, incidents, a minimum of five reviews) | A label with published criteria is fine; a composite score is not |
| Camps | Camp advisors (Tips on Trips and Camps, Camp Experts) | Free to families, paid a commission by the camp; about 30% of ACA-accredited camps use them | The model Quad refuses; the counselor portal must never become it |
| Cars | Edmunds True Cost to Own | A five-year total of seven cost categories with stated assumptions (15,000 miles a year, 10% down, a 60-month loan), "a comparative tool, not a predictive tool" | [cost-to-a-degree.md](cost-to-a-degree.md) |
| Measured reviews | RTINGS | Buys units at retail, publishes and versions its methodology, retests; in March 2026 moved full results behind a $45-a-year membership, citing lost search traffic and AI scraping | Versioned methods on the Data page; membership for depth; an open dataset's exposure to scraping |
| Measured reviews | Consumer Reports | No ads, retail purchases, member-funded since 1936, reliability surveys of members | The funding model; pooled member reports (award letters) as a later decision |
| Measured reviews | Audio Science Review | A single-number ranking (SINAD) that its own community warns against reading alone | Why Quad publishes no composite score |
| Cameras | DPReview | One studio scene, same settings, up to four cameras side by side | Compare's shared axes; "your major" and "your numbers" as the fixed scene |
| Jobs | Levels.fyi | Crowdsourced pay with privately verified offer letters, shown as verified | Verified award letters pooled later (an open decision in [award-letter-analyzer.md](../product/award-letter-analyzer.md)) |
| Reviews | Wirecutter | Affiliate-funded picks with "why you should trust us" | Explain the method; no affiliate links |

## The ideas
In the order they could be built; each is a page on the roadmap.

| Idea | Question it answers | Borrows the pattern of | Answers |
|---|---|---|---|
| [Guides](guides.md) | Which colleges should I even be looking at for X? | The guidebook, re-issued every edition | CollegeIQ's search-engine FAQ pages; Kickstart's blog; editors' lists |
| [Cost to a degree](cost-to-a-degree.md) | What does the degree cost here, not one year? | Edmunds True Cost to Own | Every site's one-year price |
| [Near and far](near-and-far.md) | How far is it, what does getting home cost, which can we see in one trip? | Zillow's map, Wanderlog's routes | CollegeIQ's geography filters, from the family's side |
| [Worst plausible spring](worst-plausible-spring.md) | If every Reach says no, what's left and can we afford it? | A planner's stress test | Kickstart's list grade and MixFixer |
| [Colleges that would compete for you](would-compete-for-you.md) | Which colleges would be glad to have me, and show it in money? | Reverse search (Levels.fyi, Redfin inverted) | CollegeIQ's "hidden gems", the buyers-and-sellers list |
| [Cycle watch](cycle-watch.md) | What changed this year at the colleges I'm applying to? | A guidebook's "new this edition"; Google Flights' "typical vs now" | Kickstart's hand-written policy posts; the counselor channel |
| [Getting into the major](getting-into-the-major.md) | Do I apply to the college or the major, and can I change in later? | The fine print every buyer's guide prints | Kickstart's department admit rates, with the question families actually have |

## Smaller additions proposed for existing specs (not applied)
Each belongs inside a spec that already exists; listed here so they aren't lost, for the owner to accept into those
specs or drop.

1. **[chances-and-fit.md](../product/chances-and-fit.md): standing with its direction.** Beside the standing, the
   five-year change in the admit rate and score ranges: "Target, and tightening: admitted 45% in 2019, 28% in 2024."
   Kickstart uses only the prior class; Quad has the series. (Google Flights' "typical vs now".)
2. **[saved-lists.md](../product/saved-lists.md): the list as a calendar feed.** An ICS subscription of every
   deadline on the list (regular, early, aid, housing deposit, merit priority) with the college's own words in the
   event note, updated when the college changes a date; a guardian subscribes too. Kickstart's action plan done as an
   open standard rather than a screen.
3. **[follow-colleges.md](../product/follow-colleges.md): follow a search.** A saved Explore query that reports when
   a college starts or stops matching ("Georgia Southern now admits most out-of-state applicants"). Zillow's saved
   search alerts, which are its most used feature.
4. **[net-price-estimator.md](../product/net-price-estimator.md): the household timeline.** The years two students
   overlap in college and the projected total across the household (the SAI no longer divides by number in college,
   but CSS Profile colleges still consider it); the "getting home" line from [near-and-far.md](near-and-far.md); the
   family version of [cost-to-a-degree.md](cost-to-a-degree.md).
5. **[data-lineage.md](../data-lineage.md): check this number.** Every citation popover gets a permalink, a
   "copy citation" button, and "report a discrepancy", which files the value, its source, and the reporter's note to
   the review queue. CollegeIQ has a data-update form per site; this is per value, which the lineage makes possible.
6. **[cds-financial-aid.md](../data-expansion/cds-financial-aid.md): a price after merit for families without
   need.** From H2A N and O, shown on the Cost page as "first-years without need who got a merit award: 54%,
   averaging $14,200 (2024–25)", with the price after that award when the share is 40% or more. A cited figure in
   place of CollegeIQ's trademarked meter.
7. **[student-profile.md](../product/student-profile.md): home ZIP and "hours from home".** The two fields
   [near-and-far.md](near-and-far.md) needs, treated like every profile value.
8. **[commercialization.md](../product/commercialization.md): say what the money never buys.** The pricing page's
   line about ads should also say "no featured listings, no leads sold to colleges, no advisor commissions", the
   three models the research found (CollegeIQ's Featured flag, Zillow's Premier Agent, camp advisors). And revisit
   counselor pricing before launch: $299 to $599 per organization is two to six times under Kickstart; per seat with a
   student cap (the portal spec's open question) and an IECA/HECA code would read as serious rather than cheap.
9. **[counselor-portal.md](../product/counselor-portal.md): students invited by a counselor are free.** Kickstart's
   acquisition pattern: a counselor's subscription covers their students' accounts. The brief in
   [cycle-watch.md](cycle-watch.md) is the content channel the portal needs.

## Considered and not added
- **Lifestyle and state-law filters** (CollegeIQ). Climate normals (NOAA) and walkability (EPA) are public, cheap,
  and factual; a Small spec could add them to the campus profile. Scoring states' abortion, DEI and gun laws is
  editorial, and half of families would distrust the scores; if ever shown, state the law with its source and don't
  score it. Owner's call; not an idea page.
- **Department admit rates as a product** (Kickstart). Captured only where a college publishes them, inside
  [getting-into-the-major.md](getting-into-the-major.md), never estimated.
- **A list grade and "fix my mix"** (Kickstart). Replaced by the stress test.
- **Reviews, forums, Q&A** (TripAdvisor, Niche, Rate My Professors). Not data; off brand.
- **A counselor directory** (Zillow Premier Agent, camp advisors). Paid placement by another name.
- **Hazard context from FEMA's National Risk Index** (county-level flood, wildfire, heat; public). Cheap and cited,
  and Zillow's retreat shows the pressure only a seller-funded site feels. Parked as a possible Small addition to the
  campus profile, not an idea page.
- **"Ask the data"**, a question box that answers only from the dataset with every number cited and refuses what
  the data can't answer (the modern advisor; Lonely Planet is adding one). The Quad twist would be a verifier that
  strips any figure not present in the query results. Generic enough that it isn't fresh, costly enough to need an
  owner decision first.

## Sources
Competitor pages read 2026-10-03: collegeiq.com (home, search, Data and Methodology, Our Story, Our Team, news,
scholarship, the University of Georgia profile and its tabs), the founder's launch post on Domain Name Wire
(2 October 2024) and the launch press release (18 October 2024); collegekickstart.com (home, About, the four pricing
pages, the solutions pages, the 2026 sneak peek for consultants), and the College Confidential thread "College
Kickstart worth $80?" (2020). Cross-vertical: Zillow's Zestimate accuracy page and the December 2025 reporting on its
climate-risk removal (TechCrunch, GeekWire); Redfin's Compete Score explainer; Google's "cheapest time to book"
announcement coverage; Wanderlog's road trip planner page; Lonely Planet's 2026 app announcement (PhocusWire);
Airbnb's Guest Favorites help article; reporting on camp advisers (Observer-Reporter, 2016; Patch); Edmunds' TCO
methodology page; RTINGS' "How we make money" and its March 2026 membership announcement; Consumer Reports' support
page; Levels.fyi's About page; DPReview's studio scene comparison; Audio Science Review forum discussion of SINAD.
