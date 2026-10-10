/**
 * Stage 3, Actions (lib/planner/actions.ts; the `actions` generator; lib/ics.ts): the follow URL per network and
 * the handle shape it's built from, the interest line for every C7 value and for null, a visit's `.ics` fields, the
 * first-past-visit rule behind `visited_on`, and the generator's three task kinds. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionsOptional,
  actionsProgress,
  appDeepLink,
  BEFORE_YOU_GO_QUESTIONS,
  firstPastVisitOn,
  followUrl,
  hasFollowIntent,
  hasVisitNotes,
  interestLine,
  interviewImportanceLine,
  orderForActions,
  VISIT_KINDS,
} from "../lib/planner/actions.ts";
import { isValidHandle } from "../lib/social.ts";
import { icsEvent } from "../lib/ics.ts";
import { generate } from "../lib/planner/generators/actions.ts";
import type { GeneratorInput, PlanItem, PlanSchool, PlanVisit } from "../lib/planner/types.ts";
import type { FactorImportance } from "../lib/types.ts";

const LIST = "11111111-1111-4111-8111-111111111111";

/* ------------------------------------------------------------------ */
/* Follow                                                               */
/* ------------------------------------------------------------------ */

test("followUrl: X and YouTube open their documented follow/subscribe intents", () => {
  assert.equal(followUrl("x", "StanfordAdmission"), "https://x.com/intent/follow?screen_name=StanfordAdmission");
  assert.equal(followUrl("youtube", "UCabc123"), "https://www.youtube.com/channel/UCabc123?sub_confirmation=1");
});

test("followUrl: the rest open the plain profile URL", () => {
  assert.equal(followUrl("instagram", "stanford"), "https://www.instagram.com/stanford");
  assert.equal(followUrl("tiktok", "stanford"), "https://www.tiktok.com/@stanford");
  assert.equal(followUrl("facebook", "Stanford"), "https://www.facebook.com/Stanford");
  assert.equal(followUrl("linkedin", "stanford-university"), "https://www.linkedin.com/school/stanford-university");
});

test("followUrl: every URL's handle segment is still a validly shaped handle for its network", () => {
  const cases: [Parameters<typeof followUrl>[0], string][] = [
    ["x", "StanfordAdm"],
    ["youtube", "UC1234567890123456789012"],
    ["instagram", "stanford.admission"],
    ["tiktok", "stanford"],
    ["facebook", "Grand-View-University-315068091675"],
    ["linkedin", "stanford-university"],
  ];
  for (const [network, handle] of cases) {
    assert.ok(isValidHandle(network, handle), `${network}: ${handle}`);
    const url = followUrl(network, handle);
    assert.ok(url.includes(encodeURIComponent(handle)) || url.endsWith(handle), `${network} URL carries the handle: ${url}`);
  }
});

test("hasFollowIntent: only X and YouTube", () => {
  assert.equal(hasFollowIntent("x"), true);
  assert.equal(hasFollowIntent("youtube"), true);
  for (const n of ["instagram", "tiktok", "facebook", "linkedin"] as const) assert.equal(hasFollowIntent(n), false, n);
});

test("appDeepLink: only Instagram documents one", () => {
  assert.equal(appDeepLink("instagram", "stanford"), "instagram://user?username=stanford");
  for (const n of ["x", "youtube", "tiktok", "facebook", "linkedin"] as const) assert.equal(appDeepLink(n, "stanford"), null, n);
});

test("orderForActions: the Dream first, then list order", () => {
  const items = [{ id: "a", dream: false, position: 0 }, { id: "b", dream: true, position: 1 }, { id: "c", dream: false, position: 2 }];
  assert.deepEqual(orderForActions(items).map((i) => i.id), ["b", "a", "c"]);
});

test("actionsProgress: counts follow only when the college has accounts", () => {
  assert.deepEqual(actionsProgress({ hasAccounts: false, anyFollowed: false, infoRequested: false, hasVisit: false }), { done: 0, total: 2 });
  assert.deepEqual(actionsProgress({ hasAccounts: true, anyFollowed: true, infoRequested: true, hasVisit: true }), { done: 3, total: 3 });
});

/* ------------------------------------------------------------------ */
/* Interest and interview (C7)                                         */
/* ------------------------------------------------------------------ */

const C7_VALUES: (FactorImportance | null)[] = ["very_important", "important", "considered", "not_considered", null];

