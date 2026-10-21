/**
 * The list endpoint's query string (specs/product/data-api.md "Endpoints"): Explore's own parameters (lib/params.ts
 * `parseFilters`, so an Explore URL's filters work as API parameters and give the same colleges in the same order),
 * plus `sort`, `limit`, `cursor`, and `fields`. A bad value is a result the route turns into `400 bad_request` naming
 * the parameter, never a silent default; a parameter the endpoint doesn't know is refused too, so a typo (`state=CA`
 * for `states=CA`) can't quietly return every college.
 *
 *   const parsed = parseListQuery(new URL(request.url).searchParams);
 *   if (!parsed.ok) return badRequest(parsed.param, parsed.message);
 *   const { items, total, next_cursor } = pageOf(getSchools(parsed.query.filters), parsed.query);
 *
 * Pure module (no Next imports), so tests load it directly. The ZIP's center (`near`) and the estimates gate are
 * server-side facts the route adds to `query.filters` the way the Explore page does.
 */
import type { SearchFilters, SizeBucket } from "../types";
import { FIELDS, type FieldPath } from "../fields.ts";
import { FILTER_KEYS, SORT_KEYS, parseFilters } from "../params.ts";
import { fieldMatches, isHiddenPath } from "./serialize.ts";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** A parameter value the API refuses: the route answers `400 bad_request` with `param: message`. */
export interface QueryProblem {
  ok: false;
  param: string;
  message: string;
}

export interface ListQuery {
  filters: SearchFilters;
  limit: number;
  /** Where this page starts in the sorted results (decoded from `cursor`). */
  offset: number;
  /** Top-level keys to keep (`fields=`), or undefined for the whole record. */
  fields?: string[];
}

export type ParsedListQuery = { ok: true; query: ListQuery } | QueryProblem;

/** Explore keys `parseFilters` reads that `FILTER_KEYS` leaves out (they price or order results; they narrow nothing). */
const EXTRA_FILTER_KEYS = ["fieldMin", "income", "sortBy", "sortDir"] as const;
/** Explore's own page state: accepted so a pasted Explore URL works, and ignored. */
const IGNORED_KEYS = ["view", "page", "chart", "forMe"] as const;
/** What the API adds. */
const API_KEYS = ["sort", "limit", "cursor", "fields"] as const;

/** Every query parameter `/schools` accepts. */
export const LIST_PARAM_NAMES: ReadonlySet<string> = new Set<string>([...FILTER_KEYS, ...EXTRA_FILTER_KEYS, ...IGNORED_KEYS, ...API_KEYS]);

/** Parameters whose value must be a number. */
const NUMERIC_KEYS = [
  "minAR", "maxAR", "minSAT", "maxSAT", "minACT", "maxACT", "mySAT", "myACT", "minEnroll", "maxEnroll", "minApplicants", "minUndergrads",
  "maxRatio", "minFullTimeFaculty", "minCost", "maxCost", "fieldMin", "conference", "within", "minAidIncome", "income", "minGreek",
] as const;

const TYPES = ["public", "private-nonprofit", "private-forprofit"] as const;
const SIZES: readonly SizeBucket[] = ["small", "medium", "large", "xl"];

const problem = (param: string, message: string): QueryProblem => ({ ok: false, param, message });

/** `base64url` of the offset's decimal digits: opaque to callers, cheap to check. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

/** The offset a cursor names, or null when it isn't one `encodeCursor` made. */
export function decodeCursor(cursor: string): number | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  if (!/^(0|[1-9]\d{0,9})$/.test(text)) return null;
  return encodeCursor(Number(text)) === cursor ? Number(text) : null;
}

/** A comma list of field names: the names, or a problem when one is empty, malformed, or `isKnown` refuses it. */
export function parseFieldList(raw: string | null, param: string, isKnown: (name: string) => boolean): { ok: true; fields: string[] | undefined } | QueryProblem {
  if (raw === null || raw === "") return { ok: true, fields: undefined };
  const names = raw.split(",").map((s) => s.trim());
  const bad = names.find((n) => !/^[A-Za-z_][\w.]*$/.test(n) || !isKnown(n));
  if (bad !== undefined) return problem(param, `"${bad}" is not a field you can ask for; use a comma-separated list of names from the record`);
  return { ok: true, fields: [...new Set(names)] };
}

