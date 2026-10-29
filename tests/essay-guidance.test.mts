/**
 * The essay reviewer's guidance corpus (specs/product/essays/reviewer.md "The guidance corpus", "Rules for the
 * synthesis"): the committed sources.json's shape and fair-use limits, guidance.md's headings (the contract with the
 * reviewer, lib/essays/guidance.ts), its citations and quotation rule, and the research script's excerpt picker. Each
 * rule is also run on a planted violation to prove it catches one. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_WORDS_PER_SOURCE,
  pageTitle,
  rejoinLines,
  selectExcerpts,
  sentences,
  SOURCES,
  TOPICS,
  wordCount,
  type GuidanceFile,
  type GuidanceSource,
} from "../scripts/research-essay-guidance.mts";

const DIR = join(import.meta.dirname, "..", "data", "reference", "essay-guidance");
const file: GuidanceFile = JSON.parse(readFileSync(join(DIR, "sources.json"), "utf8"));
const guidance = readFileSync(join(DIR, "guidance.md"), "utf8");

/** The sections the reviewer loads by heading (brief: "the heading list is the contract with U5b"). */
const REQUIRED_HEADINGS = [
  "mechanics",
  "prompt",
  "specific",
  "structure",
  "voice",
  "care",
  "showcase",
  "interest",
  "approach: what to showcase",
  "approach: the main essay and the supplements",
  "approach: depth",
  "approach: showing interest",
  "approach: short answers",
];

/* ------------------------------------------------------------------ */
/* Checks (pure, so each can be run on a planted violation)            */
/* ------------------------------------------------------------------ */

function sourceProblems(sources: GuidanceSource[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const s of sources) {
    const at = s.id ?? "(no id)";
    if (!s.id) problems.push(`${at}: no id`);
    if (ids.has(s.id)) problems.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!/^https:\/\/\S+$/.test(s.url ?? "")) problems.push(`${at}: url is not https`);
    if (urls.has(s.url)) problems.push(`${at}: duplicate url`);
    urls.add(s.url);
    if (!s.organization?.trim()) problems.push(`${at}: no organization`);
    if (!s.title?.trim()) problems.push(`${at}: no title`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.retrieved ?? "") || Number.isNaN(Date.parse(s.retrieved))) problems.push(`${at}: retrieved is not a date`);
    if (s.half !== "craft" && s.half !== "approach") problems.push(`${at}: half is ${s.half}`);
    if (!s.topics?.length || s.topics.some((t) => !(TOPICS as readonly string[]).includes(t))) problems.push(`${at}: topics ${JSON.stringify(s.topics)}`);
    if (!s.excerpts?.length) problems.push(`${at}: no excerpts`);
    const words = (s.excerpts ?? []).reduce((n, e) => n + wordCount(e), 0);
    if (words > MAX_WORDS_PER_SOURCE) problems.push(`${at}: ${words} words of excerpts (limit ${MAX_WORDS_PER_SOURCE})`);
    if ((s.excerpts ?? []).some((e) => !e.trim())) problems.push(`${at}: an empty excerpt`);
  }
  return problems;
}