test("interestLine: a line for every C7 value, and for null (unpublished)", () => {
  for (const v of C7_VALUES) assert.ok(interestLine(v).length > 0, String(v));
  assert.match(interestLine("very_important"), /considers your interest/);
  assert.match(interestLine("important"), /considers your interest/);
  assert.match(interestLine("considered"), /can help/);
  assert.match(interestLine("not_considered"), /isn't considered/);
  assert.match(interestLine(null), /hasn't published/);
  assert.match(interestLine(undefined), /hasn't published/);
});

test("actionsOptional: not considered or unpublished only", () => {
  assert.equal(actionsOptional("very_important"), false);
  assert.equal(actionsOptional("important"), false);
  assert.equal(actionsOptional("considered"), false);
  assert.equal(actionsOptional("not_considered"), true);
  assert.equal(actionsOptional(null), true);
});

test("interviewImportanceLine: a line for every C7 value, and for null", () => {
  for (const v of C7_VALUES) assert.ok(interviewImportanceLine(v).length > 0, String(v));
  assert.match(interviewImportanceLine("not_considered"), /isn't considered/);
  assert.match(interviewImportanceLine(null), /hasn't published/);
});

/* ------------------------------------------------------------------ */
/* Visits                                                               */
/* ------------------------------------------------------------------ */

test("hasVisitNotes: empty object, and whitespace-only fields, count as no notes", () => {
  assert.equal(hasVisitNotes({}), false);
  assert.equal(hasVisitNotes(null), false);
  assert.equal(hasVisitNotes({ stood_out: "   " }), false);
  assert.equal(hasVisitNotes({ worried: "The dorms" }), true);
  assert.equal(hasVisitNotes({ free: "Loved it" }), true);
});

test("firstPastVisitOn: the earliest date at or before today; null when every visit is future", () => {
  assert.equal(firstPastVisitOn(["2026-11-01", "2026-09-01"], "2026-10-08"), "2026-09-01");
  assert.equal(firstPastVisitOn(["2026-12-01"], "2026-10-08"), null);
  assert.equal(firstPastVisitOn([], "2026-10-08"), null);
  assert.equal(firstPastVisitOn(["2026-10-08"], "2026-10-08"), "2026-10-08", "today itself counts as past");
});

test("VISIT_KINDS and BEFORE_YOU_GO_QUESTIONS are non-empty fixed lists", () => {
  assert.ok(VISIT_KINDS.includes("campus_tour"));
  assert.ok(VISIT_KINDS.includes("virtual"));
  assert.ok(VISIT_KINDS.includes("interview"));
  assert.equal(BEFORE_YOU_GO_QUESTIONS.length > 0, true);
});

test("icsEvent: a visit's fields (name, address, registration link, a 24-hour-alert-ready timed event)", () => {
  const lines = icsEvent(
    {
      uid: "plan-visit-v1@quad.app",
      date: "2026-11-05",
      time: "10:00",
      summary: "Stanford: Campus tour",
      location: "Stanford, CA 94305",
      url: "https://visit.stanford.edu/register",
      description: "Registration: https://visit.stanford.edu/register",
    },
    "2026-10-08T12:00:00Z",
  );
  const text = lines.join("\n");
  assert.match(text, /UID:plan-visit-v1@quad\.app/);
  assert.match(text, /SUMMARY:Stanford: Campus tour/);
  assert.match(text, /LOCATION:Stanford\\, CA 94305/);
  assert.match(text, /URL:https:\/\/visit\.stanford\.edu\/register/);
  assert.match(text, /DTSTART:20261105T1000/);
});

test("icsEvent: an all-day visit (no time) still gets a DTSTART/DTEND pair", () => {
  const lines = icsEvent({ uid: "plan-visit-v2@quad.app", date: "2026-11-06", summary: "MIT: Virtual tour" });
  const text = lines.join("\n");
  assert.match(text, /DTSTART;VALUE=DATE:20261106/);
  assert.match(text, /DTEND;VALUE=DATE:20261107/);
});

/* ------------------------------------------------------------------ */
/* The generator                                                        */
/* ------------------------------------------------------------------ */

const UNIT = "123456";
const ITEM = "22222222-2222-4222-8222-222222222222";
const TODAY = "2026-10-08";

const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: ITEM,
  list_id: LIST,
  unit_id: UNIT,
  category: "target",
  status: "considering",
  outcome: null,
  round: null,
  position: 0,
  added_by: null,
  added_at: TODAY,
  decision_date: null,
  deadline_text: null,
  deadline_date: null,
  enrolling: false,
  updates: true,
  visited_on: null,
  follows_social: false,
  dream: false,
  priority: null,
  followed_networks: [],
  info_requested_on: null,
  application_platform: null,
  applied_on: null,
  complete_on: null,
  portal_url: null,
  committed_on: null,
  withdrawn_on: null,
  recommendations_count: null,
  supplements_count: null,
  transcript_shared: true,
  category_source: "auto",
  round_source: "auto",
  ...over,
});

const school = (over: Partial<PlanSchool> = {}): PlanSchool => ({
  unit_id: UNIT,
  name: "Example College",
  city: "Exampleville",
  state: "EX",
  admitRate: 0.2,
  admitRateCite: null,
  avgCost: 30000,
  avgCostCite: null,
  sticker: null,
  distanceMiles: null,
  links: null,
  social: { instagram: "example" },
  profile: null,
  logistics: null,
  aid: null,
  testPolicy: null,
  cycleStartYear: 2026,
  editionIsLastCycle: false,
  cites: {},
  gpaAverage: null,
  standing: { admitRate: 0.2, sat: null, act: null, gpaAverage: null, testPolicy: null },
  ...over,
});

const input = (over: Partial<GeneratorInput> = {}): GeneratorInput => ({
  list: { id: LIST, student_id: "s1", user_id: null, name: "My list", is_default: true, share_enabled: false, created_by: null, created: TODAY, sort: null, rounds_plan_accepted_at: null },
  items: [item()],
  schools: { [UNIT]: school() },
  profile: null,
  cycle: { cycle: "2026-27", startYear: 2026, entries: [] },
  grade: "senior_fall",
  today: TODAY,
  visits: [],
  offers: [],
  ...over,
});

test("generate: follow, when the college has accounts and none are followed yet, in season", () => {
  const tasks = generate(input());
  assert.ok(tasks.some((t) => t.kind === "follow" && t.item_id === ITEM));
});

test("generate: no follow task once a network is followed, or when the college has no accounts", () => {
  assert.ok(!generate(input({ items: [item({ followed_networks: ["instagram"] })] })).some((t) => t.kind === "follow"));
  assert.ok(!generate(input({ schools: { [UNIT]: school({ social: null }) } })).some((t) => t.kind === "follow"));
});

test("generate: request_info while info_requested_on is unset", () => {
  assert.ok(generate(input()).some((t) => t.kind === "request_info" && t.item_id === ITEM));
  assert.ok(!generate(input({ items: [item({ info_requested_on: "2026-09-01" })] })).some((t) => t.kind === "request_info"));
});

test("generate: nothing when the plan is out of season, or once a college is decided or withdrawn", () => {
  assert.deepEqual(generate(input({ grade: "earlier" })).filter((t) => t.kind === "follow" || t.kind === "request_info"), []);
  assert.deepEqual(generate(input({ items: [item({ status: "decided" })] })).filter((t) => t.kind === "follow" || t.kind === "request_info"), []);
  assert.deepEqual(generate(input({ items: [item({ withdrawn_on: "2026-09-01" })] })).filter((t) => t.kind === "follow" || t.kind === "request_info"), []);
});

const visit = (over: Partial<PlanVisit> = {}): PlanVisit => ({
  id: "v1",
  item_id: ITEM,
  kind: "campus_tour",
  on_date: "2026-09-01",
  at_time: null,
  registered: false,
  registration_url: null,
  who: [],
  rating: null,
  notes: {},
  created_by: null,
  created_at: TODAY,
  updated_at: TODAY,
  ...over,
});

test("generate: write_visit_notes once for a past visit with no notes; not for a future one or one with notes", () => {
  assert.ok(generate(input({ visits: [visit()] })).some((t) => t.kind === "write_visit_notes"));
  assert.ok(!generate(input({ visits: [visit({ on_date: "2026-12-01" })] })).some((t) => t.kind === "write_visit_notes"), "future visit");
  assert.ok(!generate(input({ visits: [visit({ notes: { stood_out: "The library" } })] })).some((t) => t.kind === "write_visit_notes"), "already has notes");
});

test("generate: the three task kinds are independent of each other on one fixture", () => {
  const tasks = generate(input({ visits: [visit()] }));
  const kinds = new Set(tasks.map((t) => t.kind));
  assert.ok(kinds.has("follow"));
  assert.ok(kinds.has("request_info"));
  assert.ok(kinds.has("write_visit_notes"));
});
