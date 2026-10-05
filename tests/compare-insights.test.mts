/**
 * The compare overview's card sentences (lib/compare-insights.ts, specs/compare-redesign.md#overview-page): each
 * topic's sentence for the pilot colleges, for two and four colleges, when colleges report little or nothing, ties,
 * and the length cap; never a national rank or percentile. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareTakeaway, listNames, majorInSentence, timesInWords } from "../lib/compare-insights.ts";
import { TOPIC_KEYS, type TopicKey } from "../lib/profile-topics.ts";
import type { School } from "../lib/types";
import { ADLER, BLANK, HARVARD, OHIO_STATE, UCLA, school } from "./helpers/compare-schools.mts";

const all = (schools: School[]) => Object.fromEntries(TOPIC_KEYS.map((k) => [k, compareTakeaway(k, schools)])) as Record<TopicKey, string | undefined>;

test("the pilot three: one sentence per card, two clauses at most, in the mockup's voice", () => {
  assert.deepEqual(all([HARVARD, OHIO_STATE, UCLA]), {
    admissions: "Harvard admits 4.2%, UCLA 9.0%, Ohio State 61%; Harvard's yield is highest at 84%.",
    students: "Ohio State is six times Harvard's size; UCLA has the largest Pell share.",
    academics: "Econometrics and Quantitative Economics leads at Harvard and UCLA, and Finance at Ohio State; Harvard has 7 students per faculty member to UCLA's 20.",
    cost: "Ohio State costs about $17.6K less a year than Harvard on average; Harvard's grants cover the largest share of its price.",
    outcomes: "Harvard's former students earn the most, a median $101.8K ten years after enrolling; all three graduate more than 80% within six years.",
    history: "Applications grew at all three; UCLA got more selective, Ohio State less, and Harvard held steady.",
  });
});

test("two colleges: comparatives (higher, not highest), and a college that leads twice is named once", () => {
  assert.deepEqual(all([HARVARD, OHIO_STATE]), {
    admissions: "Harvard admits 4.2%, Ohio State 61%; Harvard's yield is higher, at 84%.",
    students: "Ohio State is six times Harvard's size and has the larger Pell share.",
    academics: "Econometrics and Quantitative Economics leads at Harvard, and Finance at Ohio State; Harvard has 7 students per faculty member to Ohio State's 16.",
    cost: "Ohio State costs about $17.6K less a year than Harvard on average; Harvard's grants cover the larger share of its price.",
    outcomes: "Harvard's former students earn more, a median $101.8K ten years after enrolling; both graduate more than 80% within six years.",
    history: "Applications grew at both; Ohio State got less selective while Harvard held steady.",
  });
  // The cheapest is also the most generous: one clause.
  const generous = school({ id: "900010", name: "Generous College", cost: 20000, price: { full: 60000, grants: 40000 } });
  assert.equal(compareTakeaway("cost", [HARVARD, generous]), "Generous costs about $28.3K less a year than Harvard on average, and its grants cover the larger share of its price.");
});

test("four colleges, one reporting almost nothing: only colleges with a figure are named", () => {
  assert.deepEqual(all([HARVARD, OHIO_STATE, UCLA, ADLER]), {
    admissions: "Harvard admits 4.2%, UCLA 9.0%, Ohio State 61%; Adler doesn't report an acceptance rate.",
    // Beyond twenty times, the two counts say it better than "5,071×".
    students: "Adler has 9 undergrads to Ohio State's 45,638; UCLA has the largest Pell share.",
    // Four majors make a long clause; the ratio clause would pass the length cap, so it's left out.
    academics: "Econometrics and Quantitative Economics leads at Harvard and UCLA, Finance at Ohio State, and Applied Psychology at Adler.",
    cost: "Ohio State costs about $17.6K less a year than Harvard on average; Harvard's grants cover the largest share of its price.",
    outcomes: "Harvard's former students earn the most, a median $101.8K ten years after enrolling; Harvard, Ohio State, and UCLA all graduate more than 80% within six years.",
    history: "Applications grew at Harvard, Ohio State, and UCLA; UCLA got more selective, Ohio State less, and Harvard held steady.",
  });
});

test("open admission, test-blind, no history, and a college reporting nothing", () => {
  // No acceptance rate (open admission): said plainly, never read as 0%.
  assert.equal(compareTakeaway("admissions", [UCLA, ADLER]), "UCLA admits 9.0%; Adler doesn't report an acceptance rate.");
  assert.equal(compareTakeaway("admissions", [UCLA, ADLER, BLANK]), "UCLA admits 9.0%; Adler and Blank don't report an acceptance rate.");
  assert.equal(compareTakeaway("admissions", [ADLER, BLANK]), "Neither reports an acceptance rate.");
  assert.equal(compareTakeaway("admissions", [ADLER, BLANK, school({ id: "900011", name: "Other College" })]), "None of the three reports an acceptance rate.");
  // No ten-year history at either: no sentence (the card is hidden too).
  assert.equal(compareTakeaway("history", [ADLER, BLANK]), undefined);
  assert.equal(compareTakeaway("cost", [ADLER, BLANK]), undefined);
  assert.equal(compareTakeaway("outcomes", [ADLER, BLANK]), undefined);
  // One college with the figure: "only", never a comparison with a missing value.
  assert.equal(compareTakeaway("cost", [HARVARD, ADLER]), "Only Harvard reports an average cost ($48.3K).");
  assert.equal(
    compareTakeaway("outcomes", [HARVARD, ADLER]),
    "Harvard's former students earn a median $101.8K ten years after enrolling; only Harvard reports a graduation rate (98%)."
  );
  assert.equal(compareTakeaway("academics", [BLANK, school({ id: "900012", name: "Ratio College", ratio: 12 })]), "Only Ratio reports a student-to-faculty ratio (12 to 1).");
  assert.equal(compareTakeaway("history", [HARVARD, ADLER]), "Applications grew at Harvard, whose selectivity held steady.");
  assert.equal(compareTakeaway("history", [UCLA, ADLER, BLANK]), "Applications grew at UCLA, which got more selective.");
  assert.equal(compareTakeaway("students", [BLANK, ADLER]), "Adler has 9 undergrads to Blank's 500.");
  assert.equal(compareTakeaway("students", [UCLA, ADLER]), "Adler has 9 undergrads to UCLA's 33,475; only UCLA reports a Pell share (28%).");
  // A comparison needs two.
  assert.equal(compareTakeaway("admissions", [HARVARD]), undefined);
});

test("ties read as ties, at the printed precision", () => {
  const twin = school({ id: "900013", name: "Twin College", undergrads: 33000, pell: 0.2819, rate: 0.4, admitted: 800, enrolled: 400, cost: 32500, ratio: 20 });
  // 28.2% and 28.2% print as 28%: two colleges share the top.
  assert.equal(compareTakeaway("students", [HARVARD, UCLA, twin]), "UCLA has 4.4× as many undergrads as Harvard; UCLA and Twin have the largest Pell shares.");
  assert.equal(compareTakeaway("students", [UCLA, twin]), "UCLA and Twin are about the same size; both have the same Pell share, 28%.");
  const half = school({ id: "900014", name: "Half College", rate: 0.5, admitted: 1000, enrolled: 500 });
  assert.equal(compareTakeaway("admissions", [half, twin]), "Twin admits 40%, Half 50%; both have the same yield, 50%.");
  assert.equal(compareTakeaway("cost", [UCLA, twin]), "UCLA and Twin cost about the same a year on average.");
  assert.equal(compareTakeaway("academics", [UCLA, twin]), "Econometrics and Quantitative Economics leads at UCLA; both have 20 students per faculty member.");
  assert.equal(compareTakeaway("academics", [HARVARD, UCLA])?.split(";")[0], "Econometrics and Quantitative Economics leads at both");
  // Selectivity: the smaller group first, "more" on a tie.
  const tighter = school({ id: "900015", name: "Tighter College", apps: { since: 2014, from: 5000, to: 9000, change: 0.8 }, rateTrend: { since: 2014, from: 0.4, to: 0.3, change: -0.1 } });
  assert.equal(compareTakeaway("history", [OHIO_STATE, UCLA, tighter]), "Applications grew at all three; Ohio State got less selective while UCLA and Tighter got more.");
  assert.equal(compareTakeaway("history", [OHIO_STATE, UCLA]), "Applications grew at both; UCLA got more selective while Ohio State got less.");
});

test("graduation: a floor every college clears when the rates are close, the range when they aren't", () => {
  const at = (id: string, grad: number) => school({ id, name: `${id} College`, grad });
  assert.equal(compareTakeaway("outcomes", [at("A", 0.9835), at("B", 0.7996)]), "Both graduate at least 80% within six years.", "79.96% prints as 80%");
  assert.equal(compareTakeaway("outcomes", [at("A", 0.95), at("B", 0.8312), at("C", 0.91)]), "All three graduate more than 80% within six years.");
  assert.equal(compareTakeaway("outcomes", [at("A", 0.91), at("B", 0.64)]), "Six-year graduation runs from 91% at A to 64% at B.");
  assert.equal(compareTakeaway("outcomes", [at("A", 0.45), at("B", 0.45)]), "Both graduate 45% within six years.");
});

test("a second clause that would make the sentence too long is left out, not run on", () => {
  assert.equal(compareTakeaway("cost", [HARVARD, OHIO_STATE, UCLA], { maxLength: 100 }), "Ohio State costs about $17.6K less a year than Harvard on average.");
  const sets = [[HARVARD, OHIO_STATE, UCLA], [HARVARD, OHIO_STATE], [HARVARD, OHIO_STATE, UCLA, ADLER], [UCLA, ADLER], [ADLER, BLANK]];
  for (const set of sets) for (const k of TOPIC_KEYS) {
    const s = compareTakeaway(k, set);
    if (!s) continue;
    assert.ok(s.length <= 171, `${k}: ${s}`);
    assert.ok(s.split(";").length <= 2, `${k}: more than two clauses: ${s}`);
    assert.match(s, /^[A-Z].*\.$/, `${k}: a sentence`);
  }
});

test("never a national rank, a percentile, or a made-up figure", () => {
  const sets = [[HARVARD, OHIO_STATE, UCLA], [HARVARD, OHIO_STATE], [HARVARD, OHIO_STATE, UCLA, ADLER], [UCLA, ADLER], [ADLER, BLANK]];
  for (const set of sets)
    for (const k of TOPIC_KEYS) {
      const s = compareTakeaway(k, set) ?? "";
      assert.doesNotMatch(s, /nation|percentile|rank|of colleges|typical|median of/i, `${k}: ${s}`);
      assert.doesNotMatch(s, /(^|[^\d.])0%|\$0\b|NaN|undefined|null|Infinity/, `${k}: ${s}`);
    }
});

test("wording: lists, sizes in words only when the ratio is whole, and program titles in a sentence", () => {
  assert.equal(listNames(["Harvard"]), "Harvard");
  assert.equal(listNames(["Harvard", "UCLA"]), "Harvard and UCLA");
  assert.equal(listNames(["Harvard", "UCLA", "Ohio State"]), "Harvard, UCLA, and Ohio State");
  assert.equal(timesInWords(45638 / 7601), "six times");
  assert.equal(timesInWords(2.04), "twice");
  assert.equal(timesInWords(12.0), "12 times");
  assert.equal(timesInWords(33475 / 7601), null, "4.4: not whole, so '4.4× as many'");
  assert.equal(timesInWords(1.02), null);
  assert.equal(majorInSentence("Finance, General"), "Finance");
  assert.equal(majorInSentence("Computer and Information Sciences,  Other"), "Computer and Information Sciences");
  assert.equal(majorInSentence("Registered Nursing/Registered Nurse"), "Registered Nursing/Registered Nurse");
});
