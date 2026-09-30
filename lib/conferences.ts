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

export const CONFERENCES: Record<number, { name: string; level: ConferenceLevel | null }> = {
  101: { name: "America East", level: "I" },
  102: { name: "Atlantic Coast Conference", level: "I-FBS" },
  103: { name: "Atlantic 10 Conference", level: "I" },
  104: { name: "Big East Conference", level: "I" },
  105: { name: "Big Sky Conference", level: "I-FCS" },
  106: { name: "Big South Conference", level: "I" },
  107: { name: "Big Ten Conference", level: "I-FBS" },
  108: { name: "Big Twelve Conference", level: "I-FBS" },
  109: { name: "Big West Conference", level: "I" },
  110: { name: "Colonial Athletic Association", level: "I" },
  111: { name: "Conference USA", level: "I-FBS" },
  112: { name: "Division I Independents", level: "I" },
  113: { name: "Division I-A Independents", level: "I-FBS" },
  115: { name: "Eastern College Athletic Conference", level: null },
  117: { name: "Ivy Group", level: "I-FCS" },
  118: { name: "Metro Atlantic Athletic Conference", level: "I" },
  119: { name: "Mid-American Conference", level: "I-FBS" },
  120: { name: "The Summit League", level: "I" },
  121: { name: "Mid-Eastern Athletic Conference", level: "I-FCS" },
  122: { name: "Horizon League", level: "I" },
  123: { name: "Missouri Valley Conference", level: "I" },
  125: { name: "Northeast Conference", level: "I-FCS" },
  126: { name: "Ohio Valley Conference", level: "I-FCS" },
  127: { name: "Pacific-12 Conference", level: "I-FBS" },
  128: { name: "Patriot League", level: "I-FCS" },
  129: { name: "Pioneer Football League", level: "I-FCS" },
  130: { name: "Southeastern Conference", level: "I-FBS" },
  131: { name: "Southern Conference", level: "I-FCS" },
  132: { name: "Southland Conference", level: "I-FCS" },
  133: { name: "Southwestern Athletic Conference", level: "I-FCS" },
  134: { name: "Sun Belt Conference", level: "I-FBS" },
  135: { name: "Atlantic Sun Conference", level: "I" },
  136: { name: "West Coast Conference", level: "I" },
  137: { name: "Western Athletic Conference", level: "I" },
  138: { name: "California Collegiate Athletic Association", level: "II" },
  139: { name: "Conference Carolinas", level: "II" },
  140: { name: "Central Intercollegiate Athletic Association", level: "II" },
  141: { name: "Division II Independents", level: "II" },
  144: { name: "Great Lakes Intercollegiate Athletic Conference", level: "II" },
  145: { name: "Great Lakes Valley Conference", level: "II" },
  146: { name: "Gulf South Conference", level: "II" },
  147: { name: "Lone Star Conference", level: "II" },
  148: { name: "Mid-America Intercollegiate Athletic Association", level: "II" },
  151: { name: "East Coast Conference", level: "II" },
  153: { name: "Northeast 10 Conference", level: "II" },
  155: { name: "Northern Sun Intercollegiate Conference", level: "II" },
  156: { name: "Pacific West Conference", level: "II" },
  157: { name: "Peach Belt Conference", level: "II" },
  158: { name: "Pennsylvania State Athletic Conference", level: "II" },
  159: { name: "Rocky Mountain Athletic Conference", level: "II" },
  160: { name: "South Atlantic Conference", level: "II" },
  161: { name: "Southern Intercollegiate Athletic Conference", level: "II" },
  162: { name: "Sunshine State Conference", level: "II" },
  164: { name: "Capital Athletic Conference", level: "III" },
  165: { name: "Centennial Conference", level: "III" },
  166: { name: "City University of New York Athletic Conference", level: "III" },
  167: { name: "College Conference of Illinois and Wisconsin", level: "III" },
  168: { name: "Conference of New England", level: "III" },
  170: { name: "Division III Independents", level: "III" },
  171: { name: "USA South Athletic Conference", level: "III" },
  172: { name: "Empire Eight", level: "III" },
  173: { name: "Freedom Football Conference", level: "III" },
  174: { name: "Great Northeast Athletic Conference", level: "III" },
  175: { name: "Heartland Collegiate Athletic Conference", level: "III" },
  176: { name: "American Rivers Conference", level: "III" },
  178: { name: "Little East Conference", level: "III" },
  179: { name: "Massachusetts State College Athletic Association", level: "III" },
  180: { name: "Michigan Intercollegiate Athletic Association", level: "III" },
  181: { name: "Middle Atlantic States Athletic Corporation", level: "III" },
  182: { name: "Midwest Conference", level: "III" },
  183: { name: "Minnesota Intercollegiate Athletic Conference", level: "III" },
  184: { name: "New England Football Conference", level: "III" },
  185: { name: "New England Small College Athletic Conference", level: "III" },
  186: { name: "New England Women's & Men's Athletic Conference", level: "III" },
  187: { name: "New Jersey Athletic Conference", level: "III" },
  189: { name: "North Coast Athletic Conference", level: "III" },
  191: { name: "Ohio Athletic Conference", level: "III" },
  192: { name: "Old Dominion Athletic Conference", level: "III" },
  194: { name: "Presidents' Athletic Conference", level: "III" },
  195: { name: "St. Louis Intercollegiate Athletic Conference", level: "III" },
  196: { name: "Skyline Conference", level: "III" },
  197: { name: "Southern California Intercollegiate Athletic Conference", level: "III" },
  198: { name: "Southern Collegiate Athletic Conference", level: "III" },
  199: { name: "State University of New York Athletic Conference", level: "III" },
  200: { name: "University Athletic Association", level: "III" },
  201: { name: "Upstate Collegiate Athletic Association", level: "III" },
  202: { name: "Wisconsin Intercollegiate Athletic Conference", level: "III" },
  203: { name: "Mountain West Conference", level: "I-FBS" },
  204: { name: "American Southwest Conference", level: "III" },
  205: { name: "Northwest Conference", level: "III" },
  207: { name: "Commonwealth Conference", level: "III" },
  208: { name: "Freedom Conference", level: "III" },
  213: { name: "Great Northwest Athletic Conference", level: "II" },
  214: { name: "Allegheny Mountain Collegiate Conference", level: "III" },
  215: { name: "North Atlantic Conference", level: "III" },
  301: { name: "California Pacific Conference", level: "NAIA" },
  302: { name: "Golden State Athletic Conference", level: "NAIA" },
  304: { name: "Chicagoland Collegiate Athletic Conference", level: "NAIA" },
  305: { name: "Crossroads League", level: "NAIA" },
  307: { name: "Wolverine-Hoosier Athletic Conference", level: "NAIA" },
  309: { name: "Kansas Collegiate Athletic Conference", level: "NAIA" },
  311: { name: "Great Plains Athletic Conference", level: "NAIA" },
  315: { name: "Mid-South Conference", level: "NAIA" },
  316: { name: "Appalachian Athletic Conference", level: "NAIA" },
  318: { name: "Independent Mid-South Region", level: "NAIA" },
  319: { name: "American Midwest Conference", level: "NAIA" },
  320: { name: "Heart of America Athletic Conference", level: "NAIA" },
  322: { name: "Independent Midwest Region", level: null },
  323: { name: "Central Atlantic Collegiate Conference", level: "II" },
  327: { name: "Independent Northeast Region", level: null },
  328: { name: "Cascade Collegiate Conference", level: "NAIA" },
  333: { name: "The Sun Conference", level: "NAIA" },
  334: { name: "Southern States Athletic Conference", level: "NAIA" },
  335: { name: "Independent Southeast Region", level: null },
  337: { name: "HBCU Athletic Conference", level: "NAIA" },
  340: { name: "Sooner Athletic Conference", level: "NAIA" },
  342: { name: "Other", level: null },
  352: { name: "Frontier Conference", level: "NAIA" },
  353: { name: "Red River Athletic Conference", level: "NAIA" },
  354: { name: "Upper Midwest Athletic Conference", level: "III" },
  356: { name: "Mid-States Football Association", level: "NAIA" },
  359: { name: "Northern Athletics Conference", level: "III" },
  361: { name: "Landmark Conference", level: "III" },
  364: { name: "Colonial States Athletic Conference", level: "III" },
  365: { name: "United East Conference", level: "III" },
  366: { name: "Eastern Collegiate Football Conference", level: "III" },
  367: { name: "Great American Conference", level: "II" },
  368: { name: "Southern Athletic Association", level: "III" },
  369: { name: "Association of Independent Institutions", level: "NAIA" },
  370: { name: "Mountain East Conference", level: "II" },
  371: { name: "Great Midwest Athletic Conference", level: "II" },
  372: { name: "American Athletic Conference", level: "I-FBS" },
  373: { name: "North Star Athletic Association", level: "NAIA" },
  374: { name: "River States", level: "NAIA" },
  375: { name: "Atlantic East Conference", level: "III" },
  377: { name: "Continental Athletic Conference", level: "NAIA" },
  378: { name: "Collegiate Conference of the South", level: "III" },
  379: { name: "United Athletic Conference", level: "I-FCS" },
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
