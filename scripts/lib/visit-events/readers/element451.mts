/**
 * The Element451 reader (specs/product/visit-events.md, "Round 3: TargetX and Element451", "Element451: the
 * protocol"; research in visit-events-build/research/element451.md). Unlike Slate, the events app (`event451`) is a
 * server-rendered Angular app: one `GET https://<site>/` returns the whole listing embedded in
 * `<script id="event451-state" type="application/json">` (twice, identical), so there is no separate search request,
 * no widgets, and no event page to read: the listing already carries the venue, ZIP, and coordinates that Slate's
 * reader has to fetch an event page for. One item is a template ("Campus Visit") spanning months; its
 * `occurrences.upcoming[]` are the actual bookable slots, each becoming its own stored row (the Element451 analogue
 * of Slate's per-slot widget rows, not its one-event-one-page model).
 */
import { roundCoord } from "../../../../lib/home.ts";
import { kindOf } from "../../../../lib/visit-events/kinds.ts";
import { visitEventId, type SlateHostRow, type VisitAvailability, type VisitEventKind } from "../../../../lib/visit-events/types.ts";
import type { ZipTable } from "../geo.mts";
import { CollapsedSearchError, type HostRead, type ReadDeps, type ReadEvent } from "../sync.mts";

/** One bookable slot under an item's `occurrences` (the listing's per-visit unit; Slate's widget-row analogue). */
export interface ElementOccurrence {
  event_guid: string;
  element_guid: string;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  allday?: boolean | null;
  is_open?: boolean | null;
  is_full?: boolean | null;
  is_closed?: boolean | null;
  /** Epoch seconds; the research's assumption that `element_guid` alone identifies one occurrence doesn't hold (see
   * slateIdFor below), so this disambiguates two occurrences that share a recurring slot's `element_guid`. */
  start_ts?: number | null;
}

/** `eventsListStore.items[].location`; absent entirely for a purely virtual item (research 1.6). */
export interface ElementLocation {
  venue_name?: string | null;
  building?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  geo?: { latitude?: number | null; longitude?: number | null } | null;
}

/** One `eventsListStore.items[]` entry: a template spanning months, not a bookable slot by itself. */
export interface ElementItem {
  guid: string;
  event_type?: string | null;
  content: { title: string; description?: string | null };
  allday?: boolean | null;
  timezone?: string | null;
  location?: ElementLocation | null;
  occurrences?: { first?: ElementOccurrence | null; next?: ElementOccurrence | null; upcoming?: ElementOccurrence[] | null } | null;
}

export interface ElementState {
  eventsListStore: { items: ElementItem[]; total: number; offset?: number; limit?: number };
  configState?: { client?: { token?: string | null } };
}

const STATE_RE = /<script\s+id="event451-state"\s+type="application\/json">([\s\S]*?)<\/script>/i;

/** Whether a page carries the `event451-state` blob at all (discovery's confirmation; not whether it parses). */
export function hasElementState(html: string): boolean {
  return STATE_RE.test(html);
}

/**
 * The page's `event451-state` blob, parsed. Throws `CollapsedSearchError` when the blob is missing, isn't JSON, or
 * has no `eventsListStore.items`: a page that answers but not in this shape is a collapse (Technolutions' analogue:
 * Element451 changed its markup), never a silent zero.
 */
export function parseElementState(html: string): ElementState {
  const m = STATE_RE.exec(html);
  if (!m) throw new CollapsedSearchError('no id="event451-state" blob on the page (collapsed: markup changed, or not an Element451 events site)');
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    throw new CollapsedSearchError(`the event451-state blob isn't valid JSON (collapsed: ${(err as Error).message})`);
  }
  const state = data as Partial<ElementState> | null;
  const items = state?.eventsListStore?.items;
  if (!state || typeof state !== "object" || !state.eventsListStore || !Array.isArray(items)) {
    throw new CollapsedSearchError("the event451-state blob has no eventsListStore.items (collapsed: shape changed)");
  }
  return state as ElementState;
}

