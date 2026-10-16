/**
 * The Build your list guide (lib/planner/list-guide.ts, lib/planner/list-guide-server.ts; specs/planner/v3/guides/
 * list-size.md): every likeness fact with its sentence; the three-point rule and the few-facts exception; selectivity
 * never part of likeness; the cards' order, the 200 cap, and the freshman view's order; the shape row's counts for
 * each season; and a guard that no string the module can produce carries an estimate number (a percentage, "×",
 * "odds", "chance", a probability "likely", or a bare number other than a distance or a count line), shown failing on
 * a planted bad sentence. Then the server half over the real dataset with the real estimate: a thin list of three
 * Southeastern Reaches gets Likely cards like them. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as nodeModule from "node:module";
import {
  affiliationWord,
  alike,
  chipsFromPreferences,
  distanceText,
  FACT_ORDER,
  GUIDE_CANDIDATE_CAP,
  hasExplorePreferences,
  NO_PREFERENCES_LINE,
  GUIDE_PAGE,
  likeness,
  likenessSentence,
  nothingAlikeLine,
  openSectionsFor,
  overMaxLine,
  pageOf,
  parseChips,
  preferenceCards,
  preferenceSentence,
  rankAlike,
  rankNearHome,
  SETTING_CHIPS,
  SHAPE_EXPLAINER,
  SHAPE_EXPLAINER_SOURCES,
  shapeRow,
  shapeSentence,
  showMoreHref,
  showMoreLinks,
  SIZE_BANDS,
  SIZE_CHIPS,
  sizeBand,
  toCard,
  TYPE_CHIPS,
  unsortedSectionLine,
  type AlikeCard,
  type LikenessInput,
} from "../lib/planner/list-guide.ts";
import { countLine, shapeFor, shapeGaps } from "../lib/planner/list-shape.ts";
import { MOVE_TEXT } from "../lib/planner/moves-catalog.ts";
import type { Season } from "../lib/planner/seasons.ts";
import type { StandingLevel } from "../lib/chances/types.ts";
import type { StudentProfilePreferences } from "../lib/student-profile.ts";
import { numberProblems } from "./helpers/copy-guard.mts";

const ROOT = join(import.meta.dirname, "..");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function school(o: Partial<LikenessInput> = {}): LikenessInput {
  return {
    type: "private-nonprofit",
    undergrad: 5200,
    settingGroup: "city",
    region: "Southeast",
    lat: 36.13,
    lng: -80.28,
    affiliation: null,
    hbcu: false,
    womens: false,
    majorFamilies: ["11", "52"],
    ...o,
  };
}
const OPTS = { majorFamily: null, anchorName: "Wake Forest" };
const FAR = { lat: 47.6, lng: -122.3 }; // Seattle: far from Winston-Salem

/* ------------------------------------------------------------------ */
/* Every fact with its sentence                                        */
/* ------------------------------------------------------------------ */

test("control: both public or both private (non-profit and for-profit both private)", () => {
  const anchor = school({ type: "private-nonprofit" });
  const r = likeness(anchor, school({ type: "private-forprofit", ...FAR, region: "West", undergrad: 50, settingGroup: "rural" }), OPTS);
  assert.deepEqual(r.facts, ["control"]);
  assert.equal(r.phrases.control, "also private");
  const pub = likeness(school({ type: "public" }), school({ type: "public", ...FAR, region: "West", undergrad: 50, settingGroup: "rural" }), OPTS);
  assert.equal(pub.phrases.control, "also public");
  assert.ok(!likeness(school({ type: "public" }), school({ type: "private-nonprofit" }), OPTS).facts.includes("control"));
});

