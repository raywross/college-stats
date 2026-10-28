/**
 * The rename's words (specs/product/advisor.md "1. The name"): the plan became Quad Advisor, so what a person reads says
 * "your advisor", "Jordan's advisor", "the Advisor tab", or "your list" (when it meant the list of colleges). "Plan"
 * stays where it means a plan of action, a course plan, the College Financing Plan, a fee waiver plan, "plan to apply
 * test-optional", or the admin fallback's "planner's tables".
 *
 * The sweep parses every `.ts`/`.tsx` file in the folders the words live in and reads only string literals, template
 * text, and JSX text (comments and identifiers are free to say "plan"). It fails with the file and line of any
 * "your/the/their/my/our plan", "<Name>'s plan", "the planner", "Plan tab", or a bare "Plan" label. A line (or the
 * line above it) that carries the comment `advisor-words: ok` is skipped, for the rare sentence the allowlist misses.
 * `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");

/** The folders and files whose words U2 owns (the advisor build's brief). */
const SCOPE = [
  "components/planner",
  "components/layout",
  "components/account",
  "components/record",
  "components/school/HsPrepTable.tsx",
  "components/me",
  "app/advisor",
  "app/connect/page.tsx",
  "app/me",
  "app/household",
  "app/api/plan",
  "lib/emails",
  "lib/sms.ts",
  "lib/planner",
  "lib/chances/notes.ts",
  "lib/glossary.ts",
];

/** Files the splash-page unit deletes (the old signed-out plan); their words go with them. */
const SKIP_FILES = new Set(["components/planner/SignedOutPlan.tsx", "components/planner/PitchAnimation.tsx"]);

/** Phrases that keep "plan" because it means a plan, not the product. Removed before the patterns are tried. */
const KEEP = [
  /\bcourse plans?\b/gi,
  // "plan of", "plan for", and "plan to" keep only in these senses: "your plan to see this guide" is the product.
  /\bplans? of (?:action|attack)\b/gi,
  /\bplans? for (?:the|an?|each|every) (?:essay|summer|year|test|visit|application)s?\b/gi,
  /\bthe plan for most\b/gi,
  /\bplans? to (?:apply|take|visit|study|attend|enroll|major|retake|test)\b/gi,
  /\bfinancing plans?\b/gi,
  /\bCollege Financing Plan\b/g,
  /\bplanner's tables\b/gi,
  /\btest-optional plans?\b/gi,
  /\bpayment plans?\b/gi,
  /\bfee (?:waiver )?plans?\b/gi,
];

