import "server-only";
/**
 * Data health per college (specs/product/admin.md "Health"): when we received data, group by group, and what decides
 * each status. Nothing new is collected; health is read from what is already on hand:
 *
 *   - the dataset's lineage (`retrieved` on links, social, brand, directories, religion, LGBTQ records),
 *   - the college-reported documents (`data/college-docs.json`, `data/cds-records/<unit>.json`),
 *   - the pipeline's open failures (`data/college-failures.json`) and review queue (`data/review-queue.json`),
 *   - the link prober's findings (`data/link-issues.json`),
 *   - each publish's changed fields (`dataset_changes` in Supabase; informational).
 *
 * The first five are 42 MB, so `npm run college-health` reduces them to `data/college-health.json` (lib/admin/
 * health-files.ts) in each data PR, and the deployed page reads only that file. `collegeHealth()` is pure and takes
 * its thresholds from lib/admin/health-rules.ts, so the tests pin both. `healthOverview()` builds the overview once
 * per server instance and caches it; the changes read is kept for a few minutes only, since "Publish changes" writes
 * it after the deploy that started the instance.
 *
 * Server only (reads the file and, for `familyListUnits`, the admin's own Supabase session): never import this from a
 * client component. The types and rules a client may need are in health-rules.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHANGES_PUBLISHES_READ,
  CHANGES_TTL_MS,
  CORE_FEDERAL_FIELDS,
  HEALTH_GROUPS,
  HEALTH_RULES,
  HEALTH_STATUSES,
  statusRank,
  editionStart,
  type HealthGroup,
  type HealthRules,
  type HealthStatus,
} from "./health-rules.ts";
import { inputsFromCompact, newer, parseCompact, pickReportedDocs, type CompactHealth, type HealthInputs, type ReportedDoc } from "./health-files.ts";

export { HEALTH_GROUPS, HEALTH_STATUSES, type HealthGroup, type HealthStatus } from "./health-rules.ts";
export type { FailureInput, HealthInputs, LinkIssueInput, ReportedDoc } from "./health-files.ts";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface HealthRow {
  group: HealthGroup;
  /** Null when the group could not be judged (its files are not in this deploy); never counted toward overall. */
  status: HealthStatus | null;
  /** ISO date the status is judged by: the newest retrieval, or the newest failure run. Null when there is none. */
  judgedBy: string | null;
  /** What decided the status, in a sentence. */
  reason: string;
  /** The document or failing page the reason names. */
  link?: string;
}

export interface CollegeHealth {
  unitId: string;
  overall: HealthStatus;
  /** One row per group, in HEALTH_GROUPS order. */
  rows: HealthRow[];
  /** The newest publish that changed this college: its date (ISO) and how many fields. Informational; null when none is known. */
  changed: { at: string; fields: number } | null;
  /** Open `college_data_failures` rows for the college. */
  failures: { reason: string; stage: string }[];
  /** Review-queue items held for the college. */
  queueItems: number;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Whole days from `from` to `to` (ISO dates or timestamps; the date part is used). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
}

const dayLabel = (iso: string, today: string) => {
  const age = daysBetween(iso, today);
  return age <= 0 ? iso.slice(0, 10) : `${iso.slice(0, 10)} (${age} day${age === 1 ? "" : "s"} ago)`;
};

const words = (code: string) => code.replace(/_/g, " ");

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/* The rows                                                            */
/* ------------------------------------------------------------------ */

function federalRow(inputs: HealthInputs): HealthRow {
  const { retrieved, missing } = inputs.federal;
  if (!missing.length) {
    return { group: "federal", status: "fresh", judgedBy: retrieved, reason: `All ${CORE_FEDERAL_FIELDS.length} core fields present (${CORE_FEDERAL_FIELDS.map((f) => f.label).join(", ")}).` };
  }
  // Federal data has no Stale or Failing: a field a college does not report (an open-admission college has no admit rate) is a Watch.
  return { group: "federal", status: "watch", judgedBy: retrieved, reason: `Missing ${plural(missing.length, "core field")}: ${missing.join(", ")}.` };
}

/** Which of a document's calls were archived but never read, in words; empty when everything archived was read. */
export function unreadParts(doc: Pick<ReportedDoc, "archivedSections" | "reads">): string[] {
  if (doc.reads === null) return ["the document (no record)"];
  if (doc.reads.includes("deterministic")) return [];
  const archived = doc.archivedSections;
  const out: string[] = [];
  if ((archived === null || archived.includes("C")) && !doc.reads.includes("C")) out.push("section C");
  if ((archived === null || archived.some((s) => s !== "C")) && !doc.reads.includes("rest")) out.push("the other sections");
  return out;
}