const normUrl = (u: string) => u.replace(/[).,;]+$/, "").replace(/\/$/, "");
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** The body's paragraphs after the first heading, each list item on its own; headings dropped. */
function paragraphs(md: string): { section: string; text: string }[] {
  const out: { section: string; text: string }[] = [];
  let section = "";
  const body = md.slice(md.search(/^## /m));
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    let current: string[] = [];
    const flush = () => {
      const text = current.join(" ").trim();
      if (text) out.push({ section, text });
      current = [];
    };
    for (const line of lines) {
      if (/^#{1,6} /.test(line)) {
        flush();
        section = line.replace(/^#+\s*/, "").trim();
      } else if (/^\s*(\d+\.|[-*])\s/.test(line)) {
        flush();
        current.push(line);
      } else current.push(line);
    }
    flush();
  }
  return out;
}

function guidanceProblems(md: string, sources: GuidanceSource[]): string[] {
  const problems: string[] = [];
  const known = new Set(sources.map((s) => normUrl(s.url)));
  const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  for (const h of REQUIRED_HEADINGS) if (!headings.includes(h)) problems.push(`missing heading "## ${h}"`);
  if (!/DRAFT for the owner's review/.test(md.split("\n## ")[0])) problems.push("no DRAFT line before the first section");
  for (const p of paragraphs(md)) {
    const urls = [...p.text.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => normUrl(m[0]));
    const short = `[${p.section}] ${p.text.slice(0, 70)}…`;
    if (!urls.length) problems.push(`${short}: cites no source`);
    for (const u of urls) if (!known.has(u)) problems.push(`${short}: cites ${u}, which is not in sources.json`);
    // At most one quoted sentence of any one source: count the quoted spans (four words or more) found in its excerpts.
    const quotes = [...p.text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => norm(m[1])).filter((q) => wordCount(q) >= 4);
    for (const s of sources) {
      const text = norm(s.excerpts.join(" "));
      const n = quotes.filter((q) => text.includes(q.replace(/[.,!?]$/, ""))).length;
      if (n > 1) problems.push(`${short}: quotes ${n} sentences of ${s.id}`);
    }
    if (/^\*\*Where sources disagree/.test(p.text) && !/\bask/i.test(p.text)) problems.push(`${short}: a disagreement that doesn't say the reader asks`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* sources.json                                                        */
/* ------------------------------------------------------------------ */

test("sources.json: every source has a url, a date, a half, topics, and excerpts within 300 words", () => {
  assert.deepEqual(sourceProblems(file.sources), []);
});

test("sources.json: 40 to 60 sources, both halves present, each one on the script's list", () => {
  assert.ok(file.sources.length >= 40 && file.sources.length <= 60, `${file.sources.length} sources`);
  assert.ok(file.sources.filter((s) => s.half === "craft").length >= 15);
  assert.ok(file.sources.filter((s) => s.half === "approach").length >= 15);
  const listed = new Map(SOURCES.map((s) => [s.id, s]));
  for (const s of file.sources) {
    assert.ok(listed.has(s.id), `${s.id} is not in SOURCES`);
    assert.equal(s.url, listed.get(s.id)!.url);
    assert.equal(s.half, listed.get(s.id)!.half);
  }
});

test("sources.json: refusals name the page and the reason; a refused page kept from an earlier run keeps its older date", () => {
  const kept = new Map(file.sources.map((s) => [s.id, s]));
  for (const r of file.refused) {
    assert.ok(r.id && r.organization && /^https:\/\//.test(r.url) && r.reason && /^\d{4}-\d{2}-\d{2}$/.test(r.checked), JSON.stringify(r));
    const old = kept.get(r.id);
    if (old) assert.ok(old.retrieved < r.checked, `${r.id} is kept with excerpts read ${old.retrieved}, refused ${r.checked}`);
  }
  assert.equal(file.user_agent.startsWith("QuadCollegeData/"), true, "fetched with the honest user agent");
});

test("sources.json: no commercial coaching hosts", () => {
  const banned = /collegevine|prepscholar|collegeessayguy|empowerly|ingeniusprep|crimsoneducation|collegeadvisor|collegetransitions|koppelman|collegewise|grammarly/i;
  for (const s of [...file.sources, ...SOURCES]) assert.ok(!banned.test(s.url), s.url);
});

test("sourceProblems catches each planted violation", () => {
  const good = file.sources[0];
  const long = Array.from({ length: 301 }, () => "word").join(" ");
  const cases: [Partial<GuidanceSource>, RegExp][] = [
    [{ url: "http://example.edu/x" }, /not https/],
    [{ retrieved: "last week" }, /not a date/],
    [{ half: "other" as never }, /half is other/],
    [{ topics: ["grades" as never] }, /topics/],
    [{ excerpts: [] }, /no excerpts/],
    [{ excerpts: [long] }, /301 words/],
  ];
  for (const [patch, re] of cases) {
    const problems = sourceProblems([{ ...good, ...patch }]);
    assert.ok(problems.some((p) => re.test(p)), `${JSON.stringify(patch).slice(0, 60)} → ${problems.join("; ")}`);
  }
  assert.ok(sourceProblems([good, { ...good }]).some((p) => /duplicate id/.test(p)));
});

/* ------------------------------------------------------------------ */
/* guidance.md                                                         */
/* ------------------------------------------------------------------ */

test("guidance.md: the reviewer's sections exist, every paragraph cites sources.json, quotes stay within the rule", () => {
  assert.deepEqual(guidanceProblems(guidance, file.sources), []);
});

test("guidance.md: the DRAFT line gives the date and the source count", () => {
  const head = guidance.split("\n## ")[0];
  assert.match(head, /\d{4}-\d{2}-\d{2}/);
  const n = Number(/from (\d+) sources/.exec(head)?.[1]);
  assert.equal(n, file.sources.length, "the DRAFT line's count matches sources.json");
  const craft = Number(/\((\d+) on the craft/.exec(head)?.[1]);
  assert.equal(craft, file.sources.filter((s) => s.half === "craft").length);
});

test("guidanceProblems catches each planted violation", () => {
  const url = file.sources[0].url;
  const quoted = file.sources.find((s) => s.excerpts.length >= 2 && s.excerpts.slice(0, 2).every((e) => wordCount(e) >= 5))!;
  const base = guidance;
  const plants: [string, RegExp][] = [
    [base.replace("## care\n", "## caring\n"), /missing heading "## care"/],
    [base.replace("DRAFT for the owner's review", "Draft"), /no DRAFT line/],
    [`${base}\n\nA paragraph with no citation at all.\n`, /cites no source/],
    [`${base}\n\nA paragraph citing an unknown page (https://example.com/advice).\n`, /not in sources.json/],
    [`${base}\n\n“${quoted.excerpts[0]}” and “${quoted.excerpts[1]}” (${quoted.url}).\n`, /quotes 2 sentences/],
    [`${base}\n\n**Where sources disagree: x.** One says yes, one says no (${url}).\n`, /doesn't say the reader asks/],
  ];
  for (const [md, re] of plants) {
    const problems = guidanceProblems(md, file.sources);
    assert.ok(problems.some((p) => re.test(p)), `${re} → ${problems.join("; ")}`);
  }
});

/* ------------------------------------------------------------------ */
/* The excerpt picker                                                  */
/* ------------------------------------------------------------------ */

test("selectExcerpts: whole sentences containing an anchor, in page order, once each, under the word cap", () => {
  const text = "## Heading\nFirst idea here. Second idea is about commas. Third one.\n- A list item on run-ons\nCommas again here.";
  const { excerpts, missing } = selectExcerpts(text, ["run-ons", "commas", "nowhere"]);
  assert.deepEqual(excerpts, ["Second idea is about commas.", "A list item on run-ons", "Commas again here."]);
  assert.deepEqual(missing, ["nowhere"]);
  const capped = selectExcerpts("One two three four. Five six seven eight.", ["four", "eight"], 5);
  assert.deepEqual(capped.excerpts, ["One two three four."]);
  // Curly quotes and dashes match their plain forms.
  assert.equal(selectExcerpts("Don’t try – ever.", ["don't try - ever"]).excerpts.length, 1);
});

test("sentences: no split after a title or e.g.; a long heading-wrapped paragraph is kept; short headings dropped", () => {
  assert.deepEqual(sentences("Ask Mr. Calleson today. Then stop."), ["Ask Mr. Calleson today.", "Then stop."]);
  assert.deepEqual(sentences("## Short heading\n## This heading is really a paragraph that a blog wrapped in a heading tag by mistake, sadly."), [
    "This heading is really a paragraph that a blog wrapped in a heading tag by mistake, sadly.",
  ]);
});

test("rejoinLines: a sentence wrapped across lines is joined; a PDF's wrapped capitals too, but not its headings", () => {
  assert.deepEqual(rejoinLines("Comma splices are\ncommon errors.\nNext line."), ["Comma splices are common errors.", "Next line."]);
  assert.deepEqual(rejoinLines("RUN-ON SENTENCES\nA run-on occurs when two clauses are joined in\nPersonal Statements too.", true), [
    "RUN-ON SENTENCES",
    "A run-on occurs when two clauses are joined in Personal Statements too.",
  ]);
});

test("pageTitle: the page's own title without the site name", () => {
  assert.equal(pageTitle("<title>Fragments and Run-ons – The Writing Center</title>"), "Fragments and Run-ons");
  assert.equal(pageTitle("<title>Essay Writing Tips &middot; Inside Admissions</title>"), "Essay Writing Tips");
  assert.equal(pageTitle("<p>no title</p>"), null);
});

test("SOURCES: unique ids and urls, a topic and a pick each", () => {
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
  assert.equal(new Set(SOURCES.map((s) => s.url)).size, SOURCES.length);
  for (const s of SOURCES) assert.ok(s.topics.length && s.pick.length, s.id);
});
