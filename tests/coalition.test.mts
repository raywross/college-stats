/**
 * The Coalition application (specs/data-expansion/coalition-app.md): the two parsers on saved excerpts, every join
 * rule and the never-a-guess rule, the block set and removed with its place kept, the source and vintage from the
 * file's dates, the sentence, and the committed data's shape. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { coalitionSentence, type CoalitionFile } from "../lib/coalition.ts";
import { FIELDS } from "../lib/fields.ts";
import type { DatasetMeta, School } from "../lib/types.ts";
import { baseDomain, buildJoinIndex, joinName, mappedIds } from "../scripts/lib/coalition/join.mts";
import { addCoalitionMeta, applyCoalition, coalitionSource, coalitionVintage } from "../scripts/lib/coalition/merge.mts";
import { parseAsOf, parseMemberPage, parseScoirPage } from "../scripts/lib/coalition/parse.mts";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "tests", "fixtures", "coalition");

test("parseMemberPage: each summary item's name and admissions link, entities decoded", () => {
  const members = parseMemberPage(readFileSync(join(FIX, "member-page.html"), "utf8"));
  assert.deepEqual(
    members.map((m) => m.name),
    ["Allegheny College", "Amherst College", "Yale University"],
  );
  assert.equal(members[0].admissions_url, "https://sites.allegheny.edu/admissions/");
  assert.deepEqual(parseMemberPage('<div class="summary-title"><a href="mailto:x" class="summary-title-link">A &amp; B College</a></div>'), [{ name: "A & B College", admissions_url: null }]);
  assert.deepEqual(parseMemberPage("<p>nothing</p>"), []);
});

test("parseScoirPage: every column paragraph of the list, in page order, and the As of date", () => {
  const page = parseScoirPage(readFileSync(join(FIX, "scoir-page.html"), "utf8"));
  assert.equal(page.as_of, "2026-10-20");
  assert.equal(page.names.length, 18, "two columns of nine");
  assert.equal(page.names[0], "Allegheny College");
  assert.equal(page.names[9], "Pace University (New York City)");
  assert.equal(page.names.at(-1), "York College of Pennsylvania");
  assert.ok(!page.names.includes("Footer") && !page.names.includes("As of October 20, 2026"), "short paragraphs are not columns");
  assert.equal(parseAsOf("As of Sextember 1, 2026"), null);
  assert.equal(parseAsOf("nothing dated"), null);
});

/* ---- Joining ---- */
const colleges = [
  { unit_id: "1", name: "Allegheny College", website: "https://allegheny.edu/" },
  { unit_id: "7", name: "Wheaton College", website: "https://www.wheaton.edu/" },
  { unit_id: "8", name: "Wheaton College (Massachusetts)", website: "https://wheatoncollege.edu/" },
  { unit_id: "2", name: "University of Michigan-Ann Arbor", website: "https://umich.edu/" },
  { unit_id: "3", name: "University at Buffalo", website: "https://www.buffalo.edu/" },
  { unit_id: "4", name: "Pace University-New York", website: "https://www.pace.edu/" },
  { unit_id: "5", name: "Pace University-Pleasantville", website: "https://www.pace.edu/" },
  { unit_id: "6", name: "Yale University", website: "https://www.yale.edu/" },
];
const aliases = [
  { unit_id: "3", alias: "SUNY Buffalo", key: "sunybuffalo", source: "curated" as const, weight: 4 },
  { unit_id: "4", alias: "Pace", key: "pace", source: "curated" as const, weight: 4 },
  { unit_id: "5", alias: "Pace", key: "pace", source: "curated" as const, weight: 4 },
];
const index = buildJoinIndex(colleges, aliases, { "Pace University (New York City)": "4", "Twin College": ["4", "5"] });

test("joinName: the admissions domain first, then the name, the normalized name, an alias key, the hand map; never a guess", () => {
  assert.deepEqual(joinName(index, "Allegheny College", null), { unit_id: "1", join: "name", tried: [] });
  assert.deepEqual(joinName(index, "University of Michigan - Ann Arbor", null), { unit_id: "2", join: "normalized", tried: ["name"] });
  assert.deepEqual(joinName(index, "SUNY Buffalo", null), { unit_id: "3", join: "alias", tried: ["name", "normalized"] });
  // Two colleges share the domain pace.edu and the alias key "pace": no single answer; the hand map decides.
  assert.deepEqual(joinName(index, "Pace University (New York City)", "https://www.pace.edu/admissions"), { unit_id: "4", join: "name-map", tried: ["domain", "name", "normalized", "alias"] });
  assert.deepEqual(joinName(index, "Yale", "https://admissions.yale.edu/apply"), { unit_id: "6", join: "domain", tried: [] });
  // The Coalition's "Wheaton College" links the Massachusetts college's site; the exact name is Illinois's. The link wins.
  assert.deepEqual(joinName(index, "Wheaton College", "https://wheatoncollege.edu/admission/"), { unit_id: "8", join: "domain", tried: [] });
  assert.deepEqual(joinName(index, "Wheaton College", null), { unit_id: "7", join: "name", tried: [] });
  assert.deepEqual(joinName(index, "Yale University of the North", null), { unit_id: null, join: null, tried: ["name", "normalized", "alias", "name-map"] });
  // A hand-map entry with two ids is no single answer here (the sync expands it); one naming a college the site
  // doesn't carry is ignored, not trusted.
  assert.equal(joinName(index, "Twin College", null).unit_id, null);
  assert.deepEqual(mappedIds(index, "Twin College"), ["4", "5"]);
  const stale = buildJoinIndex(colleges, aliases, { "Gone College": "999" });
  assert.equal(joinName(stale, "Gone College", null).unit_id, null);
  assert.deepEqual(mappedIds(stale, "Gone College"), []);
});

