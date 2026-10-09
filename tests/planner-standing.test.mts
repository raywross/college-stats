/**
 * The redesigned planner's standing model and starting rounds (lib/planner/standing.ts, lib/planner/auto-rounds.ts;
 * specs/planner/redesign/standing.md and rounds.md). Pure. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { actToSat, balance, retakeSuggestion, satToAct, scoreToMoveUp, standingFor, type StandingSchool } from "../lib/planner/standing.ts";
import { autoRounds, edTwoSuggestion, roundProblems, type AutoRoundsSchool } from "../lib/planner/auto-rounds.ts";

const school = (over: Partial<StandingSchool> = {}): StandingSchool => ({ admitRate: 0.45, sat: [1280, 1450], act: [28, 33], gpaAverage: null, testPolicy: "considered", ...over });
const sat = (score: number, gpa: number | null = null) => ({ gpa, test: { kind: "sat" as const, score } });
const act = (score: number, gpa: number | null = null) => ({ gpa, test: { kind: "act" as const, score } });

test("the examples in standing.md", () => {
  assert.equal(standingFor(sat(1450), school({ admitRate: 0.06, sat: [1500, 1560] })).fit, "reach");
  assert.equal(standingFor(sat(1450), school({ admitRate: 0.06, sat: [1500, 1560] })).reachForEveryone, true);
  assert.equal(standingFor(sat(1450), school({ admitRate: 0.45, sat: [1280, 1450] })).fit, "target");
  assert.equal(standingFor(sat(1450), school({ admitRate: 0.78, sat: [1100, 1300] })).fit, "likely");
  assert.equal(standingFor(act(24), school({ admitRate: 0.4, testPolicy: "required" })).fit, "reach");
  assert.equal(standingFor({ gpa: 3.9, test: null }, school({ admitRate: 0.35, gpaAverage: 3.7 })).fit, "target");
});

test("open admission is Likely; no numbers is no standing", () => {
  assert.equal(standingFor(sat(1000), school({ admitRate: null })).fit, "likely");
  assert.equal(standingFor({ gpa: null, test: null }, school()).fit, null);
});

test("above everywhere: Likely from 50%, Target below it", () => {
  assert.equal(standingFor(sat(1500), school({ admitRate: 0.5 })).fit, "likely");
  assert.equal(standingFor(sat(1500), school({ admitRate: 0.49 })).fit, "target");
});

test("one above and one inside: Likely from 60%, Target below it", () => {
  assert.equal(standingFor(sat(1390, 3.82), school({ admitRate: 0.63, sat: [1170, 1350], gpaAverage: 3.88, testPolicy: "required" })).fit, "likely");
  assert.equal(standingFor(sat(1390, 3.82), school({ admitRate: 0.55, sat: [1170, 1350], gpaAverage: 3.88, testPolicy: "required" })).fit, "target");
});

test("inside the range at a generous college is Likely; one weak measure there is a Target, two are a Reach", () => {
  assert.equal(standingFor(sat(1350), school({ admitRate: 0.75, testPolicy: "required" })).fit, "likely");
  assert.equal(standingFor(sat(1200, 3.9), school({ admitRate: 0.75, gpaAverage: 3.5, testPolicy: "required" })).fit, "target");
  assert.equal(standingFor(sat(1200, 3.0), school({ admitRate: 0.75, gpaAverage: 3.5, testPolicy: "required" })).fit, "reach");
});

test("test-optional: a score under the range is left out and the advice says so", () => {
  const r = standingFor(sat(1200, 3.8), school({ gpaAverage: 3.75 }));
  assert.equal(r.test?.used, false);
  assert.equal(r.send, "consider-not-sending");
  assert.equal(r.fit, "target"); // GPA alone, inside
  const req = standingFor(sat(1200, 3.8), school({ gpaAverage: 3.75, testPolicy: "required" }));
  assert.equal(req.fit, "reach");
  assert.equal(req.send, "send");
});

test("test-blind colleges ignore the score", () => {
  const r = standingFor(sat(1590), school({ testPolicy: "not-considered" }));
  assert.equal(r.test, null);
  assert.equal(r.send, "not-used");
  assert.equal(r.fit, null);
});

test("concordance: an ACT reads against an SAT-only range and says so", () => {
  assert.equal(actToSat(31), 1400);
  assert.equal(satToAct(1400), 31);
  assert.equal(satToAct(1405), 31);
  const r = standingFor(act(31), school({ act: null, sat: [1300, 1450] }));
  assert.equal(r.test?.concorded, true);
  assert.equal(r.test?.position, "in");
  assert.match(r.reasons.join(" "), /concordance/);
});

test("score to move up: the fewest points, on the student's own test", () => {
  const up = scoreToMoveUp(sat(1390), school({ admitRate: 0.22, sat: [1400, 1510] }));
  assert.deepEqual(up, { score: 1400, delta: 10, from: "reach", to: "target" });
  assert.equal(scoreToMoveUp(sat(1390), school({ admitRate: 0.1 })), null, "Reach for everyone");
  assert.equal(scoreToMoveUp(sat(1550), school({ admitRate: 0.6 })), null, "already Likely");
  const actUp = scoreToMoveUp(act(27), school({ admitRate: 0.55, act: [24, 30], testPolicy: "required" }));
  assert.deepEqual(actUp, { score: 31, delta: 4, from: "target", to: "likely" });
});

test("retake suggestion: only moves within a common retake gain, largest needed first-to-last", () => {
  const list = [
    { id: "wake", school: school({ admitRate: 0.22, sat: [1400, 1510] }) },
    { id: "rhodes", school: school({ admitRate: 0.52, sat: [1330, 1430] }) },
    { id: "far", school: school({ admitRate: 0.3, sat: [1500, 1560] }) },
    { id: "ivy", school: school({ admitRate: 0.05, sat: [1500, 1560] }) },
  ];
  const s = retakeSuggestion(sat(1390), list);
  assert.ok(s);
  assert.deepEqual(s.moves.map((m) => m.id), ["wake", "rhodes"]);
  assert.equal(s.delta, 50);
  assert.equal(s.target, 1440);
  assert.equal(retakeSuggestion(sat(1390), [list[2], list[3]]), null);
});

test("balance counts", () => {
  assert.deepEqual(balance(["reach", "target", "target", null, "likely"]), { reach: 1, target: 2, likely: 1 });
});

/* Starting rounds */

