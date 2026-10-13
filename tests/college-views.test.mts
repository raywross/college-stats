/**
 * College views (specs/product/college-views.md): what a view request may carry, when the server records one, and the
 * beacon on every profile page. The table and its functions are tested against Postgres in admin-policies.test.mts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VIEW_PAGES, parseViewBody, shouldRecordView, viewPageLabel } from "../lib/college-views.ts";
import { TOPIC_KEYS } from "../lib/profile-topics.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const headers = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("a view is a six-digit college and a known page (the overview when none is given); nothing else gets through", () => {
  assert.deepEqual(parseViewBody({ unit: "199847" }), { unit: "199847", page: "overview" });
  assert.deepEqual(parseViewBody({ unit: "199847", page: "cost" }), { unit: "199847", page: "cost" });
  for (const bad of [null, "199847", {}, { unit: 199847 }, { unit: "19984" }, { unit: "199847x" }, { unit: "199847", page: "admin" }, { unit: "199847", page: 3 }]) {
    assert.equal(parseViewBody(bad), null, JSON.stringify(bad));
  }
});

test("the pages match the profile's topics, and the SQL allows exactly these", () => {
  assert.deepEqual([...VIEW_PAGES].sort(), ["overview", ...TOPIC_KEYS].sort());
  const sql = read("supabase/migrations/20261013140000_college_views.sql");
  const listed = [...sql.matchAll(/in \(('overview'[^)]*)\)/g)].map((m) => m[1].replace(/'/g, "").split(/,\s*/).sort());
  assert.ok(listed.length >= 2);
  for (const l of listed) assert.deepEqual(l, [...VIEW_PAGES].sort());
});

test("the server records an ordinary browser, and nothing for a privacy signal or a bot", () => {
  assert.equal(shouldRecordView(headers({ "user-agent": BROWSER })), true);
  assert.equal(shouldRecordView(headers({ "user-agent": BROWSER, "sec-gpc": "1" })), false);
  assert.equal(shouldRecordView(headers({ "user-agent": BROWSER, dnt: "1" })), false);
  assert.equal(shouldRecordView(headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" })), false);
  assert.equal(shouldRecordView(headers({ "user-agent": "facebookexternalhit/1.1" })), false);
  assert.equal(shouldRecordView(headers({})), false);
});

test("a view's page in words follows the profile's tab names", () => {
  const labels: Record<string, string> = { admissions: "Getting in" };
  assert.equal(viewPageLabel("overview", (k) => labels[k]), "Overview");
  assert.equal(viewPageLabel("admissions", (k) => labels[k]), "Getting in");
});

test("the beacon is on the overview and every topic page, honors privacy signals, and the route never takes a user from the request", () => {
  assert.match(read("app/schools/[id]/page.tsx"), /<ViewBeacon unit=\{school\.unit_id\} page="overview" \/>/);
  assert.match(read("components/profile/TopicPage.tsx"), /<ViewBeacon unit=\{school\.unit_id\} page=\{topic\} \/>/);
  const beacon = read("components/profile/ViewBeacon.tsx");
  assert.match(beacon, /globalPrivacyControl === true/);
  assert.match(beacon, /doNotTrack === "1"/);
  const route = read("app/api/college-view/route.ts");
  assert.match(route, /shouldRecordView\(request\.headers\)/);
  assert.match(route, /rpc\("record_college_view", \{ p_unit: view\.unit, p_page: view\.page \}\)/);
  assert.doesNotMatch(route, /user_id|userId/, "the user comes from the session inside record_college_view");
});

test("the privacy page and the account download say what is kept", () => {
  assert.match(read("app/privacy/page.tsx"), /which college pages your account opens/);
  assert.match(read("lib/account-export.ts"), /key: "college_views"/);
});
