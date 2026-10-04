/**
 * Colors (specs/school-identity/brand.md, Checks; lib/brand-colors.ts): the module's Lua, the three infobox shapes,
 * the join, the derived accent, text color, crest gradient end, and tints, and `applyBrand`'s lineage, overrides, and
 * idempotence. `npm test`. The fixture is 50 real entries of Wikipedia's module (tests/fixtures/brand/).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatasetMeta, School } from "../lib/types";
import type { BrandColorEntry, BrandLogoEntry } from "../lib/identity-files";
import {
  applyBrand,
  colorsForArticle,
  contrast,
  crestEnd,
  deriveBrand,
  findInfobox,
  hexToOklch,
  infoboxColors,
  joinTeam,
  normalizeKey,
  oklchToRgb,
  onAccent,
  overrideProblems,
  parseColorModule,
  parseLua,
  parseOklch,
  pickAccent,
  rgbToOklch,
  TINT_DARK_L,
  TINT_LIGHT_L,
  TINT_MAX_CHROMA,
  MODULE_URL,
} from "../lib/brand-colors.ts";
import { validateSchool } from "../lib/lineage.ts";
import { brandTint, crestBrand } from "../lib/brand.ts";
import { addIdentityMeta, emptyIdentityInputs } from "../lib/identity.ts";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = readFileSync(join(ROOT, "tests", "fixtures", "brand", "college-color-data.lua"), "utf8");
const mod = parseColorModule(FIXTURE);
const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
const UGA = schools.find((s) => s.unit_id === "139959")!;

/* ---------------- The module's Lua ---------------- */

test("the Lua reader handles the module's syntax: keyed and positional fields, comments, escapes, long strings", () => {
  const v = parseLua(`-- a comment
return {
  ["A \\"quoted\\" key"] = {"BA0C2F", 'ffffff', name1="red", n = 3, nested = { true, false, nil }, }, --[[ a long
  comment ]] ["Alias"] = "A \\"quoted\\" key";
  [ [[long key]] ] = [==[a ]] b]==],
}`);
  assert.ok(v && typeof v === "object" && v.kind === "table");
  const entry = v.hash.get('A "quoted" key');
  assert.ok(entry && typeof entry === "object" && entry.kind === "table");
  assert.deepEqual(entry.array, ["BA0C2F", "ffffff"]);
  assert.equal(entry.hash.get("name1"), "red");
  assert.equal(entry.hash.get("n"), 3);
  assert.equal(v.hash.get("Alias"), 'A "quoted" key');
  assert.equal(v.hash.get("long key"), "a ]] b");
  assert.throws(() => parseLua('return { ["x"] = }'), /Lua parse error/);
});

test("module entries: hex colors in brand order, aligned names, and the cited guide", () => {
  assert.equal(mod.entries.size, 50);
  const uga = mod.entries.get("Georgia Bulldogs")!;
  assert.deepEqual(uga.colors, ["#BA0C2F", "#FFFFFF", "#000000"]);
  assert.deepEqual(uga.names, ["red", null, "black"], "the module leaves the white text slot unnamed");
  assert.equal(uga.cite?.kind, "cite manual");
  assert.equal(uga.cite?.title, "University of Georgia Logo Guide");
  assert.match(uga.cite?.url ?? "", /^https:\/\/s3\.us-east-2\.amazonaws\.com\/.*25Georgia_logoguide\.pdf/);
  // An entry with no cite (it notes an eyedropper in a Lua comment), and "{{!}}"/"&#124;" decoded in titles.
  assert.equal(mod.entries.get("Alabama State Hornets")!.cite, null);
  assert.equal(mod.entries.get("Air Force Falcons")!.cite?.title, "Color Palette | Air Force Athletics Style Guide");
  assert.equal(mod.entries.get("Auburn Tigers")!.order, "31");
});