test("size: the same band of SIZE_BANDS (under 2,000 · 2,000–5,000 · 5,000–15,000 · 15,000–30,000 · over 30,000)", () => {
  assert.equal(SIZE_BANDS.length, 5);
  assert.deepEqual([1999, 2000, 4999, 5000, 14999, 15000, 29999, 30000, 60000].map(sizeBand), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(sizeBand(null), null);
  assert.equal(sizeBand(0), null);
  const r = likeness(school({ undergrad: 5200 }), school({ undergrad: 14000 }), OPTS);
  assert.ok(r.facts.includes("size"));
  assert.equal(r.phrases.size, "similar size");
  assert.ok(!likeness(school({ undergrad: 5200 }), school({ undergrad: 4900 }), OPTS).facts.includes("size"), "across a band edge");
});

test("setting: the same NCES locale group, each with its words", () => {
  const words = { city: "also in a city", town: "also a college town", suburb: "also suburban", rural: "also rural" } as const;
  for (const [g, w] of Object.entries(words)) {
    const r = likeness(school({ settingGroup: g as keyof typeof words }), school({ settingGroup: g as keyof typeof words }), OPTS);
    assert.equal(r.phrases.setting, w);
  }
  assert.ok(!likeness(school({ settingGroup: "city" }), school({ settingGroup: "rural" }), OPTS).facts.includes("setting"));
});

test("place: within 150 miles of the anchor reads 'nearby'; the same region reads 'also {region}'", () => {
  // Davidson, NC is about 70 miles from Winston-Salem.
  const near = likeness(school(), school({ lat: 35.5, lng: -80.84, region: "Southeast" }), OPTS);
  assert.ok(near.placeByDistance);
  assert.equal(near.phrases.place, "near Wake Forest");
  assert.match(likenessSentence("Wake Forest", near), /nearby/);
  assert.doesNotMatch(likenessSentence("Wake Forest", near), /near Wake Forest/, "never names the anchor twice");
  // Gainesville, FL: far, but Southeast.
  const region = likeness(school(), school({ lat: 29.65, lng: -82.32, region: "Southeast" }), OPTS);
  assert.ok(!region.placeByDistance);
  assert.equal(region.phrases.place, "also Southeast");
  // Near across a region line still counts (distance wins).
  assert.ok(likeness(school({ region: "Southeast" }), school({ lat: 36.5, lng: -80.0, region: "Mid East" }), OPTS).facts.includes("place"));
  assert.ok(!likeness(school(), school({ ...FAR, region: "West" }), OPTS).facts.includes("place"));
  assert.equal(likeness(school({ region: "Territories" }), school({ region: "Territories", ...FAR }), OPTS).phrases.place, "also in the U.S. territories");
});

test("character: the same affiliation when the anchor has one, both HBCUs, both women's colleges", () => {
  const catholic = { code: 30, label: "Roman Catholic" };
  assert.equal(likeness(school({ affiliation: catholic }), school({ affiliation: catholic }), OPTS).phrases.character, "also Catholic");
  const pcusa = { code: 66, label: "Presbyterian Church (USA)" };
  assert.equal(likeness(school({ affiliation: pcusa }), school({ affiliation: pcusa }), OPTS).phrases.character, "also Presbyterian Church (USA)");
  assert.equal(affiliationWord({ code: 80, label: "Jewish" }), "Jewish");
  assert.ok(!likeness(school({ affiliation: catholic }), school({ affiliation: pcusa }), OPTS).facts.includes("character"));
  assert.ok(!likeness(school(), school({ affiliation: catholic }), OPTS).facts.includes("character"), "an anchor without one has no character fact");
  assert.equal(likeness(school({ hbcu: true }), school({ hbcu: true }), OPTS).phrases.character, "also an HBCU");
  assert.equal(likeness(school({ womens: true }), school({ womens: true }), OPTS).phrases.character, "also a women's college");
  assert.equal(likeness(school({ hbcu: true, womens: true }), school({ hbcu: true, womens: true }), OPTS).score, likeness(school({ hbcu: true }), school({ hbcu: true }), OPTS).score, "one point however many ways");
});

test("major: the candidate awards bachelor's in the student's first intended major family", () => {
  const opts = { majorFamily: "11", majorName: "Computer science", anchorName: "Wake Forest" };
  const r = likeness(school(), school({ majorFamilies: ["11"] }), opts);
  assert.equal(r.phrases.major, "has computer science");
  assert.ok(!likeness(school(), school({ majorFamilies: ["52"] }), opts).facts.includes("major"));
  assert.ok(!likeness(school(), school(), OPTS).facts.includes("major"), "no intended major: no major fact");
  assert.equal(likeness(school(), school(), { majorFamily: "23", majorName: "English" }).phrases.major ?? null, null);
  assert.equal(likeness(school(), school({ majorFamilies: ["23"] }), { majorFamily: "23", majorName: "English" }).phrases.major, "has English");
});

test("the sentence: up to three facts, most specific first (character, place, setting, size, control, major)", () => {
  assert.deepEqual([...FACT_ORDER], ["character", "place", "setting", "size", "control", "major"]);
  const catholic = { code: 30, label: "Roman Catholic" };
  const all = likeness(school({ affiliation: catholic }), school({ affiliation: catholic, lat: 29.65, lng: -82.32 }), { majorFamily: "11", majorName: "Computer science", anchorName: "Notre Dame" });
  assert.equal(all.score, 6);
  assert.equal(likenessSentence("Notre Dame", all), "Like Notre Dame: also Catholic, also Southeast, also in a city");
  const two = likeness(school({ type: "public" }), school({ type: "public", ...FAR, region: "West", settingGroup: "rural" }), OPTS);
  assert.equal(likenessSentence("Wake Forest", two), "Like Wake Forest: similar size, also public");
});

/* ------------------------------------------------------------------ */
/* The three-point rule                                                */
/* ------------------------------------------------------------------ */

test("alike: three points, or two when the anchor has fewer than four facts known", () => {
  const anchor = school(); // control, size, setting, place known: four
  const two = likeness(anchor, school({ ...FAR, region: "West", settingGroup: "rural" }), OPTS); // control + size
  assert.equal(two.known, 4);
  assert.equal(two.score, 2);
  assert.equal(alike(two), false, "two of four is not alike");
  const three = likeness(anchor, school({ ...FAR, region: "West" }), OPTS); // control + size + setting
  assert.equal(three.score, 3);
  assert.equal(alike(three), true);
  // A thin anchor: no setting, no region, no coordinates (control and size known only).
  const thin = school({ settingGroup: null, region: null, lat: null, lng: null });
  const r = likeness(thin, school(), OPTS);
  assert.equal(r.known, 2);
  assert.equal(r.score, 2);
  assert.equal(alike(r), true, "the few-facts exception");
  assert.equal(alike(likeness(thin, school({ type: "public" }), OPTS)), false, "one point is never alike");
});

/* ------------------------------------------------------------------ */
/* Order, cap, pages                                                   */
/* ------------------------------------------------------------------ */

const row = (name: string, likenessScore: number, closeness: number | null, distanceMiles: number | null) => ({
  unitId: name,
  name,
  state: "NC",
  level: "likely" as StandingLevel,
  sentence: "",
  distanceMiles,
  likeness: likenessScore,
  closeness,
});

test("rankAlike: likeness, then closeness to the level above, then distance, then name", () => {
  const ranked = rankAlike([row("far", 4, 3, 500), row("near", 4, 3, 10), row("closer-level", 4, 3, null), row("most-alike", 5, 0, 900), row("nearly-target", 4, 3, 5), row("low-close", 4, 1, 1)]);
  assert.deepEqual(
    ranked.map((r) => r.name),
    ["most-alike", "nearly-target", "near", "far", "closer-level", "low-close"],
  );
  assert.deepEqual(rankNearHome([row("a", 0, 3, 50), row("b", 0, 0, 10), row("c", 0, 1, null)]).map((r) => r.name), ["b", "a", "c"]);
});

test("cards leave the server with the card's fields only: no closeness, no estimate number", () => {
  const card = toCard({ ...row("x", 3, 2, 12), brand: undefined });
  assert.deepEqual(Object.keys(card).sort(), ["brand", "distanceMiles", "level", "likeness", "name", "sentence", "state", "unitId"]);
  assert.equal("closeness" in card, false);
});

test("pages: twelve at a time", () => {
  assert.equal(GUIDE_PAGE, 12);
  const rows = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(pageOf(rows, 0), rows.slice(0, 12));
  assert.deepEqual(pageOf(rows, 24), rows.slice(24, 30));
  assert.deepEqual(pageOf(rows, -5), rows.slice(0, 12));
});

/* ------------------------------------------------------------------ */
/* The freshman view                                                   */
/* ------------------------------------------------------------------ */

test("freshman view: chips pre-set from preferences, nearest first, the sentence is the preferences matched", () => {
  const chips = chipsFromPreferences({ sizes: ["medium"], settings: ["suburb"], statesOrRegions: ["Northeast"], types: [] });
  assert.deepEqual(chips, { sizes: ["medium"], settings: ["suburb"], places: ["Northeast"], types: [] });
  assert.equal(preferenceSentence({ undergrad: 8000, settingGroup: "suburb", state: "MA", region: "Northeast", type: "private-nonprofit" }, chips), "Mid-sized, suburban, Northeast");
  const byState = chipsFromPreferences({ sizes: [], settings: [], statesOrRegions: ["NC"], types: ["public"] });
  assert.equal(preferenceSentence({ undergrad: 8000, settingGroup: "city", state: "NC", region: "Southeast", type: "public" }, byState, (p) => (p === "NC" ? "North Carolina" : p)), "North Carolina, public");
  assert.equal(preferenceSentence({ undergrad: 8000, settingGroup: "city", state: "NC", region: "Southeast", type: "public" }, chipsFromPreferences(null)), "", "no chips: no sentence");
  assert.deepEqual(
    preferenceCards([
      { name: "B", distanceMiles: null },
      { name: "A", distanceMiles: 30 },
      { name: "C", distanceMiles: 5 },
      { name: "D", distanceMiles: null },
    ]).map((r) => r.name),
    ["C", "A", "B", "D"],
  );
  assert.deepEqual(parseChips({ sizes: ["medium", "huge"], places: ["Northeast", "XX"], types: ["public"], settings: "city" }, ["Northeast"]), {
    sizes: ["medium"],
    settings: [],
    places: ["Northeast"],
    types: ["public"],
  });
});

/* ------------------------------------------------------------------ */
/* The shape row for each season                                       */
/* ------------------------------------------------------------------ */

const SEASONS: Season[] = ["freshman", "sophomore", "junior_fall", "junior_winter", "junior_spring", "summer_before_senior", "senior_fall", "senior_winter", "senior_spring", "summer_after", "graduated", "unknown"];
const counts = (o: Partial<Record<StandingLevel, number>>): Record<StandingLevel, number> => ({ high_reach: 0, reach: 0, target: 0, likely: 0, safe: 0, ...o });

test("shape row: no row without a shape; the long list bounds the total only; the senior shape has every range", () => {
  const c = counts({ high_reach: 3, reach: 3, target: 2 });
  for (const season of SEASONS) {
    const shape = shapeFor(season);
    const row = shapeRow(shape, c, "high_reach", 1);
    if (!shape) {
      assert.equal(row, null, season);
      continue;
    }
    assert.ok(row, season);
    assert.equal(row.total.count, 9, `${season}: eight sorted + one unsorted`);
    assert.deepEqual(row.levels.map((l) => l.count), [3, 3, 2, 0, 0], season);
    if (season === "junior_fall" || season === "junior_winter") {
      assert.equal(row.total.text, "15–20 in all · you 9", season);
      assert.ok(row.levels.every((l) => l.range === null && l.slots.length === l.count), `${season}: no ranges, just the colleges`);
      assert.equal(row.levels[2].countText, "you 2");
    } else {
      assert.equal(row.total.text, "12–15 in all · you 9", season);
      const [hr, , target, likely] = row.levels;
      assert.deepEqual(hr.slots, ["dream", "filled", "overflow"], `${season}: the Dream first, the third past the maximum`);
      assert.equal(hr.countText, "0–2 · you 3");
      assert.deepEqual(target.slots, ["filled", "filled", "need", "need", "need", "room", "room", "room"]);
      assert.equal(target.countText, "5–8 · you 2");
      assert.deepEqual(likely.slots, ["need", "need", "room"]);
    }
  }
});

/* ------------------------------------------------------------------ */
/* "Show me more" (specs/planner/record/explore-levels.md)             */
/* ------------------------------------------------------------------ */

const PREFS = { sizes: ["medium", "large"], settings: ["suburban"], statesOrRegions: ["NC", "va", "Southeast"], types: ["public"], maxAverageCost: 30000 } as unknown as StudentProfilePreferences;
const NO_PREFS = { sizes: [], settings: [], statesOrRegions: [], types: [], maxAverageCost: null } as unknown as StudentProfilePreferences;

test("Show me more: Explore at the level, with the record's preferences as Explore's own params", () => {
  const href = showMoreHref("target", PREFS);
  const url = new URL(href, "https://quad.example");
  assert.equal(url.pathname, "/explore");
  assert.equal(url.searchParams.get("forMe"), "target", "the level");
  assert.equal(url.searchParams.get("sizes"), "medium,large");
  assert.equal(url.searchParams.get("setting"), "suburban");
  assert.equal(url.searchParams.get("states"), "NC,VA", "USPS codes only; a region has no Explore filter");
  assert.equal(url.searchParams.get("types"), "public");
  assert.equal(url.searchParams.get("maxCost"), "30000");
  assert.ok(href.startsWith("/explore?forMe=target&"), "the level comes first");
  // No preferences (or no record): only the level.
  assert.equal(showMoreHref("high_reach", NO_PREFS), "/explore?forMe=high_reach");
  assert.equal(showMoreHref("safe", null), "/explore?forMe=safe");
  assert.equal(hasExplorePreferences(PREFS), true);
  assert.equal(hasExplorePreferences(NO_PREFS), false);
  assert.equal(hasExplorePreferences({ ...NO_PREFS, statesOrRegions: ["Southeast"] } as StudentProfilePreferences), false, "a region alone filters nothing");
  assert.equal(hasExplorePreferences(null), false);
});

/** Problems with a set of links against the row: a level missing, or the emphasis not exactly "below the minimum". */
function emphasisProblems(row: NonNullable<ReturnType<typeof shapeRow>>, links: Record<StandingLevel, { href: string; emphasized: boolean }>): string[] {
  const out: string[] = [];
  for (const l of row.levels) {
    const link = links[l.level];
    if (!link) {
      out.push(`${l.level}: no link`);
      continue;
    }
    if (new URL(link.href, "https://quad.example").searchParams.get("forMe") !== l.level) out.push(`${l.level}: the link's level`);
    const below = l.range !== null && l.count < l.range[0];
    if (link.emphasized !== below) out.push(`${l.level}: emphasized ${link.emphasized}, below the minimum ${below}`);
  }
  return out;
}

test("Show me more: emphasized exactly where the level is below the shape's minimum; no range reads quiet", () => {
  // Senior shape: High reach 0–2, Target 5–8, and so on.
  const senior = shapeRow(shapeFor("senior_fall"), counts({ high_reach: 3, reach: 3, target: 2 }), null)!;
  const links = showMoreLinks(senior, PREFS);
  assert.deepEqual(emphasisProblems(senior, links), []);
  assert.equal(links.target.emphasized, true, "2 Targets against a minimum of 5");
  assert.equal(links.likely.emphasized, true, "no Likely yet");
  assert.equal(links.high_reach.emphasized, false, "three High reaches: past the most, not below the least");
  assert.ok(links.target.href.includes("sizes=medium%2Clarge"));
  // The junior long list has no level ranges: every link is quiet.
  const junior = shapeRow(shapeFor("junior_fall"), counts({ reach: 1 }), null)!;
  const quiet = showMoreLinks(junior, null);
  assert.deepEqual(emphasisProblems(junior, quiet), []);
  assert.ok(Object.values(quiet).every((l) => !l.emphasized));
  // Planted bad cases: emphasis on every level, and a link to the wrong level.
  const loud = Object.fromEntries(Object.entries(links).map(([k, v]) => [k, { ...v, emphasized: true }])) as typeof links;
  assert.ok(emphasisProblems(senior, loud).length > 0);
  assert.ok(emphasisProblems(senior, { ...links, safe: { ...links.safe, href: "/explore?forMe=reach" } }).length > 0);
});

test("the list guide: Show me more in the shape table, the shape card gone, Search any college under the table", () => {
  const guide = readFileSync(join(ROOT, "components", "planner", "guides", "ListGuide.tsx"), "utf8");
  const row = readFileSync(join(ROOT, "components", "planner", "guides", "ShapeRow.tsx"), "utf8");
  assert.doesNotMatch(guide, /Your list has the shape for this season/, "the shape card is removed");
  assert.match(guide, /<ShapeRow row=\{d\.row\} links=\{links\} onShowMore=\{onShowMore\} \/>/);
  assert.match(guide, /showMoreLinks\(d\.row, preferences\)/);
  assert.match(guide, /track\("plan_show_more", \{ level, emphasized \}\)/);
  // "Explore with your numbers" is only the freshman view's now; the shape's views pass no exploreHref.
  assert.equal([...guide.matchAll(/exploreHref=\{/g)].length, 1, "one NotSeeing with an Explore link: the freshman view's");
  assert.match(guide, /<NotSeeing ctx=\{ctx\} exploreHref=\{data\.exploreHref\}/);
  // Under the table: the no-preferences line linking the record's Where you'd go step, then Search any college.
  const shapeSection = guide.slice(guide.indexOf('aria-labelledby="shape-heading"'), guide.indexOf("{sections.map("));
  assert.match(shapeSection, /NO_PREFERENCES_LINE/);
  assert.match(shapeSection, /recordHref\(\{ person, step: whereStep \}\)/);
  assert.match(shapeSection, /<NotSeeing ctx=\{ctx\} onAdded=/);
  assert.equal(NO_PREFERENCES_LINE, "Add where you'd go to your record and these show colleges that fit it too");
  // The link: "Show me more", 44 px, filled primary when emphasized, under the boxes on a phone.
  assert.match(row, />\s*Show me more\s*</);
  assert.match(row, /min-h-11/);
  assert.match(row, /emphasized \? "bg-primary text-primary-foreground/);
  assert.match(row, /col-span-2 col-start-2/);
});

test("openSectionsFor: the open section after a refresh is whatever the fresh page's openGap names, never a client guess", () => {
  assert.deepEqual(openSectionsFor("likely_min"), new Set(["likely_min"]));
  assert.deepEqual(openSectionsFor(null), new Set());
  // A second call with a different gap replaces the first (the server's answer always wins, not an accumulation).
  assert.deepEqual(openSectionsFor("target_min"), new Set(["target_min"]));
});

/* ------------------------------------------------------------------ */
/* Guard: no number from the estimate in any string the module makes   */
/* ------------------------------------------------------------------ */

/** What may carry a digit in the guide: a distance ("140 mi from home") and a count ("5–8 · you 2", "12–15 in all · you 9", "11 colleges aren't sorted", "3 Reaches"). */
const GUIDE_ALLOWED = [/\b[\d,]+ mi from home\b/g, /\b\d+–\d+ · you \d+\b/g, /\b\d+–\d+ in all · you \d+\b/g, /^you \d+$/g, /^\d+ colleges aren't sorted yet\b/g, /^\d+ High reaches crowd out\b/g, /\b\d+ (High reach(es)?|Reach(es)?|Targets?|Likely|Likelies|Safes?)\b/g];
function guideProblems(text: string): string[] {
  let rest = text;
  for (const re of GUIDE_ALLOWED) rest = rest.replace(re, "");
  return numberProblems(rest);
}

function everyString(): string[] {
  const out: string[] = [];
  const catholic = { code: 30, label: "Roman Catholic" };
  const variants: LikenessInput[] = [
    school(),
    school({ type: "public", undergrad: 40000, settingGroup: "suburb", region: "Midwest", ...FAR }),
    school({ affiliation: catholic, settingGroup: "town" }),
    school({ hbcu: true, settingGroup: "rural", region: "Territories" }),
    school({ womens: true, lat: 35.5, lng: -80.84 }),
    school({ undergrad: null, settingGroup: null, region: null, lat: null, lng: null }),
  ];
  for (const a of variants)
    for (const b of variants)
      for (const majorFamily of [null, "11", "23"]) {
        const r = likeness(a, b, { majorFamily, majorName: majorFamily === "23" ? "English" : "Computer science", anchorName: "Wake Forest" });
        out.push(likenessSentence("Wake Forest", r), ...Object.values(r.phrases));
      }
  for (const s of SEASONS) {
    out.push(shapeSentence(s));
    const row = shapeRow(shapeFor(s), counts({ high_reach: 4, reach: 1, target: 9, likely: 0, safe: 2 }), "reach", 3);
    if (row) out.push(row.total.text, ...row.levels.map((l) => l.countText));
  }
  for (const s of SHAPE_EXPLAINER) out.push(s.heading, s.text);
  out.push(SHAPE_EXPLAINER_SOURCES);
  for (const n of [1, 2, 3, 7, 10, 11, 14]) out.push(overMaxLine(n), unsortedSectionLine(n));
  for (const l of ["High reach", "Reach", "Target", "Likely", "Safe"]) out.push(nothingAlikeLine(l, true), nothingAlikeLine(l, false));
  out.push(distanceText(140), distanceText(1234.6));
  out.push(NO_PREFERENCES_LINE, "Show me more");
  for (const c of [...SIZE_CHIPS, ...SETTING_CHIPS, ...TYPE_CHIPS]) out.push(c.label, c.word);
  out.push(preferenceSentence({ undergrad: 40000, settingGroup: "rural", state: "NC", region: "Southeast", type: "public" }, chipsFromPreferences({ sizes: ["xl"], settings: ["rural"], statesOrRegions: ["Southeast"], types: ["public"] })));
  // The section titles and the count line the page shows (list-shape's, read by the guide).
  for (const k of ["likely_min", "target_min", "reach_min", "over_max", "total_off"] as const) out.push(MOVE_TEXT[`shape_gap:${k}`].title);
  out.push(countLine(counts({ reach: 3, target: 2 })));
  for (const g of shapeGaps(counts({ high_reach: 3, reach: 1 }), 0, "senior_fall", "ok")) out.push(g.line);
  return out.filter((s) => s !== "");
}

test("guard: no string the list guide can produce carries a number from the estimate", () => {
  const strings = everyString();
  assert.ok(strings.length > 300, `covered ${strings.length} strings`);
  for (const s of strings) assert.deepEqual(guideProblems(s), [], s);
  // "Likely" the level is fine; the guard reads the probability word only.
  assert.deepEqual(guideProblems("Add a Likely you'd be happy at"), []);
});

test("guard: a planted bad sentence fails", () => {
  for (const bad of [
    "Like Wake Forest: also private, 62% admit",
    "Like Duke: 3× your odds",
    "Like Duke: better odds here",
    "Likely for you: a strong chance",
    "You're likely to get in",
    "Like Elon: closeness 3",
    "5–8 · you 2 · 71",
  ]) {
    assert.ok(guideProblems(bad).length > 0, bad);
  }
  // A count line or a distance alone passes; the same digits loose in a sentence don't.
  assert.deepEqual(guideProblems("5–8 · you 2"), []);
  assert.deepEqual(guideProblems("140 mi from home"), []);
  assert.ok(guideProblems("Like Elon: 140 points higher").length > 0);
});

test("the client never sees the server half, and the card component reads no estimate field", () => {
  for (const f of ["ListGuide.tsx", "AlikeCard.tsx", "ShapeRow.tsx", "ShapeExplainer.tsx"]) {
    const src = readFileSync(join(ROOT, "components", "planner", "guides", f), "utf8");
    assert.doesNotMatch(src, /from "[^"]*(list-guide-server|chances\/estimate)"|closeness/, f);
  }
  const card = readFileSync(join(ROOT, "components", "planner", "guides", "AlikeCard.tsx"), "utf8");
  assert.match(card, /target="_blank"/, "the profile opens in a new tab");
  assert.match(card, /addToList\(listId, card\.unitId\)/);
  assert.match(card, /suggestCollege\(listId, card\.unitId\)/);
  const server = readFileSync(join(ROOT, "lib", "planner", "list-guide-server.ts"), "utf8");
  assert.match(server, /^import "server-only";/m);
});

/* ------------------------------------------------------------------ */
/* The server half over the real dataset                               */
/* ------------------------------------------------------------------ */

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: { parentURL?: string }, next: (s: string, c: unknown) => ResolveResult): ResolveResult }): void;
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier === "next/headers")
      return { url: "data:text/javascript,export function cookies(){throw new Error('no request')} export function headers(){throw new Error('no request')}", shortCircuit: true };
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(ROOT, spec.slice(2))).href;
    if ((spec.startsWith("file:") || spec.startsWith(".")) && !/\.(m?[jt]sx?|json)$/.test(spec)) {
      const base = spec.startsWith(".") && context.parentURL ? new URL(spec, context.parentURL).href : spec;
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(new URL(base + ext))) return next(base + ext, context);
    }
    return next(spec, context);
  },
});

