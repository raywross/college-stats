/**
 * The nightly read of a Slate host (specs/product/visit-events.md, "The nightly job"):
 *   1. the standard search (every placed event, no year), then each portal widget's `event_list` (online events and
 *      open/full; paged, at most five pages, stopping when a page repeats or adds nothing);
 *   2. the event page for every id not stored yet, stored with `date_confirmed = false`, or whose title or start
 *      changed in the search (the page gives the year, zone, venue, ZIP, description, and closed registration);
 *   3. rows built (`visitEventId`, `kindOf` with the campus city, ZIP → lat/lng, availability) and compared with the
 *      stored rows by `diffEvents`, a pure function: new rows, `changed_at` when the title, start, place, or
 *      availability moved (`moved_at` when the start or place did), `misses + 1` for a stored live upcoming row not seen tonight and `removed_at` at two misses;
 *   4. written through the secret key in batches of 500, the host's row updated, and a `visit_event_sync` row.
 * Guards ("Keeping it running"): a search that is Slate's page but parses to nothing it says it has (or no longer says
 * "returned N event(s)" at all) is a collapsed host, an error that counts no misses; and when more than 20% of the hosts
 * tried tonight failed or collapsed, no host's misses are written (`misses_withheld`), so a markup change can never
 * empty the table.
 * Every request goes through `PoliteHttp` (robots.txt, at least a second between requests to one host, the project's
 * user agent); hosts are read in parallel, a few at a time. Nothing is ever submitted to a college.
 */
import { localIsoIn, parseSearchWhen, toInstant, zoneForState } from "../../../lib/visit-events/dates.ts";
import { kindOf } from "../../../lib/visit-events/kinds.ts";
import { VISIT_EVENT_COLUMNS, isShownKind, visitEventId, type SlateHostRow, type VisitAvailability, type VisitEventRow } from "../../../lib/visit-events/types.ts";
import type { ReaderHttp } from "./discover.mts";
import { parseEventPage, type EventPage } from "./event-page.mts";
import { afterFailure, afterRead, FAILURES_TO_UNREACHABLE } from "./hosts.mts";
import { locate, type ZipTable } from "./geo.mts";
import { isSlateEventRegistration, parseStandardSearch, searchUrl, type StandardSearch } from "./slate-search.mts";
import { MAX_WIDGET_PAGES, parseWidgetList, widgetListUrl } from "./slate-widget.mts";
import { readElementSite } from "./readers/element451.mts";

/**
 * A stored row: the public columns plus the miss counter only the reader uses, and `moved_at` (migration
 * 20261013190000_visit_events_moved.sql): when the start or the place last changed, which the alert job reports as
 * "moved to".
 */
export type StoredEvent = VisitEventRow & { misses: number; moved_at: string | null };

/** The columns the reader reads back (every public column plus `misses` and `moved_at`). */
export const STORED_EVENT_COLUMNS = `${VISIT_EVENT_COLUMNS}, misses${/\bmoved_at\b/.test(VISIT_EVENT_COLUMNS) ? "" : ", moved_at"}`;

/** One event as tonight's read built it, before the bookkeeping columns. */
export type ReadEvent = Omit<VisitEventRow, "first_seen" | "last_seen" | "changed_at" | "removed_at" | "moved_at"> & {
  /** Whether the event page was read tonight (its fields are fresh); otherwise the stored page fields stand. */
  pageRead: boolean;
};

/* ------------------------------------------------------------------ */
/* The diff: pure                                                      */
/* ------------------------------------------------------------------ */

export interface EventDiff {
  /** Rows to upsert: new, seen again (last_seen moves), changed. */
  upserts: StoredEvent[];
  /** Stored rows not seen tonight, with `misses + 1` and `removed_at` at two misses. */
  missed: StoredEvent[];
  counts: { new: number; changed: number; removed: number; seen: number };
}

/** Misses before a row counts as removed: one missed read can be a host hiccup. */
export const MISSES_TO_REMOVE = 2;

