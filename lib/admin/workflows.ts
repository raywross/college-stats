/**
 * The runs the admin console can start (specs/product/admin.md, "Reruns"): the console's own typed table, not read
 * from GitHub, so each form is typed and nothing outside it can be dispatched (`DISPATCHABLE_FILES` is the list
 * lib/github-app.ts `dispatchWorkflow` accepts). Each row names its workflow file, the inputs the form shows (with
 * their types and the workflow's own defaults), the inputs it fixes (`mode`), and its guards:
 * - `oneAtATime`: the workflow's concurrency group. A run of the workflow already queued or in progress is shown
 *   instead of the button (GitHub keeps one pending run per group and cancels the older pending one, so a second
 *   dispatch could silently replace a queued run).
 * - `confirmWord`: the form asks for this word (`all`), and shows `lastFullRunCost()` first (`showCost`).
 * - `ref: "pull-branch"`: dispatched on a pull request's head branch rather than `main` (Re-run CI for a PR whose
 *   check never started).
 *
 * The `request_id` input every dispatchable workflow declares is added by `dispatchWorkflow`, never by a form.
 * Pure (no fs, no network), so a form component can import the table; the run summaries the cost helper needs come
 * from `main` through lib/github-app.ts `fetchRunCost` (data/reports/ isn't in the deploy).
 */

// publish-changes.yml is retired (data platform phase 2): the change log, the high-school tables and the college data
// failures are steps of the publisher (publish-snapshot.yml).
export type WorkflowFile =
  | "college-reported.yml"
  | "identity-refresh.yml"
  | "common-app.yml"
  | "coalition.yml"
  | "sync-history.yml"
  | "sync-data.yml"
  | "publish-snapshot.yml"
  | "verify.yml"
  | "visit-events.yml";

export type RunInput =
  | { name: string; label: string; kind: "unit"; required: true }
  | { name: string; label: string; kind: "boolean"; default: boolean }
  | { name: string; label: string; kind: "choice"; options: readonly string[]; default: string }
  | { name: string; label: string; kind: "money"; default: string }
  | { name: string; label: string; kind: "text"; default: string };

export type RunId =
  | "college"
  | "pilot"
  | "all"
  | "collect"
  | "identity"
  | "common-app"
  | "coalition"
  | "history"
  | "sync-data"
  | "verify"
  | "visit-events"
  | "publish-snapshot"
  | "point-snapshot";

export interface DispatchableRun {
  id: RunId;
  label: string;
  /** One line under the label. */
  description: string;
  workflow: WorkflowFile;
  /** Inputs the row sets without showing them. */
  fixed: Readonly<Record<string, string>>;
  /** Inputs the form shows, in order. */
  inputs: readonly RunInput[];
  guards: {
    oneAtATime?: { concurrencyGroup: string };
    confirmWord?: string;
    showCost?: boolean;
  };
  /** `main` for every run but Re-run CI, which runs on the pull request's branch. */
  ref: "main" | "pull-branch";
}

// Data runs open no pull requests any more (data platform phase 2: they write the store and ask the publisher), so no
// run sends `auto_merge`; a workflow that still declares the input ignores it.
const COLLEGE_REPORTED_GROUP = { concurrencyGroup: "college-reported" };