const server = await import("../lib/planner/list-guide-server.ts");
const { getData } = await import("../lib/data.ts");
const { estimateContext, estimateMany } = await import("../lib/chances/estimate.ts");
type School = import("../lib/types.ts").School;
type EstimateStudent = import("../lib/chances/types.ts").EstimateStudent;

const WAKE = "199847";
const DAVIDSON = "198385";
const DUKE = "198419";

function student(o: Partial<EstimateStudent> = {}): EstimateStudent {
  return { gpa: 3.7, gpaScale: "4.0", gpaRange: [3.7, 3.7], test: { kind: "sat", score: 1330 }, satMath: null, actMath: null, classRankPercentile: null, courses: [], state: "NC", majors: [], round: null, highSchoolId: null, ...o } as EstimateStudent;
}

async function realDeps(home: { lat: number; lng: number } | null = null) {
  const data = await getData();
  const s = student();
  const ctx = await estimateContext(s, { grade: 11 });
  return { data, deps: { schools: data.getAllSchools(), byId: data.getSchoolById, estimate: (ids: readonly string[]) => estimateMany(s, ids, ctx), home } };
}

const item = (unit_id: string, position: number, dream = false) => ({ unit_id, position, dream, withdrawn_on: null });

test("selectivity never influences likeness: two colleges differing only in admit rate and scores score the same", async () => {
  const data = await getData();
  const wake = data.getSchoolById(WAKE)!;
  const davidson = data.getSchoolById(DAVIDSON)!;
  const easier = structuredClone(davidson) as School;
  easier.admissions = { ...easier.admissions, acceptance_rate: 0.95, admitted: (easier.admissions.applicants ?? 0) * 0.95, sat_reading_25_75: [400, 500], sat_math_25_75: [400, 500], act_composite_25_75: [15, 20] };
  const a = server.likenessInputOf(wake);
  assert.deepEqual(server.likenessInputOf(easier), server.likenessInputOf(davidson));
  assert.deepEqual(likeness(a, server.likenessInputOf(easier), OPTS), likeness(a, server.likenessInputOf(davidson), OPTS));
  // LikenessInput has no field a college's selectivity could ride in.
  assert.deepEqual(Object.keys(a).sort(), ["affiliation", "hbcu", "lat", "lng", "majorFamilies", "region", "settingGroup", "type", "undergrad", "womens"]);
});