/** Fields the event page owns: kept from the stored row when tonight's read didn't reread the page. */
const PAGE_FIELDS = ["starts_at", "ends_at", "timezone", "all_day", "venue", "address", "city", "state", "zip", "lat", "lng", "description", "date_confirmed"] as const;

const sameInstant = (a: string | null, b: string | null) => (a == null || b == null ? a === b : Date.parse(a) === Date.parse(b));

/**
 * Tonight's rows against the stored ones for one host. `now` is the run's ISO time. `skipMiss` exempts stored rows
 * from the miss count (the online rows when a widget failed to answer). A row whose start has passed is never
 * counted missed: the search drops it because it happened, not because it was cancelled.
 */
export function diffEvents(stored: readonly StoredEvent[], read: readonly ReadEvent[], now: string, skipMiss: (row: StoredEvent) => boolean = () => false): EventDiff {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const upserts: StoredEvent[] = [];
  const counts = { new: 0, changed: 0, removed: 0, seen: 0 };
  for (const r of read) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const { pageRead, ...fresh } = r;
    const old = byId.get(r.id);
    if (!old) {
      counts.new++;
      upserts.push({ ...fresh, first_seen: now, last_seen: now, changed_at: now, removed_at: null, misses: 0, moved_at: null });
      continue;
    }
    counts.seen++;
    const next: StoredEvent = { ...old, ...fresh, first_seen: old.first_seen, last_seen: now, removed_at: null, misses: 0, changed_at: old.changed_at };
    if (!pageRead) {
      for (const f of PAGE_FIELDS) (next as unknown as Record<string, unknown>)[f] = old[f];
      // A row stored without coordinates (its page failed, or it predates the campus rule) takes the listing's: the
      // campus's own coordinates for an on-campus row (Central College's 503 rows, 2026-10-14).
      if (old.lat == null && fresh.lat != null) {
        next.lat = fresh.lat;
        next.lng = fresh.lng;
      }
      // Closed comes from the page and outranks the widget's "full" (Duke's filled slots say both); "open" reopens it.
      next.availability = old.availability === "closed" && fresh.availability !== "open" ? "closed" : (fresh.availability ?? old.availability);
    }
    next.date_confirmed = old.date_confirmed || next.date_confirmed;
    const changed =
      next.title !== old.title ||
      !sameInstant(next.starts_at, old.starts_at) ||
      next.venue !== old.venue ||
      next.address !== old.address ||
      next.city !== old.city ||
      next.availability !== old.availability;
    if (changed) {
      next.changed_at = now;
      counts.changed++;
    }
    // Moved: the start or the place changed on a row whose page had confirmed them (the first confirmation of a
    // search row's guessed date is not a move). A new title or availability moves changed_at only.
    const moved =
      old.date_confirmed &&
      (!sameInstant(next.starts_at, old.starts_at) || next.venue !== old.venue || next.address !== old.address || next.city !== old.city);
    next.moved_at = moved ? now : (old.moved_at ?? null);
    upserts.push(next);
  }
  const missed: StoredEvent[] = [];
  for (const s of stored) {
    if (seen.has(s.id) || s.removed_at || Date.parse(s.starts_at) < Date.parse(now) || skipMiss(s)) continue;
    const misses = s.misses + 1;
    const removed = misses >= MISSES_TO_REMOVE;
    if (removed) counts.removed++;
    missed.push({ ...s, misses, removed_at: removed ? now : null });
  }
  return { upserts, missed, counts };
}

/* ------------------------------------------------------------------ */
/* Reading a host                                                      */
/* ------------------------------------------------------------------ */

/** One event as the search and widgets list it, before its page is read. */
interface Candidate {
  slateId: string;
  title: string;
  /** Local start from the search (year rule) or the widget; null when neither gave a usable date. */
  localIso: string | null;
  /** Whether `localIso` has a time (a widget date alone has none). */
  timed: boolean;
  allDay: boolean;
  place: string;
  state: string | null;
  online: boolean;
  availability: VisitAvailability | null;
  sourceUrl: string;
  inSearch: boolean;
}

