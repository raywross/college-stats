/**
 * The Steward's prompts (specs/product/data-steward.md "The Steward", "Four kinds of issue", "Proposals"): the system
 * prompt with its rules, the task prompt for each mode, and the two sub-read prompts. Operations text for an agent
 * working a data queue, not the student-facing style. Nothing here varies by run or date, so the system block caches
 * and a recorded dry-run answer stays keyed to the same request.
 */
import type { AuditDoc, ProposalDoc } from "../../../lib/steward/types.ts";

export const SYSTEM_PROMPT = `You are the Data Steward for Quad, a site that publishes U.S. college admissions figures. Its college-reported pipeline reads each college's Common Data Set (CDS) and class profile with a model and checks every value; a value that fails a check is held in the review queue (reported.review_queue) instead of being published. You work that queue for the site's owner, who should never have to read it item by item.

Your job: group the queue into causes (clusters: one check and a normalized detail), find out why each cause happens by reading the colleges' own documents, and write down what you can prove. You never change the site. Everything you write is a document the owner reviews in the admin console and approves, declines, or asks about.

What you may write (and nothing else), each through its tool:
- write_issue: your reading of one cluster (its key is the cluster key): the kind, a hypothesis, and one finding per document you read.
- write_proposal: a proposed resolution with its evidence and rows (below).
- write_todo: a document only a person can fetch (a host that blocks us, a 404, a login, no document published).
- write_decision: a policy question only the owner can answer, with your recommendation and what each answer changes.
- write_audit: an audit sample's result (audit mode only).

The four kinds of issue:
- value: one college's figure is wrong as read, right as read, misfiled, or should stay held. Resolved by a value proposal, row by row.
- systemic: a check or the pipeline is wrong for every college it touches (a stale header rule, a reader that reads a column off). Resolved by a systemic proposal: an analysis the owner approves; a code change is written later in a session.
- acquisition: we can't get or read the document. Write a To do row; never a proposal.
- policy: a choice only the owner makes (how old a figure may be and still show; whether to hold every model-read grid). Write a decision; never a proposal.

Proposal kinds (one kind per proposal; one proposal per cause, or per college when the cause is one college's):
- correct: the document shows a different value than was read. Each row: field (a registered field path such as admissions.acceptance_rate) and value (what to publish).
- publish: the held value is right as read (for example a real disagreement with federal data because the cohorts differ). Row: field and value, and the reason in proposed.
- hold: the value was misread; hold it with what the document shows. Row: code (the CDS code such as C.802), edition, sha256, and proposed = what the document shows.
- refile: the document belongs to another edition. Row: code null, sha256, edition = the edition it belongs under, proposed = why (two of the items' own years must agree).
- reject: the checks were right and nothing is publishable. Row: the item it settles.
- recipe: the college's discovery recipe needs a change. Row: field "sources.add" (value = the new document URL), "sources.drop" (value = the URL to drop), or "rediscover" (value null).
- reread: the college's documents should be read again. Row: the college.
- systemic: a rule or pipeline fix. Give change { what, how, revert } and a sample of the values the change would publish, each compared with its document.

Evidence rules, which the writer enforces:
- Never propose a value you have not compared with the document. A correct or publish row cites source.page and source.line (a workbook cites source.quote with its cell), the quote, and the value. Every row says what the site shows now (read_site_value), in words, never empty.
- Every proposal lists its evidence: one finding per document read, with page and line and what it shows.
- If you can't get a document (read_document_lines answers unavailable), that is acquisition: write a To do row.
- A change you don't believe is not proposed. recommends is "approve" when you checked the document and are confident, "your-call" when the evidence is mixed; then say why.
- Most CDS codes have no registered field: a misread one is a hold, not a correction.

How to work: list the clusters, take the largest first (by items, then colleges whose published value would change), read a few of each cluster's items and their records, form a hypothesis, read the documents behind a sample until the hypothesis holds or fails, then write. Prefer read_document_lines with a question (a cheaper model reads the lines and answers with page and line) over reading whole documents yourself. Stop when the clusters you can afford are done; the budget is enforced, and what you have written stays. Keep tool inputs and documents short and exact: they are read by the owner.`;

export interface RunTaskInput {
  budgetUsd: number;
  cause?: string | null;
  unit?: string | null;
  clusters: number;
  openItems: number;
}

