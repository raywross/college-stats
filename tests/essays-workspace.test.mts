/**
 * The essay workspace's pure parts (specs/product/essays/workspace.md; the Essays build brief "U3 Workspace core"):
 * prompt references and their resolution (a missing prompt is "not on file", never a crash), the picker's groups,
 * reuse and the college-name check, the list's grouping (the main essay first), the version rule, and the wiring
 * guards: the capability, the summer move's button, the apply card's link, telemetry without text, and the public
 * Data API reading none of the tables. Each guard is shown failing when its rule is broken. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  asPlatformPrompts,
  collegeRef,
  essaysOf,
  FREE_REF,
  MAIN_LIMIT,
  MAIN_REF,
  parsePromptRef,
  pickerGroups,
  refUnitId,
  resolvePrompt,
  type PromptLookup,
} from "../lib/essays/prompts.ts";
import { baseChangedSince, nameForms, nameWarning, otherCollegesNamed, reuseChoices, suggestedMode } from "../lib/essays/variants.ts";
import { essaysHref, essaysListRedirect, groupEssays, isMainEssay, refsOf, shouldVersion, VERSION_PAUSE_MS, type EssayLinkRow, type EssayRow } from "../lib/essays/rows.ts";
import { CAPABILITIES } from "../lib/entitlements.ts";
import { EVENTS } from "../lib/analytics.ts";
import { cycleTask } from "../lib/planner/generators/cycle.ts";
import { guideFor } from "../lib/planner/guides.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const DUKE = "198419";
const WAKE = "199847";
const MICH = "170976";
const MSU = "171100";

const prompt = (id: string, kind: string, text: string, limit: unknown, required = true) => ({ id, text, kind, limit, required, applies_to: "all", quote: `${text.slice(0, 20)} (${required ? "required" : "optional"})` });

const SCHOOLS: Record<string, { unit_id: string; name: string; essays?: unknown }> = {
  [DUKE]: {
    unit_id: DUKE,
    name: "Duke University",
    essays: {
      cycle: "2026-27",
      status: "published",
      source_url: "https://admissions.duke.edu/essays",
      retrieved: "2026-09-01",
      prompts: [prompt(`${DUKE}:2026-27:1`, "why_us", "What is it about Duke that appeals to you?", { kind: "words", max: 250 }), prompt(`${DUKE}:2026-27:2`, "optional", "Tell us about a community you belong to.", { kind: "words", max: 250 }, false)],
    },
  },
  [WAKE]: {
    unit_id: WAKE,
    name: "Wake Forest University",
    essays: { cycle: "2026-27", status: "published", source_url: "https://admissions.wfu.edu/essays", retrieved: "2026-09-02", prompts: [prompt(`${WAKE}:2026-27:1`, "why_us", "Why Wake Forest?", { kind: "words", max: 150 })] },
  },
  [MICH]: { unit_id: MICH, name: "University of Michigan-Ann Arbor", essays: { cycle: "2026-27", status: "none", source_url: "https://umich.edu", retrieved: "2026-09-03", prompts: [] } },
  [MSU]: { unit_id: MSU, name: "Michigan State University" },
};

const PLATFORM = asPlatformPrompts({
  common_app: { cycle: "2026-27", source_url: "https://www.commonapp.org", retrieved: "2026-08-01", prompts: [1, 2, 3, 4, 5, 6, 7].map((n) => prompt(`platform:common_app:${n}`, "essay", `Common App prompt number ${n}, verbatim.`, { kind: "words", max: 650, min: 250 })) },
  coalition: { cycle: "2026-27", source_url: "https://www.coalitionforcollegeaccess.org", retrieved: "2026-08-01", prompts: [prompt("platform:coalition:1", "essay", "Tell a story from your life.", { kind: "words", max: 650 })] },
});

const lookup = (platform = PLATFORM): PromptLookup => ({ school: (id) => SCHOOLS[id] ?? null, platform });
const PLAN = [SCHOOLS[DUKE], SCHOOLS[WAKE], SCHOOLS[MICH], SCHOOLS[MSU]].map((s) => ({ unit_id: s.unit_id, name: s.name }));

/* ------------------------------------------------------------------ */
/* Prompt references                                                   */
/* ------------------------------------------------------------------ */

