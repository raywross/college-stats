/**
 * IPEDS athletic conference codes (IC `CONFNO1`–`CONFNO4`) and each conference's level
 * (specs/data-expansion/campus-services.md). Hand-kept reference data: review it every year for realignment.
 *
 * - Names are the IC2025 data dictionary's. Codes are stable across years: IC2015 and IC2025 differ only in
 *   abbreviations and renames of the same conference (checked 2026-09-30).
 * - Levels were assigned by hand and checked against Wikipedia's "List of NCAA conferences" (2025–26) and against each
 *   conference's members' own NCAA/NAIA answers (`ASSOC1`, `ASSOC2`); tests/campus-services.test.mts repeats the
 *   member check on the stored data.
 * - IPEDS uses one code for a conference's football and other sports (123 is the Missouri Valley Conference in
 *   basketball and the Missouri Valley Football Conference in football), so the FBS/FCS split is read from the
 *   football conference only (lib/campus-services.ts).
 * - `null`: mixed or unknown (ECAC, NCAA regional independents, "Other").
 */

export type ConferenceLevel = "I-FBS" | "I-FCS" | "I" | "II" | "III" | "NAIA";

export const CONFERENCES: Record<number, { name: string; slug: string; level: ConferenceLevel | null }> = {
  101: { name: "America East", slug: "america-east", level: "I" },
  102: { name: "Atlantic Coast Conference", slug: "atlantic-coast-conference", level: "I-FBS" },
  103: { name: "Atlantic 10 Conference", slug: "atlantic-10-conference", level: "I" },
  104: { name: "Big East Conference", slug: "big-east-conference", level: "I" },
  105: { name: "Big Sky Conference", slug: "big-sky-conference", level: "I-FCS" },
  106: { name: "Big South Conference", slug: "big-south-conference", level: "I" },
  107: { name: "Big Ten Conference", slug: "big-ten-conference", level: "I-FBS" },
  108: { name: "Big Twelve Conference", slug: "big-twelve-conference", level: "I-FBS" },
  109: { name: "Big West Conference", slug: "big-west-conference", level: "I" },
  110: { name: "Colonial Athletic Association", slug: "colonial-athletic-association", level: "I" },
  111: { name: "Conference USA", slug: "conference-usa", level: "I-FBS" },
  112: { name: "Division I Independents", slug: "division-i-independents", level: "I" },
  113: { name: "Division I-A Independents", slug: "division-i-a-independents", level: "I-FBS" },
  115: { name: "Eastern College Athletic Conference", slug: "eastern-college-athletic-conference", level: null },
  117: { name: "Ivy Group", slug: "ivy-group", level: "I-FCS" },
  118: { name: "Metro Atlantic Athletic Conference", slug: "metro-atlantic-athletic-conference", level: "I" },
  119: { name: "Mid-American Conference", slug: "mid-american-conference", level: "I-FBS" },
  120: { name: "The Summit League", slug: "summit-league", level: "I" },
  121: { name: "Mid-Eastern Athletic Conference", slug: "mid-eastern-athletic-conference", level: "I-FCS" },
  122: { name: "Horizon League", slug: "horizon-league", level: "I" },
  123: { name: "Missouri Valley Conference", slug: "missouri-valley-conference", level: "I" },
  125: { name: "Northeast Conference", slug: "northeast-conference", level: "I-FCS" },
  126: { name: "Ohio Valley Conference", slug: "ohio-valley-conference", level: "I-FCS" },
  127: { name: "Pacific-12 Conference", slug: "pacific-12-conference", level: "I-FBS" },
  128: { name: "Patriot League", slug: "patriot-league", level: "I-FCS" },
  129: { name: "Pioneer Football League", slug: "pioneer-football-league", level: "I-FCS" },
  130: { name: "Southeastern Conference", slug: "southeastern-conference", level: "I-FBS" },
  131: { name: "Southern Conference", slug: "southern-conference", level: "I-FCS" },
  132: { name: "Southland Conference", slug: "southland-conference", level: "I-FCS" },
  133: { name: "Southwestern Athletic Conference", slug: "southwestern-athletic-conference", level: "I-FCS" },
  134: { name: "Sun Belt Conference", slug: "sun-belt-conference", level: "I-FBS" },
  135: { name: "Atlantic Sun Conference", slug: "atlantic-sun-conference", level: "I" },
  136: { name: "West Coast Conference", slug: "west-coast-conference", level: "I" },
  137: { name: "Western Athletic Conference", slug: "western-athletic-conference", level: "I" },
  138: { name: "California Collegiate Athletic Association", slug: "california-collegiate-athletic-association", level: "II" },
  139: { name: "Conference Carolinas", slug: "conference-carolinas", level: "II" },
  140: { name: "Central Intercollegiate Athletic Association", slug: "central-intercollegiate-athletic-association", level: "II" },
  141: { name: "Division II Independents", slug: "division-ii-independents", level: "II" },
  144: { name: "Great Lakes Intercollegiate Athletic Conference", slug: "great-lakes-intercollegiate-athletic-conference", level: "II" },
  145: { name: "Great Lakes Valley Conference", slug: "great-lakes-valley-conference", level: "II" },
  146: { name: "Gulf South Conference", slug: "gulf-south-conference", level: "II" },
  147: { name: "Lone Star Conference", slug: "lone-star-conference", level: "II" },
  148: { name: "Mid-America Intercollegiate Athletic Association", slug: "mid-america-intercollegiate-athletic-association", level: "II" },
  151: { name: "East Coast Conference", slug: "east-coast-conference", level: "II" },
  153: { name: "Northeast 10 Conference", slug: "northeast-10-conference", level: "II" },
  155: { name: "Northern Sun Intercollegiate Conference", slug: "northern-sun-intercollegiate-conference", level: "II" },
  156: { name: "Pacific West Conference", slug: "pacific-west-conference", level: "II" },
  157: { name: "Peach Belt Conference", slug: "peach-belt-conference", level: "II" },
  158: { name: "Pennsylvania State Athletic Conference", slug: "pennsylvania-state-athletic-conference", level: "II" },
  159: { name: "Rocky Mountain Athletic Conference", slug: "rocky-mountain-athletic-conference", level: "II" },
  160: { name: "South Atlantic Conference", slug: "south-atlantic-conference", level: "II" },
  161: { name: "Southern Intercollegiate Athletic Conference", slug: "southern-intercollegiate-athletic-conference", level: "II" },
  162: { name: "Sunshine State Conference", slug: "sunshine-state-conference", level: "II" },
  164: { name: "Capital Athletic Conference", slug: "capital-athletic-conference", level: "III" },
  165: { name: "Centennial Conference", slug: "centennial-conference", level: "III" },
  166: { name: "City University of New York Athletic Conference", slug: "city-university-of-new-york-athletic-conference", level: "III" },
  167: { name: "College Conference of Illinois and Wisconsin", slug: "college-conference-of-illinois-and-wisconsin", level: "III" },
  168: { name: "Conference of New England", slug: "conference-of-new-england", level: "III" },
  170: { name: "Division III Independents", slug: "division-iii-independents", level: "III" },
  171: { name: "USA South Athletic Conference", slug: "usa-south-athletic-conference", level: "III" },
  172: { name: "Empire Eight", slug: "empire-eight", level: "III" },
  173: { name: "Freedom Football Conference", slug: "freedom-football-conference", level: "III" },
  174: { name: "Great Northeast Athletic Conference", slug: "great-northeast-athletic-conference", level: "III" },
  175: { name: "Heartland Collegiate Athletic Conference", slug: "heartland-collegiate-athletic-conference", level: "III" },
  176: { name: "American Rivers Conference", slug: "american-rivers-conference", level: "III" },
  178: { name: "Little East Conference", slug: "little-east-conference", level: "III" },
  179: { name: "Massachusetts State College Athletic Association", slug: "massachusetts-state-college-athletic-association", level: "III" },
  180: { name: "Michigan Intercollegiate Athletic Association", slug: "michigan-intercollegiate-athletic-association", level: "III" },
  181: { name: "Middle Atlantic States Athletic Corporation", slug: "middle-atlantic-states-athletic-corporation", level: "III" },
  182: { name: "Midwest Conference", slug: "midwest-conference", level: "III" },
  183: { name: "Minnesota Intercollegiate Athletic Conference", slug: "minnesota-intercollegiate-athletic-conference", level: "III" },
  184: { name: "New England Football Conference", slug: "new-england-football-conference", level: "III" },
  185: { name: "New England Small College Athletic Conference", slug: "new-england-small-college-athletic-conference", level: "III" },
  186: { name: "New England Women's & Men's Athletic Conference", slug: "new-england-womens-mens-athletic-conference", level: "III" },
  187: { name: "New Jersey Athletic Conference", slug: "new-jersey-athletic-conference", level: "III" },
  189: { name: "North Coast Athletic Conference", slug: "north-coast-athletic-conference", level: "III" },
  191: { name: "Ohio Athletic Conference", slug: "ohio-athletic-conference", level: "III" },
  192: { name: "Old Dominion Athletic Conference", slug: "old-dominion-athletic-conference", level: "III" },
  194: { name: "Presidents' Athletic Conference", slug: "presidents-athletic-conference", level: "III" },
  195: { name: "St. Louis Intercollegiate Athletic Conference", slug: "st-louis-intercollegiate-athletic-conference", level: "III" },
  196: { name: "Skyline Conference", slug: "skyline-conference", level: "III" },
  197: { name: "Southern California Intercollegiate Athletic Conference", slug: "southern-california-intercollegiate-athletic-conference", level: "III" },
  198: { name: "Southern Collegiate Athletic Conference", slug: "southern-collegiate-athletic-conference", level: "III" },
  199: { name: "State University of New York Athletic Conference", slug: "state-university-of-new-york-athletic-conference", level: "III" },
  200: { name: "University Athletic Association", slug: "university-athletic-association", level: "III" },
  201: { name: "Upstate Collegiate Athletic Association", slug: "upstate-collegiate-athletic-association", level: "III" },
  202: { name: "Wisconsin Intercollegiate Athletic Conference", slug: "wisconsin-intercollegiate-athletic-conference", level: "III" },
  203: { name: "Mountain West Conference", slug: "mountain-west-conference", level: "I-FBS" },
  204: { name: "American Southwest Conference", slug: "american-southwest-conference", level: "III" },
  205: { name: "Northwest Conference", slug: "northwest-conference", level: "III" },
  207: { name: "Commonwealth Conference", slug: "commonwealth-conference", level: "III" },
  208: { name: "Freedom Conference", slug: "freedom-conference", level: "III" },
  213: { name: "Great Northwest Athletic Conference", slug: "great-northwest-athletic-conference", level: "II" },
  214: { name: "Allegheny Mountain Collegiate Conference", slug: "allegheny-mountain-collegiate-conference", level: "III" },
  215: { name: "North Atlantic Conference", slug: "north-atlantic-conference", level: "III" },
  301: { name: "California Pacific Conference", slug: "california-pacific-conference", level: "NAIA" },
  302: { name: "Golden State Athletic Conference", slug: "golden-state-athletic-conference", level: "NAIA" },
  304: { name: "Chicagoland Collegiate Athletic Conference", slug: "chicagoland-collegiate-athletic-conference", level: "NAIA" },
  305: { name: "Crossroads League", slug: "crossroads-league", level: "NAIA" },
  307: { name: "Wolverine-Hoosier Athletic Conference", slug: "wolverine-hoosier-athletic-conference", level: "NAIA" },
  309: { name: "Kansas Collegiate Athletic Conference", slug: "kansas-collegiate-athletic-conference", level: "NAIA" },
  311: { name: "Great Plains Athletic Conference", slug: "great-plains-athletic-conference", level: "NAIA" },
  315: { name: "Mid-South Conference", slug: "mid-south-conference", level: "NAIA" },
  316: { name: "Appalachian Athletic Conference", slug: "appalachian-athletic-conference", level: "NAIA" },
  318: { name: "Independent Mid-South Region", slug: "independent-mid-south-region", level: "NAIA" },
  319: { name: "American Midwest Conference", slug: "american-midwest-conference", level: "NAIA" },
  320: { name: "Heart of America Athletic Conference", slug: "heart-of-america-athletic-conference", level: "NAIA" },
  322: { name: "Independent Midwest Region", slug: "independent-midwest-region", level: null },
  323: { name: "Central Atlantic Collegiate Conference", slug: "central-atlantic-collegiate-conference", level: "II" },
  327: { name: "Independent Northeast Region", slug: "independent-northeast-region", level: null },
  328: { name: "Cascade Collegiate Conference", slug: "cascade-collegiate-conference", level: "NAIA" },
  333: { name: "The Sun Conference", slug: "sun-conference", level: "NAIA" },
  334: { name: "Southern States Athletic Conference", slug: "southern-states-athletic-conference", level: "NAIA" },
  335: { name: "Independent Southeast Region", slug: "independent-southeast-region", level: null },
  337: { name: "HBCU Athletic Conference", slug: "hbcu-athletic-conference", level: "NAIA" },
  340: { name: "Sooner Athletic Conference", slug: "sooner-athletic-conference", level: "NAIA" },
  342: { name: "Other", slug: "other", level: null },
  352: { name: "Frontier Conference", slug: "frontier-conference", level: "NAIA" },
  353: { name: "Red River Athletic Conference", slug: "red-river-athletic-conference", level: "NAIA" },
  354: { name: "Upper Midwest Athletic Conference", slug: "upper-midwest-athletic-conference", level: "III" },
  356: { name: "Mid-States Football Association", slug: "mid-states-football-association", level: "NAIA" },
  359: { name: "Northern Athletics Conference", slug: "northern-athletics-conference", level: "III" },
  361: { name: "Landmark Conference", slug: "landmark-conference", level: "III" },
  364: { name: "Colonial States Athletic Conference", slug: "colonial-states-athletic-conference", level: "III" },
  365: { name: "United East Conference", slug: "united-east-conference", level: "III" },
  366: { name: "Eastern Collegiate Football Conference", slug: "eastern-collegiate-football-conference", level: "III" },
  367: { name: "Great American Conference", slug: "great-american-conference", level: "II" },
  368: { name: "Southern Athletic Association", slug: "southern-athletic-association", level: "III" },
  369: { name: "Association of Independent Institutions", slug: "association-of-independent-institutions", level: "NAIA" },
  370: { name: "Mountain East Conference", slug: "mountain-east-conference", level: "II" },
  371: { name: "Great Midwest Athletic Conference", slug: "great-midwest-athletic-conference", level: "II" },
  372: { name: "American Athletic Conference", slug: "american-athletic-conference", level: "I-FBS" },
  373: { name: "North Star Athletic Association", slug: "north-star-athletic-association", level: "NAIA" },
  374: { name: "River States", slug: "river-states", level: "NAIA" },
  375: { name: "Atlantic East Conference", slug: "atlantic-east-conference", level: "III" },
  377: { name: "Continental Athletic Conference", slug: "continental-athletic-conference", level: "NAIA" },
  378: { name: "Collegiate Conference of the South", slug: "collegiate-conference-of-the-south", level: "III" },
  379: { name: "United Athletic Conference", slug: "united-athletic-conference", level: "I-FCS" },
};