/** `?limit=`: a whole number from 1; above the maximum it is held to it (the response's `next_cursor` continues). */
function parseLimit(raw: string | null): number | QueryProblem {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) return problem("limit", `use a whole number from 1 to ${MAX_LIMIT}`);
  return Math.min(Number(raw), MAX_LIMIT);
}

/**
 * The list query: `parseFilters` over the same parameters Explore reads, `sort` (or Explore's `sortBy`) validated
 * against Explore's sort keys, `sortDir`, `limit` (1..100, default 50), `cursor`, and `fields` (checked against
 * `isKnownField`, the record's top-level keys).
 */
export function parseListQuery(search: URLSearchParams, isKnownField: (name: string) => boolean = () => true): ParsedListQuery {
  for (const key of new Set(search.keys())) {
    if (!LIST_PARAM_NAMES.has(key)) return problem(key, "not a parameter of this endpoint; see /api/v1/openapi.json for the list");
  }
  const get = (key: string) => search.get(key);

  for (const key of NUMERIC_KEYS) {
    const v = get(key);
    if (v !== null && v !== "" && !Number.isFinite(Number(v))) return problem(key, "use a number");
  }
  for (const [key, allowed] of [["types", TYPES], ["sizes", SIZES]] as const) {
    const bad = (get(key) ?? "").split(",").filter(Boolean).find((v) => !(allowed as readonly string[]).includes(v));
    if (bad !== undefined) return problem(key, `"${bad}" is not one of ${allowed.join(", ")}`);
  }

  // `sort` is the API's name; `sortBy` is Explore's, accepted so a pasted Explore URL sorts the same.
  const sortParam = get("sort") !== null ? "sort" : "sortBy";
  const sort = get(sortParam);
  if (sort !== null && sort !== "" && !(SORT_KEYS as readonly string[]).includes(sort)) {
    return problem(sortParam, `"${sort}" is not a sort key; use one of ${SORT_KEYS.join(", ")}`);
  }
  const dir = get("sortDir");
  if (dir !== null && dir !== "asc" && dir !== "desc") return problem("sortDir", "use asc or desc");

  const limit = parseLimit(get("limit"));
  if (typeof limit !== "number") return limit;

  let offset = 0;
  const cursor = get("cursor");
  if (cursor !== null && cursor !== "") {
    const decoded = decodeCursor(cursor);
    if (decoded === null) return problem("cursor", "not a cursor this API returned; pass next_cursor from the previous page unchanged");
    offset = decoded;
  }

  const fields = parseFieldList(get("fields"), "fields", isKnownField);
  if (!fields.ok) return fields;

  const params: Record<string, string | undefined> = {};
  for (const [k, v] of search) if (k !== "sort" && k !== "sortBy" && !(k in params)) params[k] = v;
  if (sort) params.sortBy = sort;
  const filters = parseFilters(params);
  return { ok: true, query: { filters, limit, offset, ...(fields.fields ? { fields: fields.fields } : {}) } };
}

/** One page of already-sorted results: the slice, the total, and the cursor for the next page (null at the end). */
export function pageOf<T>(all: readonly T[], query: Pick<ListQuery, "limit" | "offset">): { items: T[]; total: number; next_cursor: string | null } {
  const end = query.offset + query.limit;
  return { items: all.slice(query.offset, end), total: all.length, next_cursor: end < all.length ? encodeCursor(end) : null };
}

const keyMemo = new WeakMap<readonly object[], Set<string>>();

/** Every top-level key some college's record has (what `fields=` may name on a record), memoized per dataset array. */
export function recordKeys(schools: readonly object[]): ReadonlySet<string> {
  let keys = keyMemo.get(schools);
  if (!keys) {
    keys = new Set(schools.flatMap((s) => Object.keys(s)));
    keyMemo.set(schools, keys);
  }
  return keys;
}

/** Whether `name` picks at least one public registered field (a field path or a prefix of some): what `fields=` may name on /lineage. */
export function isLineageField(name: string): boolean {
  return (Object.keys(FIELDS) as FieldPath[]).some((path) => !isHiddenPath(path) && !isHiddenPath(name) && fieldMatches(path, [name]));
}