test("parsePromptRef accepts the four shapes and nothing else", () => {
  assert.deepEqual(parsePromptRef(MAIN_REF), { kind: "main" });
  assert.deepEqual(parsePromptRef(FREE_REF), { kind: "free" });
  assert.deepEqual(parsePromptRef("platform:coalition:3"), { kind: "coalition", n: 3 });
  assert.deepEqual(parsePromptRef(`college:${DUKE}:2026-27:2`), { kind: "college", unitId: DUKE, cycle: "2026-27", n: 2, promptId: `${DUKE}:2026-27:2` });
  for (const bad of ["", "platform:common_app:1", "college:duke:2026-27:1", `college:${DUKE}:2026-27:0`, "platform:coalition:x", null, 7, "x".repeat(300)]) {
    assert.equal(parsePromptRef(bad), null, String(bad));
  }
  assert.equal(collegeRef(`${DUKE}:2026-27:1`), `college:${DUKE}:2026-27:1`);
  assert.equal(refUnitId(`college:${DUKE}:2026-27:1`), DUKE);
  assert.equal(refUnitId(MAIN_REF), null);
});

test("the main essay resolves with the Common App's limits, and its seven prompts when the reference file is there", () => {
  const main = resolvePrompt(MAIN_REF, lookup());
  assert.equal(main.found, true);
  assert.deepEqual(main.limit, MAIN_LIMIT);
  assert.deepEqual(MAIN_LIMIT, { kind: "words", max: 650, min: 250 });
  assert.equal(main.options.length, 7);
  assert.equal(main.kind, "personal");
  assert.equal(main.source?.url, "https://www.commonapp.org");
  const bare = resolvePrompt(MAIN_REF, lookup(null));
  assert.equal(bare.found, true, "the main essay works without the reference file");
  assert.deepEqual(bare.options, []);
  assert.deepEqual(bare.limit, MAIN_LIMIT);
});

test("a college prompt resolves to its text, limit, college, kind, page, and quote", () => {
  const p = resolvePrompt(`college:${DUKE}:2026-27:1`, lookup());
  assert.equal(p.found, true);
  assert.equal(p.text, "What is it about Duke that appeals to you?");
  assert.deepEqual(p.limit, { kind: "words", max: 250 });
  assert.deepEqual(p.college, { unit_id: DUKE, name: "Duke University" });
  assert.equal(p.kind, "why_us");
  assert.equal(p.title, "Why us");
  assert.deepEqual(p.source, { url: "https://admissions.duke.edu/essays", retrieved: "2026-09-01", cycle: "2026-27" });
  assert.ok(p.quote);
  const opt = resolvePrompt(`college:${DUKE}:2026-27:2`, lookup());
  assert.equal(opt.required, false);
});

test("a missing prompt is 'Prompt not on file', never a crash", () => {
  const cases = [
    `college:${DUKE}:2026-27:9`, // gone from the page
    `college:${DUKE}:2025-26:1`, // last cycle's
    `college:${MSU}:2026-27:1`, // a college with no block
    "college:999999:2026-27:1", // not in the dataset
    `college:${MICH}:2026-27:1`, // status none
    "platform:coalition:4",
    "nonsense",
  ];
  for (const ref of cases) {
    const p = resolvePrompt(ref, lookup());
    assert.equal(p.found, false, ref);
    assert.equal(p.title, "Prompt not on file", ref);
  }
  assert.deepEqual(resolvePrompt(`college:${MSU}:2026-27:1`, lookup()).college, { unit_id: MSU, name: "Michigan State University" }, "the college is still named");
  assert.equal(resolvePrompt("platform:coalition:1", lookup(null)).found, false, "no reference file");
  assert.equal(resolvePrompt("platform:coalition:1", lookup()).found, true);
  assert.equal(resolvePrompt(FREE_REF, lookup()).limit, null);
});