const s = (o: { ed?: boolean; ed2?: boolean; ea?: boolean; rea?: boolean; type?: string } = {}): AutoRoundsSchool => ({
  type: o.type ?? "private-nonprofit",
  profile: {
    early_decision: o.ed ? { offered: true, first: null, other: o.ed2 ? { closing: null, notification: null } : null } : { offered: false },
    early_action: o.ea || o.rea ? { offered: true, restrictive: !!o.rea, closing: null, notification: null } : { offered: false },
  } as AutoRoundsSchool["profile"],
  logistics: null,
});

test("the Dream starts in ED where offered; nobody else starts binding", () => {
  const schools = { a: s({ ed: true, ea: true }), b: s({ ed: true, ea: true }), c: s({ ed: true }) };
  const r = autoRounds(
    [
      { id: "a", dream: true, chosen: null },
      { id: "b", dream: false, chosen: null },
      { id: "c", dream: false, chosen: null },
    ],
    schools,
  );
  assert.deepEqual(r.map((x) => x.round), ["ed", "ea", "rd"]);
  assert.ok(r.every((x) => x.auto));
});

test("no Dream, no ED", () => {
  const r = autoRounds([{ id: "a", dream: false, chosen: null }], { a: s({ ed: true }) });
  assert.equal(r[0].round, "rd");
});

test("a Dream with REA keeps private colleges out of EA, public ones in", () => {
  const r = autoRounds(
    [
      { id: "d", dream: true, chosen: null },
      { id: "p", dream: false, chosen: null },
      { id: "u", dream: false, chosen: null },
    ],
    { d: s({ rea: true }), p: s({ ea: true }), u: s({ ea: true, type: "public" }) },
  );
  assert.deepEqual(r.map((x) => x.round), ["rea", "rd", "ea"]);
});

test("the student's pick wins and is not auto", () => {
  const r = autoRounds([{ id: "a", dream: true, chosen: "rd" }], { a: s({ ed: true }) });
  assert.deepEqual([r[0].round, r[0].auto], ["rd", false]);
});

test("ED II is suggested, never set, and only behind an early Dream", () => {
  const items = [
    { id: "d", dream: true, chosen: null },
    { id: "x", dream: false, chosen: null },
  ];
  const schools = { d: s({ ed: true }), x: s({ ed: true, ed2: true }) };
  const rounds = autoRounds(items, schools);
  assert.equal(rounds[1].round, "rd");
  assert.equal(edTwoSuggestion(items, rounds, schools), "x");
  assert.equal(edTwoSuggestion([{ ...items[0], dream: false }, items[1]], autoRounds([{ ...items[0], dream: false }, items[1]], schools), schools), null);
});

test("problems appear only when they exist", () => {
  const names = { a: "A", b: "B" };
  const schools = { a: s({ ed: true }), b: s({ ed: true }) };
  assert.deepEqual(roundProblems(autoRounds([{ id: "a", dream: true, chosen: null }, { id: "b", dream: false, chosen: null }], schools), schools, names), []);
  const two = roundProblems(
    [
      { id: "a", round: "ed", auto: false, why: "" },
      { id: "b", round: "ed", auto: false, why: "" },
    ],
    schools,
    names,
  );
  assert.equal(two.length, 1);
  assert.match(two[0], /only one college/);
});