function reportedRow(inputs: HealthInputs, rules: HealthRules["reported"]): HealthRow {
  const r = inputs.reported;
  if (!r) {
    return { group: "reported", status: null, judgedBy: null, reason: "Not judged: the college-reported files (data/college-docs.json and the rest) are not in this deploy." };
  }
  const { edition, profile, cds } = pickReportedDocs(r.docs);

  // Failing: an open failure at fetch or read, or held values with a review-queue item to resolve.
  const deciding = r.failures.filter((f) => rules.failingStages.includes(f.stage) || (f.reason === rules.failingWithQueueReason && r.queueItems > 0));
  if (deciding.length) {
    const codes = [...new Set(deciding.map((f) => `${words(f.reason)} (${f.stage})`))];
    const lastRun = deciding.reduce<string | null>((acc, f) => newer(acc, f.lastRun), null);
    const queued = deciding.some((f) => f.reason === rules.failingWithQueueReason) ? `; ${plural(r.queueItems, "review-queue item")} waiting` : "";
    return {
      group: "reported",
      status: "failing",
      judgedBy: lastRun ?? edition?.retrieved ?? null,
      reason: `${plural(deciding.length, "open failure")}: ${codes.join(", ")}${queued}.`,
      link: deciding.find((f) => f.url)?.url ?? edition?.url ?? undefined,
    };
  }

  if (!edition) {
    if (profile) {
      return { group: "reported", status: "watch", judgedBy: profile.retrieved, reason: "Class profile only: no Common Data Set with a stated edition.", link: profile.url };
    }
    return { group: "reported", status: "stale", judgedBy: null, reason: cds.length ? "No document with a stated edition." : "No document found." };
  }

  const current = editionStart(rules.currentEdition) ?? 0;
  const behind = current - (editionStart(edition.edition) ?? current);
  const read = edition.extracted ? `, read ${edition.extracted}` : "";
  const base = `${edition.edition} edition, retrieved ${edition.retrieved}${read}`;
  if (behind >= rules.staleEditionsBehind) {
    return { group: "reported", status: "stale", judgedBy: edition.retrieved, reason: `${base}: ${plural(behind, "edition")} behind ${rules.currentEdition}.`, link: edition.url };
  }
  const unread = unreadParts(edition);
  if (behind >= rules.watchEditionsBehind) {
    const also = unread.length ? `; ${unread.join(" and ")} archived but not read` : "";
    return { group: "reported", status: "watch", judgedBy: edition.retrieved, reason: `${base}: ${plural(behind, "edition")} behind ${rules.currentEdition}${also}.`, link: edition.url };
  }
  if (unread.length) {
    return { group: "reported", status: "watch", judgedBy: edition.retrieved, reason: `${base}: ${unread.join(" and ")} archived but not read.`, link: edition.url };
  }
  return { group: "reported", status: "fresh", judgedBy: edition.retrieved, reason: `${base}; every section read.`, link: edition.url };
}

function identityRow(inputs: HealthInputs, rules: HealthRules["identity"]): HealthRow {
  const { newest, linkIssues } = inputs.identity;
  if (linkIssues === null) {
    return { group: "identity", status: null, judgedBy: newest, reason: "Not judged: data/link-issues.json is not in this deploy." };
  }
  const issue = linkIssues[0];
  const dead = linkIssues.length ? ` ${plural(linkIssues.length, "dead link")}: ${linkIssues.map((i) => `${i.field}${i.status ? ` ${i.status}` : ""}`).join(", ")}.` : "";
  if (!newest) {
    return { group: "identity", status: "stale", judgedBy: null, reason: `No probe on record.${dead}`, link: issue?.url };
  }
  const age = daysBetween(newest, inputs.today);
  let status: HealthStatus = age <= rules.freshDays ? "fresh" : age <= rules.watchDays ? "watch" : "stale";
  if (status === "fresh" && linkIssues.length) status = "watch";
  const probed = `Probed ${dayLabel(newest, inputs.today)}.`;
  return { group: "identity", status, judgedBy: newest, reason: `${probed}${dead || " No link issues."}`, link: issue?.url };
}