test("essaysOf reads the block through an unknown accessor and drops what isn't the contract's shape", () => {
  assert.equal(essaysOf(null), null);
  assert.equal(essaysOf({ essays: "yes" }), null);
  assert.equal(essaysOf({ essays: { status: "published" } }), null, "no cycle");
  const e = essaysOf({ essays: { cycle: "2026-27", status: "published", source_url: "u", retrieved: "d", prompts: [{ id: "1:2026-27:1", text: "Why?", kind: "weird", limit: { kind: "words", max: -3 } }, "junk"] } });
  assert.equal(e?.prompts.length, 1);
  assert.equal(e?.prompts[0].kind, "other");
  assert.equal(e?.prompts[0].limit, null);
});

test("the picker: the main essay first, then each plan college in order (with a note when nothing is on file), the Coalition, then free", () => {
  const groups = pickerGroups(PLAN, lookup());
  assert.deepEqual(groups.map((g) => g.key), ["common_app", DUKE, WAKE, MICH, MSU, "coalition", "free"]);
  assert.equal(groups[0].prompts[0].ref, MAIN_REF);
  assert.deepEqual(groups[1].prompts.map((p) => p.ref), [`college:${DUKE}:2026-27:1`, `college:${DUKE}:2026-27:2`]);
  assert.equal(groups[3].note, "No essays beyond the Common App's");
  assert.equal(groups[4].note, "Prompts not on file yet");
  assert.equal(groups[5].prompts[0].ref, "platform:coalition:1");
  assert.deepEqual(pickerGroups([], lookup(null)).map((g) => g.key), ["common_app", "free"], "no reference file: no Coalition group");
});

/* ------------------------------------------------------------------ */
/* Reuse and the college-name check                                    */
/* ------------------------------------------------------------------ */

test("name forms: the full name, without a campus suffix, without 'University', and 'University of X' as X", () => {
  assert.deepEqual(nameForms("Duke University"), ["Duke University", "Duke"]);
  assert.ok(nameForms("Wake Forest University").includes("Wake Forest"));
  const mich = nameForms("University of Michigan-Ann Arbor");
  assert.ok(mich.includes("University of Michigan") && mich.includes("Michigan"), mich.join("|"));
  assert.ok(!nameForms("Winston-Salem State University").includes("Winston"), "a hyphen inside a name isn't a campus suffix");
  assert.ok(!nameForms("Union College").includes("Union"), "a lone common word isn't flagged");
});

test("a variant for one college that names another college on the plan gets a warning", () => {
  const wake = { unit_id: WAKE, name: "Wake Forest University" };
  const hits = otherCollegesNamed("I can't wait to walk Duke's quad and join the debate team.", wake, PLAN);
  assert.deepEqual(hits.map((h) => [h.unit_id, h.form]), [[DUKE, "Duke"]]);
  assert.equal(nameWarning(hits, wake), "This draft names Duke. It's for Wake Forest University.");
  assert.deepEqual(otherCollegesNamed("Wake Forest's small classes drew me in.", wake, PLAN), [], "its own name is fine");
  assert.deepEqual(otherCollegesNamed("I marched with the Marching Dukes.", wake, PLAN), [], "a whole-word match only");
  const msu = { unit_id: MSU, name: "Michigan State University" };
  assert.deepEqual(otherCollegesNamed("Michigan State's farm program", msu, PLAN), [], "'Michigan' on a Michigan State draft is its own word");
  assert.deepEqual(otherCollegesNamed("Duke and Michigan both", null, PLAN).length, 2, "a draft for no college lists every name it uses");
  assert.equal(nameWarning([], wake), null);
});

test("guard: a substring match would flag a name inside another word", () => {
  const naive = (text: string, form: string) => text.toLowerCase().includes(form.toLowerCase());
  assert.equal(naive("the Marching Dukes", "Duke"), true, "the whole-word rule is what keeps this from warning");
});

test("reuse: same kind only, the suggested mode by limit, never the prompts the draft already serves", () => {
  const groups = pickerGroups(PLAN, lookup());
  const whyDuke = reuseChoices({ kind: "why_us", limit: { kind: "words", max: 250 }, refs: [`college:${DUKE}:2026-27:1`] }, groups);
  assert.deepEqual(whyDuke.map((c) => [c.prompt.ref, c.mode]), [[`college:${WAKE}:2026-27:1`, "variant"]]);
  const main = reuseChoices({ kind: "personal", limit: MAIN_LIMIT, refs: [MAIN_REF] }, groups);
  assert.deepEqual(main.map((c) => [c.prompt.ref, c.mode]), [["platform:coalition:1", "variant"]]);
  assert.equal(suggestedMode(MAIN_LIMIT, { kind: "words", max: 650, min: 250 }), "link");
  assert.equal(suggestedMode({ kind: "words", max: 250 }, { kind: "characters", max: 250 }), "variant");
  const free = reuseChoices({ kind: "free", limit: null, refs: [FREE_REF] }, groups);
  assert.ok(free.length >= 4, "a free draft may go to any prompt");
});