/** The spec's Reruns table, with each workflow's own input defaults (.github/workflows/*.yml). */
export const DISPATCHABLE_RUNS: readonly DispatchableRun[] = [
  {
    id: "college",
    label: "Re-read one college's documents",
    description: "Fetches and reads this college's Common Data Set and class profile again.",
    workflow: "college-reported.yml",
    fixed: { mode: "college" },
    inputs: [
      { name: "college", label: "Unit id", kind: "unit", required: true },
      { name: "rediscover", label: "Re-run discovery even if the college has a recipe", kind: "boolean", default: false },
    ],
    guards: { oneAtATime: COLLEGE_REPORTED_GROUP },
    ref: "main",
  },
  {
    id: "pilot",
    label: "Run the pilot set",
    description: "The pilot colleges, with the workflow's default cost cap.",
    workflow: "college-reported.yml",
    fixed: { mode: "pilot" },
    inputs: [],
    guards: { oneAtATime: COLLEGE_REPORTED_GROUP },
    ref: "main",
  },
  {
    id: "all",
    label: "Run all colleges",
    description: "Every college. The run stops (keeping finished colleges) when its estimated cost reaches the cap.",
    workflow: "college-reported.yml",
    fixed: { mode: "all" },
    // The dispatch form's max_cost default is 25 US dollars, which would stop a full run early; the scheduled full
    // run uses 150 (the workflow's "Resolve run parameters" step), so the console offers that.
    inputs: [{ name: "max_cost", label: "Stop at this estimated cost (US dollars)", kind: "money", default: "150" }],
    guards: { oneAtATime: COLLEGE_REPORTED_GROUP, confirmWord: "all", showCost: true },
    ref: "main",
  },
  {
    id: "collect",
    label: "Finish open batches",
    description: "Collects a run's open batches now instead of waiting for the half-hourly job.",
    workflow: "college-reported.yml",
    fixed: { mode: "collect" },
    inputs: [],
    guards: { oneAtATime: COLLEGE_REPORTED_GROUP },
    ref: "main",
  },
  {
    id: "identity",
    label: "Refresh links, social, brand",
    description: "Re-syncs Wikidata, re-probes every college's site, and re-reads college colors.",
    workflow: "identity-refresh.yml",
    fixed: {},
    inputs: [{ name: "force", label: "Run even if the last probe is under 28 days old", kind: "boolean", default: false }],
    guards: { oneAtATime: { concurrencyGroup: "identity-refresh" } },
    ref: "main",
  },
  {
    id: "verify",
    label: "Re-run CI",
    description: "Starts Verify on a pull request's branch when its check never started.",
    workflow: "verify.yml",
    fixed: {},
    inputs: [],
    guards: {},
    ref: "pull-branch",
  },
  // The sources' hand-run syncs (data platform phase 2, E3): each writes its layer to the store in one change set and
  // asks the publisher for a snapshot at the end. Inputs mirror each workflow's workflow_dispatch.inputs.
  {
    id: "common-app",
    label: "Common App",
    description: "Refresh the Common App grid and members.",
    workflow: "common-app.yml",
    fixed: {},
    inputs: [
      { name: "mode", label: "What to refresh", kind: "choice", options: ["default", "refresh-members", "grid-only", "members-only"], default: "default" },
      { name: "limit", label: "Fetch at most this many member records (empty for no limit)", kind: "text", default: "" },
    ],
    guards: { oneAtATime: { concurrencyGroup: "common-app" } },
    ref: "main",
  },
  {
    id: "coalition",
    label: "Coalition",
    description: "Refresh the Coalition members.",
    workflow: "coalition.yml",
    fixed: {},
    inputs: [],
    guards: { oneAtATime: { concurrencyGroup: "coalition" } },
    ref: "main",
  },
  {
    id: "history",
    label: "History",
    description: "Rebuild the year-by-year history.",
    workflow: "sync-history.yml",
    fixed: {},
    inputs: [{ name: "ids", label: "Unit ids to rebuild, comma-separated (empty for every college)", kind: "text", default: "" }],
    guards: { oneAtATime: { concurrencyGroup: "sync-history" } },
    ref: "main",
  },
  {
    id: "sync-data",
    label: "Base dataset",
    description: "Rebuild the base dataset from IPEDS and Scorecard.",
    workflow: "sync-data.yml",
    fixed: {},
    inputs: [{ name: "releases-only", label: "Only check NCES for upcoming releases (no full sync)", kind: "boolean", default: false }],
    guards: { oneAtATime: { concurrencyGroup: "sync-data" } },
    ref: "main",
  },
  {
    id: "visit-events",
    label: "Read visit-event calendars",
    description: "Reads every Slate host's event calendar now, instead of waiting for the nightly schedule.",
    workflow: "visit-events.yml",
    fixed: {},
    inputs: [
      { name: "target", label: "Which Supabase project to write", kind: "choice", options: ["dev", "prod"], default: "dev" },
      { name: "units", label: "Unit ids to read (comma-separated; empty for every known host)", kind: "text", default: "" },
      { name: "discover", label: "Also look for Slate hosts not in the table yet", kind: "boolean", default: false },
    ],
    guards: { oneAtATime: { concurrencyGroup: "visit-events" } },
    ref: "main",
  },
  // The data platform's publisher (specs/data-platform/publish.md "The admin's publish controls"), dispatched from
  // the Data console's Overview and Snapshots screens (lib/admin/data-actions.ts) through this same table and
  // dispatchRun(), so each dispatch is logged `ops.dispatch` exactly as every other run is.
  {
    id: "publish-snapshot",
    label: "Publish now",
    description: "Publishes the layers in Supabase as the next snapshot.",
    workflow: "publish-snapshot.yml",
    fixed: { force: "true" },
    inputs: [],
    guards: { oneAtATime: { concurrencyGroup: "publish-snapshot" } },
    ref: "main",
  },
  {
    id: "point-snapshot",
    label: "Point back here",
    description: "Moves the live pointer to an older snapshot, without a rebuild.",
    workflow: "publish-snapshot.yml",
    fixed: {},
    inputs: [{ name: "point", label: "Snapshot id", kind: "text", default: "" }],
    guards: { oneAtATime: { concurrencyGroup: "publish-snapshot" } },
    ref: "main",
  },
];