const FORBIDDEN: { re: RegExp; what: string }[] = [
  { re: /(?:\b(?:your|the|their|my|our|this|that|whose)|'s) plans?\b/i, what: "the product called a plan" },
  { re: /\blists?, plans?\b|\b(?:college|family) plans?\b|\bstart a plan\b/, what: "the product called a plan" },
  { re: /\bthe planner\b/i, what: '"the planner" to a person' },
  { re: /\bPlan (?:tab|reminders|setup|settings|menu|views)\b/i, what: 'a "Plan …" label' },
];

const ESCAPE = /advisor-words:\s*ok/;

function files(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return /\.tsx?$/.test(rel) ? [rel] : [];
  return readdirSync(abs).flatMap((name) => files(join(rel, name)));
}

type Hit = { file: string; line: number; text: string; what: string };

/** Every forbidden use of "plan" in a source text's string literals, template text, and JSX text. */
export function sweep(file: string, src: string): Hit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = src.split("\n");
  const hits: Hit[] = [];
  // `afterValue`: the text follows a `${…}` or a JSX `{…}`, so a leading "plan" is "{whose} plan" ("Open {whose} plan").
  const check = (node: ts.Node, text: string, afterValue = false, jsx = false) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (ESCAPE.test(lines[line] ?? "") || ESCAPE.test(lines[line - 1] ?? "")) return;
    let rest = text.replace(/\u2019/g, "'");
    for (const k of KEEP) rest = rest.replace(k, " ");
    const label = (jsx ? /^plan$/i : /^Plan$/).test(text.trim()) ? 'a bare "Plan" label' : null;
    const named = afterValue && /^\s*plans?\b/i.test(rest) ? '"{whose} plan"' : null;
    const found = label ?? named ?? FORBIDDEN.find((f) => f.re.test(rest))?.what;
    if (found) hits.push({ file, line: line + 1, text: text.trim().slice(0, 120), what: found });
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text);
    else if (ts.isTemplateHead(node)) check(node, node.text);
    else if (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) check(node, node.text, true);
    else if (ts.isJsxText(node)) {
      const siblings = ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent) ? node.parent.children : undefined;
      const i = siblings ? siblings.indexOf(node) : -1;
      const afterValue = i > 0 && ts.isJsxExpression(siblings![i - 1]);
      check(node, node.text.replace(/&apos;|&#39;|&rsquo;/g, "'").replace(/\s+/g, " "), afterValue, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

test("no person reads \"your plan\", \"Jordan's plan\", \"the planner\", or a bare \"Plan\" label in the owned folders", () => {
  const all = SCOPE.flatMap(files).filter((f) => !SKIP_FILES.has(f));
  assert.ok(all.length > 100, `the sweep found only ${all.length} files; a folder moved`);
  const hits = all.flatMap((f) => sweep(f, readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(
    hits.map((h) => `${relative(ROOT, join(ROOT, h.file))}:${h.line} ${h.what}: ${h.text}`),
    [],
  );
});

test("the sweep catches each forbidden form and spares the senses that keep \"plan\"", () => {
  const caught = (src: string, file = "x.tsx") => sweep(file, src).length;
  // Forbidden: the product called a plan, in every place a person reads words.
  assert.equal(caught(`const a = "Open your plan";`), 1);
  assert.equal(caught("const a = `Open ${x} on your plan today`;"), 1);
  assert.equal(caught("const a = `${first}'s plan`;"), 1);
  assert.equal(caught(`const a = "Jordan's plan";`), 1);
  assert.equal(caught(`export const A = () => <p>It goes on the plan.</p>;`), 1);
  assert.equal(caught(`export const A = () => <a title="Back to the plan">x</a>;`), 1);
  assert.equal(caught(`export const A = () => <span>Plan</span>;`), 1);
  assert.equal(caught(`const label = "Plan";`), 1);
  assert.equal(caught(`const a = "Ask the planner";`), 1);
  assert.equal(caught(`const a = "Open the Plan tab";`), 1);
  assert.equal(caught(`const a = "Plan reminders";`), 1);
  assert.equal(caught(`export const A = () => <p>Set up your plan to see this guide.</p>;`), 1);
  assert.equal(caught(`const a = "No activity on the plan for 14 days.";`), 1);
  assert.equal(caught(`const a = "That plan isn't one you can see.";`), 1);
  assert.equal(caught(`const a = "edit my list, plan, and numbers";`), 1);
  assert.equal(caught("const a = `texts about ${whose} college plan`;"), 1);
  assert.equal(caught("const a = `Open ${whose} plan`;"), 1);
  assert.equal(caught(`export const A = () => <a>Open {whose} plan</a>;`), 1);
  assert.equal(caught(`export const A = () => <p>all in {whose} <a href="/">plan</a></p>;`), 1);
  assert.equal(caught(`export const A = () => <p>The planner&apos;s view</p>;`), 1);
  // Kept: plans of action, the College Financing Plan, comments, identifiers, types, the escape.
  assert.equal(caught(`const a = "Make your plan for the essay";`), 0);
  assert.equal(caught(`const a = "Read the College Financing Plan";`), 0);
  assert.equal(caught(`const a = "Their plan to apply test-optional";`), 0);
  assert.equal(caught(`const a = "See the course plan";`), 0);
  assert.equal(caught(`const a = "Four years of tuition is the plan for most families";`), 0);
  assert.equal(caught(`const a = "Write the plan of action";`), 0);
  assert.equal(caught(`const a = "Not in the planner's tables yet";`), 0);
  assert.equal(caught(`// your plan\nconst yourPlan = 1; /* the plan */`), 0);
  assert.equal(caught(`type T = { tab: "Plan" };`), 0);
  assert.equal(caught(`const a = "your plan"; // advisor-words: ok`), 0);
  assert.equal(caught(`export const A = () => (\n  <>\n    {/* advisor-words: ok */}\n    <p>the plan</p>\n  </>\n);`), 0);
});
