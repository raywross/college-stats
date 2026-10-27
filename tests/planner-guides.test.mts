/**
 * The guides registry (lib/planner/guides.ts; specs/planner/v3/now.md "The guide pattern"; build-plan.md "Guides"):
 * every move in now.md's table maps to its guide; a move with no guide maps to null; the buttons and URLs; every slug
 * has a page (lib/planner/guides-server.ts) and a stub until its owner replaces it; no guide's words carry a number
 * from the estimate (the catalog's guard). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUIDE_BY_CYCLE_KEY,
  GUIDE_BY_PLAYBOOK_KEY,
  GUIDE_SLUGS,
  GUIDES,
  guideFor,
  guideHref,
  parseGuideFrom,
  parseGuideQuery,
  parseGuideSlug,
  type GuideSlug,
} from "../lib/planner/guides.ts";
import { PLAYBOOK } from "../lib/planner/moves-catalog.ts";
import type { PlanTask, TaskKind } from "../lib/planner/types.ts";
import { numberProblems } from "./helpers/copy-guard.mts";

const ROOT = join(import.meta.dirname, "..");
const L = "11111111-1111-1111-1111-111111111111";
const playbook = (key: string) => ({ kind: "playbook" as TaskKind, key: `${L}:playbook:${key}`, item_id: null });
const cycle = (key: string) => ({ kind: "cycle" as TaskKind, key: `${L}:cycle:${key}`, item_id: null });
const kind = (k: TaskKind, key: string | null = null) => ({ kind: k, key, item_id: null });
const slugOf = (t: Pick<PlanTask, "kind" | "key" | "item_id">) => guideFor(t)?.slug ?? null;

test("now.md's table: every move maps to its guide", () => {
  const table: [Pick<PlanTask, "kind" | "key" | "item_id">, GuideSlug][] = [
    // Build your list
    [kind("shape_gap", `${L}:shape_gap:likely_min`), "list"],
    [kind("shape_gap", `${L}:shape_gap:target_min`), "list"],
    [playbook("build_list"), "list"],
    [playbook("long_list"), "list"],
    // Show interest
    [kind("show_interest", `${L}:show_interest:item-1`), "interest"],
    [kind("visit_ed", `${L}:visit_ed:item-1`), "interest"],
    [playbook("fall_break_visit"), "interest"],
    [playbook("spring_break_visit"), "interest"],
    [playbook("freshman_visit_travel"), "interest"],
    [playbook("sophomore_visit_travel"), "interest"],
    // Reach your score
    [playbook("pick_test"), "test"],
    [playbook("register_spring_test"), "test"],
    [playbook("reach_score_junior_fall"), "test"],
    [playbook("reach_score_senior_fall"), "test"],
    [kind("test_register", `${L}:test_register:sat_2027_03`), "test"],
    [kind("test_day", `${L}:test_day:sat_2027_03`), "test"],
    // Your story
    [kind("story", `${L}:playbook:story`), "story"],
    [playbook("brag_sheet"), "story"],
    [cycle("personal_essay_draft"), "story"],
    // Courses
    [playbook("freshman_choose_courses"), "courses"],
    [playbook("sophomore_choose_courses"), "courses"],
    [playbook("junior_choose_courses"), "courses"],
    [cycle("choose_courses_2027"), "courses"],
    // Recommenders
    [playbook("pick_recommenders"), "recommenders"],
    [cycle("ask_recommenders"), "recommenders"],
    [cycle("thank_recommenders"), "recommenders"],
    [kind("recommendation", "item-1:recommendation"), "recommenders"],
    // ED
    [kind("ed_decide", `${L}:ed_decide`), "ed"],
    [kind("ed2_decide", `${L}:ed2_decide`), "ed"],
  ];
  for (const [task, want] of table) assert.equal(slugOf(task), want, `${task.kind} ${task.key}`);
});

test("a move with no guide maps to null (its built action stays)", () => {
  for (const t of [
    playbook("profile"),
    playbook("activities"),
    playbook("class_year"),
    playbook("psat_nmsqt"),
    playbook("summer_program"),
    cycle("common_app_opens"),
    cycle("fafsa_opens"),
    kind("apply", "item-1:apply:rd"),
    kind("decision_expected", "item-1:decision_expected"),
    kind("own"),
    kind("playbook", null),
  ]) {
    assert.equal(guideFor(t), null, `${t.kind} ${t.key}`);
  }
  // Planted: a key that only looks like a mapped one doesn't match.
  assert.equal(guideFor(playbook("build_list_extra")), null);
  assert.equal(guideFor(cycle("pick_recommenders")), null, "a playbook key under :cycle: is not the playbook's");
});

test("every playbook pattern names entries that exist", () => {
  const keys = PLAYBOOK.map((e) => e.key);
  for (const [re, slug] of GUIDE_BY_PLAYBOOK_KEY) assert.ok(keys.some((k) => re.test(k)), `${re} (${slug}) matches no playbook entry`);
  for (const k of ["build_list", "long_list", "fall_break_visit", "spring_break_visit", "pick_test", "register_spring_test", "brag_sheet", "junior_choose_courses", "pick_recommenders"]) {
    assert.ok(keys.includes(k), k);
  }
  assert.ok(GUIDE_BY_CYCLE_KEY.length >= 3);
});

test("the buttons and titles are the contract's", () => {
  const buttons: Record<GuideSlug, string> = {
    list: "Help me build it",
    interest: "Show me how",
    test: "Help me get there",
    story: "Write it",
    courses: "Help me choose",
    recommenders: "Help me pick",
    ed: "See the facts",
  };
  assert.deepEqual([...GUIDE_SLUGS].sort(), Object.keys(GUIDES).sort());
  for (const s of GUIDE_SLUGS) {
    assert.equal(GUIDES[s].slug, s);
    assert.equal(GUIDES[s].button, buttons[s], s);
    assert.ok(GUIDES[s].title && GUIDES[s].purpose, s);
  }
});

test("no guide title, button, or purpose carries a number from the estimate (the catalog's guard)", () => {
  const bad = GUIDE_SLUGS.flatMap((s) => [GUIDES[s].title, GUIDES[s].button, GUIDES[s].purpose].map((text) => ({ s, text, problems: numberProblems(text) }))).filter((x) => x.problems.length);
  assert.deepEqual(bad, []);
  // The guard is live here too.
  assert.ok(numberProblems("Colleges where you have a 60% chance").length > 0);
  assert.ok(numberProblems("Add 3 more Likely colleges").length > 0);
});

test("guideHref: the slug, then for, move, college, level, from, only those given", () => {
  assert.equal(guideHref("list"), "/advisor/guide/list");
  assert.equal(guideHref("list", { level: "likely", from: "notice" }), "/advisor/guide/list?level=likely&from=notice");
  assert.equal(guideHref("interest", { person: "s1", move: "t1", college: "198419", from: "move" }), "/advisor/guide/interest?for=s1&move=t1&college=198419&from=move");
  assert.equal(guideHref("test", { person: null, move: null, college: null, level: null }), "/advisor/guide/test");
});

const task = (over: Partial<PlanTask>): PlanTask =>
  ({ id: "t1", list_id: L, item_id: null, key: null, kind: "playbook", title: "x", detail: null, action: null, season: null, ...over }) as PlanTask;

test("hrefFor: the move and from=move; the interest and ED guides add the college; the list guide adds a shape gap's level", () => {
  const items = [{ id: "item-1", unit_id: "198419" }];
  const interest = task({ id: "t9", kind: "show_interest", item_id: "item-1" });
  assert.equal(guideFor(interest)!.hrefFor(interest, { person: "s1", items }), "/advisor/guide/interest?for=s1&move=t9&college=198419&from=move");
  assert.equal(guideFor(interest)!.hrefFor(interest, { person: null }), "/advisor/guide/interest?move=t9&from=move", "no rows passed: no college");
  const ed = task({ id: "t8", kind: "ed_decide", item_id: "item-1" });
  assert.equal(guideFor(ed)!.hrefFor(ed, { person: null, items }), "/advisor/guide/ed?move=t8&college=198419&from=move");
  const gap = task({ id: "t7", kind: "shape_gap", action: { kind: "show_rail", level: "likely", gap: "likely_min" } });
  assert.equal(guideFor(gap)!.hrefFor(gap, { person: null }), "/advisor/guide/list?move=t7&level=likely&from=move");
  const story = task({ id: "t6", kind: "story", key: `${L}:playbook:story` });
  assert.equal(guideFor(story)!.hrefFor(story, { person: "s2" }), "/advisor/guide/story?for=s2&move=t6&from=move");
  assert.equal(GUIDES.test.hrefFor(null, { person: null }), "/advisor/guide/test", "no move: the bare guide");
});

test("every slug has a guide page (lib/planner/guides-server.ts) and, until replaced, a stub", () => {
  const src = readFileSync(join(ROOT, "lib", "planner", "guides-server.ts"), "utf8");
  const body = /export const GUIDE_PAGES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
  const keys = [...body.matchAll(/^\s*([a-z]+):\s*\{/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [...GUIDE_SLUGS].sort());
  assert.match(src, /^import "server-only";/m);
  // The page resolves the slug through the registry and 404s an unknown one.
  const page = readFileSync(join(ROOT, "app", "advisor", "guide", "[slug]", "page.tsx"), "utf8");
  assert.match(page, /parseGuideSlug\(/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /redirect\(ADVISOR_PATH\)/);
  assert.match(page, /GUIDE_PAGES\[slug\]/);
});

test("lib/planner/guides.ts stays pure: no React and no server imports", () => {
  const src = readFileSync(join(ROOT, "lib", "planner", "guides.ts"), "utf8");
  const imports = [...src.matchAll(/^import [^;]*from "([^"]+)";/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith("../") || i.startsWith("./"), i);
  assert.doesNotMatch(src, /server-only|from "react"|next\//);
});

test("parse helpers: slug, query, from", () => {
  assert.equal(parseGuideSlug("list"), "list");
  assert.equal(parseGuideSlug("nope"), null);
  assert.equal(parseGuideSlug(undefined), null);
  assert.deepEqual(parseGuideQuery({ college: "198419", level: "likely", move: "0a1b2c3d-1111-2222-3333-444455556666" }), {
    college: "198419",
    level: "likely",
    move: "0a1b2c3d-1111-2222-3333-444455556666",
  });
  assert.deepEqual(parseGuideQuery({ college: "<script>", level: "great", move: "1; drop" }), { college: null, level: null, move: null });
  assert.equal(parseGuideFrom("pill", true), "pill");
  assert.equal(parseGuideFrom("bogus", true), "move");
  assert.equal(parseGuideFrom(undefined, false), "profile");
});