export interface ReadDeps {
  http: ReaderHttp;
  now: Date;
  zips: ZipTable;
  /** The college's campus city, lower-cased ("gainesville"): `kindOf` makes unmatched away rows travel. */
  campusCity: string | null;
  /** The campus state, for the zone of a row with no state before its page is read. */
  campusState: string | null;
  /** The campus coordinates (IPEDS), where on-campus rows are placed without reading their page. */
  campusLat: number | null;
  campusLng: number | null;
  /** Stored rows for the host, by id (decides which event pages to read). */
  stored: ReadonlyMap<string, StoredEvent>;
  /** Event pages read per host at most this run (default: all that need it). */
  maxPages?: number;
  log?: (msg: string) => void;
}

export interface HostRead {
  rows: ReadEvent[];
  /** Requests made to the host (search, widget pages, event pages). */
  fetched: number;
  pagesRead: number;
  /** Whether a widget failed to answer (its online rows then aren't counted missed). */
  widgetFailed: boolean;
  /** The search's stated total ("returned N event(s)"). */
  searchTotal: number | null;
  errors: string[];
}

/**
 * A search page that is Slate's but parsed to nothing it says it has: "returned N event(s)" with N > 0 and no rows, or
 * the phrase gone entirely. Most likely Technolutions changed the markup; the host's stored rows must not be missed.
 */
export class CollapsedSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollapsedSearchError";
  }
}

/** Why a parsed standard search is a collapse, or null when it is a real answer (rows, or "returned 0 event(s)"). */
export function searchCollapse(search: StandardSearch): string | null {
  if (search.total == null) return 'the search page no longer says "returned N event(s)" (collapsed: markup changed?)';
  if (search.total > 0 && search.rows.length === 0) return `the search says it returned ${search.total} event(s) but none parsed (collapsed: markup changed?)`;
  return null;
}