test("candidates: alike to an anchor, never on the list, capped at 200 by best likeness", async () => {
  const { deps } = await realDeps();
  const anchors = server.anchorsOf([item(DUKE, 1), item(WAKE, 0), item(DAVIDSON, 2, true)], deps.byId);
  assert.deepEqual(anchors.map((a) => a.unitId), [DAVIDSON, WAKE, DUKE], "the Dream first, then the list's order");
  const listed = new Set([WAKE, DAVIDSON, DUKE]);
  const pool = server.alikeCandidates(deps, anchors, listed, { majorFamily: "11", maxAverageCost: null });
  assert.ok(pool.length <= GUIDE_CANDIDATE_CAP);
  assert.equal(pool.length, GUIDE_CANDIDATE_CAP, "a Southeastern private list has more than 200 alike colleges");
  assert.ok(pool.every((c) => !listed.has(c.school.unit_id)));
  for (let i = 1; i < pool.length; i++) assert.ok(pool[i - 1].best.score >= pool[i].best.score, "best likeness first");
  assert.ok(pool.every((c) => alike(c.best)));
});

test("a thin list of three Southeastern Reaches gets Likely colleges like them, each with its sentence", async () => {
  const { deps } = await realDeps({ lat: 35.23, lng: -80.84 }); // Charlotte
  const items = [item(WAKE, 0, true), item(DAVIDSON, 1), item(DUKE, 2)];
  const anchors = server.anchorsOf(items, deps.byId);
  const listed = new Set(items.map((i) => i.unit_id));
  const studentFacts = { majorFamily: null, maxAverageCost: null };
  const { rows, fallback } = server.rankedForGap(deps, anchors, listed, studentFacts, { gap: "likely_min", level: "likely" });
  console.log(`thin list (Wake Forest, Davidson, Duke; SAT 1330, GPA 3.7): ${rows.length} Likely cards alike, fallback ${fallback}`);
  assert.equal(fallback, false);
  assert.ok(rows.length >= 4, `at least a row of cards (${rows.length})`);
  for (const r of rows) {
    assert.equal(r.level, "likely");
    assert.match(r.sentence, /^Like (Wake Forest University|Davidson College|Duke University): /);
    assert.deepEqual(guideProblems(r.sentence), [], r.sentence);
    assert.ok(r.distanceMiles !== null);
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].likeness >= rows[i].likeness, "likeness first");
  const pool = server.alikePool(deps, anchors, listed, studentFacts);
  const target = server.alikeAtLevel(pool, studentFacts, { gap: "target_min", level: "target" });
  console.log(`  the same pool at Target: ${target.length}; at Safe: ${server.alikeAtLevel(pool, studentFacts, { gap: "likely_min", level: "safe" }).length}`);
});

