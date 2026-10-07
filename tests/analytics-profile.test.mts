/**
 * Static guards on the profile's usage instrumentation (specs/product/telemetry.md): the topic cards, pills, anchors,
 * block views, popovers, and Over-time group picks each report through `lib/analytics.ts`, once, and only with
 * registered properties. The components are React, so these read the source (as tests/citation-guards.test.mts does)
 * rather than render it. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENTS, type AnalyticsEvent } from "../lib/analytics.ts";

const ROOT = join(import.meta.dirname, "..");

/** Code with comments removed, so documentation examples don't trip the guards. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const count = (s: string, pattern: RegExp) => (s.match(pattern) ?? []).length;

const TOPIC_CARD = "components/profile/TopicCard.tsx";
const TOPIC_PILLS = "components/profile/TopicPills.tsx";
const PILL_ROW = "components/ui/pill-row.tsx";
const ANCHOR = "components/profile/AnchorRedirect.tsx";
const BLOCK_VIEWS = "components/profile/BlockViews.tsx";
const TOPIC_PAGE = "components/profile/TopicPage.tsx";
const INFO_TIP = "components/ui/info-tip.tsx";
const GROUP_NAV = "components/profile/HistoryGroupNav.tsx";
const OVER_TIME = "components/history/OverTime.tsx";
const HISTORY_PAGE = "app/schools/[id]/history/page.tsx";
const STORE = "lib/history-group-store.ts";

const OWNED = [TOPIC_CARD, TOPIC_PILLS, ANCHOR, BLOCK_VIEWS, INFO_TIP, GROUP_NAV, OVER_TIME];

/** Every `track("event", { a, b: x })` call and `event="…" properties={{ … }}` in the source: [event, property names]. */
function trackedCalls(src: string): [string, string[]][] {
  const names = (body: string) => body.split(",").flatMap((part) => part.trim().match(/^(\w+)/)?.[1] ?? []);
  const calls: [string, string[]][] = [];
  for (const m of src.matchAll(/\btrack\(\s*"(\w+)"\s*,\s*\{([^}]*)\}/g)) calls.push([m[1], names(m[2])]);
  for (const m of src.matchAll(/event="(\w+)"\s+properties=\{\{([^}]*)\}\}/g)) calls.push([m[1], names(m[2])]);
  return calls;
}

test("every instrumented file imports track or TrackedLink, so the instrumentation can't silently go", () => {
  for (const f of [TOPIC_PILLS, ANCHOR, BLOCK_VIEWS, INFO_TIP, GROUP_NAV, OVER_TIME]) {
    assert.match(code(f), /import \{[^}]*\btrack\b[^}]*\} from "@\/lib\/analytics"/, `${f} doesn't import track`);
  }
  assert.match(code(TOPIC_CARD), /import \{ TrackedLink \} from "@\/components\/analytics\/TrackedLink"/);
});

test("every track call in the profile files names a registered event with registered properties", () => {
  let seen = 0;
  for (const f of OWNED) {
    for (const [event, props] of trackedCalls(code(f))) {
      seen++;
      assert.ok(event in EVENTS, `${f}: "${event}" isn't in the registry`);
      const allowed: readonly string[] = EVENTS[event as AnalyticsEvent].properties;
      for (const p of props) assert.ok(allowed.includes(p), `${f}: "${event}" sends "${p}", which the registry doesn't list`);
      assert.deepEqual([...props].sort(), [...allowed].sort(), `${f}: "${event}" should send exactly its registered properties`);
    }
  }
  assert.ok(seen >= 10, `expected to find the profile's track calls, found ${seen}`);
});

test("the topic card's overlay is a TrackedLink (profile_card_opened from card), not a bare Link", () => {
  const src = code(TOPIC_CARD);
  assert.match(src, /<TrackedLink\b/);
  assert.doesNotMatch(src, /<Link\b/, "TopicCard renders a bare <Link>");
  assert.doesNotMatch(src, /from "next\/link"/);
  assert.deepEqual(trackedCalls(src), [["profile_card_opened", ["unit_id", "topic", "from"]]]);
  assert.match(src, /from: "card"/);
});