/** Codes no longer used, with the name from the last dictionary that listed them: for event sentences only. */
export const RETIRED_CONFERENCES: Record<number, string> = {
  114: "Division I-AA Independents", // IC2018
  116: "Gateway Football Conference", // IC2015
  124: "Mountain Pacific Sports Federation", // IC2021
  163: "West Virginia Intercollegiate Athletic Conf", // IC2015
  188: "New York State Women's Coll Ath Assoc", // IC2015
  193: "Pennsylvania Athletic Conference", // IC2015
  209: "Heartland Conference", // IC2015
  303: "Independent Far West Region", // IC2015
  306: "American Mideast Conference", // IC2015
  308: "Independent Great Lakes Region", // IC2015
  310: "Midlands Collegiate Athletic Conf", // IC2015
  314: "Kentucky Intercollegiate Ath Conf", // IC2015
  317: "TranSouth Athletic Conference", // IC2015
  321: "Midwest Classic Conference", // IC2015
  331: "Independent Pacific Northwest Region", // IC2015
  332: "Eastern Intercollegiate Athletic Conference", // IC2021
  341: "Independent Southwest Region", // IC2015
  355: "Central States Football League", // IC2015
  360: "Great South Athletic Conference", // IC2015
  362: "Great West Conference", // IC2015
  363: "New England Collegiate Conference", // IC2015
  376: "American Collegiate Athletic Association", // IC2018
};

