/**
 * The hand read (specs/product/essays/sources.md "The hand read"; the hand-read brief, unit U1): the record's checks
 * (`validateConfirmed`, each rule broken on purpose), kept in step with the reader's `promptProblems`; the paste box's
 * splitter; the file's text; the platform homepages; the merge's precedence (a reader `published` wins, else the hand
 * read, open cycle only); lineage on a real college (the University of Florida, 134130, from data/schools.json, with a
 * placeholder record, never a real student's words) passing `validateLineage` with the real data/meta.json and
 * re-merging byte for byte, including after the college-reported and selectivity merges; the merge CLI's refusal; the
 * display words; the advisor's live overlay; the nightly export writing recordJson's bytes; and the table's policies
 * on PGlite (anyone reads, only an admin writes). `npm test`. No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { FIELDS } from "../lib/fields.ts";
import { lineageFor, validateLineage, validateSchool } from "../lib/lineage.ts";
import type { DatasetMeta, EssayPrompt, School } from "../lib/types.ts";
import {
  FORM_KINDS,
  LIMIT_RANGE,
  PLATFORM_HOMEPAGE,
  PROMPT_CHARS,
  confirmedPromptProblems,
  handReadLine,
  noneSentence,
  openCycleOf,
  overlayEssays,
  platformHomepage,
  recordJson,
  splitPastedPrompts,
  validateConfirmed,
  type ConfirmedRecord,
} from "../lib/essay-prompts/confirmed.ts";
import { collegeNote } from "../lib/essays/tab-view.ts";
import { pickerGroups, resolvePrompt, sourceOf, type PromptLookup } from "../lib/essays/prompts.ts";
import { essayProgress } from "../lib/essays/progress.ts";
import { LIMIT_RANGE as CHECK_LIMITS, PROMPT_CHARS as CHECK_CHARS, promptProblems } from "../scripts/lib/essay-prompts/checks.mts";
import { openCycle } from "../scripts/lib/essay-prompts/cycle.mts";
import { applyEssays, blockOf, confirmedProblems, lineageOf, summaryLine } from "../scripts/lib/essay-prompts/merge.mts";
import { essayPaths, readConfirmedRecords, readEssayRecords, type EssayRecord } from "../scripts/lib/essay-prompts/store.mts";
import { applyExport, planExport, readConfirmedFiles, type OverrideRow } from "../scripts/lib/essay-prompts/export-confirmed.mts";
import { formatSchools } from "../scripts/lib/identity-sync.mts";
import { placeSelectivity } from "../scripts/lib/selectivity.mts";
import { mergeReported } from "../lib/reported-merge.ts";
import type { ReportedFile } from "../lib/reported.ts";
import { CDS_TEMPLATE } from "../lib/cds-template.ts";
import { readRecords } from "../scripts/lib/college-reported/records.mts";
import { AUTH_STUB_SQL, asUser, createUser, type AuthDb } from "./helpers/pg-auth.mts";

const ROOT = join(import.meta.dirname, "..");
const TODAY = "2026-10-30";
const CYCLE = openCycle(TODAY);
const UF = "134130";
const schools = JSON.parse(readFileSync(join(ROOT, "data", "schools.json"), "utf8")) as School[];
const meta = JSON.parse(readFileSync(join(ROOT, "data", "meta.json"), "utf8")) as DatasetMeta;
const ufSchool = () => structuredClone(schools.find((s) => s.unit_id === UF)!);
const realRecords = readEssayRecords(essayPaths(ROOT).records);

/* ------------------------------------------------------------------ */
/* Fixtures (placeholder prompts, not a college's or a student's text) */
/* ------------------------------------------------------------------ */

function prompt(n: number, text: string, o: Partial<EssayPrompt> = {}, unit = UF): EssayPrompt {
  return { id: `${unit}:${CYCLE}:${n}`, text, kind: "short_answer", limit: { kind: "words", max: 250 }, required: true, applies_to: "all", quote: text, ...o };
}

function record(o: Partial<ConfirmedRecord> = {}): ConfirmedRecord {
  return {
    unit_id: UF,
    name: "University of Florida",
    cycle: CYCLE,
    status: "published",
    confidence: "confirmed",
    source: "form-by-hand",
    form: "common_app",
    read_on: TODAY,
    reader: "RR",
    prompts: [
      prompt(1, "Placeholder question one: describe an activity or interest that has shaped how you spend your time."),
      prompt(2, "Placeholder question two: tell us about a community you belong to and your place in it.", { limit: { kind: "characters", max: 1000 } }),
    ],
    ...o,
  };
}

/** A reader record (the college's own page) for a college. */
function readerRecord(school: School, o: Partial<EssayRecord> = {}): EssayRecord {
  return {
    unit_id: school.unit_id,
    name: school.name,
    cycle: CYCLE,
    status: "refers_to_form",
    source_url: "https://admissions.example.edu/apply",
    retrieved: "2026-10-20",
    sha256: "x".repeat(64),
    cycle_quote: "",
    cycle_assumed: true,
    status_quote: "Complete the supplement questions in the Common Application.",
    via: "known-link",
    model: "fake",
    reader: "test",
    prompts: [],
    ...o,
  };
}

/* ------------------------------------------------------------------ */
/* validateConfirmed                                                   */
/* ------------------------------------------------------------------ */

test("validateConfirmed: the fixture passes, as published and as none", () => {
  assert.deepEqual(validateConfirmed(record(), TODAY), []);
  assert.deepEqual(validateConfirmed(record({ status: "none", prompts: [] }), TODAY), []);
  for (const form of FORM_KINDS) assert.deepEqual(validateConfirmed(record({ form }), TODAY), [], form);
  const choose = record({
    prompts: [
      prompt(1, "Placeholder required question: why this university, in your own words?"),
      prompt(2, "Placeholder choice A: a challenge you met and what came of it.", { required: false }),
      prompt(3, "Placeholder choice B: an idea that kept you up at night.", { required: false }),
    ],
    choose: { n: 1, of: 2, quote: "Answer one of the following." },
  });
  assert.deepEqual(validateConfirmed(choose, TODAY), []);
});