test("pills report through PillRow's onSelect (from pill), and only for topics, never Overview", () => {
  const row = code(PILL_ROW);
  assert.match(row, /onSelect\?: \(key: string\) => void/);
  assert.match(row, /onClick=\{\(\) => onSelect\?\.\(p\.key\)\}/, "each pill's click calls onSelect");
  assert.match(row, /<Link\b/, "the pill is still a link");
  const pills = code(TOPIC_PILLS);
  assert.match(pills, /onSelect=\{onSelect\}/);
  assert.match(pills, /isTopicKey\(key\)/, "Overview is filtered out by narrowing to a topic key");
  assert.match(pills, /from: "pill"/);
});

test("the anchor redirect reports (from anchor) before it replaces the URL", () => {
  const src = code(ANCHOR);
  const tracked = src.indexOf('from: "anchor"');
  const replaced = src.indexOf("router.replace(");
  assert.ok(tracked >= 0 && replaced >= 0, "both calls exist");
  assert.ok(tracked < replaced, "track comes before router.replace");
  assert.equal(count(src, /\btrack\(/g), 1);
});

test("BlockViews observes at half visibility, once per block, and cleans up; TopicPage renders it", () => {
  const src = code(BLOCK_VIEWS);
  assert.match(src, /new IntersectionObserver\(/);
  assert.match(src, /threshold: 0\.5/);
  assert.match(src, /observer\.unobserve\(e\.target\)/, "a block is reported once, then unobserved");
  assert.match(src, /observer\.disconnect\(\)/);
  assert.match(src, /\[unitId, topic, key\]/, "re-runs when the college or topic changes");
  assert.match(src, /track\("profile_block_viewed", \{ unit_id: unitId, topic, block: e\.target\.id \}\)/);
  assert.equal(count(src, /\btrack\(/g), 1);
  const page = code(TOPIC_PAGE);
  assert.match(page, /<BlockViews unitId=\{school\.unit_id\} topic=\{topic\} ids=\{items\.map\(\(i\) => i\.id\)\} \/>/);
  assert.match(page, /items\.length > 0 && <BlockViews/, "skipped when the page lists no blocks");
});

test("every popover in info-tip.tsx counts its opening through the shared onOpen helper", () => {
  const src = code(INFO_TIP);
  const roots = count(src, /<Popover\.Root\b/g);
  assert.equal(roots, 4, "InfoTip, SourceTip, SourcesTip, and Term");
  assert.equal(count(src, /<Popover\.Root onOpenChange=\{onOpen\(/g), roots, "each Popover.Root has the shared handler");
  assert.match(src, /return \(open\) => \{\s*if \(open\) cb\(\);\s*\}/, "only an opening counts, not the close");
  // Terms report term_opened; anything with a source reports citation_opened with the cited field path.
  assert.match(src, /track\("term_opened", \{ term \}\)/);
  assert.equal(count(src, /\btrack\("citation_opened", \{ field: [\w.[\]]*cited\.path \}\)/g), 3, "term helper, SourceTip, SourcesTip");
});

test("Over-time group picks are counted at the pickers only, never in setGroup or the store", () => {
  const nav = code(GROUP_NAV);
  assert.equal(count(nav, /track\("trend_group_opened", \{ unit_id: unitId, group: g \}\)/g), 1);
  assert.ok(nav.indexOf("trend_group_opened") < nav.indexOf("publishHistoryGroup(g)"), "tracked before it publishes");
  assert.match(nav, /unitId: string/);

  const over = code(OVER_TIME);
  assert.equal(count(over, /track\("trend_group_opened"/g), 1, "exactly one tracking call in OverTime (the phone picker)");
  assert.match(over, /track\("trend_group_opened", \{ unit_id: history\.unit_id, group: g \}\)/);
  // The tracking sits in the picker's onChange, not in useUrlState's setGroup, which the side list's pick also reaches.
  const setGroupLine = over.split("\n").find((l) => l.includes("setGroup: (v: HistoryGroupKey)")) ?? "";
  assert.ok(setGroupLine.length > 0, "found useUrlState's setGroup");
  assert.doesNotMatch(setGroupLine, /track\(/);
  const picker = over.slice(over.indexOf("<GroupPills"), over.indexOf("colors={groupColors}", over.indexOf("<GroupPills")));
  assert.match(picker, /trend_group_opened/);

  assert.doesNotMatch(code(STORE), /track|analytics/, "the store stays free of telemetry (it would double count)");
  assert.match(code(HISTORY_PAGE), /<HistoryGroupNav unitId=\{school\.unit_id\}/);
});
