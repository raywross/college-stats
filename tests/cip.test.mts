/**
 * The CIP 2020 reference table (data/reference/cip2020.json, `npm run build-cip`) and its helpers (lib/cip.ts), which
 * majors (specs/data-expansion/majors.md) and field-of-study earnings use. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CIP_SOURCE,
  cip4,
  cip4Title,
  cipCodes,
  cipFamily,
  cipFamilyTitle,
  cipLevel,
  cipTitle,
  fromCip2010,
  hasCip,
  hasCip4,
  isCipField,
  normalizeCip,
} from "../lib/cip.ts";

const ROOT = join(import.meta.dirname, "..");
const RAW = readFileSync(join(ROOT, "data", "reference", "cip2020.json"), "utf8");
const TABLE = JSON.parse(RAW) as { titles: Record<string, string>; moved_from_2010: Record<string, string>; url: string; retrieved: string };

test("normalizeCip reads every spelling IPEDS and Scorecard use", () => {
  const cases: [string | number, string | null][] = [
    ["11.0701", "11.0701"],
    ['"11.0701"', "11.0701"],
    ['="01.0101"', "01.0101"],
    ["1.0101", "01.0101"], // a spreadsheet dropped the leading zero
    ["110701", "11.0701"],
    ["10701", "01.0701"],
    ["1107", "11.07"], // Scorecard field of study (4-digit)
    ["107", "01.07"],
    ["11.07", "11.07"],
    ["11.7", "11.70"], // a number lost its trailing zero
    ["11.070", "11.0700"],
    ["11", "11"],
    ["1", "01"],
    [" 52.0201 ", "52.0201"],
    [11.07, "11.07"],
    ["99", "99"],
    ["", null],
    ["11.07.01", null],
    ["abc", null],
    ["1234567", null],
  ];
  for (const [input, want] of cases) assert.equal(normalizeCip(input), want, String(input));
  assert.equal(normalizeCip(null), null);
  assert.equal(normalizeCip(undefined), null);
});

test("levels, families, and 4-digit groups", () => {
  assert.equal(cipLevel("11"), 2);
  assert.equal(cipLevel("1107"), 4);
  assert.equal(cipLevel("11.0701"), 6);
  assert.equal(cipLevel("x"), null);
  assert.equal(cipFamily("11.0701"), "11");
  assert.equal(cipFamily("107"), "01");
  assert.equal(cip4("11.0701"), "11.07");
  assert.equal(cip4("110701"), "11.07");
  assert.equal(cip4("1107"), "11.07");
  assert.equal(cip4("11"), null, "a family has no 4-digit group");
});

test("titles at every level, including the 4-digit groups field-of-study earnings use", () => {
  assert.equal(cipTitle("11.0701"), "Computer Science");
  assert.equal(cipTitle("51.38"), "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing");
  assert.equal(cip4Title("5138"), cipTitle("51.38"));
  assert.equal(cip4Title("51.3801"), cipTitle("51.38"));
  assert.equal(cipTitle("52"), "Business, Management, Marketing, and Related Support Services", "family titles are title-cased");
  assert.equal(cipFamilyTitle("52.0201"), cipTitle("52"));
  assert.equal(cipTitle("30.7001"), "Data Science, General", "new in CIP 2020");
  assert.ok(hasCip4("1107") && hasCip4("11.0701") && hasCip4("30.70"));
  assert.ok(!hasCip4("11.98"), "no such group");
  assert.ok(!hasCip4("11"));
  assert.equal(cipTitle("11.9998"), null);
  assert.ok(!hasCip("99"));
  assert.ok(!isCipField("99"), "IPEDS's total row isn't a field");
  assert.ok(isCipField("11.0701"));
});

test("codes CIP 2020 moved or deleted aren't titles; the crosswalk maps them (some across families)", () => {
  // Viticulture moved from 01.0309 (CIP 2010) to 01.1004.
  assert.ok(!hasCip("01.0309"));
  assert.equal(fromCip2010("01.0309"), "01.1004");
  // Veterinary programs moved from health professions (51) to agriculture (01).
  assert.equal(fromCip2010("51.2401"), "01.8001");
  assert.equal(fromCip2010("11.0701"), "11.0701", "unchanged codes keep their number");
  for (const [from, to] of Object.entries(TABLE.moved_from_2010)) {
    assert.ok(hasCip(to), `${from} moves to ${to}, a CIP 2020 code`);
    assert.equal(normalizeCip(from), from);
  }
});

test("the reference table is complete and well formed", () => {
  assert.equal(cipCodes(2).length, 50);
  assert.equal(cipCodes(4).length, 464);
  assert.equal(cipCodes(6).length, 2173);
  for (const code of Object.keys(TABLE.titles)) {
    assert.equal(normalizeCip(code), code, `${code} is canonical`);
    assert.ok(TABLE.titles[code].trim() && !TABLE.titles[code].endsWith("."), `${code} has a clean title`);
    // Every program's group and family exist.
    if (code.length >= 5) assert.ok(hasCip(code.slice(0, 5)), `${code}'s group`);
    assert.ok(hasCip(code.slice(0, 2)), `${code}'s family`);
  }
  // Sorted, one entry per line, so a CIP revision reads as a small diff.
  const keys = [...RAW.slice(RAW.indexOf("\"titles\""), RAW.indexOf("\"moved_from_2010\"")).matchAll(/^ {4}"([\d.]+)":/gm)].map((m) => m[1]);
  assert.equal(keys.length, Object.keys(TABLE.titles).length);
  assert.deepEqual(keys, [...keys].sort());
  assert.match(RAW, /\n {4}"11\.0701": "Computer Science",\n/);
  assert.equal(CIP_SOURCE.url, TABLE.url);
  assert.match(CIP_SOURCE.retrieved, /^\d{4}-\d{2}-\d{2}$/);
});