/** The workflow files the console may dispatch: exactly the table's. */
export const DISPATCHABLE_FILES: ReadonlySet<string> = new Set(DISPATCHABLE_RUNS.map((r) => r.workflow));

export function runById(id: string): DispatchableRun | null {
  return DISPATCHABLE_RUNS.find((r) => r.id === id) ?? null;
}

/** IPEDS unit ids are six digits. */
const UNIT_ID = /^\d{6}$/;
const BRANCH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export type BuiltDispatch =
  | { ok: true; run: DispatchableRun; file: WorkflowFile; inputs: Record<string, string>; ref: string }
  | { ok: false; errors: string[] };

/**
 * A form's values as a dispatch: every shown input validated and filled with its default when left out, the fixed
 * inputs added, booleans as "true"/"false". `confirm` must equal the row's confirm word; `branch` is the pull
 * request's head branch for Re-run CI. The caller then logs `ops.dispatch` and calls `dispatchWorkflow(file, inputs,
 * requestId, { ref })`.
 */
export function buildDispatch(
  id: string,
  values: Readonly<Record<string, string | boolean | undefined>>,
  opts: { confirm?: string; branch?: string } = {},
): BuiltDispatch {
  const run = runById(id);
  if (!run) return { ok: false, errors: [`unknown run "${id}"`] };
  const errors: string[] = [];
  const inputs: Record<string, string> = {};
  for (const input of run.inputs) {
    const raw = values[input.name];
    switch (input.kind) {
      case "unit": {
        const v = typeof raw === "string" ? raw.trim() : "";
        if (!UNIT_ID.test(v)) errors.push(`${input.label}: a six-digit unit id`);
        inputs[input.name] = v;
        break;
      }
      case "boolean": {
        const v = raw === undefined || raw === "" ? input.default : raw === true || raw === "true" || raw === "on";
        if (raw !== undefined && raw !== "" && typeof raw === "string" && !["true", "false", "on"].includes(raw)) errors.push(`${input.label}: true or false`);
        inputs[input.name] = String(v);
        break;
      }
      case "choice": {
        const v = raw === undefined || raw === "" ? input.default : String(raw);
        if (!input.options.includes(v)) errors.push(`${input.label}: one of ${input.options.join(", ")}`);
        inputs[input.name] = v;
        break;
      }
      case "money": {
        const v = raw === undefined || raw === "" ? input.default : String(raw).trim();
        if (!/^\d{1,5}(\.\d{1,2})?$/.test(v) || Number(v) <= 0) errors.push(`${input.label}: a dollar amount`);
        inputs[input.name] = v;
        break;
      }
      case "text": {
        inputs[input.name] = raw === undefined ? input.default : String(raw).trim();
        break;
      }
    }
  }
  for (const key of Object.keys(values)) {
    if (!run.inputs.some((i) => i.name === key)) errors.push(`"${key}" is not an input of this run`);
  }
  Object.assign(inputs, run.fixed);
  if (run.guards.confirmWord && opts.confirm?.trim() !== run.guards.confirmWord) errors.push(`type "${run.guards.confirmWord}" to confirm`);
  let ref = "main";
  if (run.ref === "pull-branch") {
    const b = opts.branch?.trim() ?? "";
    if (!BRANCH.test(b) || b === "main") errors.push("the pull request's branch");
    ref = b;
  }
  return errors.length ? { ok: false, errors } : { ok: true, run, file: run.workflow, inputs, ref };
}