async function getText(http: ReaderHttp, url: string): Promise<string | null> {
  const res = await http.get(url);
  if (!res) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const cityOf = (place: string) => /^(.+?),\s*[A-Z]{2}$/.exec(place)?.[1] ?? null;

/** Whether a listing's place is the campus: the campus city, or no city at all (a widget row names a building). */
export function isCampusPlace(place: string, campusCity: string | null): boolean {
  const city = cityOf(place);
  if (!city) return true;
  return !!campusCity && city.toLowerCase() === campusCity;
}

export type PagePolicy = "listing" | "page";

/**
 * What a listing row needs (owner, 2026-10-14; specs/product/visit-events.md "What is stored, read in detail, and
 * shown"): every row is stored from the listing. Only a shown kind (lib/visit-events/types.ts SHOWN_KINDS) that happens
 * away from campus (the travel calendar, a session in another city) is worth its event page, for the venue's address
 * and ZIP. Campus rows take the campus's own coordinates and zone; online rows need no place; `other` and `staff` rows
 * (what a Slate database exposes by accident) are kept from the listing alone and never shown.
 */
export function pagePolicy(c: Pick<Candidate, "title" | "place" | "online">, campusCity: string | null): PagePolicy {
  const kind = kindOf({ title: c.title, online: c.online, place: c.place, campusCity });
  if (!isShownKind(kind)) return "listing";
  if (kind === "online" || c.online) return "listing";
  if (kind === "travel") return "page";
  return isCampusPlace(c.place, campusCity) ? "listing" : "page";
}

/** Whether a stored row's page should be read again: not confirmed, or the title or the start moved in the listing. */
export function needsPage(stored: StoredEvent | undefined, c: Pick<Candidate, "title" | "localIso" | "timed" | "inSearch">): boolean {
  if (!stored || !stored.date_confirmed) return true;
  // A widget's button text ("Sign Up For a Tour") isn't a title; only the search's title is compared.
  if (c.inSearch && stored.title !== c.title) return true;
  if (!c.localIso) return false;
  const was = localIsoIn(stored.starts_at, stored.timezone ?? zoneForState(stored.state));
  return c.timed && !stored.all_day ? was.slice(0, 16) !== c.localIso.slice(0, 16) : was.slice(0, 10) !== c.localIso.slice(0, 10);
}

/** The row for one candidate, from its page when read, else from the listing alone (date unconfirmed). */
export function buildRow(
  host: string,
  unitId: string,
  c: Candidate,
  page: EventPage | null,
  deps: Pick<ReadDeps, "zips" | "campusCity" | "campusState" | "campusLat" | "campusLng">,
): ReadEvent | null {
  const title = (page?.title ?? c.title).slice(0, 300);
  const state = page?.state ?? c.state ?? null;
  const guessZone = zoneForState(state ?? deps.campusState);
  let startsAt: string | null = null;
  let endsAt: string | null = null;
  let timezone: string | null = null;
  let allDay = c.allDay;
  const confirmed = !!page?.start;
  if (page?.start) {
    const at = page.offset ?? page.zone ?? guessZone;
    startsAt = toInstant(page.start, at);
    endsAt = page.end ? toInstant(page.end, page.zone ?? page.offset ?? guessZone) : null;
    timezone = page.zone;
    allDay = page.allDay;
  } else if (c.localIso) {
    startsAt = toInstant(c.localIso, guessZone);
  }
  if (!startsAt) return null;
  const zip = page?.zip && /^\d{5}$/.test(page.zip) ? page.zip : null;
  // No page for an on-campus row (pagePolicy "listing"): the campus's own coordinates place it.
  const onCampus = !page && !c.online && isCampusPlace(c.place, deps.campusCity) && deps.campusLat != null && deps.campusLng != null;
  const where = onCampus
    ? { lat: deps.campusLat as number, lng: deps.campusLng as number }
    : locate(deps.zips, { zip, online: c.online, mapLat: page?.mapLat, mapLng: page?.mapLng });
  const place = c.place || [page?.city, page?.state].filter(Boolean).join(", ");
  const availability: VisitAvailability | null = page?.closed ? "closed" : c.availability;
  return {
    id: visitEventId(host, c.slateId),
    unit_id: unitId,
    host,
    slate_id: c.slateId,
    title,
    kind: kindOf({ title, online: c.online, place, campusCity: deps.campusCity }),
    starts_at: startsAt,
    ends_at: endsAt,
    timezone,
    all_day: allDay,
    online: c.online,
    venue: page?.venue?.slice(0, 300) ?? null,
    address: page?.address?.slice(0, 300) ?? null,
    city: page?.city ?? cityOf(c.place),
    state: state && /^[A-Z]{2}$/.test(state) ? state : null,
    zip,
    lat: where.lat,
    lng: where.lng,
    availability,
    book_url: `https://${host}/register/?id=${c.slateId}`,
    source_url: c.sourceUrl,
    description: page?.description?.slice(0, 4000) ?? null,
    date_confirmed: confirmed,
    pageRead: !!page,
  };
}

/** Reads one host: search, widgets, the event pages that need it; returns tonight's rows. Throws when the search fails. */
export async function readHost(hostRow: Pick<SlateHostRow, "unit_id" | "host" | "portal_parts">, deps: ReadDeps): Promise<HostRead> {
  const { host, unit_id: unitId } = hostRow;
  const log = deps.log ?? (() => {});
  const errors: string[] = [];
  let fetched = 0;
  const sUrl = searchUrl(host);
  fetched++;
  const searchHtml = await getText(deps.http, sUrl);
  if (searchHtml == null) throw new Error(`robots.txt disallows ${sUrl}, or the host didn't answer it`);
  // A page still headed "Event Registration" is Slate's even when the results phrase is gone (a results page has no
  // form fields, so isSlateEventRegistration alone would call it a stranger): that is a collapse, not a plain failure.
  const search = parseStandardSearch(searchHtml, host);
  const headed = /<h1>\s*Event Registration\s*<\/h1>/i.test(searchHtml);
  const collapse = headed ? searchCollapse(search) : null;
  if (collapse) throw new CollapsedSearchError(`${sUrl}: ${collapse}`);
  if (!isSlateEventRegistration(searchHtml)) throw new Error(`${sUrl} is not Slate's Event Registration page`);
  const cands = new Map<string, Candidate>();
  for (const r of search.rows) {
    const when = parseSearchWhen(r.when, deps.now);
    cands.set(r.slateId, {
      slateId: r.slateId,
      title: r.title,
      localIso: when?.iso ?? null,
      timed: !!when && !when.allDay,
      allDay: when?.allDay ?? false,
      place: r.place,
      state: r.state,
      online: false,
      availability: null,
      sourceUrl: sUrl,
      inSearch: true,
    });
  }

  let widgetFailed = false;
  for (const part of hostRow.portal_parts ?? []) {
    let last = "";
    const ids = new Set<string>();
    for (let page = 1; page <= MAX_WIDGET_PAGES; page++) {
      const url = widgetListUrl(host, part.service, page);
      let html: string | null;
      try {
        fetched++;
        html = await getText(deps.http, url);
      } catch (err) {
        widgetFailed = true;
        errors.push(`${url}: ${(err as Error).message}`);
        break;
      }
      if (html == null || html === last) break;
      last = html;
      const rows = parseWidgetList(html, host);
      const fresh = rows.filter((r) => !ids.has(r.slateId));
      if (!fresh.length) break;
      for (const w of fresh) {
        ids.add(w.slateId);
        const timed = /T\d{2}:\d{2}/.test(w.whenIso);
        const prev = cands.get(w.slateId);
        if (prev) {
          prev.online = prev.online || w.online;
          prev.availability = w.availability ?? prev.availability;
          if (!prev.timed && timed) {
            prev.localIso = w.whenIso.slice(0, 19);
            prev.timed = true;
            prev.allDay = false;
          }
          if (w.online) prev.place = "Online";
        } else {
          cands.set(w.slateId, {
            slateId: w.slateId,
            title: w.title,
            localIso: timed ? w.whenIso.slice(0, 19).padEnd(19, ":00") : `${w.whenIso.slice(0, 10)}T00:00:00`,
            timed,
            allDay: false,
            place: w.place,
            state: null,
            online: w.online,
            availability: w.availability,
            sourceUrl: `https://${host}${part.page}`,
            inSearch: false,
          });
        }
      }
    }
  }

  const rows: ReadEvent[] = [];
  let pagesRead = 0;
  const cap = deps.maxPages ?? Infinity;
  for (const c of cands.values()) {
    const id = visitEventId(host, c.slateId);
    const policy = pagePolicy(c, deps.campusCity);
    let page: EventPage | null = null;
    if (policy === "page" && needsPage(deps.stored.get(id), c) && pagesRead < cap) {
      const url = `https://${host}/register/?id=${c.slateId}`;
      try {
        fetched++;
        const html = await getText(deps.http, url);
        if (html != null) {
          page = parseEventPage(html);
          pagesRead++;
        }
      } catch (err) {
        errors.push(`${url}: ${(err as Error).message}`);
      }
    }
    try {
      const row = buildRow(host, unitId, c, page, deps);
      if (row) rows.push(row);
    } catch (err) {
      errors.push(`${c.slateId}: ${(err as Error).message}`);
    }
  }
  log(`  ${host}: ${search.rows.length} in the search, ${cands.size} in all, ${pagesRead} event pages read`);
  return { rows, fetched, pagesRead, widgetFailed, searchTotal: search.total, errors };
}

/**
 * Reads one host by its vendor (specs/product/visit-events.md, "Round 3: TargetX and Element451"): `readHost` for
 * `slate` (today's reader, above), `readElementSite` for `element451`; throws for anything else, so an unknown or
 * misconfigured vendor is a visible failure rather than a silently skipped host. (TargetX agent: add a `targetx` case
 * here, alongside the `element451` one.)
 */
export async function readSite(hostRow: SlateHostRow, deps: ReadDeps): Promise<HostRead> {
  switch (hostRow.vendor) {
    case "slate":
      return readHost(hostRow, deps);
    case "element451":
      return readElementSite(hostRow, deps);
    default:
      throw new Error(`readSite: no reader for vendor "${hostRow.vendor}" (host ${hostRow.host})`);
  }
}

/* ------------------------------------------------------------------ */
/* Storage and the run                                                 */
/* ------------------------------------------------------------------ */

/** Where rows live: Supabase in a run (`supabaseStore`), memory in tests. */
export interface EventStore {
  storedFor(host: string, unitId: string): Promise<StoredEvent[]>;
  upsertEvents(rows: readonly StoredEvent[]): Promise<void>;
  updateHost(unitId: string, patch: Partial<SlateHostRow>): Promise<void>;
  recordSync(row: SyncRecord): Promise<void>;
}

export interface SyncRecord {
  ran_at: string;
  finished_at: string;
  hosts_read: number;
  events_new: number;
  events_changed: number;
  events_removed: number;
  pages_fetched: number;
  errors: { host: string; error: string }[];
  /** Hosts whose read failed (not answering, not Slate's page, a write error); collapsed hosts are counted apart. */
  hosts_failed: number;
  /** Hosts whose search collapsed (`CollapsedSearchError`). */
  hosts_collapsed: number;
  /** Whether the run-level guard withheld every host's misses tonight. */
  misses_withheld: boolean;
}

export interface HostResult {
  unitId: string;
  host: string;
  ok: boolean;
  /** Whether the failure was a collapsed search (`CollapsedSearchError`). */
  collapsed: boolean;
  error?: string;
  diff?: EventDiff;
  read?: HostRead;
}

export interface SyncDeps {
  http: ReaderHttp;
  store: EventStore;
  zips: ZipTable;
  now: Date;
  /** Campus city and state by unit id (data/schools.json `location`). */
  campus: (unitId: string) => { city: string | null; state: string | null; lat: number | null; lng: number | null };
  dryRun?: boolean;
  maxPages?: number;
  log?: (msg: string) => void;
}

/** Hosts that fail this many nights running become `unreachable` (retried 7 days after the last attempt; hosts.mts). */
export { FAILURES_TO_UNREACHABLE };

/**
 * Reads, diffs, and (unless a dry run) writes one host's new and changed rows and its `slate_hosts` row. The misses
 * (`diff.missed`) are left to `runSync`, which writes them only when the run-level guard allows. Never throws: a
 * failure is the result's `error`; a collapsed search is a failure with `collapsed` set.
 */
export async function syncHost(hostRow: SlateHostRow, deps: SyncDeps): Promise<HostResult> {
  const now = deps.now.toISOString();
  const log = deps.log ?? (() => {});
  try {
    const stored = await deps.store.storedFor(hostRow.host, hostRow.unit_id);
    const campus = deps.campus(hostRow.unit_id);
    const read = await readSite(hostRow, {
      http: deps.http,
      now: deps.now,
      zips: deps.zips,
      campusCity: campus.city?.toLowerCase() ?? null,
      campusState: campus.state,
      campusLat: campus.lat,
      campusLng: campus.lng,
      stored: new Map(stored.map((s) => [s.id, s])),
      maxPages: deps.maxPages,
      log,
    });
    const diff = diffEvents(stored, read.rows, now, (s) => read.widgetFailed && s.online);
    if (!deps.dryRun) {
      await deps.store.upsertEvents(diff.upserts);
      await deps.store.updateHost(hostRow.unit_id, afterRead(hostRow, { rows: read.rows.length, searchTotal: read.searchTotal }, deps.now));
    }
    return { unitId: hostRow.unit_id, host: hostRow.host, ok: true, collapsed: false, diff, read };
  } catch (err) {
    const error = (err as Error).message;
    log(`  ${hostRow.host}: ${error}`);
    if (!deps.dryRun) {
      await deps.store.updateHost(hostRow.unit_id, afterFailure(hostRow, error, deps.now)).catch(() => {});
    }
    return { unitId: hostRow.unit_id, host: hostRow.host, ok: false, collapsed: err instanceof CollapsedSearchError, error };
  }
}

/** Runs `fn` over `items`, `size` at a time. */
export async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Hosts read in parallel (each host's own requests stay one a second, so the pool changes nothing a college sees).
 * VISIT_EVENTS_HOST_POOL raises it for a first full read, which fetches every event's page once.
 */
export const HOST_POOL = Math.max(1, Number(process.env.VISIT_EVENTS_HOST_POOL) || 8);

/** Above this share of tonight's hosts failed or collapsed, no misses are written for any host (the run-level guard). */
export const MAX_FAILED_SHARE = 0.2;

/** Whether the run-level guard withholds tonight's misses: more than `MAX_FAILED_SHARE` of the hosts tried failed or collapsed. */
export function withholdMisses(tried: number, failed: number, collapsed: number): boolean {
  return tried > 0 && (failed + collapsed) / tried > MAX_FAILED_SHARE;
}

/**
 * Syncs the hosts (one row per host; a host listed for two colleges is read once), then writes every host's misses
 * unless the run-level guard withholds them, records the run, and returns the results.
 */
export async function runSync(hosts: readonly SlateHostRow[], deps: SyncDeps): Promise<{ results: HostResult[]; record: SyncRecord }> {
  const ranAt = deps.now.toISOString();
  const byHost = new Map<string, SlateHostRow>();
  for (const h of hosts) {
    if (byHost.has(h.host)) deps.log?.(`  ${h.host} is listed for ${byHost.get(h.host)!.unit_id} and ${h.unit_id}; read once, for ${byHost.get(h.host)!.unit_id}`);
    else byHost.set(h.host, h);
  }
  const results = await pool([...byHost.values()], HOST_POOL, (h) => syncHost(h, deps));
  const collapsed = results.filter((r) => r.collapsed).length;
  const failed = results.filter((r) => !r.ok && !r.collapsed).length;
  const withheld = withholdMisses(results.length, failed, collapsed);
  const runErrors: { host: string; error: string }[] = [];
  if (withheld) {
    deps.log?.(`  Misses withheld: ${failed} failed and ${collapsed} collapsed of ${results.length} hosts (more than ${MAX_FAILED_SHARE * 100}%)`);
  } else if (!deps.dryRun) {
    const missed = results.flatMap((r) => r.diff?.missed ?? []);
    try {
      if (missed.length) await deps.store.upsertEvents(missed);
    } catch (err) {
      runErrors.push({ host: "*", error: `writing ${missed.length} missed rows: ${(err as Error).message}` });
    }
  }
  const record: SyncRecord = {
    ran_at: ranAt,
    finished_at: new Date().toISOString(),
    hosts_read: results.filter((r) => r.ok).length,
    events_new: results.reduce((n, r) => n + (r.diff?.counts.new ?? 0), 0),
    events_changed: results.reduce((n, r) => n + (r.diff?.counts.changed ?? 0), 0),
    events_removed: withheld || runErrors.length ? 0 : results.reduce((n, r) => n + (r.diff?.counts.removed ?? 0), 0),
    pages_fetched: results.reduce((n, r) => n + (r.read?.fetched ?? 0), 0),
    errors: results.flatMap((r) => [
      ...(r.error ? [{ host: r.host, error: r.error }] : []),
      ...(r.read?.errors ?? []).slice(0, 20).map((e) => ({ host: r.host, error: e })),
    ]).concat(runErrors),
    hosts_failed: failed,
    hosts_collapsed: collapsed,
    misses_withheld: withheld,
  };
  if (!deps.dryRun) await deps.store.recordSync(record);
  return { results, record };
}

