/**
 * Less text on every screen (specs/planner/record/less-text.md): a screen opens with a title and one line, and the
 * why/how-to-think-about-it text folds behind `WhyFold` (components/ui/why-fold.tsx) instead of sitting above the
 * first control. This repo has no React test renderer wired up for client components, so every check here is a
 * "source-level test" (the same kind `tests/*-ui.test.mts` and the copy guards already use): read the component's
 * own source, assert the fold exists and the lead is short, and plant a bad case (an inline second paragraph, or a
 * missing fold) to prove the guard isn't vacuous. `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECORD_STEPS } from "../lib/planner/record.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The number of top-level `<p` elements in a block of JSX source (a cheap proxy for "how many lines of prose"). */
function pCount(block: string): number {
  return (block.match(/<p[\s>]/g) ?? []).length;
}

/**
 * The intro block every tour step now shares: `<div className="space-y-1">…Headline…WhyFold…one line…</div>`,
 * with a nested `<div className="flex items-center …">` around the headline + WhyFold. Finds the *matching* close
 * of the outer div (by depth), not just the first `</div>` (which would stop inside the nested one).
 */
function introBlock(src: string): string {
  const start = src.indexOf('<div className="space-y-1">');
  assert.ok(start !== -1, 'no `<div className="space-y-1">` intro block found');
  let pos = src.indexOf(">", start) + 1; // just past the outer div's own opening tag
  let depth = 1; // the outer div itself
  while (pos < src.length) {
    const nextOpen = src.indexOf("<div", pos);
    const nextClose = src.indexOf("</div>", pos);
    assert.ok(nextClose !== -1, "intro block never closes");
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return src.slice(start, nextClose);
      pos = nextClose + 6;
    }
  }
  throw new Error("intro block never closes");
}

/* ------------------------------------------------------------------ */
/* WhyFold itself                                                      */
/* ------------------------------------------------------------------ */

const whyFoldSrc = read("components/ui/why-fold.tsx");