test("alias keys point at their entry", () => {
  assert.equal(mod.aliases.get("UAH Chargers"), "Alabama–Huntsville Chargers");
  assert.equal(mod.aliases.get("Georgia Lady Bulldogs"), "Georgia Bulldogs");
  assert.ok(mod.aliases.size >= 20);
});

/* ---------------- The infobox: three shapes ---------------- */

const lead = (fields: string) => `{{Short description|University}}\n{{Infobox university\n| name = Test U\n${fields}\n}}\nTest U is a university.`;

test("shape 1: {{college color list|team=…}} names the module key", () => {
  const box = findInfobox(lead("| colors = {{college color list|team=Georgia Bulldogs}}"))!;
  assert.deepEqual(infoboxColors(box).keys, ["Georgia Bulldogs"]);
  const r = colorsForArticle(lead("| colors = {{college color list|team=Georgia Bulldogs}}"), mod);
  assert.equal(r.colors?.key, "Georgia Bulldogs");
  assert.equal(r.colors?.via, "key");
  assert.equal(r.colors?.cite_title, "University of Georgia Logo Guide");
  // The positional spelling some articles use.
  assert.equal(colorsForArticle(lead("| colors = Blue and red<br/>{{college color boxes|Samford Bulldogs}}"), mod).colors?.key, "Samford Bulldogs");
});

test("shape 2: the sports nickname's link target is the key or one of its aliases", () => {
  const r = colorsForArticle(lead("| colors = Red and black\n| sports_nickname = [[Georgia Lady Bulldogs|Lady Bulldogs]]"), mod);
  assert.equal(r.colors?.key, "Georgia Bulldogs");
  assert.equal(r.colors?.via, "alias");
  const ath = colorsForArticle(lead("| athletics_nickname = {{nowrap|[[Stanford Cardinal|Cardinal]]}}"), mod);
  assert.equal(ath.colors?.key, "Stanford Cardinal");
  // A typo in the colors template falls through to the nickname link (Troy's article, 2026-10-04).
  const troy = colorsForArticle(lead("| colors = {{college color list|team=Troy Trojan}}\n| sports_nickname = [[Troy Trojans|Trojans]]"), mod);
  assert.equal(troy.colors?.key, "Troy Trojans");
});

test("shape 3: hex color boxes are read when the module has no entry, with names when there is one per color", () => {
  const r = colorsForArticle(lead("| colors = {{color box|#4F2D7F}}&nbsp;{{color box|#818A8F}} Purple & gray <!-- note --><ref>x|y</ref>"), mod);
  assert.deepEqual(r.colors?.colors, ["#4F2D7F", "#818A8F"]);
  assert.deepEqual(r.colors?.names, ["Purple", "gray"]);
  assert.equal(r.colors?.key, null);
  assert.equal(r.colors?.via, "infobox");
  // "black" and "white" beside a hex value are exact; other names are dropped, never guessed.
  const mixed = colorsForArticle(lead("| colors = {{color box|black}}{{color box|#eaaa00}} Black & gold"), mod);
  assert.deepEqual(mixed.colors?.colors, ["#000000", "#EAAA00"]);
  assert.deepEqual(colorsForArticle(lead("| colors = {{color box|purple}}{{color box|#FFD700}} Purple & gold"), mod).colors?.colors, ["#FFD700"]);
});

test("names alone are never turned into colors", () => {
  for (const f of ["| colors = Red and black", "| colors = {{Color box|maroon}} {{Color box|gray}} Maroon and gray", "| colors = {{color box|black}}{{color box|white}}"]) {
    const r = colorsForArticle(lead(f), mod);
    assert.equal(r.colors, null, f);
    assert.equal(r.reason, "color names only");
  }
  assert.equal(colorsForArticle(lead("| colors =\n| sports_nickname = Bears"), mod).reason, "no colors in the infobox");
  assert.equal(colorsForArticle("No infobox here.", mod).reason, "no infobox");
  assert.equal(colorsForArticle(lead("| sports_nickname = [[Nowhere Nobodies|Nobodies]]"), mod).reason, "team not in the module");
});