/** One `GET https://<site>/`: the whole listing, no paging (every fixture had `total <= limit`; see readElementSite). */
export async function listElementEvents(site: string, http: { get(url: string): Promise<Response | null> }): Promise<{ items: ElementItem[]; total: number; sourceUrl: string }> {
  const url = `https://${site}/`;
  const res = await http.get(url);
  if (!res) throw new Error(`robots.txt disallows ${url}, or the host didn't answer it`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const state = parseElementState(html);
  return { items: state.eventsListStore.items, total: state.eventsListStore.total, sourceUrl: url };
}

/**
 * Whether an item's location means "online": the key absent entirely (the documented rule, research 1.6), or present
 * but naming no place at all (undocumented: University of St Francis's "Virtual Information Session" items carry a
 * `location` with only `platform_name`/`help_text`, no city, address, or geo — the research's four fixtures didn't
 * predict this shape; treating a placeless location the same as an absent one keeps the one rule instead of two).
 */
function isOnlineLocation(loc: ElementLocation | null | undefined): boolean {
  if (!loc) return true;
  return !(loc.city || loc.address || loc.venue_name || loc.building || loc.zip || (loc.geo && (loc.geo.latitude != null || loc.geo.longitude != null)));
}

/** The occurrence rows a stored row comes from: every `upcoming[]` slot, else `first`/`next` when `upcoming` is empty. */
function occurrencesOf(item: ElementItem): ElementOccurrence[] {
  const upcoming = item.occurrences?.upcoming;
  if (upcoming && upcoming.length) return upcoming;
  const out: ElementOccurrence[] = [];
  const first = item.occurrences?.first;
  const next = item.occurrences?.next;
  if (first) out.push(first);
  if (next && next.element_guid !== first?.element_guid) out.push(next);
  return out;
}

/** The event's own coordinates (`location.geo`), else its ZIP's ZCTA centre; null for an online row or an unplaced one. */
function locateElement(loc: ElementLocation | null | undefined, online: boolean, zips: ZipTable): { lat: number | null; lng: number | null } {
  if (online) return { lat: null, lng: null };
  if (loc?.geo && loc.geo.latitude != null && loc.geo.longitude != null) return { lat: roundCoord(loc.geo.latitude), lng: roundCoord(loc.geo.longitude) };
  const z = loc?.zip ? zips.get(loc.zip) : undefined;
  return z ? { lat: z.lat, lng: z.lng } : { lat: null, lng: null };
}

/**
 * `kindOf` on the title alone; when that yields `other`, retried with the client's free-text `event_type` appended to
 * the title text (never stored) so a slug like "discover-usf-day" can tip a title `kindOf` alone can't place (research
 * 1.6: "no fixed enum... needs the same keyword-mapping approach... not a lookup table").
 */
/**
 * The stored row id's event half: `${item.guid}:${occurrence.element_guid}` is NOT unique by itself — a recurring
 * daily slot (CCCB's "Campus Visit" 2:30pm tour, Cookman's two tour items, St Francis's and Webber's own recurring
 * items) repeats the SAME `element_guid` across every date it recurs on (confirmed in all four research fixtures: a
 * 10-occurrence item typically has only 2-5 distinct `element_guid` values). Composing the id from the pair alone, as
 * the research proposed, would collide two different dates onto one `visit_events` row and silently drop one. The
 * occurrence's own `start_ts` (epoch seconds, present on every occurrence in every fixture) disambiguates them.
 */
function slateIdFor(item: ElementItem, occ: ElementOccurrence): string {
  const when = occ.start_ts != null ? String(occ.start_ts) : (occ.start_date ?? "");
  return `${item.guid}:${occ.element_guid}:${when}`;
}

function kindForItem(title: string, eventType: string | null | undefined, online: boolean, place: string, campusCity: string | null): VisitEventKind {
  const base = kindOf({ title, online, place, campusCity });
  if (base !== "other" || !eventType) return base;
  return kindOf({ title: `${title} ${eventType}`, online, place, campusCity });
}

export interface ElementRowContext {
  /** The stored host (the confirmed event451 site, e.g. "cccb.event451.sites.451.io" or "visit.cookman.edu"). */
  host: string;
  unitId: string;
  sourceUrl: string;
  zips: ZipTable;
  /** The college's campus city, lower-cased; `kindOf`'s away-from-campus fallback (same rule as Slate's). */
  campusCity: string | null;
}

/**
 * Pure: one row per occurrence, the parent item's title, description, and location carried down. `date_confirmed` is
 * always true (the listing is authoritative, unlike Slate's search guess); there is no event page to read.
 */
export function elementRows(items: readonly ElementItem[], ctx: ElementRowContext): ReadEvent[] {
  const rows: ReadEvent[] = [];
  for (const item of items) {
    const title = (item.content?.title ?? "").trim().slice(0, 300);
    const loc = item.location ?? null;
    const online = isOnlineLocation(loc);
    const venue = (loc?.venue_name || loc?.building || null)?.slice(0, 300) ?? null;
    const address = loc?.address?.slice(0, 300) ?? null;
    const city = loc?.city ?? null;
    const state = loc?.state && /^[A-Z]{2}$/.test(loc.state) ? loc.state : null;
    const zip = loc?.zip && /^\d{5}$/.test(loc.zip) ? loc.zip : null;
    const place = online ? "Online" : [city, state].filter(Boolean).join(", ");
    const where = locateElement(loc, online, ctx.zips);
    const description = item.content?.description?.slice(0, 4000) ?? null;
    for (const occ of occurrencesOf(item)) {
      if (!occ.start_date) continue;
      const startsAt = new Date(occ.start_date).toISOString();
      if (Number.isNaN(Date.parse(startsAt))) continue;
      const endsAt = occ.end_date ? new Date(occ.end_date).toISOString() : null;
      const kind = kindForItem(title, item.event_type, online, place, ctx.campusCity);
      const availability: VisitAvailability | null = occ.is_closed ? "closed" : occ.is_full ? "full" : occ.is_open ? "open" : null;
      const slateId = slateIdFor(item, occ);
      rows.push({
        id: visitEventId(ctx.host, slateId),
        unit_id: ctx.unitId,
        host: ctx.host,
        slate_id: slateId,
        title,
        kind,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: occ.timezone ?? item.timezone ?? null,
        all_day: occ.allday ?? item.allday ?? false,
        online,
        venue,
        address,
        city,
        state,
        zip,
        lat: where.lat,
        lng: where.lng,
        availability,
        book_url: `https://${ctx.host}/event/${item.guid}`,
        source_url: ctx.sourceUrl,
        description,
        date_confirmed: true,
        pageRead: false,
      });
    }
  }
  return rows;
}

/**
 * Reads one Element451 site: the one listing request, flattened to one row per occurrence. No detail read (the
 * listing already has everything a row needs; `pagePolicy` is "listing" for every Element451 row). `total >
 * items.length` is a warning, not silently dropped: no paging parameter is known for a busier calendar (research
 * 1.7).
 */
export async function readElementSite(
  hostRow: Pick<SlateHostRow, "unit_id" | "host" | "config">,
  deps: Pick<ReadDeps, "http" | "zips" | "campusCity" | "log">,
): Promise<HostRead> {
  const log = deps.log ?? (() => {});
  const site = (hostRow.config as { site?: string } | null | undefined)?.site || hostRow.host;
  const { items, total, sourceUrl } = await listElementEvents(site, deps.http);
  const rows = elementRows(items, { host: hostRow.host, unitId: hostRow.unit_id, sourceUrl, zips: deps.zips, campusCity: deps.campusCity });
  const errors: string[] = [];
  if (total > items.length) {
    errors.push(`${sourceUrl}: eventsListStore.total (${total}) is greater than items.length (${items.length}); no paging parameter is known (research/element451.md)`);
  }
  log(`  ${hostRow.host}: ${items.length} items, ${rows.length} occurrence rows`);
  return { rows, fetched: 1, pagesRead: 0, widgetFailed: false, searchTotal: total, errors };
}
