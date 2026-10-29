/**
 * The run summary (data/essay-prompts/last-run.json) and what the workflow builds from it: the data PR's body and its
 * release note (specs/release-notes.md). Pure.
 */

export interface RunSummary {
  run: string;
  started: string;
  finished: string | null;
  /** The open cycle on the run's day. */
  cycle: string;
  budget_usd: number;
  spent_usd: number;
  stopped: string | null;
  dry_run: boolean;
  colleges: number;
  counts: { passed: number; held: number; unchanged: number; not_found: number; failed: number; found: number };
  passed: { unit_id: string; name: string; status: string; prompts: number }[];
  held: { unit_id: string; name: string; problems: string[] }[];
  not_found: { unit_id: string; name: string; blocked?: string }[];
  failed: { unit_id: string; name: string; reason: string }[];
}

const row = (cells: (string | number)[]) => `| ${cells.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;

export function prBody(s: RunSummary): string {
  const c = s.counts;
  const lines = [
    `Essay prompts run ${s.run} for the ${s.cycle} cycle (specs/product/essays/prompts.md).`,
    "",
    `- Colleges: ${s.colleges}; passed ${c.passed}, held ${c.held}, unchanged ${c.unchanged}, not found ${c.not_found}, failed ${c.failed}`,
    `- Spent $${s.spent_usd.toFixed(2)} of the $${s.budget_usd.toFixed(2)} budget${s.stopped ? `; stopped: ${s.stopped}` : ""}`,
    "",
    "Held records are in `data/essay-prompts/held/` and never merged; review them, fix by hand or re-run.",
  ];
  if (s.held.length) {
    lines.push("", "### Held", "", row(["College", "Unit", "Why"]), row(["---", "---", "---"]));
    for (const h of s.held.slice(0, 60)) lines.push(row([h.name, h.unit_id, h.problems.slice(0, 3).join("; ")]));
    if (s.held.length > 60) lines.push("", `… and ${s.held.length - 60} more.`);
  }
  const blocked = s.not_found.filter((n) => n.blocked);
  if (blocked.length) {
    lines.push("", "### Blocked (for the Data Steward's To do list)", "", row(["College", "Unit", "Host"]), row(["---", "---", "---"]));
    for (const b of blocked.slice(0, 60)) lines.push(row([b.name, b.unit_id, b.blocked!]));
  }
  if (s.failed.length) {
    lines.push("", "### Reads that failed", "", row(["College", "Unit", "Reason"]), row(["---", "---", "---"]));
    for (const f of s.failed.slice(0, 60)) lines.push(row([f.name, f.unit_id, f.reason]));
  }
  return `${lines.join("\n")}\n`;
}

/** The release note for the data PR. */
export function releaseNote(s: RunSummary, pr: number, date: string): string {
  const n = s.counts.passed;
  return `---
title: "Essay prompts for ${n} more ${n === 1 ? "college" : "colleges"}"
pr: ${pr}
date: ${date}
kind: data
summary: "Read the ${s.cycle} essay and short-answer prompts from ${n} ${n === 1 ? "college's" : "colleges'"} own admissions pages."
---

## What's new
- The essay and short-answer prompts ${n === 1 ? "one college publishes" : `${n} colleges publish`} for this cycle, each quoted from the college's own page with its limit and whether it is required.

## Behind the scenes
- Run ${s.run}: ${s.counts.held} held for review, ${s.counts.not_found} with no essay page found, $${s.spent_usd.toFixed(2)} spent.
`;
}