test("validateConfirmed: each guard fails when its rule is broken", () => {
  const fails = (r: ConfirmedRecord, expect: RegExp) => {
    const problems = validateConfirmed(r, TODAY);
    assert.ok(problems.some((p) => expect.test(p)), `expected ${expect} in ${JSON.stringify(problems)}`);
  };
  const withPrompt = (o: Partial<EssayPrompt>) => record({ prompts: [prompt(1, "Placeholder question: tell us about something you made.", o)] });
  fails(record({ unit_id: "13413x" }), /unit_id "13413x" isn't 1 to 12 digits/);
  fails(record({ unit_id: "1234567890123" }), /isn't 1 to 12 digits/);
  fails(record({ name: " " }), /name is missing/);
  fails(record({ cycle: "2026-28" }), /cycle "2026-28" isn't "YYYY-YY"/);
  fails(record({ cycle: "2026-2027" }), /isn't "YYYY-YY"/);
  fails(record({ status: "refers_to_form" as never }), /status "refers_to_form" isn't published or none/);
  fails(record({ confidence: "likely" as never }), /confidence must be "confirmed"/);
  fails(record({ source: "form-by-families" as never }), /source must be "form-by-hand"/);
  fails(record({ form: "scoir" as never }), /form "scoir" isn't one of/);
  fails(record({ read_on: "2026-10-31" }), /read_on 2026-10-31 is in the future/);
  fails(record({ read_on: "2026-02-30" }), /read_on "2026-02-30" isn't a date/);
  fails(record({ read_on: "Oct 30" }), /isn't a date/);
  fails(record({ reader: "R.R." }), /reader "R.R." isn't 1 to 4 letters/);
  fails(record({ reader: "ABCDE" }), /isn't 1 to 4 letters/);
  fails(record({ reader: "" }), /isn't 1 to 4 letters/);
  fails(record({ prompts: [] }), /the form asks questions, but none are entered/);
  fails(record({ status: "none" }), /status none, but 2 prompt\(s\)/);
  fails(record({ note: "x".repeat(501) }), /note must be text of at most 500/);
  fails({ ...record(), extra: 1 } as never, /"extra" isn't a field of a hand-read record/);
  // Prompt text.
  fails(withPrompt({ text: "", quote: "" }), /prompt 1: the text is empty/);
  fails(withPrompt({ text: "Too short", quote: "Too short" }), /prompt is 9 characters/);
  fails(withPrompt({ text: "1. Tell us about something you made.", quote: "1. Tell us about something you made." }), /starts with a number, letter, bullet/);
  fails(withPrompt({ text: "Prompt 2: Tell us about something you made.", quote: "Prompt 2: Tell us about something you made." }), /"Prompt 1:" label/);
  fails(withPrompt({ text: "• Tell us about something you made.", quote: "• Tell us about something you made." }), /bullet/);
  fails(withPrompt({ text: "Tell us about <b>something</b> you made.", quote: "Tell us about <b>something</b> you made." }), /HTML tags/);
  fails(withPrompt({ text: "Tell us about something you made and…", quote: "Tell us about something you made and…" }), /ends in an ellipsis/);
  fails(withPrompt({ text: "Tell us about  something you made.", quote: "Tell us about  something you made." }), /extra spaces or line breaks/);
  fails(withPrompt({ text: "TODO paste the question from the form here", quote: "TODO paste the question from the form here" }), /placeholder/);
  fails(withPrompt({ quote: "" }), /no quote/);
  fails(withPrompt({ quote: "A different sentence entirely, not the prompt." }), /the quote isn't the prompt's own text/);
  fails(withPrompt({ kind: "story" as never }), /kind "story" isn't one of/);
  fails(withPrompt({ required: "yes" as never }), /required must be true or false/);
  fails(withPrompt({ extra: 1 } as never), /"extra" isn't a field of a prompt/);
  // Limits and applies_to (the reader's rules).
  fails(withPrompt({ limit: { kind: "words", max: 5000 } }), /prompt 1: a limit of 5000 words is outside 25 to 2000/);
  fails(withPrompt({ limit: { kind: "characters", max: 50 } }), /a limit of 50 characters is outside 100 to 10000/);
  fails(withPrompt({ limit: { kind: "words", max: 250, min: 250 } }), /prompt 1: the minimum 250 isn't a whole number below the maximum/);
  fails(withPrompt({ limit: { kind: "pages" as never, max: 2 } }), /a limit counted in "pages" must be in words or characters/);
  fails(withPrompt({ applies_to: "everyone" as never }), /applies_to "everyone" isn't all/);
  fails(withPrompt({ kind: "program", applies_to: "all" }), /kind program, but applies_to names no program/);
  fails(withPrompt({ applies_to: { program: " " } }), /applies to a program, but names none/);
  // Ids in order, no repeats.
  const r = record();
  r.prompts[1] = { ...r.prompts[1], id: `${UF}:${CYCLE}:3` };
  fails(r, new RegExp(`prompt 2: id ${UF}:${CYCLE}:3 isn't ${UF}:${CYCLE}:2`));
  const twice = record();
  twice.prompts[1] = { ...twice.prompts[0], id: `${UF}:${CYCLE}:2` };
  fails(twice, /prompt 2: the same prompt twice/);
  // Choose.
  fails(record({ choose: { n: 1, of: 2, quote: "Answer one." } }), /choose says 2 prompts to pick from, but 0 are marked optional/);
  fails(record({ choose: { n: 2, of: 2, quote: "Answer two." } }), /isn't a choice/);
  fails(record({ choose: { n: 0, of: 2, quote: "Answer." } }), /choose: how many to answer \(0\) must be a whole number of at least 1/);
  fails(record({ status: "none", prompts: [], choose: { n: 1, of: 2, quote: "x" } }), /choose is set, but status is none/);
  const noQuote = record({ prompts: [prompt(1, "Placeholder choice A: a challenge you met.", { required: false }), prompt(2, "Placeholder choice B: an idea you love.", { required: false })], choose: { n: 1, of: 2, quote: "" } });
  fails(noQuote, /choose: no quote/);
  assert.deepEqual(validateConfirmed(null as never, TODAY), ["the record isn't an object"]);
});

test("validateConfirmed keeps the reader's rules: the same limits and lengths, and the same verdict on shared fixtures", () => {
  assert.deepEqual(PROMPT_CHARS, CHECK_CHARS);
  assert.deepEqual(LIMIT_RANGE, CHECK_LIMITS);
  const base = prompt(1, "Placeholder question: tell us about something you made.");
  const fixtures: EssayPrompt[] = [
    base,
    { ...base, text: "Short", quote: "Short" },
    { ...base, text: "x".repeat(1501), quote: "x".repeat(1501) },
    { ...base, limit: null },
    { ...base, limit: { kind: "words", max: 24 } },
    { ...base, limit: { kind: "words", max: 2001 } },
    { ...base, limit: { kind: "words", max: 250.5 } },
    { ...base, limit: { kind: "characters", max: 99 } },
    { ...base, limit: { kind: "characters", max: 10_001 } },
    { ...base, limit: { kind: "words", max: 300, min: 300 } },
    { ...base, limit: { kind: "words", max: 300, min: 0 } },
    { ...base, limit: { kind: "words", max: 300, min: 100 } },
    { ...base, applies_to: "transfer" },
    { ...base, applies_to: "nobody" as never },
    { ...base, kind: "program", applies_to: { program: "Honors" } },
    { ...base, kind: "program", applies_to: "all" },
  ];
  // The reader's rules that need no page: length, limit, applies_to (quotes, the optional word, and why_us need the page).
  // The console words some messages its own way ("a limit of …", "the minimum …"), so the verdicts are compared by rule.
  const RULES: [string, RegExp][] = [
    ["length", /prompt is \d+ characters/],
    ["limit-kind", /words or characters/],
    ["limit-range", /is outside \d+ to \d+/],
    ["minimum", /minimum .* below the maximum/],
    ["program", /kind program, but applies_to names no program/],
    ["empty-program", /applies_to names an empty program|applies to a program, but names none/],
    ["applies", /isn't all, transfer, international, or a program/],
  ];
  const rules = (msgs: string[]) => msgs.flatMap((m) => RULES.filter(([, re]) => re.test(m)).map(([k]) => k)).sort();
  const pageless = (msgs: string[]) => msgs.filter((m) => !/quote|optional|required|why_us|on the page|isn't named/.test(m));
  for (const p of fixtures) {
    const mine = confirmedPromptProblems(p, "prompt 1");
    const theirs = pageless(promptProblems(p, "prompt 1", null));
    assert.equal(mine.length, rules(mine).length, `every console message maps to one rule: ${JSON.stringify(mine)}`);
    assert.deepEqual(rules(mine), rules(theirs), JSON.stringify(p));
  }
  // Guard: a different limit range here would disagree with the reader on the 24-word fixture.
  const drifted = confirmedPromptProblems({ ...base, limit: { kind: "words", max: 24 } }, "prompt 1");
  assert.ok(drifted.length > 0, "the 24-word limit must be refused by both, or the comparison proves nothing");
});

/* ------------------------------------------------------------------ */
/* splitPastedPrompts                                                  */
/* ------------------------------------------------------------------ */

test("splitPastedPrompts: one prompt per paragraph, labels stripped, whitespace collapsed, paragraphs never split", () => {
  const pasted = [
    "1. Placeholder first question: describe an activity",
    "   that has shaped how you spend your time.",
    "",
    "  ",
    "2)  Placeholder second question:\ttell us about a community.",
    "",
    "Prompt 3: Placeholder third question, labelled the way some forms label them.",
    "",
    "• Placeholder fourth question, pasted with a bullet.",
    "",
    "b) Placeholder fifth question, lettered.",
    "",
    "Question 6 - Placeholder sixth question, with a dash.",
    "",
    "A placeholder seventh question that starts with the word A and must keep it.",
  ].join("\r\n");
  assert.deepEqual(splitPastedPrompts(pasted), [
    "Placeholder first question: describe an activity that has shaped how you spend your time.",
    "Placeholder second question: tell us about a community.",
    "Placeholder third question, labelled the way some forms label them.",
    "Placeholder fourth question, pasted with a bullet.",
    "Placeholder fifth question, lettered.",
    "Placeholder sixth question, with a dash.",
    "A placeholder seventh question that starts with the word A and must keep it.",
  ]);
  // A numbered list pasted without blank lines: every line opens an item, so one prompt per line.
  assert.deepEqual(splitPastedPrompts("1. First placeholder question here.\n2. Second placeholder question here.\n(3) Third placeholder question here."), [
    "First placeholder question here.",
    "Second placeholder question here.",
    "Third placeholder question here.",
  ]);
  // A paragraph whose second line happens to start with a number is one prompt (not every line opens an item).
  assert.deepEqual(splitPastedPrompts("Tell us about the most meaningful thing you did in\n2025 and what it taught you."), ["Tell us about the most meaningful thing you did in 2025 and what it taught you."]);
  assert.deepEqual(splitPastedPrompts(""), []);
  assert.deepEqual(splitPastedPrompts("\n\n  \n"), []);
  // Each split prompt passes the text checks it will meet on save.
  for (const text of splitPastedPrompts(pasted)) {
    const r = record({ prompts: [prompt(1, text)] });
    assert.deepEqual(validateConfirmed(r, TODAY), [], text);
  }
});

/* ------------------------------------------------------------------ */
/* recordJson, platformHomepage, the words                             */
/* ------------------------------------------------------------------ */

test("recordJson: fixed key order, one prompt per line, parses back, the same bytes whatever order the keys came in", () => {
  const r = record({ note: "The Honors prompt is separate." });
  const text = recordJson(r);
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(r)));
  assert.ok(text.endsWith("}\n"));
  assert.equal(text.split("\n").filter((l) => l.includes('"id":')).length, 2, "one prompt per line");
  assert.deepEqual(Object.keys(JSON.parse(text)), ["unit_id", "name", "cycle", "status", "confidence", "source", "form", "read_on", "reader", "note", "prompts"]);
  assert.deepEqual(Object.keys(JSON.parse(text).prompts[0]), ["id", "text", "kind", "limit", "required", "applies_to", "quote"]);
  const shuffled = Object.fromEntries(Object.entries(r).reverse()) as unknown as ConfirmedRecord;
  // Nested keys too, the way Postgres jsonb hands a row back ({"max":250,"kind":"words"}).
  shuffled.prompts = r.prompts.map((p) => Object.fromEntries(Object.entries({ ...p, limit: p.limit && { max: p.limit.max, kind: p.limit.kind } }).reverse()) as unknown as EssayPrompt);
  assert.equal(recordJson(shuffled), text, "byte-identical");
  const withChoose = record({ prompts: [prompt(1, "Placeholder choice A: a challenge you met.", { required: false }), prompt(2, "Placeholder choice B: an idea you love.", { required: false })], choose: { n: 1, of: 2, quote: "Answer one." } });
  assert.equal(recordJson({ ...withChoose, choose: { quote: "Answer one.", of: 2, n: 1 } }), recordJson(withChoose));
  assert.match(recordJson(record({ status: "none", prompts: [] })), /"prompts": \[\]\n\}\n$/);
});

test("platformHomepage: each platform's homepage; the college's own form cites its apply page, else the note's address; none is null", () => {
  assert.equal(platformHomepage("common_app"), "https://www.commonapp.org");
  assert.equal(platformHomepage("coalition"), "https://www.coalitionforcollegeaccess.org");
  assert.equal(platformHomepage("apply_texas"), "https://www.applytexas.org");
  assert.equal(platformHomepage("uc"), "https://admission.universityofcalifornia.edu");
  assert.equal(Object.keys(PLATFORM_HOMEPAGE).length, 4);
  assert.equal(platformHomepage("own", { links: { apply: "https://apply.example.edu/", admissions: "https://x.example.edu" } }), "https://apply.example.edu/");
  assert.equal(platformHomepage("own", { links: { apply: null, admissions: "https://adm.example.edu" } }), "https://adm.example.edu");
  assert.equal(platformHomepage("own", { links: null }, "Read at https://go.example.edu/apply."), "https://go.example.edu/apply");
  assert.equal(platformHomepage("own", null), null);
});

test("the words: handReadLine and the none sentence", () => {
  assert.equal(handReadLine("2026-10-30"), "From the application form, read by hand on October 30, 2026");
  assert.equal(handReadLine("2026-01-05"), "From the application form, read by hand on January 5, 2026");
  assert.equal(noneSentence("common_app"), "No college questions beyond the platform's; read in the Common App by hand");
  assert.equal(openCycleOf(TODAY), CYCLE, "the pure port agrees with scripts/lib/essay-prompts/cycle.mts");
  assert.equal(openCycleOf("2027-07-31"), openCycle("2027-07-31"));
  assert.equal(openCycleOf("2027-08-01"), openCycle("2027-08-01"));
});

/* ------------------------------------------------------------------ */
/* The merge: precedence, the cycle rule, the summary                   */
/* ------------------------------------------------------------------ */

test("precedence: the hand read beats refers_to_form, none, and no read; a reader published record wins; a confirmed none never beats published", () => {
  const uf = ufSchool();
  const pick = (records: EssayRecord[], confirmed: ConfirmedRecord[]) => applyEssays([uf], records, TODAY, confirmed);

  const overRefers = pick([readerRecord(uf)], [record()]);
  assert.equal(overRefers.schools[0].essays!.confidence, "confirmed");
  assert.equal(overRefers.schools[0].essays!.prompts.length, 2);
  assert.equal(overRefers.summary.confirmed, 1);

  const overNone = pick([readerRecord(uf, { status: "none", status_quote: "No supplemental essays are required." })], [record()]);
  assert.equal(overNone.schools[0].essays!.confidence, "confirmed");

  const noRead = pick([], [record()]);
  assert.equal(noRead.schools[0].essays!.status, "published");
  assert.equal(noRead.schools[0].essays!.confidence, "confirmed");

  const published = readerRecord(uf, { status: "published", status_quote: undefined, cycle_quote: "2026–2027 Essay Prompts", cycle_assumed: undefined, prompts: [prompt(1, "The college's own published question about why you chose it.", { quote: "Respond in 250 words." })] });
  const pageWins = pick([published], [record()]);
  assert.equal(pageWins.schools[0].essays!.confidence, undefined, "the college's own page wins");
  assert.equal(pageWins.schools[0].essays!.source_url, "https://admissions.example.edu/apply");
  assert.equal(pageWins.summary.confirmed, 0);
  assert.equal(pageWins.summary.confirmedOutranked, 1);

  const noneOverRefers = pick([readerRecord(uf)], [record({ status: "none", prompts: [] })]);
  assert.equal(noneOverRefers.schools[0].essays!.status, "none");
  assert.equal(noneOverRefers.schools[0].essays!.confidence, "confirmed");
  const noneUnderPublished = pick([published], [record({ status: "none", prompts: [] })]);
  assert.equal(noneUnderPublished.schools[0].essays!.status, "published");
  assert.equal(noneUnderPublished.schools[0].essays!.confidence, undefined);
  assert.match(summaryLine(noneOverRefers.summary), /; 1 read from the form by hand\)/);
  assert.match(summaryLine(pageWins.summary), /0 read from the form by hand, 1 outranked by the college's page/);
});

test("the cycle rule: a hand read for a closed or a coming cycle is skipped and counted; a college not in the dataset is unjoined", () => {
  const uf = ufSchool();
  const closed = record({ cycle: "2025-26", prompts: record().prompts.map((p, i) => ({ ...p, id: `${UF}:2025-26:${i + 1}` })) });
  const coming = record({ cycle: "2027-28", prompts: record().prompts.map((p, i) => ({ ...p, id: `${UF}:2027-28:${i + 1}` })) });
  const r = applyEssays([uf], [readerRecord(uf)], TODAY, [closed, coming, record({ unit_id: "000000" })]);
  assert.equal(r.schools[0].essays!.status, "refers_to_form", "the reader's record stands");
  assert.equal(r.summary.confirmedSkipped, 2);
  assert.equal(r.summary.confirmedUnjoined, 1);
  assert.match(summaryLine(r.summary), /2 hand-read skipped \(not the open cycle, or no page to cite\), 1 hand-read unjoined/);
  // Guard: the same record in the open cycle applies, so the skip above is the cycle's doing.
  assert.equal(applyEssays([uf], [readerRecord(uf)], TODAY, [record()]).schools[0].essays!.confidence, "confirmed");
  // The college's own form with no apply page anywhere: nothing to cite, so skipped.
  const bare = { ...uf, links: { website: null, price_calculator: null } } as School;
  assert.equal(applyEssays([bare], [], TODAY, [record({ form: "own" })]).summary.confirmedSkipped, 1);
});

test("the block and its lineage: the platform's homepage, the day read, the first prompt (or the none sentence) as the quote, method reported", () => {
  const uf = ufSchool();
  const block = blockOf(record(), uf);
  assert.deepEqual(Object.keys(block), ["cycle", "status", "source_url", "retrieved", "prompts", "confidence", "form", "read_on", "reader"]);
  assert.equal(block.source_url, "https://www.commonapp.org");
  assert.equal(block.retrieved, TODAY);
  assert.deepEqual(lineageOf(record(), uf), { source: "college-site", method: "reported", year: CYCLE, url: "https://www.commonapp.org", retrieved: TODAY, quote: record().prompts[0].text });
  assert.equal(lineageOf(record({ status: "none", prompts: [] }), uf).quote, "No college questions beyond the platform's; read in the Common App by hand");
  assert.equal(blockOf(record({ form: "own" }), uf).source_url, uf.links!.apply, "the college's own form: its apply page");
  assert.throws(() => blockOf(record({ form: "own" }), { links: undefined }), /no page to cite/);
});

/* ------------------------------------------------------------------ */
/* Real data: Florida                                                  */
/* ------------------------------------------------------------------ */

test("real data: Florida with a hand read passes validateLineage with the real meta, and re-merging changes nothing, byte for byte", () => {
  const before = ufSchool();
  assert.equal(before.essays?.status, "refers_to_form", "the committed Florida points to the form (or this proves less than it says)");
  const ufReader = realRecords.filter((r) => r.unit_id === UF);
  assert.equal(ufReader.length, 1);
  const once = applyEssays([before], realRecords, TODAY, [record()]).schools;
  const uf = once[0];
  assert.deepEqual(validateLineage(once, meta), []);
  assert.deepEqual(validateSchool(uf, meta), []);
  assert.equal(uf.essays!.confidence, "confirmed");
  assert.equal(uf.lineage!.essays!.method, "reported");
  const twice = applyEssays(once, realRecords, TODAY, [record()]).schools;
  assert.equal(formatSchools(twice), formatSchools(once), "re-merge is byte-for-byte stable");
  // Every essays.* path cites the platform and the day read; never the admissions document.
  for (const path of ["essays.prompts", "essays.status", "essays.confidence", "essays.form", "essays.read_on", "essays.reader"] as const) {
    const cited = lineageFor(path, uf, meta);
    assert.equal(cited.key, "college-site", path);
    assert.equal(cited.url, "https://www.commonapp.org", path);
    assert.equal(cited.retrieved, TODAY, path);
    assert.equal(cited.sourceKind, undefined, path);
  }
  // Taking the hand read away puts Florida's reader block back exactly.
  const back = applyEssays(once, realRecords, TODAY, []).schools;
  assert.equal(JSON.stringify(back[0]), JSON.stringify(before), "byte for byte");
});

test("real data: the college-reported and selectivity merges leave a hand-read block where it is (the re-merge rule)", () => {
  const merged = applyEssays([ufSchool()], realRecords, TODAY, [record()]).schools[0];
  const all = schools.map((s) => (s.unit_id === UF ? merged : s));
  const reported: ReportedFile = JSON.parse(readFileSync(join(ROOT, "data", "college-reported.json"), "utf8"));
  const after = mergeReported(all, reported, { records: readRecords(join(ROOT, "data", "cds-records")), meta, table: CDS_TEMPLATE }).schools;
  const ufAfter = after.find((s) => s.unit_id === UF)!;
  assert.equal(JSON.stringify(ufAfter), JSON.stringify(merged), "merge-reported moves nothing");
  const reSelected = placeSelectivity(ufAfter, ufAfter.selectivity);
  assert.equal(JSON.stringify(reSelected), JSON.stringify(merged), "the tiers rebuild moves nothing");
  assert.equal(JSON.stringify(applyEssays([reSelected], realRecords, TODAY, [record()]).schools[0]), JSON.stringify(merged), "and the essays merge after them moves nothing");
  assert.deepEqual(validateLineage([ufAfter], meta), []);
});

test("lineage guards: a hand-read block with the wrong method, no reader, a read_on that isn't retrieved, or hand-read fields on a page block fails", () => {
  const merged = applyEssays([ufSchool()], realRecords, TODAY, [record()]).schools[0];
  const plant = (change: (s: School) => void, expect: RegExp) => {
    const s = structuredClone(merged);
    change(s);
    const errors = validateSchool(s, meta);
    assert.ok(errors.some((e) => expect.test(e)), `expected ${expect} in ${JSON.stringify(errors)}`);
  };
  plant((s) => (s.lineage!.essays!.method = "extracted"), /hand-read block must cite source "college-site" with method "reported"/);
  plant((s) => delete s.essays!.reader, /needs its form, read_on, and reader/);
  plant((s) => (s.essays!.read_on = "2026-10-01"), /essays.read_on isn't the block's retrieved/);
  plant((s) => delete s.lineage!.essays!.quote, /lacks quote, url, retrieved, or year/);
  plant((s) => (s.essays!.status = "refers_to_form"), /never refers_to_form/);
  plant((s) => {
    delete s.essays!.confidence;
  }, /belong to a hand-read block/);
  plant((s) => ((s.essays as unknown as Record<string, unknown>).confidence = "likely"), /essays.confidence "likely" isn't "confirmed"/);
});

test("registry: essays.confidence, form, read_on, and reader are college-site, admissions, no vintage", () => {
  for (const p of ["essays.confidence", "essays.form", "essays.read_on", "essays.reader"] as const) {
    assert.equal(FIELDS[p].source, "college-site");
    assert.equal(FIELDS[p].topic, "admissions");
    assert.equal(FIELDS[p].vintage, null);
  }
});

/* ------------------------------------------------------------------ */
/* The merge CLI and the store                                         */
/* ------------------------------------------------------------------ */

function scratch(confirmed: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "essay-confirmed-"));
  mkdirSync(join(dir, "data", "essay-prompts", "records"), { recursive: true });
  mkdirSync(join(dir, "data", "essay-prompts", "confirmed"), { recursive: true });
  mkdirSync(join(dir, "data", "reference"), { recursive: true });
  writeFileSync(join(dir, "data", "schools.json"), formatSchools([ufSchool()]));
  writeFileSync(join(dir, "data", "meta.json"), readFileSync(join(ROOT, "data", "meta.json")));
  writeFileSync(join(dir, "data", "reference", "platform-prompts.json"), readFileSync(join(ROOT, "data", "reference", "platform-prompts.json")));
  writeFileSync(join(dir, "data", "essay-prompts", "records", `${UF}.json`), readFileSync(join(ROOT, "data", "essay-prompts", "records", `${UF}.json`)));
  for (const [name, text] of Object.entries(confirmed)) writeFileSync(join(dir, "data", "essay-prompts", "confirmed", name), text);
  return dir;
}

const runMerge = (dir: string) =>
  spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "merge-essay-prompts.mts")], {
    encoding: "utf8",
    env: { ...process.env, MERGE_ESSAY_PROMPTS_ROOT: dir, MERGE_ESSAY_PROMPTS_TODAY: TODAY },
  });

test("merge-essay-prompts applies data/essay-prompts/confirmed/, is idempotent, and refuses a bad hand-read file", () => {
  const dir = scratch({ [`${UF}.json`]: recordJson(record()) });
  try {
    const first = runMerge(dir);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /1 read from the form by hand/);
    const written = readFileSync(join(dir, "data", "schools.json"), "utf8");
    assert.equal((JSON.parse(written) as School[])[0].essays!.confidence, "confirmed");
    assert.equal(runMerge(dir).status, 0);
    assert.equal(readFileSync(join(dir, "data", "schools.json"), "utf8"), written, "the CLI is idempotent on its own output");
    writeFileSync(join(dir, "data", "essay-prompts", "confirmed", `${UF}.json`), recordJson(record({ reader: "R2D2" })));
    const bad = runMerge(dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /hand-read records check failed; nothing written:\n {2}confirmed\/134130\.json: reader "R2D2" isn't 1 to 4 letters/);
    assert.equal(readFileSync(join(dir, "data", "schools.json"), "utf8"), written, "nothing written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store: readConfirmedRecords reads the directory by unit id and refuses a file named for another college", () => {
  const dir = mkdtempSync(join(tmpdir(), "essay-confirmed-store-"));
  try {
    writeFileSync(join(dir, `${UF}.json`), recordJson(record()));
    writeFileSync(join(dir, ".gitkeep"), "");
    assert.deepEqual(readConfirmedRecords(dir), [JSON.parse(recordJson(record()))]);
    assert.deepEqual(confirmedProblems(readConfirmedRecords(dir), TODAY), []);
    writeFileSync(join(dir, "100000.json"), recordJson(record()));
    assert.throws(() => readConfirmedRecords(dir), /100000\.json: file name doesn't match unit_id 134130/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(readConfirmedRecords(join(ROOT, "data", "essay-prompts", "confirmed")).length >= 0, true);
  assert.deepEqual(confirmedProblems(readConfirmedRecords(join(ROOT, "data", "essay-prompts", "confirmed")), new Date().toISOString().slice(0, 10)), [], "every committed hand-read file passes");
});

/* ------------------------------------------------------------------ */
/* Display: sourceOf, the picker, the tab's note, progress             */
/* ------------------------------------------------------------------ */

test("display: sourceOf and the resolved prompt say 'From the application form, read by hand on {date}' with the platform's homepage", () => {
  const merged = applyEssays([ufSchool()], realRecords, TODAY, [record()]).schools[0];
  const lookup: PromptLookup = { school: (id) => (id === UF ? merged : null), platform: null };
  const resolved = resolvePrompt(`college:${UF}:${CYCLE}:1`, lookup);
  assert.equal(resolved.found, true);
  assert.equal(resolved.source?.url, "https://www.commonapp.org");
  assert.equal(resolved.source?.handRead, "From the application form, read by hand on October 30, 2026");
  assert.equal(sourceOf({ source_url: "https://x.edu/essays", retrieved: TODAY, cycle: CYCLE })?.handRead, undefined, "a page block has no hand-read credit");
  const groups = pickerGroups([{ unit_id: UF, name: "University of Florida" }], lookup);
  assert.equal(groups.find((g) => g.key === UF)!.prompts.length, 2, "the picker lists the hand-read prompts");
  const page = readFileSync(join(ROOT, "app", "advisor", "essays", "[id]", "page.tsx"), "utf8");
  assert.match(page, /prompt\.source\.handRead/, "the editor's prompt heading shows the hand-read credit");
});

test("display: the Essays tab's note for a hand-read college, and the reworded refers_to_form line", () => {
  assert.equal(collegeNote({ onFile: "published", name: "University of Florida", confirmedOn: TODAY }), "From the application form, read by hand on October 30, 2026.");
  assert.equal(collegeNote({ onFile: "none", name: "University of Florida", confirmedOn: TODAY }), "From the application form, read by hand on October 30, 2026.");
  assert.equal(collegeNote({ onFile: "refers_to_form", name: "Rice" }), "Rice doesn't publish its questions on its site; they're inside the application. Add each one here as you meet it.");
  assert.equal(collegeNote({ onFile: "published", name: "Duke" }), null);
  const merged = applyEssays([ufSchool()], realRecords, TODAY, [record()]).schools[0];
  const item = { id: "i1", unit_id: UF, round: null, position: 0, withdrawn_on: null, outcome: null, enrolling: false, application_platform: "common_app" };
  const progress = essayProgress({ items: [item] as never, schools: { [UF]: { ...merged, apply: merged.apply ?? null, profile: null, logistics: null } } as never, essays: null });
  assert.equal(progress.colleges[0].confirmedOn, TODAY);
  assert.equal(progress.colleges[0].onFile, "published");
  assert.equal(progress.colleges[0].total, 2, "the essays move counts the hand-read prompts as work to do");
  const card = readFileSync(join(ROOT, "components", "essays", "CollegeEssayCard.tsx"), "utf8");
  assert.match(card, /canWrite && !c\.confirmedOn && <PromptPicker/, "no 'Add what {College} asks' under a hand-read college's note");
});

/* ------------------------------------------------------------------ */
/* The advisor's live overlay                                          */
/* ------------------------------------------------------------------ */

test("overlayEssays: the saved row beats refers_to_form, none, no block, and an older exported hand read; a page's published block wins; a bad or other-cycle row changes nothing", () => {
  const uf = ufSchool();
  const row = record();
  const over = overlayEssays(uf, row, TODAY)!;
  assert.equal(over.confidence, "confirmed");
  assert.deepEqual(over, blockOf(row, uf), "the same block the merge writes");
  assert.equal(overlayEssays({ ...uf, essays: undefined }, row, TODAY)!.confidence, "confirmed");
  const none = { ...uf, essays: { ...uf.essays!, status: "none" as const } };
  assert.equal(overlayEssays(none, row, TODAY)!.confidence, "confirmed");
  const exported = applyEssays([uf], [], TODAY, [record({ read_on: "2026-10-01", reader: "AB" })]).schools[0];
  assert.equal(overlayEssays(exported, row, TODAY)!.reader, "RR", "a newer save beats the exported file");
  const pageBlock = { ...uf, essays: { cycle: CYCLE, status: "published" as const, source_url: "https://x.edu/essays", retrieved: TODAY, prompts: [prompt(1, "The college's own published question about your goals.")] } };
  assert.equal(overlayEssays(pageBlock, row, TODAY), pageBlock.essays, "the college's own page wins");
  assert.equal(overlayEssays(uf, record({ reader: "1" }), TODAY), uf.essays, "a row that fails validateConfirmed changes nothing");
  assert.equal(overlayEssays(uf, { ...row, unit_id: "100000" }, TODAY), uf.essays, "a row for another college changes nothing");
  const closed = record({ cycle: "2025-26", prompts: row.prompts.map((p, i) => ({ ...p, id: `${UF}:2025-26:${i + 1}` })) });
  assert.equal(overlayEssays(uf, closed, TODAY), uf.essays, "a closed cycle's row changes nothing");
  assert.equal(overlayEssays(uf, null, TODAY), uf.essays);
});

test("the wiring: planSchools and promptLookup lay the saved rows over the dataset; the public college page doesn't read the table", () => {
  const context = readFileSync(join(ROOT, "lib", "planner", "context.ts"), "utf8");
  assert.match(context, /const overrides = await readEssayOverrides\(unitIds\);/);
  assert.match(context, /planSchoolFor\(withOverride\(school, overrides\)/);
  const load = readFileSync(join(ROOT, "lib", "essays", "load.ts"), "utf8");
  assert.match(load, /readEssayOverrides\(null\)/);
  assert.match(load, /withOverride\(s, overrides\)/);
  const overrides = readFileSync(join(ROOT, "lib", "essays", "overrides.ts"), "utf8");
  assert.match(overrides, /^import "server-only";/);
  assert.match(overrides, /from\("essay_prompt_overrides"\)\.select\("unit_id, record"\)\.eq\("cycle", cycle\)/);
  assert.match(overrides, /= cache\(/, "one query per request");
  const exportRoute = readFileSync(join(ROOT, "app", "advisor", "essays", "package", "[unit]", "export", "route.ts"), "utf8");
  assert.match(exportRoute, /packagePromptRefs\(lookup\.schoolRecord\(unit\)\?\.essays/, "the package export reads the overlaid block");
  assert.doesNotMatch(readFileSync(join(ROOT, "components", "school", "EssayPrompts.tsx"), "utf8"), /overrides|essay_prompt_overrides/);
});

/* ------------------------------------------------------------------ */
/* The nightly export                                                  */
/* ------------------------------------------------------------------ */

test("the export writes exactly recordJson's bytes, removes files with no open-cycle row, keeps a bad row's file, and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "essay-confirmed-export-"));
  try {
    const other = record({ unit_id: "100654", name: "Placeholder College", status: "none", prompts: [] });
    writeFileSync(join(dir, "999999.json"), recordJson(record({ unit_id: "999999", prompts: [] , status: "none"})));
    writeFileSync(join(dir, "100000.json"), "old text\n");
    const rows: OverrideRow[] = [
      { unit_id: UF, cycle: CYCLE, record: record() },
      { unit_id: "100654", cycle: CYCLE, record: other },
      { unit_id: "100000", cycle: CYCLE, record: record({ unit_id: "100000", reader: "toolong" }) },
      { unit_id: "200000", cycle: "2025-26", record: record({ unit_id: "200000", cycle: "2025-26" }) },
      { unit_id: "300000", cycle: CYCLE, record: record() },
    ];
    const plan = planExport(rows, readConfirmedFiles(dir), TODAY);
    assert.deepEqual([...plan.writes.keys()], ["100654", UF]);
    assert.deepEqual(plan.removes, ["999999"], "no open-cycle row: removed");
    assert.equal(plan.skipped.length, 2);
    assert.match(plan.skipped[0], /^100000: reader "toolong"/);
    assert.match(plan.skipped[1], /^300000: the record is for 134130 2026-27, not its row's 300000/);
    applyExport(dir, plan);
    assert.equal(readFileSync(join(dir, `${UF}.json`), "utf8"), recordJson(record()), "the same bytes recordJson gives");
    assert.equal(readFileSync(join(dir, "100654.json"), "utf8"), recordJson(other));
    assert.equal(readFileSync(join(dir, "100000.json"), "utf8"), "old text\n", "a bad row leaves the file as it was");
    assert.deepEqual(readdirSync(dir).sort(), ["100000.json", "100654.json", `${UF}.json`]);
    const again = planExport(rows, readConfirmedFiles(dir), TODAY);
    assert.equal(again.writes.size, 0);
    assert.equal(again.removes.length, 0);
    assert.equal(again.unchanged, 2);
    // The exported files are what the merge reads, and they pass its check.
    rmSync(join(dir, "100000.json"));
    const exported = readConfirmedRecords(dir);
    assert.deepEqual(exported.map((r) => r.unit_id), ["100654", UF]);
    assert.deepEqual(confirmedProblems(exported, TODAY), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the export script and its workflow: the service role's env names, nightly and by hand, a data PR that auto-merges", () => {
  const script = readFileSync(join(ROOT, "scripts", "export-essay-confirmed.mts"), "utf8");
  assert.match(script, /process\.env\.SUPABASE_URL \|\| !process\.env\.SUPABASE_SECRET_KEY/);
  assert.match(script, /from\("essay_prompt_overrides"\)/);
  assert.match(script, /merge-essay-prompts\.mts/);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["export-essay-confirmed"], /scripts\/export-essay-confirmed\.mts/);
  const yml = readFileSync(join(ROOT, ".github", "workflows", "essay-confirmed.yml"), "utf8");
  assert.match(yml, /^on:\n {2}schedule:\n {4}- cron: "[^"]+"[^\n]*\n {2}workflow_dispatch:/m);
  assert.match(yml, /SUPABASE_URL: \$\{\{ secrets\.PROD_SUPABASE_URL \}\}/);
  assert.match(yml, /SUPABASE_SECRET_KEY: \$\{\{ secrets\.PROD_SUPABASE_SECRET_KEY \}\}/);
  assert.match(yml, /npm run export-essay-confirmed/);
  assert.match(yml, /npm run check:lineage/);
  assert.match(yml, /branch="data\/essay-confirmed-\$\{date\}"/);
  assert.match(yml, /gh pr merge "\$PR_NUMBER" --auto --squash/);
  assert.match(yml, /kind: data/);
  assert.doesNotMatch(yml, /scrape|\bAI\b/i);
});

/* ------------------------------------------------------------------ */
/* The table's policies (PGlite)                                       */
/* ------------------------------------------------------------------ */

const MIGRATIONS = join(ROOT, "supabase", "migrations");
const OVERRIDES_MIGRATION = "20261030150000_essay_prompt_overrides.sql";

async function boot(transform?: (sql: string) => string): Promise<AuthDb> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(AUTH_STUB_SQL);
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    let sql = readFileSync(join(MIGRATIONS, name), "utf8");
    if (name === OVERRIDES_MIGRATION && transform) {
      const changed = transform(sql);
      assert.notEqual(changed, sql, "the guard's transform must change the migration");
      sql = changed;
    }
    await db.exec(sql);
  }
  await db.exec("grant usage on schema extensions to anon, authenticated, service_role");
  return db;
}

/** One statement as a signed-in user at aal2 in the console. */
async function asAal2<T = Record<string, unknown>>(db: AuthDb, who: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated", aal: "aal2" })]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-quad-console": "1" })]);
    await tx.exec("set local role authenticated");
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function asAnon<T = Record<string, unknown>>(db: AuthDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
    await tx.exec("set local role anon");
    return (await tx.query<T>(sql, params)).rows;
  });
}

const errorOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "ok";
  } catch (err) {
    return (err as Error).message;
  }
};

async function policyWorld(transform?: (sql: string) => string) {
  const db = await boot(transform);
  const quinn = await createUser(db, { email: "quinn@quad.test", birthYear: 1985, roleHint: "guardian", displayName: "Quinn Admin" });
  const eve = await createUser(db, { email: "eve@example.com", birthYear: 1980, roleHint: "guardian", displayName: "Eve Evans" });
  await db.query("insert into public.admins (user_id, note) values ($1, 'owner')", [quinn]);
  return { db, quinn, eve };
}

const SET = "select public.admin_set_essay_prompts($1, $2, $3::jsonb)";

test("essay_prompt_overrides: an admin saves and deletes (logged); anyone, signed out too, reads; a non-admin can't call the set function or write the table", async () => {
  const { db, quinn, eve } = await policyWorld();
  const r = record();
  await asAal2(db, quinn, SET, [UF, CYCLE, JSON.stringify(r)]);
  const read = await asAnon<{ unit_id: string; record: ConfirmedRecord; status: string; reader: string }>(db, "select unit_id, record, status, reader from public.essay_prompt_overrides");
  assert.equal(read.length, 1, "anon reads the table");
  assert.equal(read[0].record.prompts.length, 2);
  assert.equal(read[0].reader, "RR");
  assert.equal((await asUser(db, eve, "select unit_id from public.essay_prompt_overrides")).length, 1, "a signed-in family reads it");
  assert.match(await errorOf(asAal2(db, eve, SET, [UF, CYCLE, JSON.stringify(r)])), /admin only/, "a non-admin can't call the set function");
  assert.match(await errorOf(asAnon(db, SET, [UF, CYCLE, JSON.stringify(r)])), /permission denied/, "anon can't execute it at all");
  assert.match(await errorOf(asAal2(db, eve, "select public.admin_delete_essay_prompts($1, $2)", [UF, CYCLE])), /admin only/);
  assert.match(await errorOf(asUser(db, eve, "insert into public.essay_prompt_overrides (unit_id, cycle, record, status, read_on, reader) values ('100000', $1, '{}', 'none', current_date, 'EE')", [CYCLE])), /permission denied|row-level security/);
  assert.match(await errorOf(asUser(db, eve, "update public.essay_prompt_overrides set reader = 'EE'")), /permission denied/);
  assert.match(await errorOf(asUser(db, eve, "delete from public.essay_prompt_overrides")), /permission denied/);
  assert.equal((await db.query<{ reader: string }>("select reader from public.essay_prompt_overrides")).rows[0].reader, "RR", "an update touches nothing");
  assert.match(await errorOf(asAal2(db, quinn, SET, ["100000", CYCLE, JSON.stringify(r)])), /record_mismatch/, "the row and its JSON never drift apart");
  const actions = (await db.query<{ action: string }>("select action from public.admin_log order by id")).rows.map((x) => x.action);
  assert.deepEqual(actions, ["essays.set"]);
  await asAal2(db, quinn, "select public.admin_delete_essay_prompts($1, $2)", [UF, CYCLE]);
  assert.equal((await asAnon(db, "select 1 from public.essay_prompt_overrides")).length, 0);
  // The exported record and the saved one are the same JSON: the export writes recordJson of what anyone reads.
  assert.equal(recordJson(read[0].record), recordJson(r));
});

test("guard: dropping the is_admin() line from admin_set_essay_prompts is caught (a non-admin's save gets through)", async () => {
  const { db, eve } = await policyWorld((sql) => sql.replace("if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;\n  if jsonb_typeof", "if jsonb_typeof"));
  assert.equal(await errorOf(asAal2(db, eve, SET, [UF, CYCLE, JSON.stringify(record())])), "ok", "without the line the refusal check above would fail");
});