function campusRow(inputs: HealthInputs, rules: HealthRules["campus"]): HealthRow {
  const { newest } = inputs.campus;
  if (!newest) {
    return { group: "campus", status: rules.neverCollected, judgedBy: null, reason: "Never collected: no directory, religion, or LGBTQ record is dated." };
  }
  const age = daysBetween(newest, inputs.today);
  const status: HealthStatus = age <= rules.freshDays ? "fresh" : age <= rules.watchDays ? "watch" : "stale";
  return { group: "campus", status, judgedBy: newest, reason: `Collected ${dayLabel(newest, inputs.today)}.` };
}

/**
 * One college's health. Pure: the same inputs and rules give the same answer. Overall is the worst row's status in the
 * order Failing > Stale > Watch > Fresh; a group that could not be judged (null) is left out, and a college with no
 * judged group is Fresh by default.
 */
export function collegeHealth(unitId: string, inputs: HealthInputs, rules: HealthRules = HEALTH_RULES): CollegeHealth {
  const rows = [federalRow(inputs), reportedRow(inputs, rules.reported), identityRow(inputs, rules.identity), campusRow(inputs, rules.campus)];
  const overall = rows.reduce<HealthStatus>((worst, row) => (row.status && statusRank(row.status) > statusRank(worst) ? row.status : worst), "fresh");
  return {
    unitId,
    overall,
    rows,
    changed: inputs.changes,
    failures: (inputs.reported?.failures ?? []).map((f) => ({ reason: f.reason, stage: f.stage })),
    queueItems: inputs.reported?.queueItems ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* What changed (dataset_changes)                                      */
/* ------------------------------------------------------------------ */

/** The two reads the newest-change lookup needs; the default wraps Supabase, tests pass a fake. */
export interface ChangesReader {
  /** The newest publish with an id below `before` (the newest overall when null): its id and ISO time. */
  newestPublishBefore(before: number | null): Promise<{ id: number; at: string } | null>;
  /** The college of every changed field in a publish (one entry per field). */
  unitsOfPublish(publishId: number): Promise<string[]>;
}

/**
 * Each college's newest change: the date of the newest publish that changed it, and how many fields it changed. Reads
 * the newest `publishes` publishes, newest first; a college not changed in any of them has none.
 */
export async function latestChanges(reader: ChangesReader, publishes: number = CHANGES_PUBLISHES_READ): Promise<Map<string, { at: string; fields: number }>> {
  const out = new Map<string, { at: string; fields: number }>();
  let before: number | null = null;
  for (let i = 0; i < publishes; i++) {
    const publish = await reader.newestPublishBefore(before);
    if (!publish) break;
    const counts = new Map<string, number>();
    for (const unit of await reader.unitsOfPublish(publish.id)) counts.set(unit, (counts.get(unit) ?? 0) + 1);
    for (const [unit, fields] of counts) if (!out.has(unit)) out.set(unit, { at: publish.at.slice(0, 10), fields });
    before = publish.id;
  }
  return out;
}

const PAGE = 1000;
/** A hard stop on paging so a runaway table cannot hang the page: 100,000 rows. */
const MAX_PAGES = 100;

type Rows<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
interface QueryLike<T> extends Rows<T> {
  eq(column: string, value: unknown): QueryLike<T>;
  lt(column: string, value: unknown): QueryLike<T>;
  order(column: string, opts?: { ascending?: boolean }): QueryLike<T>;
  range(from: number, to: number): QueryLike<T>;
  limit(n: number): QueryLike<T>;
}
/** The slice of a Supabase client the two reads use. */
export interface TableClient {
  from(table: string): { select(columns: string): QueryLike<Record<string, unknown>> };
}

/** Pages `build(range)` until a short page; throws on an error, or when the cap is hit (an incomplete read would mislead). */
async function readAll<T>(build: (from: number, to: number) => Rows<T>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Supabase: reading ${what} failed: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
  throw new Error(`Supabase: ${what} has more than ${MAX_PAGES * PAGE} rows; refusing to read a partial list`);
}

export function supabaseChangesReader(client: TableClient): ChangesReader {
  return {
    async newestPublishBefore(before) {
      let q = client.from("dataset_changes").select("publish_id, published_at").order("publish_id", { ascending: false }).limit(1);
      if (before !== null) q = q.lt("publish_id", before);
      const { data, error } = await q;
      if (error) throw new Error(`Supabase: reading the newest publish failed: ${error.message}`);
      const row = data?.[0];
      return row ? { id: Number(row.publish_id), at: String(row.published_at) } : null;
    },
    async unitsOfPublish(publishId) {
      const rows = await readAll((from, to) => client.from("dataset_changes").select("unit_id").eq("publish_id", publishId).order("id").range(from, to), `the changes of publish ${publishId}`);
      return rows.map((r) => String(r.unit_id));
    },
  };
}

/* ------------------------------------------------------------------ */
/* On a family's list                                                  */
/* ------------------------------------------------------------------ */

let familyWarned = false;

/**
 * Every college on any family's list (distinct `list_items.unit_id`), read through the signed-in admin's own session and
 * the admin policy (lib/supabase-server.ts), or null when that read is unavailable: sign-in isn't configured, the
 * policy or table isn't there, the read failed, or it was too large to read whole. Callers show "on a family's list" as
 * unavailable rather than as empty. Not cached: it depends on who is asking and changes as families work.
 */
export async function familyListUnits(deps: { client?: () => Promise<TableClient | null> } = {}): Promise<ReadonlySet<string> | null> {
  try {
    const client = await (deps.client ?? defaultAdminClient)();
    if (!client) return null;
    const rows = await readAll((from, to) => client.from("list_items").select("unit_id").order("unit_id").order("id").range(from, to), "list_items");
    return new Set(rows.map((r) => String(r.unit_id)));
  } catch (err) {
    if (!familyWarned) {
      familyWarned = true;
      console.error("[admin health] reading the colleges on families' lists failed; the filter is unavailable.", err);
    }
    return null;
  }
}

async function defaultAdminClient(): Promise<TableClient | null> {
  const { supabaseAuthEnv, createServerSupabase } = await import("../supabase-server");
  if (!supabaseAuthEnv()) return null;
  return (await createServerSupabase()) as unknown as TableClient;
}

/* ------------------------------------------------------------------ */
/* The overview                                                        */
/* ------------------------------------------------------------------ */

export interface HealthCounts {
  total: number;
  overall: Record<HealthStatus, number>;
  /** Per group; `unjudged` counts colleges whose group had no files to judge from. */
  groups: Record<HealthGroup, Record<HealthStatus | "unjudged", number>>;
}

export interface HealthOverview {
  /** Worst first (then by how many groups are not fresh, then unit id). */
  colleges: CollegeHealth[];
  counts: HealthCounts;
  /** ISO date the overview was measured on. */
  today: string;
  /** The date of the compact file's sources (`generated` in data/college-health.json): how fresh the health inputs are. */
  generated: string;
  /** False when `dataset_changes` could not be read (no Supabase configured, or the read failed): `changed` is null for every college. */
  changesAvailable: boolean;
}

export function countHealth(colleges: readonly CollegeHealth[]): HealthCounts {
  const zero = () => Object.fromEntries(HEALTH_STATUSES.map((s) => [s, 0])) as Record<HealthStatus, number>;
  const groups = Object.fromEntries(HEALTH_GROUPS.map((g) => [g, { ...zero(), unjudged: 0 }])) as HealthCounts["groups"];
  const overall = zero();
  for (const c of colleges) {
    overall[c.overall]++;
    for (const row of c.rows) groups[row.group][row.status ?? "unjudged"]++;
  }
  return { total: colleges.length, overall, groups };
}

/** Worst overall first; then more non-fresh groups first; then unit id, so the order is stable. */
export function sortWorstFirst(colleges: CollegeHealth[]): CollegeHealth[] {
  const notFresh = (c: CollegeHealth) => c.rows.filter((r) => r.status && r.status !== "fresh").length;
  return [...colleges].sort((a, b) => statusRank(b.overall) - statusRank(a.overall) || notFresh(b) - notFresh(a) || a.unitId.localeCompare(b.unitId, "en", { numeric: true }));
}

/** Everything the overview needs from outside, so tests can stand in for the file, the clock, and Supabase. */
export interface HealthDeps {
  /** The compact health file (data/college-health.json). */
  compact(): Promise<CompactHealth>;
  /** The newest change per college; null when `dataset_changes` is unavailable. */
  changes(): Promise<Map<string, { at: string; fields: number }> | null>;
  now(): number;
}

/**
 * An overview function over `deps` that reads the compact file once (the first call; a failed read is not kept) and
 * `dataset_changes` again after CHANGES_TTL_MS. `healthOverview` below is this with the real dependencies.
 */
export function createHealthOverview(deps: HealthDeps): () => Promise<HealthOverview> {
  let base: Promise<CompactHealth> | null = null;
  let changes: { at: number; value: Map<string, { at: string; fields: number }> | null } | null = null;
  return async function overview() {
    base ??= deps.compact();
    let compact: CompactHealth;
    try {
      compact = await base;
    } catch (err) {
      base = null;
      throw err;
    }
    const now = deps.now();
    if (!changes || now - changes.at > CHANGES_TTL_MS) {
      let value: Map<string, { at: string; fields: number }> | null = null;
      try {
        value = await deps.changes();
      } catch (err) {
        console.error("[admin health] reading dataset_changes failed; \"what changed\" is left out.", err);
      }
      changes = { at: now, value };
    }
    const today = new Date(now).toISOString().slice(0, 10);
    const colleges = sortWorstFirst(Object.keys(compact.colleges).map((unit) => collegeHealth(unit, inputsFromCompact(compact, unit, { today, changes: changes!.value })!)));
    return { colleges, counts: countHealth(colleges), today, generated: compact.generated, changesAvailable: changes.value !== null };
  };
}

// The compact file is a health-only input (specs/product/admin.md "Files the deploy must carry"), so it is read here and
// not through getData(). The path spells out its folder and file with literals so the tracer ships exactly this file
// (next.config.ts "/admin/**"; tests/tracing.test.mts).
function readCompactFromDisk(): CompactHealth {
  const path = join(process.cwd(), "data", "college-health.json");
  if (!existsSync(path)) throw new Error("data/college-health.json is not in this deploy; run npm run college-health and commit it");
  return parseCompact(readFileSync(path, "utf8"));
}

const realDeps: HealthDeps = {
  async compact() {
    return readCompactFromDisk();
  },
  async changes() {
    // Changes live only in Supabase, written after each deploy (lib/data.ts getSchoolChanges): without SUPABASE_URL there are none.
    const fixture = process.env.CHANGES_FIXTURE;
    if (fixture && existsSync(fixture)) {
      const rows = JSON.parse(readFileSync(fixture, "utf8")) as { unit_id: string; publish_id: number; published_at: string }[];
      const publishes = [...new Map(rows.map((r) => [r.publish_id, r.published_at])).entries()].sort((a, b) => b[0] - a[0]);
      return latestChanges({
        newestPublishBefore: async (before) => {
          const next = publishes.find(([id]) => before === null || id < before);
          return next ? { id: next[0], at: next[1] } : null;
        },
        unitsOfPublish: async (id) => rows.filter((r) => r.publish_id === id).map((r) => r.unit_id),
      });
    }
    if (!process.env.SUPABASE_URL) return null;
    const { supabaseClient } = await import("../supabase");
    return latestChanges(supabaseChangesReader(supabaseClient("read") as unknown as TableClient));
  },
  now: () => Date.now(),
};

/** Every college by data health, worst first, with counts. Computed once per server instance (the changes read: every few minutes). */
export const healthOverview = createHealthOverview(realDeps);

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** One CSV cell: quoted when it holds a comma, quote, or line break; a leading = + - @ is defused so a spreadsheet won't run it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const HEALTH_CSV_COLUMNS: readonly string[] = [
  "unit_id",
  "name",
  "overall",
  ...HEALTH_GROUPS.flatMap((g) => [`${g}_status`, `${g}_date`, `${g}_reason`]),
  "changed_at",
  "changed_fields",
  "open_failures",
  "queue_items",
];

/** The overview as CSV: one line per college in the order given, `names` by unit id (a missing name is blank). */
export function healthCsv(rows: CollegeHealth[], names: Record<string, string>): string {
  const lines = [HEALTH_CSV_COLUMNS.map(csvCell).join(",")];
  for (const c of rows) {
    const byGroup = new Map(c.rows.map((r) => [r.group, r]));
    const cells: (string | number | null)[] = [c.unitId, names[c.unitId] ?? "", c.overall];
    for (const g of HEALTH_GROUPS) {
      const r = byGroup.get(g);
      cells.push(r?.status ?? "", r?.judgedBy ?? "", r?.reason ?? "");
    }
    cells.push(c.changed?.at ?? "", c.changed?.fields ?? "", [...new Set(c.failures.map((f) => f.reason))].join("; "), c.queueItems);
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
