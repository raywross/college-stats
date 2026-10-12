/**
 * "How Quad reads your list" (lib/chances/notes.ts listExplainer; components/planner/ListExplainer.tsx): the plan's one
 * list-level info panel (owner, 2026-10-12). It names kinds of inputs and the outputs, never a weight, a cutoff, a
 * multiplier, a score, or the odds (specs/chances/README.md "Quad's estimate is proprietary"). `npm test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_EXPLAINER_TITLE, listExplainer, noteText, type ListExplainerSection } from "../lib/chances/notes.ts";
import { STANDING_LEVELS, STANDING_LEVEL_LABELS, SELECTIVITY_TIERS, SELECTIVITY_TIER_LABELS } from "../lib/chances/levels.ts";

const ROOT = join(import.meta.dirname, "..");
const allText = (sections: ListExplainerSection[]) => sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.items ?? []).flatMap((i) => [i.label, i.text])]).join("\n");

/** Words and shapes that would describe the method rather than its inputs. */
function methodLeaks(text: string): string[] {
  const out: string[] = [];
  if (/\d/.test(text)) out.push("a number");
  if (/%/.test(text)) out.push("a percent sign");
  for (const w of [/\bweight(ed|s|ing)? (of|by)\b/i, /multipl/i, /cutoff/i, /threshold/i, /\bodds\b/i, /\bindex\b/i, /\bpoints?\b/i, /\bpool\b/i, /\bcap(s|ped)?\b/i, /\bfloor\b/i])
    if (w.test(text)) out.push(String(w));
  return out;
}

test("the panel names every level, in order, with the catalog's own meaning line", () => {
  const levels = listExplainer().find((s) => s.term === "levels")!;
  assert.deepEqual(levels.items!.map((i) => i.label), STANDING_LEVELS.map((l) => STANDING_LEVEL_LABELS[l]));
  for (const l of STANDING_LEVELS) {
    const item = levels.items!.find((i) => i.label === STANDING_LEVEL_LABELS[l])!;
    assert.equal(item.text, noteText({ key: `estimate.level.${l}`, values: { test: "" } }));
    assert.ok(item.text.length > 20);
  }
});

test("the panel names the six selectivity tiers, Ultra selective's stricter bar, and the very top's standout", () => {
  const tiers = listExplainer().find((s) => s.term === "selectivity-tier")!;
  const text = tiers.paragraphs.join(" ");
  for (const t of SELECTIVITY_TIERS) assert.match(text, new RegExp(SELECTIVITY_TIER_LABELS[t]), t);
  assert.match(text, /reach for everyone/);
  assert.match(text, /every part/);
  assert.ok(tiers.paragraphs.includes(noteText({ key: "estimate.top_band", values: {} })));
});

test("the panel lists the kinds of inputs, the junior's target, missing inputs, who you're compared with, and never a percentage", () => {
  const sections = listExplainer();
  const labels = sections.flatMap((s) => (s.items ?? []).map((i) => i.label));
  for (const l of ["Grades", "Class standing", "Courses", "Tests", "Activities", "Legacy", "Recruiting", "Visits and following"]) assert.ok(labels.includes(l), l);
  const text = allText(sections);
  assert.match(text, /weighted GPA/);
  assert.match(text, /AP exam results/);
  assert.match(text, /Until junior year ends/);
  assert.match(text, /Depth counts/);
  assert.match(text, /Missing inputs lower confidence/);
  assert.match(text, /Applicants like you/);
  assert.match(text, /never a percentage/i);
  assert.equal(LIST_EXPLAINER_TITLE, "How Quad reads your list");
});

test("the panel never spells the method: no numbers, weights, cutoffs, multipliers, odds, or the index", () => {
  assert.deepEqual(methodLeaks(allText(listExplainer())), []);
});

test("guard: the leak check catches a number, a multiplier, and a cutoff", () => {
  assert.ok(methodLeaks("Legacy multiplies the rate").length > 0);
  assert.ok(methodLeaks("Reach above 25 odds").length > 0);
  assert.ok(methodLeaks("the cutoff for Safe").length > 0);
  assert.ok(methodLeaks("top 5% of the class").length > 0);
});

test("the panel component reads the catalog and links the glossary terms", () => {
  const src = readFileSync(join(ROOT, "components/planner/ListExplainer.tsx"), "utf8");
  assert.match(src, /listExplainer\(\)/);
  assert.match(src, /\/glossary#\$\{/);
  assert.match(src, /LIST_EXPLAINER_TITLE/);
  // The list header opens it.
  assert.match(readFileSync(join(ROOT, "components/planner/PlanList.tsx"), "utf8"), /<ListExplainer\b/);
});
