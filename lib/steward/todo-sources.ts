/**
 * The To do list's rows from the engines' own records (specs/product/data-steward.md "Documents a person has to
 * fetch"): documents we know about but a machine can't get. Three sources:
 *
 * - `reported.failures`: a college's discovery and fetch failures (nothing found, robots.txt, a blocked host, a 404,
 *   a malformed link, only a class profile). Read and check failures are the pipeline's, not a person's, and stay out.
 * - the review queue's open `unreachable` and `not-a-url` items;
 * - `directories.blocked`: campus directories that refused the crawler.
 *
 * Each row's `why` is mapped from the failure's reason and words; `reach` is 1 for a college (and for a directory
 * until its listings are counted); `demand` is 0 here (lib/admin/steward-reads.ts fills it from the plan lists). Rows
 * are de-duplicated by key (`<kind>:<unit_id or subject slug>:<edition or ->`), merging their attempts and keeping
 * the most specific `why`, and start `open`. Pure.
 */
import { isCdsDocument } from "../admin/review-queue.ts";
import { reviewKey, type ReviewItem } from "../reported.ts";
import type { TodoDoc, TodoWhy } from "./types.ts";

/** A `reported.failures` row (scripts/lib/college-failures.mts `FailureRow`), the fields read here. */
export interface FailureRowLike {
  unit_id: string;
  name: string;
  reason_code: string;
  stage: string;
  detail: string;
  url: string | null;
  edition: string | null;
  last_run: string;
}

/** A `directories.blocked` record (scripts/lib/directories/files.mts `BlockedRecord`). */
export interface BlockedDirectoryLike {
  org: string;
  url: string;
  reason: string;
  detail?: string;
  first_seen: string;
  last_seen: string;
}

/** The failure reasons a person can act on (the rest are the pipeline's to fix). */
export const ACQUISITION_REASONS: ReadonlySet<string> = new Set(["no_document_found", "class_profile_only", "robots_disallowed", "host_blocked", "unreachable", "malformed_url"]);
/** The review queue's checks that are To do rows. */
export const ACQUISITION_QUEUE_CHECKS: ReadonlySet<string> = new Set(["unreachable", "not-a-url"]);

/** Most specific first: when two sources disagree on why, the earlier one wins. */
const WHY_RANK: readonly TodoWhy[] = ["terms", "login", "challenge", "robots-host", "robots-path", "viewer", "js-only", "bot-check", "no-document", "not-found", "unknown"];

/** Why a machine couldn't, from free words (a failure's detail, a URL). "unknown" when nothing matches. */
export function whyFromWords(text: string): TodoWhy {
  const t = text.toLowerCase();
  if (/\bterms\b|terms of (use|service)/.test(t)) return "terms";
  if (/log ?in|sign[- ]?in|password|sso|members? only|\b401\b|unauthori[sz]ed|sharepoint\.com\/:b:|\/_layouts\/15\/(authenticate|login)/.test(t)) return "login";
  if (/challenge|captcha|cloudflare|just a moment/.test(t)) return "challenge";
  if (/robots/.test(t)) return /\bhost\b|whole site|every path|disallow: \/\s*$/.test(t) ? "robots-host" : "robots-path";
  if (/drive\.google|docs\.google|onedrive|1drv\.ms|box\.com|issuu|dropbox|viewer/.test(t)) return "viewer";
  if (/javascript|js[- ]only|client[- ]rendered|needs a browser/.test(t)) return "js-only";
  if (/\b40[35]\b|\b429\b|refuse|forbidden|rate[- ]limit|blocked|bot/.test(t)) return "bot-check";
  if (/no (common data set|cds)|only class profile/.test(t)) return "no-document";
  if (/\b404\b|\b410\b|not found|nothing found|gone|doesn't parse|does not parse/.test(t)) return "not-found";
  return "unknown";
}

/** Why, for a `reported.failures` row: its reason code first, then its words. */
export function whyOfFailure(row: Pick<FailureRowLike, "reason_code" | "detail" | "url">): TodoWhy {
  const words = `${row.detail} ${row.url ?? ""}`;
  switch (row.reason_code) {
    case "robots_disallowed":
      return /\bhost\b|whole site/.test(row.detail.toLowerCase()) ? "robots-host" : "robots-path";
    case "host_blocked": {
      const w = whyFromWords(row.detail);
      return w === "unknown" || w === "not-found" ? "bot-check" : w;
    }
    case "class_profile_only":
      return "no-document";
    case "no_document_found":
    case "malformed_url":
      return "not-found";
    default:
      return whyFromWords(words);
  }
}

/** Why, for a blocked directory: its reason (`Blocked["reason"]` in scripts/lib/directories/contract.mts). */
export function whyOfBlocked(row: Pick<BlockedDirectoryLike, "reason" | "detail">): TodoWhy {
  switch (row.reason) {
    case "robots":
      return "robots-path";
    case "challenge":
      return "challenge";
    case "login":
    case "unauthorized":
      return "login";
    case "terms":
      return "terms";
    case "forbidden":
    case "rate-limited":
      return "bot-check";
    default:
      return whyFromWords(`${row.reason} ${row.detail ?? ""}`);
  }
}

/** The route a row starts with: a site whose terms or login stand in front is "ask"; a page its own script builds, "render". */
function routeOf(why: TodoWhy): TodoDoc["route"] {
  if (why === "terms" || why === "login") return "ask";
  if (why === "js-only") return "render";
  return null;
}

/** "Gamma Rho Lambda" → "gamma-rho-lambda". */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "-"
  );
}