/* ---------------- The join ---------------- */

test("the join: exact key, then alias key, then normalized key", () => {
  assert.equal(joinTeam(mod, "Stanford Cardinal")?.via, "key");
  assert.equal(joinTeam(mod, "UAH Chargers")?.via, "alias");
  // A hyphen where the key has an en dash, accents, "&", "St.": normalized.
  const hyphen = joinTeam(mod, "Alabama-Huntsville Chargers");
  assert.equal(hyphen?.entry.key, "Alabama–Huntsville Chargers");
  assert.equal(hyphen?.via, "normalized");
  assert.equal(normalizeKey("Ball St. Cardinals"), "ball state cardinals");
  assert.equal(normalizeKey("St. Cloud St. Huskies"), "st cloud state huskies", "a leading St. is Saint");
  assert.equal(normalizeKey("Texas A&M–Commerce Lions"), "texas a and m commerce lions");
  // An athletics article named for both teams reaches the men's key; one sport's article reaches its program.
  assert.equal(joinTeam(mod, "Central Arkansas Bears and Sugar Bears")?.entry.key, "Central Arkansas Bears");
  assert.equal(joinTeam(mod, "Stanford Cardinal football")?.entry.key, "Stanford Cardinal");
  assert.equal(joinTeam(mod, "Duke Blue Devils men's basketball")?.entry.key, "Duke Blue Devils");
  assert.equal(joinTeam(mod, "Nowhere Nobodies"), null);
});

test("a normalized form shared by two entries is ambiguous and joins nothing", () => {
  const two = parseColorModule(`return { ["A–B Owls"] = {"112233"}, ["A-B Owls"] = {"445566"} }`);
  assert.equal(joinTeam(two, "A B Owls"), null);
  assert.equal(joinTeam(two, "A-B Owls")?.via, "key");
});

/* ---------------- Derived fields ---------------- */

test("the accent skips white, black, and gray", () => {
  assert.equal(pickAccent(["#000000", "#FFFFFF", "#CFAE70"]), "#CFAE70", "Vanderbilt: gold");
  assert.equal(pickAccent(["#FFFFFF", "#888B8D", "#003865"]), "#003865", "gray skipped");
  assert.equal(pickAccent(["#BA0C2F", "#FFFFFF", "#000000"]), "#BA0C2F");
  assert.equal(pickAccent(["#000000", "#FFFFFF"]), "#000000", "all neutral: the first color");
});

test("on_accent is black on #FFC72C and white on #002B5C, with at least 4.5:1", () => {
  assert.equal(onAccent("#FFC72C"), "black");
  assert.equal(onAccent("#002B5C"), "white");
  for (const e of mod.entries.values()) {
    for (const c of e.colors) assert.ok(contrast(c, onAccent(c) === "white" ? "#FFFFFF" : "#000000") >= 4.5, c);
  }
});

test("tints stay within L ± 0.02 and chroma ≤ 0.16, inside sRGB, for every color of 50 real entries", () => {
  const colors = [...mod.entries.values()].flatMap((e) => e.colors);
  assert.ok(colors.length >= 140);
  for (const c of colors) {
    const { tint_light, tint_dark } = deriveBrand([c]);
    for (const [css, target] of [
      [tint_light, TINT_LIGHT_L],
      [tint_dark, TINT_DARK_L],
    ] as const) {
      const parsed = parseOklch(css);
      assert.ok(parsed, css);
      assert.ok(parsed.c <= TINT_MAX_CHROMA, `${c} → ${css}: chroma over the cap`);
      // As a browser shows it: clipped into sRGB, then measured again.
      const shown = rgbToOklch(oklchToRgb(parsed).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number]);
      assert.ok(Math.abs(shown.l - target) <= 0.02, `${c} → ${css}: shown at L ${shown.l.toFixed(3)}`);
      assert.ok(shown.c <= TINT_MAX_CHROMA + 0.005, `${c} → ${css}: shown at C ${shown.c.toFixed(3)}`);
    }
  }
});