test("a variant knows when its base changed after it was made", () => {
  assert.equal(baseChangedSince("2026-10-01T10:00:00Z", "2026-10-02T09:00:00Z"), true);
  assert.equal(baseChangedSince("2026-10-02T10:00:00Z", "2026-10-02T09:00:00Z"), false);
});

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

const essay = (id: string, prompt_ref: string, kind: EssayRow["kind"], updated: string): EssayRow => ({
  id,
  student_id: "s",
  prompt_ref,
  title: id,
  count_kind: "words",
  count: 100,
  limit_max: null,
  limit_min: null,
  status: "draft",
  kind,
  base_id: null,
  created: "2026-09-01T00:00:00Z",
  updated,
});

const ESSAYS = [
  essay("why-wake", `college:${WAKE}:2026-27:1`, "why_us", "2026-10-05T00:00:00Z"),
  essay("free-1", FREE_REF, "free", "2026-10-06T00:00:00Z"),
  essay("why-duke", `college:${DUKE}:2026-27:1`, "why_us", "2026-10-03T00:00:00Z"),
  essay("duke-opt", `college:${DUKE}:2026-27:2`, "optional", "2026-10-07T00:00:00Z"),
  essay("main", MAIN_REF, "personal", "2026-10-01T00:00:00Z"),
  essay("old", "college:111111:2026-27:1", "essay", "2026-10-01T00:00:00Z"),
];
const LINKS: EssayLinkRow[] = [{ essay_id: "main", prompt_ref: `college:${DUKE}:2026-27:9`, created: "x" }];
const nameOf = (id: string) => SCHOOLS[id]?.name ?? (id === "111111" ? "Old College" : null);

test("groups: the platforms' essays first with the main essay at the top, then plan colleges in order, then off-plan, then loose", () => {
  const groups = groupEssays(ESSAYS, LINKS, PLAN, nameOf);
  assert.deepEqual(groups.map((g) => g.key), ["main", DUKE, WAKE, "111111", "other"]);
  assert.deepEqual(groups[0].essays.map((e) => e.id), ["main"]);
  assert.deepEqual(groups[1].essays.map((e) => e.id), ["main", "why-duke", "duke-opt"], "a linked main essay shows under the college too, first");
  assert.equal(groups[3].label, "Old College");
  assert.deepEqual(groups[4].essays.map((e) => e.id), ["free-1"]);
});

test("groups narrowed to one college keep the platforms' group only when the college takes it, and an empty college still shows", () => {
  assert.deepEqual(groupEssays(ESSAYS, LINKS, PLAN, nameOf, { college: WAKE }).map((g) => g.key), [WAKE]);
  assert.deepEqual(groupEssays(ESSAYS, LINKS, PLAN, nameOf, { college: WAKE, withPlatform: true }).map((g) => g.key), ["main", WAKE]);
  const empty = groupEssays(ESSAYS, LINKS, PLAN, nameOf, { college: MSU });
  assert.deepEqual(empty.map((g) => [g.key, g.essays.length]), [[MSU, 0]]);
});

test("guard: sorting a group by date alone would put the main essay below newer drafts", () => {
  const byDate = [...groupEssays(ESSAYS, LINKS, PLAN, nameOf)[1].essays].sort((a, b) => b.updated.localeCompare(a.updated));
  assert.notEqual(byDate[0].id, "main", "the main-first assertion above is what catches it");
});