/** The To do key: `<kind>:<unit_id or subject slug>:<edition or ->`. */
export function todoKey(kind: TodoDoc["kind"], subject: { unit_id: string | null; name: string }, edition: string | null): string {
  return `${kind}:${subject.unit_id ?? slug(subject.name)}:${edition || "-"}`;
}

/** A URL's host, or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** The host a failure names in words ("refused by stillman.edu (HTTP 403)", "every candidate host refuses us: www.aum.edu"). */
function hostInWords(detail: string): string | null {
  const m = /(?:refused by|refuses us:|answers)\s*([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(detail) ?? /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s+answers\b/i.exec(detail);
  return m ? m[1].toLowerCase() : null;
}

function row(input: {
  kind: TodoDoc["kind"];
  unit_id: string | null;
  subject: string;
  edition: string | null;
  url: string | null;
  host: string | null;
  why: TodoWhy;
  attempt: TodoDoc["attempts"][number];
}): TodoDoc {
  return {
    key: todoKey(input.kind, { unit_id: input.unit_id, name: input.subject }, input.edition),
    kind: input.kind,
    unit_id: input.unit_id,
    subject: input.subject,
    edition: input.edition || null,
    landing: input.url,
    document_url: null,
    host: input.host,
    why: input.why,
    reach: 1,
    demand: 0,
    status: "open",
    route: routeOf(input.why),
    attempts: [input.attempt],
    note: null,
    updated: input.attempt.at,
  };
}

const moreSpecific = (a: TodoWhy, b: TodoWhy): TodoWhy => (WHY_RANK.indexOf(a) <= WHY_RANK.indexOf(b) ? a : b);

/** Two rows with one key as one: the most specific why, the first landing page and host, every attempt (oldest first). */
function merge(a: TodoDoc, b: TodoDoc): TodoDoc {
  const why = moreSpecific(a.why, b.why);
  const attempts = [...a.attempts, ...b.attempts]
    .filter((x, i, all) => all.findIndex((y) => y.at === x.at && y.route === x.route && y.result === x.result) === i)
    .sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  return {
    ...a,
    landing: a.landing ?? b.landing,
    host: a.host ?? b.host,
    why,
    route: routeOf(why),
    reach: Math.max(a.reach, b.reach),
    attempts,
    updated: a.updated >= b.updated ? a.updated : b.updated,
  };
}

/** The order the To do screen lists rows in: highest reach, then demand, then subject and key. */
export function compareTodo(a: TodoDoc, b: TodoDoc): number {
  return b.reach - a.reach || b.demand - a.demand || a.subject.localeCompare(b.subject, "en") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export interface TodoSources {
  failures: readonly FailureRowLike[];
  queueItems: readonly ReviewItem[];
  blockedDirectories: readonly BlockedDirectoryLike[];
}

/** The open To do rows the three sources give, one per key, in `compareTodo` order. */
export function todoRows({ failures, queueItems, blockedDirectories }: TodoSources): TodoDoc[] {
  const out = new Map<string, TodoDoc>();
  const add = (r: TodoDoc) => {
    const prior = out.get(r.key);
    out.set(r.key, prior ? merge(prior, r) : r);
  };

  for (const f of failures) {
    if (!ACQUISITION_REASONS.has(f.reason_code)) continue;
    add(
      row({
        kind: "cds",
        unit_id: f.unit_id,
        subject: f.name,
        edition: f.edition,
        url: f.url,
        host: hostOf(f.url) ?? hostInWords(f.detail),
        why: whyOfFailure(f),
        attempt: { at: f.last_run, route: f.stage, result: `${f.reason_code}: ${f.detail}` },
      }),
    );
  }

  for (const item of queueItems) {
    if (item.resolved) continue;
    const failure = item.failures.find((x) => ACQUISITION_QUEUE_CHECKS.has(x.check));
    if (!failure) continue;
    const url = item.urls[0] ?? null;
    const kind: TodoDoc["kind"] = failure.check === "not-a-url" ? "other" : item.code || isCdsDocument(url ?? "") ? "cds" : "class-profile";
    add(
      row({
        kind,
        unit_id: item.unit_id,
        subject: item.name,
        edition: item.edition ?? null,
        url,
        host: hostOf(url),
        why: whyFromWords(`${failure.detail} ${url ?? ""}`),
        attempt: { at: item.queued, route: "queue", result: `${failure.check}: ${failure.detail} (${reviewKey(item)})` },
      }),
    );
  }

  for (const b of blockedDirectories) {
    add(
      row({
        kind: "campus-page",
        unit_id: null,
        subject: b.org,
        edition: null,
        url: b.url,
        host: hostOf(b.url),
        why: whyOfBlocked(b),
        attempt: { at: b.last_seen, route: "crawl", result: `${b.reason}${b.detail ? `: ${b.detail}` : ""}` },
      }),
    );
  }

  return [...out.values()].sort(compareTodo);
}

/**
 * The To do screen's rows: the stored `steward.todo` documents (a person's Found, No document published, Done; the
 * Steward's rows) over the generated ones with the same key, plus the generated rows nobody has touched. `demand`
 * (unit id → lists, follows) fills each college's row when given.
 */
export function mergeTodo(generated: readonly TodoDoc[], stored: Iterable<TodoDoc>, demand?: ReadonlyMap<string, number> | null): TodoDoc[] {
  const out = new Map<string, TodoDoc>(generated.map((r) => [r.key, r]));
  for (const s of stored) {
    const g = out.get(s.key);
    out.set(s.key, g ? { ...s, attempts: s.attempts.length ? s.attempts : g.attempts } : s);
  }
  const rows = [...out.values()].map((r) => (demand && r.unit_id && demand.has(r.unit_id) ? { ...r, demand: demand.get(r.unit_id)! } : r));
  return rows.sort(compareTodo);
}