test("nothing alike at the level: the near-home fallback, by distance", async () => {
  const { deps } = await realDeps({ lat: 35.23, lng: -80.84 });
  const anchors = server.anchorsOf([item(WAKE, 0)], deps.byId);
  // An empty pool stands in for "nothing alike": every candidate on the list already.
  const { rows, fallback } = server.rankedForGap(deps, anchors, new Set([WAKE]), { majorFamily: null, maxAverageCost: null }, { gap: "likely_min", level: "likely" }, { pool: [], estimates: {} });
  assert.equal(fallback, true);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.sentence === "" && r.likeness === 0 && r.level === "likely"));
  for (let i = 1; i < rows.length; i++) assert.ok((rows[i - 1].distanceMiles ?? Infinity) <= (rows[i].distanceMiles ?? Infinity), "nearest first");
});

test("freshman cards: fit every chip, nearest first, never a level", async () => {
  const { deps } = await realDeps({ lat: 42.36, lng: -71.06 }); // Boston
  const chips = chipsFromPreferences({ sizes: ["medium"], settings: ["suburb"], statesOrRegions: ["Northeast"], types: [] });
  const cards: AlikeCard[] = server.freshmanCards(deps, new Set(), null, chips);
  assert.ok(cards.length > 5);
  assert.ok(cards.every((c) => c.level === null && c.sentence === "Mid-sized, suburban, Northeast"));
  for (let i = 1; i < cards.length; i++) assert.ok((cards[i - 1].distanceMiles ?? Infinity) <= (cards[i].distanceMiles ?? Infinity));
});