test("baseDomain: the registrable part, with two-letter country codes", () => {
  assert.equal(baseDomain("https://admissions.vanderbilt.edu/apply"), "vanderbilt.edu");
  assert.equal(baseDomain("https://www.aber.ac.uk/en"), "aber.ac.uk");
  assert.equal(baseDomain("not a url"), null);
});

/* ---- The block and the meta ---- */
function file(overrides: Partial<CoalitionFile> = {}): CoalitionFile {
  return {
    retrieved: "2026-10-28",
    member_url: "https://www.coalitionforcollegeaccess.org/our-members",
    scoir_url: "https://www.scoir.com/apply-colleges",
    members: [
      { name: "Allegheny College", admissions_url: null, unit_id: "1", join: "name", via_scoir: true },
      { name: "Yale University", admissions_url: null, unit_id: "6", join: "name", via_scoir: false },
      { name: "Nowhere College", admissions_url: null, unit_id: null, join: null, via_scoir: false },
    ],
    scoir: { as_of: "2026-10-20", names: [{ name: "Allegheny College", unit_id: "1", join: "name" }], not_members: [] },
    unmatched: [{ name: "Nowhere College", list: "coalition", tried: ["name", "normalized", "alias", "domain", "name-map"] }],
    ...overrides,
  };
}
const school = (unit_id: string, extra: Record<string, unknown> = {}): School => ({ unit_id, name: `School ${unit_id}`, ...extra, lineage: {}, trends: {} }) as unknown as School;

test("applyCoalition: the block on each joined member, placed before the record's later keys; removed from a college that left", () => {
  const was = school("2", { coalition: { member: true, via_scoir: true, retrieved: "2026-01-01" } });
  const { schools, summary } = applyCoalition([school("1"), was, school("6")], file());
  assert.deepEqual(schools[0].coalition, { member: true, via_scoir: true, retrieved: "2026-10-28" });
  assert.deepEqual(Object.keys(schools[0]), ["unit_id", "name", "coalition", "lineage", "trends"], "before the later keys");
  assert.equal(schools[1].coalition, undefined, "2 left the list");
  assert.ok(!("coalition" in schools[1]));
  assert.deepEqual(schools[2].coalition, { member: true, via_scoir: false, retrieved: "2026-10-28" });
  assert.deepEqual(summary, { members: 2, viaScoir: 1, removed: 1, unjoined: 1 });
});

test("the source and the vintage come from the file's dates, never typed", () => {
  assert.equal(coalitionVintage(file()), "Member list read October 28, 2026");
  const src = coalitionSource(file());
  assert.equal(src.edition, "Member list read October 28, 2026; Scoir's list as of October 20, 2026");
  assert.equal(src.url, "https://www.coalitionforcollegeaccess.org");
  assert.equal(coalitionSource(file({ scoir: { as_of: null, names: [], not_members: [] } })).edition, "Member list read October 28, 2026");
  const meta = { sources: {}, vintages: {} } as unknown as DatasetMeta;
  addCoalitionMeta(meta, file({ retrieved: "2027-09-02" }));
  assert.equal(meta.vintages["coalition-members"], "Member list read September 2, 2027");
  assert.equal(meta.sources.coalition?.label, "Coalition for College");
});

test("coalitionSentence: only for a college on Scoir's list; 'Also' beside the Common App card", () => {
  const via = { member: true as const, via_scoir: true, retrieved: "2026-10-28" };
  assert.equal(coalitionSentence({ coalition: via }), "Takes the Coalition application, through Scoir.");
  assert.equal(coalitionSentence({ coalition: via, apply: { common_app: { member: true }, deadlines: { regular: "2027-01-01" } } as unknown as School["apply"] }), "Also takes the Coalition application, through Scoir.");
  // A member with no grid row has no card, so the line stands alone and says "Takes".
  assert.equal(coalitionSentence({ coalition: via, apply: { common_app: { member: true }, deadlines: null } as unknown as School["apply"] }), "Takes the Coalition application, through Scoir.");
  assert.equal(coalitionSentence({ coalition: { ...via, via_scoir: false } }), null);
  assert.equal(coalitionSentence({}), null);
});

test("the registry carries both fields as present-only Coalition facts", () => {
  assert.equal(FIELDS["coalition.member"].source, "coalition");
  assert.equal(FIELDS["coalition.via_scoir"].vintage, "coalition-members");
});

test("the committed data: every block is a member, Scoir's are a subset, and the meta names the file's dates", () => {
  const schools: School[] = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8"));
  const meta: DatasetMeta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8"));
  const data: CoalitionFile = JSON.parse(readFileSync(join(ROOT, "data", "coalition", "members.json"), "utf8"));
  const joined = new Set(data.members.filter((m) => m.unit_id).map((m) => m.unit_id));
  const withBlock = schools.filter((s) => s.coalition);
  assert.equal(withBlock.length, joined.size);
  for (const s of withBlock) {
    assert.ok(joined.has(s.unit_id), `${s.unit_id} has a block but isn't on the list`);
    assert.equal(s.coalition!.member, true);
    assert.equal(s.coalition!.retrieved, data.retrieved);
  }
  assert.ok(withBlock.filter((s) => s.coalition!.via_scoir).length >= 50, "most members take the form through Scoir");
  assert.equal(meta.vintages["coalition-members"], coalitionVintage(data));
  assert.equal(meta.sources.coalition?.edition, coalitionSource(data).edition);
  assert.ok(data.unmatched.length <= data.members.length / 10, `unmatched: ${data.unmatched.map((u) => u.name).join(", ")}`);
});
