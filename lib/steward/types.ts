/**
 * The Data Steward's document shapes (specs/product/data-steward.md "What it writes", "Proposals", "Four kinds of
 * issue"): what `scripts/steward.mts` writes to the `steward.*` collections and what the console reads and decides.
 * Pure types and the few words every screen and the script share. The clustering itself is lib/steward/cluster.ts.
 */

/**
 * The four kinds of issue, each resolved its own way, plus `job`: a finding from the Steward's job review
 * (specs/product/admin-redesign.md "What the Steward reviews"), keyed `job|<job id>` or `change|<id>`, with `family`
 * naming the job; and `collision`: two files claim one edition of a college (specs/product/document-collisions.md), keyed
 * `collision|<unit>|<edition>`, written by the Steward's writer when it refuses a refile into a taken edition.
 */
export type IssueKind = "value" | "systemic" | "acquisition" | "policy" | "job" | "collision";
export const ISSUE_KINDS: readonly IssueKind[] = ["value", "systemic", "acquisition", "policy", "job", "collision"];
export const ISSUE_KIND_LABEL: Record<IssueKind, string> = { value: "Value", systemic: "Systemic", acquisition: "Acquisition", policy: "Policy", job: "Job", collision: "Two files" };

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
  /** A job finding's job id (lib/jobs/registry.ts); absent on the review queue's kinds. */
  family?: string;
  /** Where a person acts on it (a collision's compare link), and the button's words ("Choose the file"). */
  href?: string;
  action?: string;
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
/** `failed`: approved, but the apply job refused or broke part way (`failed_reason` says why); a person decides what next. */
export type ProposalStatus = "open" | "approved" | "declined" | "applied" | "asked" | "failed";
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
  /** Status `failed`: the apply job's refusal or error, word for word (scripts/lib/steward/proposals.mts). */
  failed_reason?: string | null;
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

/**
 * A host the owner has an account on (`steward.logins`, one document per host, keyed by the host): a To do row behind
 * a login on a listed host can be worked from the owner's own browser, where the session already exists. No credential
 * is ever stored; `may_use` is the owner's answer to the terms question (whether documents from behind this login may
 * be used and cited). See specs/product/todo-browser-agent.md "Logins".
 */
export interface LoginDoc {
  /** The host, lowercase, as a URL names it (`irp.example.edu`). */
  host: string;
  /** What the account is, in words ("a counselor account", "alumni login"). */
  account: string;
  /** Whether documents from behind this login may be used on the site. */
  may_use: boolean;
  note: string | null;
  added: string;
  /** Who added it (the admin's name). */
  added_by: string | null;
  /** When the owner removed it (the document stays for the history); null while listed. */
  removed?: string | null;
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
  /** A check family, or `jobs` for the weekly jobs summary (`jobs` below; `checked` is the runs reviewed). */
  family: "grids" | "bands" | "aid-grids" | "h2" | "jobs" | string;
  checked: number;
  wrong: ProposalRow[];
  rate: number;
  run: string;
  created: string;
  /** The weekly jobs summary, on a `jobs` audit only. */
  jobs?: JobsWeek;
}

/** The Sunday audit's week of jobs (lib/steward/job-review.ts `jobsWeek`). */
export interface JobsWeek {
  /** The seven days summed, ISO. */
  from: string;
  to: string;
  /** Runs reviewed, and of them failed, flagged, and repaired. */
  reviewed: number;
  failed: number;
  flagged: number;
  repaired: number;
  /** Per job: its reviewed runs by verdict, and its repairs. */
  byJob: { job: string; fine: number; flagged: number; failed: number; repaired: number }[];
  /** Dollars the Steward spent in the seven days, by mode. */
  spendByMode: Record<string, number>;
  /** The review queue's open items now, and at the last jobs summary (null when unknown, or the first week). */
  queueOpen: number | null;
  queueOpenBefore: number | null;
}

/** The Steward's job review: what it made of one run (specs/product/admin-redesign.md "What the Steward reviews"). */
export type ReviewVerdict = "fine" | "flagged" | "failed";
/** The three repairs its fixed tools allow. */
export type ReviewRepair = "restart" | "publish" | "hold-finding";

/** A review document (`steward.reviews`), keyed `<job>:<run ref>`: one per run reviewed. */
export interface ReviewDoc {
  key: string;
  job: string;
  /** The run: a `job_runs` id for a Vercel job, the workflow run id for a GitHub job. */
  run_ref: string;
  verdict: ReviewVerdict;
  /** What the review found, a sentence each, quoted from the run's record. */
  reasons: string[];
  repair: ReviewRepair | null;
  /** The repair was carried out (a restart or publish dispatched, a finding left). */
  repaired: boolean;
  /** One sentence for a person (Haiku), on a flagged or failed run only; null when fine or when the budget refused. */
  note: string | null;
  created: string;
  /** When the run started (the weekly summary's window). */
  run_started?: string | null;
  /** The Steward run that wrote it. */
  run?: string;
}

/** `steward.reviews` (scripts/lib/data-platform/layers.mts `COLLECTIONS.steward.reviews`; a test checks they agree). */
export const REVIEWS_COLLECTION = "steward.reviews";

/** A run summary (`steward.runs`). */
export interface RunDoc {
  key: string;
  mode: "run" | "audit" | "apply" | "answer" | "review";
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
  /** Job reviews written (mode review: one when it wrote). */
  reviews?: number;
  /** Repairs carried out (a restart, a publish, a finding on a held change). */
  repairs?: number;
  /** Mode review: the job and the run reviewed. */
  job?: string | null;
  run_ref?: string | null;
}

/** The words on the Issues screen for a status. */
export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  open: "Open",
  approved: "Approved",
  declined: "Declined",
  applied: "Applied",
  asked: "Asked",
  failed: "Apply failed",
};