test("the crest gradient's end keeps the monogram's text at 4.5:1 or more", () => {
  for (const e of mod.entries.values()) {
    const d = deriveBrand(e.colors);
    const text = d.on_accent === "white" ? "#FFFFFF" : "#000000";
    assert.ok(contrast(d.crest_to, text) >= 4.5, `${e.key}: ${d.crest_to}`);
  }
  // Georgia (red, white, black): black is next once white is skipped → a darkened red.
  const uga = deriveBrand(["#BA0C2F", "#FFFFFF", "#000000"]);
  assert.ok(hexToOklch(uga.crest_to).l < hexToOklch("#BA0C2F").l);
  assert.ok(Math.abs(hexToOklch(uga.crest_to).h - hexToOklch("#BA0C2F").h) < 8, "same hue");
  // A readable second brand color is used as it is.
  assert.equal(crestEnd(["#FFC72C", "#FFFFFF", "#E87722"], "#FFC72C", "black"), "#E87722");
});

/* ---------------- applyBrand ---------------- */

const colorsRow = (over: Partial<BrandColorEntry> = {}): BrandColorEntry => ({
  unit_id: UGA.unit_id,
  colors: ["#BA0C2F", "#FFFFFF", "#000000"],
  names: ["red", null, "black"],
  key: "Georgia Bulldogs",
  article: "https://en.wikipedia.org/wiki/University_of_Georgia",
  cite_url: "https://example.org/uga-logo-guide.pdf",
  cite_title: "University of Georgia Logo Guide",
  retrieved: "2026-10-04",
  via: "key",
  ...over,
});
const logoRow: BrandLogoEntry = { unit_id: UGA.unit_id, source_url: "https://www.uga.edu/apple-touch-icon.png", retrieved: "2026-10-04", width: 192, tag: '<link rel="apple-touch-icon" sizes="180x180"> on https://www.uga.edu/' };

test("applyBrand writes colors, derived fields, the mark, and lineage that validates", () => {
  const s = structuredClone(UGA);
  applyBrand(s, { colors: colorsRow(), logo: logoRow, override: undefined });
  assert.deepEqual(s.brand?.colors, ["#BA0C2F", "#FFFFFF", "#000000"]);
  assert.equal(s.brand?.accent, "#BA0C2F");
  assert.equal(s.brand?.on_accent, "white");
  assert.match(s.brand?.tint_light ?? "", /^oklch\(0\.72 0\.16 2\d(\.\d)?\)$/);
  assert.deepEqual(s.brand?.logo, { source_url: logoRow.source_url, retrieved: "2026-10-04", width: 192 });
  // The module key and the cited guide name the colors; the icon's URL and its tag name the mark.
  assert.deepEqual(s.lineage?.["brand.colors"], { source: "wikipedia", method: "reported", url: "https://example.org/uga-logo-guide.pdf", field: "Georgia Bulldogs", retrieved: "2026-10-04", quote: "University of Georgia Logo Guide" });
  assert.equal(s.lineage?.["brand.logo"]?.source, "college-site");
  assert.equal(s.lineage?.["brand.logo"]?.method, "extracted");
  assert.equal(s.lineage?.["brand.logo"]?.year, "2026");
  assert.deepEqual(validateSchool(s, meta), []);
  // Uncited module colors cite the module; infobox colors cite the article.
  const bare = structuredClone(UGA);
  applyBrand(bare, { colors: colorsRow({ cite_url: null, cite_title: null }), logo: undefined, override: undefined });
  assert.equal(bare.lineage?.["brand.colors"]?.url, MODULE_URL);
  const box = structuredClone(UGA);
  applyBrand(box, { colors: colorsRow({ key: null, via: "infobox", cite_url: null, cite_title: null, quote: "{{color box|#BA0C2F}}" }), logo: undefined, override: undefined });
  assert.equal(box.lineage?.["brand.colors"]?.url, "https://en.wikipedia.org/wiki/University_of_Georgia");
  assert.deepEqual(validateSchool(box, meta), []);
});

