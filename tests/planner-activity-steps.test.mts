/**
 * The intake's four activity steps' pure rules (lib/planner/activity-steps.ts; specs/planner/redesign/intake.md
 * "Activities, four steps"): which step shows an entry, the entries a catalog pick or typed name start as, the one-tap
 * year chips and their default titles, the title chips per kind, the family and type picks, hours, recognition, the
 * Sports/Clubs/awards searches, and the summaries. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityByKey, roleForTitle, titlesFor } from "../lib/chances/activity-catalog.ts";
import { awardByKey } from "../lib/chances/awards-catalog.ts";
import type { ActivityEntry, ActivityKind } from "../lib/chances/types.ts";
import {
  activitiesIn,
  activityFromCatalog,
  activitySummary,
  asksFamily,
  catalogEntryName,
  CLUB_FAMILY_PICKS,
  enterPick,
  guessOtherType,
  guessWorkType,
  hoursHint,
  parseHours,
  POPULAR_AWARDS,
  POPULAR_CLUBS,
  POPULAR_SPORTS,
  recognitionChoices,
  searchAwards,
  searchStep,
  setClubFamily,
  setOtherType,
  setWorkType,
  setYearTitle,
  stepOfActivity,
  stepRailSummary,
  stepReviewValue,
  titleChoices,
  toggleYear,
  typedActivity,
  typedCandidate,
  yearChips,
  yearTitle,
} from "../lib/planner/activity-steps.ts";
import { sanitizeActivities } from "../lib/student-profile.ts";

const KINDS: ActivityKind[] = ["sport", "club", "arts", "service", "work", "research", "family", "other"];
const cat = (key: string) => activityFromCatalog(activityByKey(key)!);

test("stepOfActivity: every kind lands on exactly one step; catalog research and service are clubs, typed ones work and other", () => {
  const e = (kind: ActivityKind, catalogKey: string | null = null) => ({ kind, catalogKey });
  assert.equal(stepOfActivity(e("sport")), "sports");
  assert.equal(stepOfActivity(e("club")), "clubs");
  assert.equal(stepOfActivity(e("arts")), "clubs");
  assert.equal(stepOfActivity(e("research", "science_research_program")), "clubs");
  assert.equal(stepOfActivity(e("research")), "work");
  assert.equal(stepOfActivity(e("service", "key_club")), "clubs");
  assert.equal(stepOfActivity(e("service")), "other");
  assert.equal(stepOfActivity(e("service", "gone_key")), "other", "an old key no longer in the catalog reads as typed");
  assert.equal(stepOfActivity(e("work")), "work");
  assert.equal(stepOfActivity(e("family")), "work");
  assert.equal(stepOfActivity(e("other")), "other");
  // Each step's typed entry and each catalog entry lands back on its own step.
  for (const step of ["sports", "clubs", "work", "other"] as const) assert.equal(stepOfActivity(typedActivity(step, "Something")), step);
  for (const key of [...POPULAR_SPORTS, ...POPULAR_CLUBS, "science_research_program", "sadd"]) {
    const a = cat(key);
    assert.equal(stepOfActivity(a), a.kind === "sport" ? "sports" : "clubs", key);
  }
});

test("activitiesIn keeps list order and only the step's entries", () => {
  const list = [cat("soccer"), cat("deca"), typedActivity("work", "Barista"), cat("tennis")];
  assert.deepEqual(activitiesIn(list, "sports").map((a) => a.name), ["Soccer", "Tennis"]);
  assert.deepEqual(activitiesIn(list, "clubs").map((a) => a.name), ["DECA"]);
  assert.deepEqual(activitiesIn(list, "other"), []);
});

test("catalog picks: name, kind, family, and key from the catalog; a long '(e.g. …)' name fits 60 characters", () => {
  const deca = cat("deca");
  assert.equal(deca.name, "DECA");
  assert.equal(deca.kind, "club");
  assert.equal(deca.family, "business");
  assert.equal(deca.catalogKey, "deca");
  assert.deepEqual(deca.years, []);
  assert.equal(catalogEntryName(activityByKey("culture_club")!), "Culture Club");
  assert.equal(catalogEntryName(activityByKey("fbla")!), "FBLA (Future Business Leaders of America)");
  for (const c of [...POPULAR_SPORTS, ...POPULAR_CLUBS].map((k) => activityByKey(k)!)) assert.ok(catalogEntryName(c).length <= 60);
  // Every catalog entry survives the sanitizer as picked.
  const kept = sanitizeActivities([cat("culture_club")]);
  assert.equal(kept.length, 1);
});

test("typed entries: a sport is athletics, a club waits for its family pick, work and other guess their type from the words", () => {
  assert.equal(typedActivity("sports", "Sumo").family, "athletics");
  const club = typedActivity("clubs", "Bee club");
  assert.equal(club.kind, "club");
  assert.equal(club.family, null);
  assert.equal(asksFamily(club), true);
  assert.equal(asksFamily(cat("deca")), false, "a catalog club already has its family");
  assert.equal(guessWorkType("Lab assistant at UCSF"), "research");
  assert.equal(guessWorkType("Babysitting my brothers"), "family");
  assert.equal(guessWorkType("Family responsibilities"), "family");
  assert.equal(guessWorkType("Cashier at Target"), "job");
  assert.equal(typedActivity("work", "Research position").kind, "research");
  assert.equal(typedActivity("work", "Taking care of my sister").kind, "family");
  assert.equal(guessOtherType("Food bank volunteer"), "service");
  assert.equal(guessOtherType("Independent project"), "other");
  assert.equal(typedActivity("other", "Volunteering").kind, "service");
  assert.equal(typedActivity("other", "x".repeat(80)).name.length, 60);
});

test("family pick: arts makes a typed club an arts entry, anything else a club; catalog entries never change", () => {
  let a = toggleYear(typedActivity("clubs", "Ukulele club"), 10);
  a = setClubFamily(a, "arts");
  assert.equal(a.kind, "arts");
  assert.equal(a.family, "arts");
  assert.equal(stepOfActivity(a), "clubs");
  a = setClubFamily(a, "science");
  assert.equal(a.kind, "club");
  assert.equal(yearTitle(a, 10), "Member");
  const deca = cat("deca");
  assert.equal(setClubFamily(deca, "arts"), deca);
  assert.equal(CLUB_FAMILY_PICKS.length, new Set(CLUB_FAMILY_PICKS.map((f) => f.family)).size);
});

test("type picks: work ↔ research ↔ family and volunteering ↔ other keep titles the new kind offers, else its first", () => {
  let job = setYearTitle(typedActivity("work", "Grocery store"), 11, "Shift lead");
  job = setWorkType(job, "family");
  assert.equal(job.kind, "family");
  assert.equal(yearTitle(job, 11), "Shared responsibility");
  assert.equal(job.roles[11], "member");
  assert.equal(stepOfActivity(job), "work");
  let v = toggleYear(typedActivity("other", "Volunteering"), 9);
  v = setOtherType(v, "other");
  assert.equal(v.kind, "other");
  assert.equal(v.family, null);
  v = setOtherType(v, "service");
  assert.equal(v.family, "service");
});

test("title chips: every title in activity-roles.json is offered for its kind exactly once; sports lead with JV · Varsity · Captain", () => {
  for (const kind of KINDS) {
    const { primary, more } = titleChoices(kind);
    assert.deepEqual([...primary, ...more].sort(), titlesFor(kind).map((t) => t.title).sort(), kind);
  }
  assert.deepEqual(titleChoices("sport").primary, ["JV", "Varsity", "Captain"]);
  assert.ok(titleChoices("sport").more.includes("Co-captain"));
  assert.deepEqual(titleChoices("club").primary, ["Member", "Vice President", "President", "Founder"]);
});

test("year chips: one tap on, one tap off; a new year takes the nearest earlier year's title, else the nearest later, else the default; roles follow titles", () => {
  let s = cat("soccer");
  s = toggleYear(s, 9);
  assert.deepEqual(s.titles, { 9: "JV" });
  s = setYearTitle(s, 9, "Varsity");
  s = toggleYear(s, 10);
  assert.equal(yearTitle(s, 10), "Varsity", "carried from 9th");
  s = setYearTitle(s, 12, "Captain");
  assert.deepEqual(s.years, [9, 10, 12], "picking a title checks its year");
  assert.equal(s.roles[12], roleForTitle("sport", "Captain"));
  assert.equal(s.roles[12], "leader");
  s = toggleYear(s, 10);
  assert.deepEqual(s.years, [9, 12]);
  assert.equal(s.titles?.[10], undefined);
  assert.equal(s.roles[10], undefined);
  let late = toggleYear(setYearTitle(cat("tennis"), 12, "Captain"), 11);
  assert.equal(yearTitle(late, 11), "Captain", "with no earlier year, the later one's title");
  late = toggleYear(late, 11);
  assert.deepEqual(late.years, [12]);
  const intern = toggleYear(typedActivity("work", "Summer internship"), 11);
  assert.equal(yearTitle(intern, 11), "Intern");
  assert.equal(yearTitle(toggleYear(typedActivity("work", "Cashier"), 11), 11), "Employee");
});

test("yearTitle reads an entry saved before titles from its role tier, and the first title edit keeps the others as shown", () => {
  const old: ActivityEntry = { id: "o", name: "Robotics", kind: "club", years: [10, 11], roles: { 10: "member", 11: "officer" }, hoursPerWeek: null, recognition: null, relatedToMajor: false };
  assert.equal(yearTitle(old, 10), "Member");
  assert.equal(yearTitle(old, 11), "Committee chair");
  assert.equal(yearTitle(old, 12), null);
  const edited = setYearTitle(old, 10, "Founder");
  assert.deepEqual(edited.titles, { 10: "Founder", 11: "Committee chair" });
  assert.deepEqual(edited.roles, { 10: "leader", 11: "officer" });
});

test("yearChips: 9th–12th with the school year once the class is known", () => {
  assert.deepEqual(yearChips(2027).map((c) => c.sub), ["23–24", "24–25", "25–26", "26–27"]);
  assert.deepEqual(yearChips(null).map((c) => [c.label, c.sub]), [["9th", null], ["10th", null], ["11th", null], ["12th", null]]);
});

test("hours: a whole number 1–60 or nothing, with a hint only when it's out of range", () => {
  assert.equal(parseHours("12"), 12);
  assert.equal(parseHours(" 1 "), 1);
  assert.equal(parseHours("0"), null);
  assert.equal(parseHours("61"), null);
  assert.equal(parseHours("4.5"), null);
  assert.equal(parseHours(""), null);
  assert.equal(hoursHint(""), null);
  assert.equal(hoursHint("12"), null);
  assert.equal(hoursHint("90"), "A number from 1 to 60.");
});

test("recognition chips: school, state or regional, national per step (none for work), worded for the step", () => {
  assert.deepEqual(recognitionChoices("work"), []);
  for (const step of ["sports", "clubs", "other"] as const) assert.deepEqual(recognitionChoices(step).map((r) => r.tier), [3, 2, 1]);
  assert.match(recognitionChoices("sports").map((r) => r.label).join(" "), /all-state/i);
  assert.match(recognitionChoices("clubs").map((r) => r.example).join(" "), /DECA/);
});

test("Sports and Clubs search: popular chips before typing; acronyms find DECA, HOSA, MUN; added ones never show again", () => {
  assert.deepEqual(searchStep("sports", "", []).map((c) => c.key), POPULAR_SPORTS.slice(0, 8));
  assert.deepEqual(searchStep("clubs", "", ["national_honor_society"]).map((c) => c.key), POPULAR_CLUBS.filter((k) => k !== "national_honor_society").slice(0, 8));
  for (const k of [...POPULAR_SPORTS, ...POPULAR_CLUBS]) assert.ok(activityByKey(k), `popular ${k} is in the catalog`);
  assert.equal(searchStep("clubs", "DECA", [])[0].key, "deca");
  assert.equal(searchStep("clubs", "hosa", [])[0].key, "hosa");
  assert.equal(searchStep("clubs", "MUN", [])[0].key, "model_un");
  assert.equal(searchStep("sports", "xc", [])[0].key, "cross_country");
  assert.equal(searchStep("clubs", "DECA", ["deca"]).some((c) => c.key === "deca"), false);
  assert.equal(searchStep("sports", "DECA", []).length, 0, "sports search never shows clubs");
});

test("typed candidates and Enter: an exact acronym or name is the catalog entry; anything else adds as typed", () => {
  const m = searchStep("clubs", "mun", []);
  assert.equal((enterPick("mun", m) as { key: string }).key, "model_un");
  assert.equal(typedCandidate("DECA", searchStep("clubs", "DECA", [])), null, "an exact name isn't offered again as typed");
  assert.equal(typedCandidate("  Bee   club ", []), "Bee club");
  assert.equal(enterPick("Bee club", []), "Bee club");
  assert.equal(enterPick("   ", []), null);
});

test("awards search: popular awards first; nicknames and word starts find the rest; added awards never show again", () => {
  for (const k of POPULAR_AWARDS) assert.ok(awardByKey(k), `popular ${k} is in the catalog`);
  assert.deepEqual(searchAwards("", []).map((a) => a.key), POPULAR_AWARDS.slice(0, 8));
  assert.equal(searchAwards("nmsf", [])[0].key, "national_merit_semifinalist");
  assert.equal(searchAwards("eagle", [])[0].key, "eagle_scout");
  assert.equal(searchAwards("ap sch", [])[0].key, "ap_scholar_distinction");
  assert.equal(searchAwards("honor roll", ["honor_roll"]).some((a) => a.key === "honor_roll"), false);
  assert.deepEqual(searchAwards("zzzz", []), []);
});

test("summaries: a card's pill, a step's Review value, and its rail line", () => {
  const s = setYearTitle(toggleYear(toggleYear(cat("soccer"), 10), 11), 12, "Captain");
  assert.deepEqual(activitySummary(s), { text: "3 years · Captain", incomplete: false });
  assert.deepEqual(activitySummary(cat("deca")), { text: "Pick years", incomplete: true });
  assert.deepEqual(activitySummary(toggleYear(cat("deca"), 11)), { text: "11th", incomplete: false });
  assert.equal(activitySummary(toggleYear(typedActivity("clubs", "Bee club"), 11)).incomplete, true, "a typed club without a family");
  const list = [s, cat("tennis"), cat("golf"), cat("deca")];
  assert.equal(stepReviewValue("sports", list, []), "Soccer, Tennis +1 more");
  assert.equal(stepReviewValue("work", list, []), "Not added", "empty and unanswered");
  assert.equal(stepReviewValue("work", list, [], true), "None", "the student chose None (owner, 2026-10-12)");
  assert.equal(stepReviewValue("other", [], []), "Not added");
  assert.equal(stepRailSummary("sports", list, []), "3 sports");
  assert.equal(stepRailSummary("clubs", list, []), "1 club");
  assert.equal(stepRailSummary("work", list, []), null);
});