/**
 * FBS independents coded under 112 "Division I Independents" (which also holds FCS independents) rather than 113
 * "Division I-A Independents". IPEDS can't tell them apart, so they're listed here; review with the table.
 */
export const FBS_INDEPENDENTS: Record<string, string> = {
  "129020": "University of Connecticut (FBS independent since 2016; football code 112 in IC2025)",
};

/** A conference's name for any code seen since IC2015, or null. */
export function conferenceName(code: number): string | null {
  return CONFERENCES[code]?.name ?? RETIRED_CONFERENCES[code] ?? null;
}

/*
 * Conference pages (specs/trends/conferences.md). Each conference's `slug` above is its page's URL
 * (/trends/conferences/{slug}): written out rather than derived from the name, so a rename in a later IPEDS dictionary
 * doesn't move the page. tests/trends-conferences.test.mts checks they're unique and URL-safe.
 */

/**
 * True for a real league: false for the independents' codes, the regional NAIA independents, ECAC (a mixed-level
 * federation), and "Other" (spec rule 5: listed under "No conference" and left out of medians).
 */
export function isLeague(code: number): boolean {
  const c = CONFERENCES[code];
  return !!c && c.level !== null && !/independent|^other$/i.test(c.name);
}

/** The conference code for a page slug, or null. */
export function conferenceBySlug(slug: string): number | null {
  for (const [code, c] of Object.entries(CONFERENCES)) if (c.slug === slug) return Number(code);
  return null;
}

/** Levels in the order the conferences index groups them, with their short labels. */
export const CONFERENCE_LEVELS: readonly { level: ConferenceLevel; label: string }[] = [
  { level: "I-FBS", label: "Division I FBS" },
  { level: "I-FCS", label: "Division I FCS" },
  { level: "I", label: "Division I, other" },
  { level: "II", label: "Division II" },
  { level: "III", label: "Division III" },
  { level: "NAIA", label: "NAIA" },
];

/** The Power 4, in the order the conferences index shows them: SEC, Big Ten, ACC, Big 12. */
export const POWER_FOUR: readonly number[] = [130, 107, 102, 108];