test("applyBrand is idempotent and clears its own values first; nothing left means no brand key", () => {
  const s = structuredClone(UGA);
  const inputs = { colors: colorsRow(), logo: logoRow, override: undefined };
  applyBrand(s, inputs);
  const once = structuredClone(s);
  applyBrand(s, inputs);
  assert.deepEqual(s, once);
  applyBrand(s, { colors: undefined, logo: undefined, override: undefined });
  assert.equal("brand" in s, false);
  assert.ok(!Object.keys(s.lineage ?? {}).some((k) => k.startsWith("brand")));
  assert.deepEqual(s, UGA, "back to the school it was");
});

test("overrides: logo false removes the mark; corrected colors carry their lineage; a correction without a source is refused", () => {
  const s = structuredClone(UGA);
  applyBrand(s, { colors: colorsRow(), logo: logoRow, override: { logo: false } });
  assert.equal(s.brand?.logo, null);
  assert.equal(s.lineage?.["brand.logo"], undefined);
  const guide = { source: "college-site" as const, url: "https://brand.uga.edu/colors/", year: "2026", retrieved: "2026-10-04" };
  applyBrand(s, { colors: colorsRow(), logo: undefined, override: { colors: ["#ba0c2f", "#000000"], names: ["Bulldog red", "Arch black"], _lineage: guide } });
  assert.deepEqual(s.brand?.colors, ["#BA0C2F", "#000000"]);
  assert.deepEqual(s.lineage?.["brand.colors"], guide);
  assert.deepEqual(s.lineage?.["brand.names"], guide);
  assert.deepEqual(validateSchool(s, meta), []);
  assert.throws(() => applyBrand(structuredClone(UGA), { colors: undefined, logo: undefined, override: { colors: ["#BA0C2F"] } }), /_lineage/);
  assert.deepEqual(overrideProblems("1", { logo: false }), []);
  assert.equal(overrideProblems("1", { colors: ["red"], _lineage: guide }).length, 1);
});

test("crestBrand: gradient from the accent to the stored end, the text color, and the mark unless BRAND_MARKS=off", () => {
  const s = structuredClone(UGA);
  assert.equal(crestBrand(s), undefined, "no brand: the generated tile");
  applyBrand(s, { colors: colorsRow(), logo: logoRow, override: undefined });
  const c = crestBrand(s)!;
  assert.deepEqual(c.gradient, [s.brand!.accent, s.brand!.crest_to]);
  assert.equal(c.text, "white");
  assert.equal(c.logo, "/brand/139959.webp");
  const before = process.env.BRAND_MARKS;
  try {
    process.env.BRAND_MARKS = "off";
    assert.equal(crestBrand(s)!.logo, null);
    assert.deepEqual(crestBrand(s)!.gradient, c.gradient, "colors stay");
  } finally {
    if (before === undefined) delete process.env.BRAND_MARKS;
    else process.env.BRAND_MARKS = before;
  }
  // Tints carry the surface's alpha; without colors, the hashed hue in both themes.
  assert.match(brandTint(s, 0.35).dark, /^oklch\(0\.62 [\d.]+ [\d.]+ \/ 0\.35\)$/);
  const plain = brandTint(UGA, 0.35);
  assert.equal(plain.light, plain.dark);
});

test("the wikipedia source is dated by the newest color retrieval", () => {
  const m = structuredClone(meta);
  const inputs = emptyIdentityInputs();
  inputs.brandColors.set(UGA.unit_id, colorsRow({ retrieved: "2026-10-02" }));
  inputs.brandColors.set("221999", colorsRow({ unit_id: "221999", retrieved: "2026-10-04" }));
  addIdentityMeta(m, inputs);
  assert.equal(m.sources.wikipedia?.edition, "Retrieved 2026-10-04");
});