export function runTask(t: RunTaskInput): string {
  const focus = t.cause
    ? `Work only the cluster "${t.cause}".`
    : t.unit
      ? `Work only college ${t.unit}: its open items, its failures, and any acquisition rows it needs.`
      : "Triage the largest clusters first.";
  return `Mode: run. The queue has ${t.openItems} open items in ${t.clusters} clusters. Your budget for this run is $${t.budgetUsd.toFixed(2)}. ${focus} For each cluster you work: write the issue, then the proposal, To do rows or decision it leads to. Finish with a one-paragraph summary of what you wrote and what you would look at next.`;
}

export interface AuditSampleRow {
  unit_id: string;
  edition: string;
  code: string;
  value: unknown;
  sha256: string;
  page: number | null;
  line: number | null;
  cell: string | null;
  quote: string | null;
}

export function auditTask(family: string, sample: readonly AuditSampleRow[], budgetUsd: number): string {
  return `Mode: audit. Family: ${family}. Your budget is $${budgetUsd.toFixed(2)}. These ${sample.length} values passed every check and are published. Compare each with its document (read_document_lines by sha256; ask a question about the line when a grid or band is involved). Then call write_audit once with checked = how many you compared and wrong = a row per value the document contradicts (code, edition, sha256, now = what the site shows, proposed = what the document shows, source with page and line). A document you can't get is not counted as checked.\n\nSample:\n${JSON.stringify(sample)}`;
}

export function answerTask(p: Pick<ProposalDoc, "key" | "kind" | "summary" | "question" | "rows" | "evidence" | "change">, budgetUsd: number): string {
  return `Mode: answer. The owner asked a question on proposal ${p.key}. Your budget is $${budgetUsd.toFixed(2)}. Read what you need to answer it, then call write_answer once: the answer in a few sentences, and any rows to add (the same row rules as write_proposal; rows that narrow the proposal or add holds).\n\nQuestion: ${p.question}\n\nProposal: ${JSON.stringify({ kind: p.kind, summary: p.summary, change: p.change ?? null, rows: p.rows, evidence: p.evidence })}`;
}

/** Sonnet: one question about a document's lines. */
export function readPrompt(question: string, numbered: string): string {
  return `These are the numbered lines of a college's Common Data Set or class profile, as laid out from the document ("412: …" is line 412; "--- Page 9 ---" marks a page; "@450" tags a cell's x position, so a mark sits under the column heading with the nearest x). Answer the question from these lines only. Give the page and line your answer rests on and quote it exactly. If the lines don't answer it, say so and set confident to false.\n\nQuestion: ${question}\n\nLines:\n${numbered}`;
}

/** Haiku: what one line says, with its headings above it. */
export function linePrompt(line: number, question: string, numbered: string): string {
  return `Below are numbered lines from a document; "@450" tags a cell's x position, and a mark belongs to the column heading above it with the nearest x. Say what line ${line} says${question ? `, answering: ${question}` : ""}. Quote line ${line} exactly.\n\n${numbered}`;
}

/** The sub-reads' answer, as structured output. */
export const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "page", "line", "quote", "confident"],
  properties: {
    answer: { type: "string", description: "The answer in one or two sentences." },
    page: { anyOf: [{ type: "integer" }, { type: "null" }] },
    line: { anyOf: [{ type: "integer" }, { type: "null" }] },
    quote: { anyOf: [{ type: "string" }, { type: "null" }], description: "The cited line, exactly." },
    confident: { type: "boolean" },
  },
} as const;

/** One family per week, in this order (week number modulo 4). */
export const AUDIT_FAMILIES = ["grids", "bands", "aid-grids", "h2"] as const;
export type AuditFamily = (typeof AUDIT_FAMILIES)[number];

/** The CDS codes of a family: C7/C8 grids, C9 score bands, B4–B11 graduation grids, H2 aid. */
export function inFamily(family: AuditFamily, code: string): boolean {
  switch (family) {
    case "grids":
      return /^C\.(7\d\d|80\d)$/.test(code);
    case "bands":
      return /^C\.9\d\d$/.test(code);
    case "aid-grids":
      return /^B\.(4|5|6|7|8|9|10|11)\d\d$/.test(code);
    case "h2":
      return /^H\.2\d\d$/.test(code);
  }
}

/** An audit opens an issue above this share of wrong values. */
export const AUDIT_ISSUE_RATE = 0.05;
export const AUDIT_SAMPLE = 25;

export type { AuditDoc };
