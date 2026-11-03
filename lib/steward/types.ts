/**
 * The Data Steward's document shapes (specs/product/data-steward.md "What it writes", "Proposals", "Four kinds of
 * issue"): what `scripts/steward.mts` writes to the `steward.*` collections and what the console reads and decides.
 * Pure types and the few words every screen and the script share. The clustering itself is lib/steward/cluster.ts.
 */

/** The four kinds of issue, each resolved its own way. */
export type IssueKind = "value" | "systemic" | "acquisition" | "policy";
export const ISSUE_KINDS: readonly IssueKind[] = ["value", "systemic", "acquisition", "policy"];
export const ISSUE_KIND_LABEL: Record<IssueKind, string> = { value: "Value", systemic: "Systemic", acquisition: "Acquisition", policy: "Policy" };

export type IssueStatus = "new" | "investigating" | "proposed" | "waiting" | "left";
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  new: "New",
  investigating: "Investigating",
  proposed: "Proposed",
  waiting: "Waiting on owner",
  left: "Left",
};

/**
 * A cluster of open review items with one cause: the check and a normalized detail (numbers, years and codes masked),
 * computed live from the queue by lib/steward/cluster.ts. `key` is stable across runs and is the issue document's key.
 */
export interface Cluster {
  key: string;
  check: string;
  /** The masked detail the items share ("item year # is not edition #"), or "" when the check's details vary freely. */
  detail: string;
  items: number;
  colleges: number;
  /** Colleges whose value a visitor sees would change if the items were published, when the check knows. */
  published: number;
  /** Up to five example item keys (`reported.review_queue` keys). */
  examples: string[];
  /** Documents (sha256) the items came from, up to twenty. */
  documents: string[];
}

/** An issue document (`steward.issues`, keyed by the cluster key): the Steward's reading of one cause. */
export interface IssueDoc {
  key: string;
  kind: IssueKind;
  status: IssueStatus;
  hypothesis: string;
  /** What the Steward checked and what it found, one line per document read. */
  findings: Finding[];
  /** Proposal keys this issue produced. */
  proposals: string[];
  /** The owner's reason when left, or the Steward's when it couldn't decide. */
  reason: string | null;
  run: string;
  updated: string;
}

/** One document read: college, edition, the document, where, and what it shows. */
export interface Finding {
  unit_id: string;
  edition: string | null;
  sha256: string | null;
  url: string | null;
  page: number | null;
  line: number | null;
  shows: string;
}

export type ProposalKind = "correct" | "publish" | "hold" | "refile" | "reject" | "recipe" | "reread" | "systemic";
export const PROPOSAL_KIND_LABEL: Record<ProposalKind, string> = {
  correct: "Correct a value",
  publish: "Publish as read",
  hold: "Hold as misread",
  refile: "Refile a document",
  reject: "Reject",
  recipe: "Change a recipe",
  reread: "Re-read",
  systemic: "Fix a rule",
};
export type ProposalStatus = "open" | "approved" | "declined" | "applied" | "asked";
export type Recommendation = "approve" | "your-call";
export type RowDecision = "approved" | "declined";

/** One row of a value proposal: a college and a field (a registered path) or a CDS code. */
export interface ProposalRow {
  unit_id: string;
  /** A registered field path (`admissions.acceptance_rate`) for correct/publish; the CDS code (`C.802`) for hold/refile/reject. */
  field: string | null;
  code: string | null;
  edition: string | null;
  sha256: string | null;
  /** What a visitor sees now, as the citation would say it ("72.1% · IPEDS, fall 2023 class"). */
  now: string;
  /** What is proposed, in words, and the value to write for correct/publish. */
  proposed: string;
  value?: number | string | boolean | null;
  /** Where the document says it. */
  source: { page: number | null; line: number | null; quote: string | null; url: string | null };
  recommends: Recommendation;
  /** Why "your call", when it is. */
  why?: string;
  /** The queue item this row settles, when there is one. */
  item: string | null;
  decision?: RowDecision;
  decisionNote?: string;
}

/** A proposal document (`steward.proposals`), keyed `<kind>-<cause>-<run>` or as the Steward names it. */
export interface ProposalDoc {
  key: string;
  kind: ProposalKind;
  /** The cluster key this answers, when it does. */
  cause: string | null;
  status: ProposalStatus;
  summary: string;
  evidence: Finding[];
  rows: ProposalRow[];
  /** A systemic proposal's sample of what the change publishes. */
  sample?: { checked: number; wrong: ProposalRow[] };
  /** A systemic proposal's change, in words: what, how, and how to revert. */
  change?: { what: string; how: string; revert: string };
  /** A re-read's projected cost in US dollars, for the rows ticked. */
  cost?: number;
  question?: string | null;
  answer?: string | null;
  run: string;
  created: string;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
}

export type TodoWhy = "robots-path" | "robots-host" | "challenge" | "bot-check" | "viewer" | "js-only" | "terms" | "login" | "not-found" | "no-document" | "unknown";
export type TodoStatus = "open" | "found" | "no-document" | "done";

/** An acquisition row (`steward.todo`): a document only a person can fetch. */
export interface TodoDoc {
  key: string;
  kind: "cds" | "class-profile" | "campus-page" | "hs-profile" | "other";
  unit_id: string | null;
  subject: string;
  edition: string | null;
  landing: string | null;
  document_url: string | null;
  host: string | null;
  why: TodoWhy;
  /** Subjects the document covers (colleges, schools). */
  reach: number;
  /** Lists, follows or signed-in students that want it. */
  demand: number;
  status: TodoStatus;
  route: "archive" | "ask" | "render" | "person" | null;
  attempts: { at: string; route: string; result: string }[];
  note: string | null;
  updated: string;
}

/** A policy question (`steward.decisions`) with the Steward's recommendation and the owner's answer. */
export interface DecisionDoc {
  key: string;
  question: string;
  recommends: string;
  /** What each answer changes, in words. */
  options: { answer: string; effect: string }[];
  answer: string | null;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  run: string;
  created: string;
}

/** An audit (`steward.audits`): a check family's sample of passed values against their documents. */
export interface AuditDoc {
  key: string;
  family: "grids" | "bands" | "aid-grids" | "h2" | string;
  checked: number;
  wrong: ProposalRow[];
  rate: number;
  run: string;
  created: string;
}

/** A run summary (`steward.runs`). */
export interface RunDoc {
  key: string;
  mode: "run" | "audit" | "apply" | "answer";
  started: string;
  finished: string | null;
  budget_usd: number;
  spent_usd: number;
  clusters: number;
  issues: number;
  proposals: number;
  todo: number;
  decisions: number;
  audits: number;
  /** Where it stopped early, if it did. */
  stopped: string | null;
  request_id: string | null;
}

/** The words on the Issues screen for a status. */
export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  open: "Open",
  approved: "Approved",
  declined: "Declined",
  applied: "Applied",
  asked: "Asked",
};