/** Run statuses GitHub uses before a run completes. */
const ACTIVE = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

/**
 * The one-at-a-time guard: the newest queued or in-progress run of the row's workflow, which the page shows instead
 * of the button; null when the row has no such guard or nothing is running. `runs` from `listRuns`.
 */
export function blockingRun<R extends { workflow: string; status: string }>(run: DispatchableRun, runs: readonly R[]): R | null {
  if (!run.guards.oneAtATime) return null;
  return runs.find((r) => r.workflow === run.workflow && ACTIVE.has(r.status)) ?? null;
}

/* ------------------------------------------------------------------ */
/* The cost shown before a full run                                    */
/* ------------------------------------------------------------------ */

/** A run that covered (nearly) every college: pilot and batch-sized runs are under 300; `all` is ~1,900. */
export const FULL_RUN_MIN_COLLEGES = 1000;

/** The parts of a run summary (data/reports/college-reported-run-<run>.json, lib/reported.ts) the cost needs. */
export interface RunSummaryLike {
  run: string;
  finished?: string | null;
  started?: string;
  total?: number;
  usage?: Record<string, { cost_usd?: number }>;
  usage_rows?: { cost_usd?: number }[];
  projection?: { full_run_usd?: number } | null;
}

export interface FullRunCost {
  /** The newest full run and what it cost (every model job). */
  last: { run: string; finished: string | null; colleges: number; costUsd: number } | null;
  /** The newest summary's projection of a full run, and which run made it. */
  projection: { run: string; fullRunUsd: number } | null;
}

/** A summary's cost: its per-row usage when it has one (round 3), else its per-job usage. */
export function summaryCost(s: RunSummaryLike): number {
  const rows = s.usage_rows?.length ? s.usage_rows : Object.values(s.usage ?? {});
  return Math.round(rows.reduce((n, r) => n + (Number(r.cost_usd) || 0), 0) * 100) / 100;
}

/** Pure: the last full run's cost and the newest full-run projection from parsed summaries. */
export function lastFullRunCost(summaries: readonly RunSummaryLike[]): FullRunCost {
  const newestFirst = [...summaries].sort((a, b) => ((a.started ?? a.run) < (b.started ?? b.run) ? 1 : -1));
  const full = newestFirst.find((s) => (s.total ?? 0) >= FULL_RUN_MIN_COLLEGES);
  const projected = newestFirst.find((s) => typeof s.projection?.full_run_usd === "number");
  return {
    last: full ? { run: full.run, finished: full.finished ?? null, colleges: full.total ?? 0, costUsd: summaryCost(full) } : null,
    projection: projected ? { run: projected.run, fullRunUsd: projected.projection!.full_run_usd! } : null,
  };
}