test("refs and the main essay", () => {
  assert.deepEqual(refsOf(ESSAYS[4], LINKS), [MAIN_REF, `college:${DUKE}:2026-27:9`]);
  assert.equal(isMainEssay(ESSAYS[4], LINKS), true);
  assert.equal(isMainEssay({ id: "x", prompt_ref: FREE_REF }, [{ essay_id: "x", prompt_ref: MAIN_REF, created: "" }]), true);
  // The list is the advisor's Essays tab since essays-next (specs/product/essays/tab.md): a college is its card's anchor.
  assert.equal(essaysHref(), "/advisor?tab=essays");
  assert.equal(essaysHref({ college: DUKE, person: "abc" }), `/advisor?for=abc&tab=essays#college-${DUKE}`);
});

test("versions: after ten minutes since the last one, on every import, on a mark; not for an unchanged typed save", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(VERSION_PAUSE_MS, 600_000);
  assert.equal(shouldVersion({ lastVersionAt: null, now, source: "typed", mark: false, changed: true }), true, "the first save");
  assert.equal(shouldVersion({ lastVersionAt: ago(9 * 60_000), now, source: "typed", mark: false, changed: true }), false);
  assert.equal(shouldVersion({ lastVersionAt: ago(10 * 60_000), now, source: "typed", mark: false, changed: true }), true);
  assert.equal(shouldVersion({ lastVersionAt: ago(60_000), now, source: "pasted", mark: false, changed: true }), true);
  assert.equal(shouldVersion({ lastVersionAt: ago(60_000), now, source: "typed", mark: true, changed: false }), true);
  assert.equal(shouldVersion({ lastVersionAt: ago(60 * 60_000), now, source: "typed", mark: false, changed: false }), false);
});

/* ------------------------------------------------------------------ */
/* Wiring guards                                                       */
/* ------------------------------------------------------------------ */