test("WhyFold is a closed-by-default <details> that fires plan_why_opened once per open, not on close", () => {
  assert.match(whyFoldSrc, /defaultOpen\s*=\s*false/);
  assert.match(whyFoldSrc, /<details[\s\S]*?open=\{defaultOpen\}/);
  assert.match(whyFoldSrc, /onToggle=\{[\s\S]*?if \(e\.currentTarget\.open && !opened\.current\)/);
  assert.match(whyFoldSrc, /track\("plan_why_opened", \{ screen, section \}\)/);
});

test("WhyFold's compact shape is a round \"?\" trigger (the record tour's stand-in InfoNote shape), the full shape a chevron + title", () => {
  assert.match(whyFoldSrc, /compact\s*\?[\s\S]*?"\?"/);
  assert.match(whyFoldSrc, /ChevronDown/);
});

test("planted bad case: a details with no onToggle guard would double-fire (and the real component isn't that)", () => {
  const planted = `<details onToggle={() => track("plan_why_opened", { screen, section })}>`;
  assert.doesNotMatch(whyFoldSrc.replace(/\s+/g, " "), new RegExp(planted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

/* ------------------------------------------------------------------ */
/* The tour's steps                                                     */
/* ------------------------------------------------------------------ */

const TOUR_STEPS: { file: string; step: number; section: string }[] = [
  { file: "components/planner/intake/GradesStep.tsx", step: 0, section: "grades" },
  { file: "components/planner/intake/TestStep.tsx", step: 1, section: "test" },
  { file: "components/planner/intake/ApStep.tsx", step: 2, section: "courses" },
  { file: "components/planner/intake/ConnectionsStep.tsx", step: 6, section: "connections" },
  { file: "components/planner/intake/MajorStep.tsx", step: 8, section: "major" },
  { file: "components/planner/intake/BasicsStep.tsx", step: 9, section: "basics" },
  { file: "components/planner/intake/WhereStep.tsx", step: 10, section: "where" },
  { file: "components/planner/intake/StoryStep.tsx", step: 11, section: "story" },
  { file: "components/planner/intake/RecommendersStep.tsx", step: 12, section: "recommenders" },
];

for (const { file, step, section } of TOUR_STEPS) {
  test(`${file}: the headline row has a compact WhyFold holding RECORD_STEPS[${step}].why, and the intro has exactly one unconditional lead paragraph`, () => {
    const src = read(file);
    assert.match(src, /import \{ WhyFold \} from "@\/components\/ui\/why-fold";/);
    const block = introBlock(src);
    assert.match(block, /<WhyFold compact title="Why we ask" screen="record_tour" section=/, "no compact WhyFold on the headline row");
    // Steps 11/12 (story, recommenders) add a *conditional* `{firstRun && <p>…}` note on the first run
    // (steps.md "First run"); that's allowed on top of the one unconditional lead line.
    const unconditional = block.replace(/\{firstRun\s*&&\s*\([^]*?\)\}/, "");
    assert.equal(pCount(unconditional), 1, `expected exactly one unconditional lead <p> above the first control in ${file}, found ${pCount(unconditional)}`);
    const info = RECORD_STEPS.find((s) => s.section === section);
    assert.ok(info, `no RECORD_STEPS entry for section ${section}`);
    assert.equal(info!.step, step);
  });
}

test("ActivitiesStep (sports, clubs, work, other) looks up its line/why from RECORD_STEPS by section, not a hardcoded copy table", () => {
  const src = read("components/planner/intake/ActivitiesStep.tsx");
  assert.match(src, /const info = RECORD_STEPS\.find\(\(s\) => s\.section === step\)!;/);
  assert.match(src, /\{info\.line\}/);
  assert.match(src, /\{info\.why\}/);
  // The old per-step hardcoded `sub` strings are gone from the copy table.
  assert.doesNotMatch(src, /sub:\s*"/);
});

test("planted bad case: a two-paragraph intro (the old headline + two sentences) would fail the one-paragraph guard", () => {
  const planted = `
      <div className="space-y-1">
        <Headline lead="Any" pop="connections" tail="to a college?" />
        <p className="text-sm text-muted-foreground">
          A parent, grandparent, or sibling who went somewhere, or a coach who&apos;s recruiting you. Some colleges weigh these; we only use them where
          the college says it does.
        </p>
      </div>`;
  assert.equal(pCount(introBlock(planted)), 1, "sanity: the two sentences are in the same <p>, so this plant needs the second check below instead");
  // The actual regression this guard exists to catch: a *second* <p> back above the controls.
  const plantedTwoParagraphs = `
      <div className="space-y-1">
        <Headline lead="Your" pop="recommenders" />
        <p className="text-sm text-muted-foreground">The teachers who might write for you, first choice first.</p>
        <p className="text-sm text-muted-foreground">Most colleges ask for one or two teacher letters.</p>
      </div>`;
  assert.equal(pCount(introBlock(plantedTwoParagraphs)), 2, "the planted regression has two lead paragraphs, which the real guard above would reject");
});

/* ------------------------------------------------------------------ */
/* Build your list: the season sentence moves into "Why this shape"    */
/* ------------------------------------------------------------------ */

test("ListGuide no longer prints the season sentence inline; it hands it to ShapeExplainer instead", () => {
  const src = read("components/planner/guides/ListGuide.tsx");
  assert.doesNotMatch(src, /<p className="text-sm text-muted-foreground">\{d\.sentence\}<\/p>/, "the season sentence is still printed above the fold");
  assert.match(src, /<ShapeExplainer season=\{ctx\.season\} sentence=\{d\.sentence\}\s*\/>/);
});

test("ShapeExplainer's sheet renders the season sentence it's handed (content unchanged, just moved)", () => {
  const src = read("components/planner/guides/ShapeExplainer.tsx");
  assert.match(src, /sentence\?:\s*string/);
  assert.match(src, /\{sentence && <p className="text-muted-foreground">\{sentence\}<\/p>\}/);
});

test("planted bad case: ShapeExplainer with no sentence prop would silently drop the season sentence", () => {
  const planted = 'export function ShapeExplainer({ season }: { season: Season }) {';
  assert.doesNotMatch(read("components/planner/guides/ShapeExplainer.tsx"), new RegExp(planted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

/* ------------------------------------------------------------------ */
/* Show interest: the per-section sentence folds under an info icon    */
/* ------------------------------------------------------------------ */

test("InterestGuide's 'Ask for information' and 'Follow' sections fold their sentence under a compact WhyFold on the title, unchanged in wording", () => {
  const src = read("components/planner/guides/InterestGuide.tsx");
  assert.match(src, /note=\{\s*<WhyFold compact[^]*?Ask for information|note=\{[\s\S]*?ask_for_information/);
  assert.match(src, /An information request or a mailing-list sign-up puts you in \{name\}&apos;s system\./, "the exact sentence must survive the move, word for word");
  assert.match(src, /No college says it counts a follow; do it for yourself\./, "the exact sentence must survive the move, word for word");
  // Neither sentence sits as a bare <p> above the section's own buttons any more.
  assert.doesNotMatch(src, /<p className="text-sm text-muted-foreground">An information request/);
  assert.doesNotMatch(src, /<p className="text-sm text-muted-foreground">No college says it counts a follow/);
});

test("planted bad case: the old bare <p> sentence (no WhyFold) above the buttons would fail the guard above", () => {
  const planted = '<p className="text-sm text-muted-foreground">An information request or a mailing-list sign-up puts you in {name}&apos;s system.</p>\n<div>';
  assert.match(planted, /<p className="text-sm text-muted-foreground">An information request/, "sanity: the plant reproduces the old shape");
});

/* ------------------------------------------------------------------ */
/* Reach your score: Study becomes links + a fold                      */
/* ------------------------------------------------------------------ */

test("TestGuide's Study section shows the links only; the lead sentence and the cadence fold under 'How much to study'", () => {
  const src = read("components/planner/guides/TestGuide.tsx");
  const start = src.indexOf('id="test-study"');
  const section = src.slice(start, src.indexOf("</section>", start));
  assert.match(section, /<WhyFold title="How much to study" screen="test_guide" section="study">/);
  assert.match(section, /Official, free, and the ones advisors point to first:/, "the lead sentence must survive the move");
  assert.match(section, /\{study\.cadence\}/, "the cadence line must survive the move");
  // The lead sentence is inside the fold, not printed before the links list.
  const beforeLinks = section.slice(0, section.indexOf("study.resources.map"));
  assert.doesNotMatch(beforeLinks, /Official, free, and the ones advisors point to first:/);
});

test("planted bad case: the lead sentence printed before the links (no fold) would fail the guard above", () => {
  const planted = '<h2>Study</h2>\n<p>Official, free, and the ones advisors point to first:</p>\n<ul>{study.resources.map';
  const beforeLinks = planted.slice(0, planted.indexOf("study.resources.map"));
  assert.match(beforeLinks, /Official, free, and the ones advisors point to first:/, "the plant reproduces the pre-fold regression");
});

/* ------------------------------------------------------------------ */
/* Your story: Depth and breadth / What your record says so far        */
/* ------------------------------------------------------------------ */

test("StoryGuide folds 'Depth and breadth' (closed) and 'What your record says so far' (open only while the story is empty)", () => {
  const src = read("components/planner/guides/StoryGuide.tsx");
  assert.match(src, /<WhyFold title="Depth and breadth" screen="story_guide" section="depth_and_breadth">/);
  assert.match(src, /<WhyFold title="What your record says so far" screen="story_guide" section="record_so_far" defaultOpen=\{storyEmpty\}>/);
  assert.match(src, /const storyEmpty = !story\?\.narrative\?\.trim\(\);/);
  // The privacy line is a rule the student must know (less-text.md), so it stays bare, outside any fold.
  assert.match(src, /<p className="text-sm text-muted-foreground">Private to you\. Nobody at Quad reads it, and your parents can&apos;t see it\.<\/p>\s*\n\s*<Frame/);
  // Content unchanged: the depth sentence and the "add your activities" sentence both still appear verbatim.
  assert.match(src, /Colleges that read beyond the numbers look for two things:/);
  assert.match(src, /Add your activities and the plan will show what they say\./);
});

test("planted bad case: Frame rendered as a bare section (no fold) would fail the guard above", () => {
  const planted = '<section className="space-y-2">\n<h2>Depth and breadth</h2>\n<p>Colleges that read beyond the numbers...</p>\n</section>';
  assert.doesNotMatch(planted, /<WhyFold title="Depth and breadth"/);
});

/* ------------------------------------------------------------------ */
/* Choose APs: the top paragraph becomes one line                      */
/* ------------------------------------------------------------------ */

test("CoursesGuide's opening paragraph is one sentence; the depth tie-in sentence on each suggestion card is untouched", () => {
  const src = read("components/planner/guides/CoursesGuide.tsx");
  const open = src.slice(src.indexOf("return (\n    <div"), src.indexOf("<WhatYouveTaken"));
  assert.equal(pCount(open), 1, "the opening block above the first section should be one paragraph");
  assert.match(open, /Schools ask for next year&apos;s choices in late winter\./);
  assert.doesNotMatch(open, /Colleges read the courses as closely as the grades\./, "the second sentence should no longer sit above the fold");
  // depthTieFor/depthTie is still wired on the suggestion cards (the brief: "the depth tie-in sentence stays").
  assert.match(src, /depthTie=\{depthTieFor\(tracks, s\.subject\)\}/);
  assert.match(src, /\{depthTie && <p className="mt-1 text-muted-foreground">\{depthTie\}<\/p>\}/);
});

test("planted bad case: the original two-sentence paragraph would fail the one-paragraph guard", () => {
  const planted = `return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Schools ask for next year's choices in late winter. Colleges read the courses as closely as the grades.
      </p>

      <WhatYouveTaken`;
  const open = planted.slice(planted.indexOf("return (\n    <div"), planted.indexOf("<WhatYouveTaken"));
  assert.equal(pCount(open), 1, "sanity: still one <p> tag — the second sentence hid inside it, which is exactly the shape the real fix removes");
  assert.match(open, /Colleges read the courses as closely as the grades\./, "the plant keeps the second sentence the real fix drops");
});

/* ------------------------------------------------------------------ */
/* Pick your recommenders: teachers first, both notes folded           */
/* ------------------------------------------------------------------ */

test("RecommendersGuide lists the teachers before 'What to think about' and 'How to ask', both closed folds", () => {
  const src = read("components/planner/guides/RecommendersGuide.tsx");
  const teachersAt = src.indexOf("Your teachers");
  const thinkAt = src.indexOf('<WhyFold title="What to think about"');
  const askAt = src.indexOf('<WhyFold title="How to ask"');
  assert.ok(teachersAt !== -1 && thinkAt !== -1 && askAt !== -1, "one of the three sections is missing");
  assert.ok(teachersAt < thinkAt, "the teachers list must come before 'What to think about'");
  assert.ok(thinkAt < askAt, "'What to think about' must come before 'How to ask'");
  // Neither fold is forced open.
  assert.doesNotMatch(src.slice(thinkAt, thinkAt + 200), /defaultOpen/);
  assert.doesNotMatch(src.slice(askAt, askAt + 200), /defaultOpen/);
  // Content unchanged: THINK_ABOUT/HOW_TO_ASK are still the source, just rendered inside the fold now.
  assert.match(src, /\{THINK_ABOUT\.map/);
  assert.match(src, /\{say\(HOW_TO_ASK\.join\(" "\)\)\}/);
});

test("planted bad case: 'What to think about' rendered before the teachers list would fail the order guard above", () => {
  const planted = '<section><h2>What to think about</h2></section>\n<section><h2>Your teachers</h2></section>';
  const thinkAt = planted.indexOf("What to think about");
  const teachersAt = planted.indexOf("Your teachers");
  assert.ok(thinkAt < teachersAt, "sanity: the plant really has the old (wrong) order");
});

/* ------------------------------------------------------------------ */
/* ED facts: "What {college} reports" and the caveat fold together     */
/* ------------------------------------------------------------------ */

test("EdSheet keeps the read and the questions visible; 'What {college} reports' and the caveat fold together", () => {
  const src = read("components/planner/EdSheet.tsx");
  assert.match(src, /<p>\{facts\.read\}<\/p>/);
  assert.match(src, /<WhyFold title=\{`What \$\{facts\.name\} reports`\} screen="ed_sheet" section="what_reports">/);
  const foldStart = src.indexOf('<WhyFold title={`What');
  const foldEnd = src.indexOf("</WhyFold>", foldStart);
  const fold = src.slice(foldStart, foldEnd);
  assert.match(fold, /\{facts\.framing\}/, "the framing sentence must survive the move");
  assert.match(fold, /ED_CAVEAT\.before/, "the caveat must fold together with 'What {college} reports'");
  // The questions list is still outside (and after) the fold, unconditionally visible.
  const questionsAt = src.indexOf("facts.questions.map");
  assert.ok(questionsAt > foldEnd, "the questions should render after the fold closes, not inside it");
});

test("planted bad case: the caveat rendered as a bare paragraph outside any fold would fail the guard above", () => {
  const planted = '</WhyFold>\n\n<p className="text-muted-foreground">\n  {ED_CAVEAT.before}\n</p>\n\n<ul className="space-y-1">\n{facts.questions.map';
  const foldEnd = planted.indexOf("</WhyFold>") + "</WhyFold>".length;
  const rest = planted.slice(foldEnd);
  assert.match(rest, /ED_CAVEAT\.before/, "sanity: the plant reproduces the caveat sitting outside the fold");
});

/* ------------------------------------------------------------------ */
/* Telemetry                                                           */
/* ------------------------------------------------------------------ */

test("plan_why_opened is registered in the event registry with screen and section, client-side", () => {
  const src = read("lib/analytics.ts");
  assert.match(src, /plan_why_opened:\s*\{\s*screen:\s*string;\s*section:\s*string\s*\}/);
  assert.match(src, /plan_why_opened:\s*\{\s*properties:\s*\["screen",\s*"section"\],\s*side:\s*"client"/);
});