test("listGuideFor: a junior-spring list of three Reaches opens the Likely section with cards; a freshman gets the preference view", async () => {
  const { emptyProfile } = await import("../lib/student-profile.ts");
  const { estimateInputFromProfile } = await import("../lib/chances/estimate-input.ts");
  const profile = emptyProfile();
  profile.academics.gpa = 3.7;
  profile.academics.gpaScale = "4.0";
  profile.tests.satTotal = 1330;
  profile.preferences.sizes = ["medium"];
  const input = estimateInputFromProfile(profile, "", null).student;
  const estCtx = await estimateContext(input, { grade: 11 });
  const ids = [WAKE, DAVIDSON, DUKE];
  const estimates = estimateMany(input, ids, estCtx);
  const items = ids.map((unit_id, i) => ({ id: `i${i}`, unit_id, position: i, dream: i === 0, withdrawn_on: null }));
  const ctx = {
    season: "junior_spring",
    items,
    estimates,
    schools: {},
    profile,
    home: { lat: 35.23, lng: -80.84, label: "", place: "Charlotte, NC", zip: null },
    visits: [],
    gradYear: 2028,
    today: "2027-03-01",
    list: { id: "list-1" },
    student: { id: "s1", display_name: "Sam", grad_year: 2028, user_id: "u1" },
    viewer: { userId: "u1", firstName: "Sam", canEdit: true, relation: "self", isGuardian: false },
  } as unknown as Parameters<typeof server.listGuideFor>[0];
  const levels = ids.map((id) => estimates[id]?.group);
  assert.ok(levels.every((l) => l === "reach" || l === "high_reach"), `three Reaches for this record: ${levels.join(", ")}`);
  const data = await server.listGuideFor(ctx, {} as never, { level: null });
  assert.equal(data.freshman, null);
  assert.ok(data.row);
  assert.equal(data.row.total.count, 3);
  assert.equal(data.exploreHref, "/explore?mySAT=1330", "the student's own Fits my scores link");
  {
    assert.equal(data.openGap, "likely_min");
    const open = data.sections.find((s) => s.gap === "likely_min")!;
    assert.ok(open.cards.length > 0 && open.cards.length <= GUIDE_PAGE);
    assert.ok(open.cards.every((c) => c.level === "likely"));
    const target = data.sections.find((s) => s.gap === "target_min");
    assert.ok(target && target.cards.length === 0, "a folded section waits to be opened");
  }
  // A guardian's link never carries the student's score.
  const guardian = await server.listGuideFor({ ...ctx, viewer: { ...ctx.viewer, relation: "guardian", isGuardian: true } }, {} as never, { level: "target" });
  assert.equal(guardian.exploreHref, "/explore");
  // A freshman: no shape, no levels, the chips from the profile.
  const fresh = await server.listGuideFor({ ...ctx, season: "freshman" }, {} as never, { level: null });
  assert.equal(fresh.row, null);
  assert.deepEqual(fresh.sections, []);
  assert.ok(fresh.freshman);
  assert.deepEqual(fresh.freshman.chips.sizes, ["medium"]);
  assert.ok(fresh.freshman.cards.every((c) => c.level === null));
});
