/**
 * The major picker's search (lib/majors-search.ts; specs/planner/record/majors.md): the common chips, name and alias
 * matches in their order, the alias shown as `via`, exclusion of picked families, the cap, and an alias table that only
 * names real families. Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAJOR_ALIASES, POPULAR_MAJORS, searchMajors } from "../lib/majors-search.ts";
import { isMajorFamily, MAJOR_FAMILIES } from "../lib/majors.ts";

test("every alias is lower-case and resolves to real families", () => {
  for (const [alias, families] of Object.entries(MAJOR_ALIASES)) {
    assert.equal(alias, alias.toLowerCase(), alias);
    assert.equal(alias, alias.trim(), alias);
    assert.ok(families.length > 0, alias);
    for (const f of families) assert.ok(isMajorFamily(f), `${alias} → ${f}`);
  }
});

test("the spec's aliases map where majors.md says", () => {
  const want: Record<string, string[]> = {
    "pre-med": ["Biology", "Health professions"],
    premed: ["Biology", "Health professions"],
    medicine: ["Biology", "Health professions"],
    nursing: ["Health professions"],
    cs: ["Computer science"],
    coding: ["Computer science"],
    software: ["Computer science"],
    finance: ["Business"],
    accounting: ["Business"],
    marketing: ["Business"],
    "pre-law": ["Law and legal studies", "Social sciences"],
    physics: ["Physical sciences"],
    chemistry: ["Physical sciences"],
    art: ["Visual and performing arts"],
    music: ["Visual and performing arts"],
    theater: ["Visual and performing arts"],
    film: ["Visual and performing arts"],
    econ: ["Social sciences"],
    economics: ["Social sciences"],
    "political science": ["Social sciences"],
    "poli sci": ["Social sciences"],
    sociology: ["Social sciences"],
    kinesiology: ["Parks, recreation, and kinesiology"],
    "sports medicine": ["Parks, recreation, and kinesiology"],
    architecture: ["Architecture"],
    "data science": ["Math and statistics"],
    statistics: ["Math and statistics"],
    environmental: ["Natural resources"],
    journalism: ["Communication and journalism"],
    teaching: ["Education"],
    "criminal justice": ["Criminal justice and protective services"],
    nutrition: ["Family and consumer sciences"],
  };
  for (const [alias, names] of Object.entries(want)) {
    assert.deepEqual(MAJOR_ALIASES[alias]?.map((f) => MAJOR_FAMILIES[f]).sort(), [...names].sort(), alias);
  }
});

test("POPULAR_MAJORS: the eight common families, in majors.md's order; an empty query offers them", () => {
  assert.deepEqual(
    POPULAR_MAJORS.map((f) => MAJOR_FAMILIES[f]),
    ["Business", "Engineering", "Biology", "Computer science", "Psychology", "Health professions", "Visual and performing arts", "Social sciences"],
  );
  assert.deepEqual(
    searchMajors("", [], 8).map((m) => m.family),
    [...POPULAR_MAJORS],
  );
  assert.deepEqual(
    searchMajors("  ", ["52", "14"], 3).map((m) => m.name),
    ["Biology", "Computer science", "Psychology"],
    "a picked one leaves the row; the next fills in",
  );
  assert.ok(searchMajors("", []).every((m) => m.via === null));
});

test("name matches: a prefix, case and punctuation ignored", () => {
  assert.deepEqual(searchMajors("Bus", [])[0], { family: "52", name: "Business", via: null });
  assert.deepEqual(searchMajors("comp", [])[0], { family: "11", name: "Computer science", via: null });
  assert.equal(searchMajors("engineering", [])[0].name, "Engineering", "the exact family before Engineering technologies");
  assert.equal(searchMajors("ENGLISH", [])[0].name, "English");
});

test("alias matches carry the alias as `via`: nursing, pre-med, CS, finance", () => {
  assert.deepEqual(searchMajors("nursing", []), [{ family: "51", name: "Health professions", via: "nursing" }]);
  const premed = searchMajors("Pre-Med", []);
  assert.deepEqual(
    premed.map((m) => [m.name, m.via]),
    [
      ["Biology", "pre-med"],
      ["Health professions", "pre-med"],
    ],
  );
  assert.deepEqual(searchMajors("cs", [])[0], { family: "11", name: "Computer science", via: "cs" });
  assert.deepEqual(searchMajors("finance", [])[0], { family: "52", name: "Business", via: "finance" });
  assert.deepEqual(searchMajors("poli sci", [])[0], { family: "45", name: "Social sciences", via: "poli sci" });
});

test("order: name-prefix matches, then alias matches, then names that contain the query", () => {
  // "art": Area, ethnic… doesn't start with it; the alias "art" names Visual and performing arts; names containing
  // "art" (Liberal arts…, Visual and performing arts) come after.
  const art = searchMajors("art", [], 10);
  assert.equal(art[0].name, "Visual and performing arts");
  assert.equal(art[0].via, "art");
  assert.ok(art.some((m) => m.name === "Liberal arts and general studies" && m.via === null));
  assert.ok(art.findIndex((m) => m.name === "Liberal arts and general studies") > 0);
  // "science": Science technologies starts with it; "data science" and other aliases next; then the names containing it.
  const sci = searchMajors("science", [], 20);
  assert.deepEqual(sci[0], { family: "41", name: "Science technologies", via: null });
  const firstAlias = sci.findIndex((m) => m.via !== null);
  const lastAlias = sci.map((m) => m.via !== null).lastIndexOf(true);
  assert.ok(firstAlias > 0 && lastAlias < sci.length - 1);
  assert.ok(sci.slice(0, firstAlias).every((m) => m.name.toLowerCase().startsWith("science")), "name-prefix matches first");
  assert.ok(sci.slice(firstAlias, lastAlias + 1).every((m) => m.via !== null), "then the alias matches, together");
  assert.ok(sci.slice(lastAlias + 1).every((m) => m.via === null && !m.name.toLowerCase().startsWith("science")), "then the names that contain it");
  assert.ok(sci.slice(lastAlias + 1).some((m) => m.name === "Computer science"));
  // A name-prefix match beats an alias for the same family: "architecture" is both.
  assert.deepEqual(searchMajors("architecture", [])[0], { family: "04", name: "Architecture", via: null });
  // Name-prefix before alias: "psych" starts Psychology's name (and is an alias too).
  assert.deepEqual(searchMajors("psych", [])[0], { family: "42", name: "Psychology", via: null });
});

test("picked families never come back, and results stop at the limit", () => {
  assert.deepEqual(searchMajors("pre-med", ["26"]).map((m) => m.name), ["Health professions"]);
  assert.equal(searchMajors("nursing", ["51"]).length, 0);
  assert.equal(searchMajors("s", []).length, 6, "the default cap is six");
  assert.equal(searchMajors("s", [], 3).length, 3);
  const all = searchMajors("s", [], 100).map((m) => m.family);
  assert.equal(new Set(all).size, all.length, "one row per family");
});

test("nothing matches: an empty list", () => {
  assert.deepEqual(searchMajors("zzzz", []), []);
});

test("a short query matches aliases and names by word, never by a bare substring ('cs' is not 'economics')", async () => {
  const { searchMajors } = await import("../lib/majors-search.ts");
  const families = searchMajors("cs", []).map((m) => m.family);
  assert.deepEqual(families, ["11"], "Computer science only");
  // A longer query may still match inside a name ("stat" → Math and statistics).
  assert.ok(searchMajors("stat", []).some((m) => m.family === "27"));
});