test("the capability is listed and the store asks for it on every action", () => {
  assert.ok(CAPABILITIES.includes("advisor.essays"));
  const store = read("lib", "essays", "store.ts");
  assert.match(store, /^"use server";/);
  assert.match(store, /allowed\(user, "advisor\.essays"\)/);
  const exported = [...store.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(
    exported.sort(),
    [
      "addComment",
      "createEssay",
      "deleteComment",
      "deleteEssay",
      "importPastedText",
      "importUploadedFile",
      "linkEssay",
      "makeVariant",
      "openVersion",
      "renameEssay",
      "resolveComment",
      "restoreVersion",
      "saveEssay",
      "setEssayStatus",
      "unlinkEssay",
    ].sort(),
  );
  for (const name of exported) {
    const body = store.slice(store.indexOf(`export async function ${name}`)).split(/\nexport /)[0];
    assert.match(body, /await ready\(\)/, `${name} runs through ready()`);
  }
  assert.doesNotMatch(store.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /^export (const|let|function [^a])/m, "a use-server module exports only async functions");
});

test("the summer's 'Draft the personal essay' move opens the workspace, not the story guide", () => {
  const entry = { key: "personal_essay_draft", label: "Draft the personal essay", window: ["2027-06-15", "2027-08-31"], applies: "has_common_app", assignee: "student", source: "x" };
  const task = cycleTask(entry as Parameters<typeof cycleTask>[0], "L", 0);
  assert.deepEqual(task.action, { kind: "href", href: "/advisor/essays" });
  assert.equal(guideFor({ kind: "cycle", key: task.key, item_id: null }), null, "no guide button takes its place");
  const other = cycleTask({ ...entry, key: "fafsa_opens" } as Parameters<typeof cycleTask>[0], "L", 0);
  assert.equal(other.action, undefined, "other cycle entries carry no action");
  assert.match(read("components", "planner", "moves", "MoveCard.tsx"), /action\.href\.startsWith\("\/"\)/, "an in-site href opens in place");
});

test("the apply surfaces link 'Essays for {college}' to the list filtered by that college", () => {
  for (const file of [["components", "planner", "CollegeApplyCard.tsx"], ["components", "planner", "moves", "SubmitCard.tsx"]]) {
    const src = read(...file);
    assert.match(src, /essaysHref\(\{ college: school\.unit_id/, file.join("/"));
    assert.match(src, /Essays for \{school\.name\}/, file.join("/"));
  }
});

test("telemetry: the events carry no text (no body, title, prompt, or college)", () => {
  assert.deepEqual([...EVENTS.essay_created.properties], ["prompt_kind"]);
  assert.deepEqual([...EVENTS.essay_saved_version.properties], ["source"]);
  assert.deepEqual([...EVENTS.essay_commented.properties], ["role"]);
  assert.deepEqual([...EVENTS.essay_started_from.properties], ["where"]);
  for (const name of ["essay_created", "essay_saved_version", "essay_commented", "essay_started_from"] as const) {
    for (const p of EVENTS[name].properties) assert.doesNotMatch(p, /text|body|title|prompt_text|unit|college|name/, `${name}.${p}`);
  }
  const calls = ["components/essays/PromptPicker.tsx", "components/essays/Editor.tsx", "components/essays/Comments.tsx", "components/essays/CollegeEssayCard.tsx"]
    .map((f) => read(f))
    .join("\n")
    .match(/track\("essay_[a-z_]+", \{[^}]*\}\)/g);
  assert.ok(calls && calls.length >= 6, "the components send the events");
  for (const c of calls!) assert.match(c, /\{ (prompt_kind: r\.kind|source: "(typed|restored)"|role: r\.role|where: "(tab|picker)") \}/, c);
});

test("the old list page is a 308 to the Essays tab, keeping ?for= and turning ?college= into the card's anchor", () => {
  const uuid = "6f1c2a7e-1b2c-4d3e-8f90-0123456789ab";
  assert.equal(essaysListRedirect({}), "/advisor?tab=essays");
  assert.equal(essaysListRedirect({ for: uuid }), `/advisor?for=${uuid}&tab=essays`);
  assert.equal(essaysListRedirect({ for: uuid, college: DUKE }), `/advisor?for=${uuid}&tab=essays#college-${DUKE}`);
  assert.equal(essaysListRedirect({ college: [DUKE, "1"] }), `/advisor?tab=essays#college-${DUKE}`);
  // Anything malformed is dropped, never carried into the URL.
  assert.equal(essaysListRedirect({ for: "javascript:alert(1)", college: "x#y" }), "/advisor?tab=essays");
  const page = read("app", "advisor", "essays", "page.tsx");
  assert.match(page, /permanentRedirect\(essaysListRedirect\(await searchParams\)\)/);
  assert.doesNotMatch(page, /EssayList|readEssays/, "the list page renders nothing of its own");
});

test("guard: a list page that still rendered, or a plain (307) redirect, fails the redirect check", () => {
  const bad = ['export default async function P() { redirect(essaysListRedirect(await searchParams)); }', "export default function P() { return <EssayList />; }"];
  for (const src of bad) assert.doesNotMatch(src, /permanentRedirect\(essaysListRedirect\(await searchParams\)\)/);
});

test("the editor's, the package's, and the delete's way back is the Essays tab, not the old list", () => {
  assert.match(read("app", "advisor", "essays", "[id]", "page.tsx"), /href=\{essaysHref\(\{ person, college: refUnitId\(essay\.prompt_ref\) \}\)\}/);
  assert.match(read("app", "advisor", "essays", "package", "[unit]", "page.tsx"), /href=\{essaysHref\(\{ person, college: unitId \}\)\}/);
  assert.match(read("components", "essays", "Editor.tsx"), /router\.push\(essaysHref\(\{ person \}\)\)/);
  for (const f of [["app", "advisor", "essays", "[id]", "page.tsx"], ["app", "advisor", "essays", "package", "[unit]", "page.tsx"], ["components", "essays", "Editor.tsx"]]) {
    assert.doesNotMatch(read(...f), /`\/advisor\/essays\$\{/, `${f.join("/")} links the old list`);
  }
});

test("the public Data API (app/api/v1, lib/api) reads none of the essay tables", () => {
  const files = [...readdirSync(join(ROOT, "lib", "api")).map((f) => join("lib", "api", f)), ...readdirSync(join(ROOT, "app", "api", "v1"), { recursive: true, encoding: "utf8" }).map((f) => join("app", "api", "v1", f))].filter((f) => /\.(ts|tsx|json)$/.test(f) && statSync(join(ROOT, f)).isFile());
  const hits = files.filter((f) => /\bessay(s|_versions|_links|_comments)\b/.test(read(f)));
  assert.deepEqual(hits, []);
  assert.equal(/\bessay_comments\b/.test("from('essay_comments')"), true, "the scan would see a read");
});
