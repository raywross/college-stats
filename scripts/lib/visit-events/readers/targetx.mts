/**
 * The TargetX reader (specs/product/visit-events.md, "TargetX: the protocol"; research in
 * visit-events-build/research/targetx.md). Two flavours of Salesforce site are read; a third is recorded, never read:
 *
 * - **legacy** (`TargetX_Eventsb`, `https://<org>.my.salesforce-sites.com/<site>`): the page embeds a Visualforce
 *   remoting descriptor (`RemotingProviderImpl`: `vid`, and a `csrf` and `authorization` token per method). The read is
 *   the two calls the page itself makes, `initialize` (the org's settings) then `getFutureEvents` with
 *   `[{}, <Use_Location_Lookup__c>, "", []]`, both `POST …/<service>` with `Referer` and `Origin` set to the site's own
 *   origin (Salesforce answers 402 without them). Tokens are page-scoped: the page is fetched in the same read that
 *   calls, never cached. No other remoting method is ever called (`remotingBody` refuses any other name). The answer
 *   may be reference-compressed (`ref: true`; `{"s": id, "v": …}` / `{"r": id}`), which `resolveRefs` undoes.
 * - **erx** (`ERx_Events`, usually `/EventListing`): the whole list is a JavaScript string literal in the page
 *   (`var a = '[…]'`), so the read is one GET, a tolerant one-layer unescape, and `JSON.parse`, one event at a time
 *   when the whole array won't parse (a bad event is skipped and counted, never fails the page).
 * - **lightning** (`/s/` Experience Cloud sites): nothing is server-rendered; never read (stored `off`).
 *
 * Every field is optional (Salesforce drops null fields). Places: a ZIP places a row through the ZCTA table; a row
 * with no city (venue text only) or the campus city takes the campus's coordinates; an away row (another city, or a
 * travel kind) with no ZIP stays unlocated. Availability: cancelled is `closed`; no slots and no waitlist is `full`
 * (legacy), registrations at the cap is `full` (ERx); else `open`. Every request goes through `PoliteHttp`
 * (robots.txt, one request a second per host, the project's user agent).
 */
import { toInstant, zoneFor } from "../../../../lib/visit-events/dates.ts";
import { kindOf } from "../../../../lib/visit-events/kinds.ts";
import { visitEventId, type SlateHostRow, type VisitAvailability } from "../../../../lib/visit-events/types.ts";
import { decodeEntities, htmlToText } from "../../college-reported/documents.mts";
import type { ReaderHttp } from "../discover.mts";
import { locate, type ZipTable } from "../geo.mts";
import { CollapsedSearchError, type HostRead, type ReadDeps, type ReadEvent } from "../sync.mts";

export type TargetxFlavour = "legacy" | "erx" | "lightning";

export interface TargetxConfig {
  /** The path (and, for ERx, the query) after the host: "events", "visit", "EventListing?eventfilter=UAA". */
  site: string;
  flavour: TargetxFlavour;
}

/** The slice of `PoliteHttp` this reader needs: `get`, and a paced `post` with a body and extra headers. */
export interface TargetxHttp extends ReaderHttp {
  post(url: string, body: string, headers: Record<string, string>): Promise<Response | null>;
}

/* ------------------------------------------------------------------ */
/* The remoting descriptor and the two calls                           */
/* ------------------------------------------------------------------ */

/** The only two remoting methods this reader ever calls. */
export const REMOTING_METHODS = ["initialize", "getFutureEvents"] as const;
export type RemotingMethodName = (typeof REMOTING_METHODS)[number];

export interface RemotingMethod {
  csrf: string;
  authorization: string;
  ns: string;
  ver: number;
}

export interface RemotingDescriptor {
  vid: string;
  /** The remoting endpoint's path on the site's host ("events/apexremote"). */
  service: string;
  /** The controller ("TargetX_Eventsb.eventsRemote"). */
  action: string;
  methods: Record<RemotingMethodName, RemotingMethod>;
}

/** The object literal starting at `start` (a `{`), by brace depth outside strings; null when it never closes. */
export function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * The page's TargetX events remoting descriptor: the `vid`, the service path, the controller, and the tokens for
 * `initialize` and `getFutureEvents`; null when the page has none (a collapse for a legacy site).
 */
export function parseRemotingDescriptor(html: string): RemotingDescriptor | null {
  for (const m of html.matchAll(/RemotingProviderImpl\(\s*\{/g)) {
    const raw = balancedObject(html, (m.index ?? 0) + m[0].length - 1);
    if (!raw) continue;
    let parsed: { vf?: { vid?: unknown }; actions?: Record<string, { ms?: unknown[] }>; service?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const vid = parsed.vf?.vid;
    if (typeof vid !== "string" || typeof parsed.service !== "string") continue;
    for (const [action, a] of Object.entries(parsed.actions ?? {})) {
      const methods: Partial<Record<RemotingMethodName, RemotingMethod>> = {};
      for (const ms of a?.ms ?? []) {
        const x = ms as Record<string, unknown>;
        if (!REMOTING_METHODS.includes(x.name as RemotingMethodName)) continue;
        if (typeof x.csrf !== "string" || typeof x.authorization !== "string") continue;
        methods[x.name as RemotingMethodName] = { csrf: x.csrf, authorization: x.authorization, ns: String(x.ns ?? ""), ver: Number(x.ver) };
      }
      if (methods.initialize && methods.getFutureEvents) {
        return { vid, service: parsed.service.replace(/^\/+/, ""), action, methods: methods as Record<RemotingMethodName, RemotingMethod> };
      }
    }
  }
  return null;
}

/** One Visualforce remoting request, as the page's own client builds it. Refuses any method but the two reads. */
export function remotingBody(method: RemotingMethodName, data: unknown[], desc: RemotingDescriptor, tid: number) {
  if (!REMOTING_METHODS.includes(method)) throw new Error(`remoting method ${String(method)} is never called`);
  const m = desc.methods[method];
  return {
    action: desc.action,
    method,
    data,
    type: "rpc",
    tid,
    ctx: { csrf: m.csrf, vid: desc.vid, ns: m.ns, ver: m.ver, authorization: m.authorization },
  };
}

/**
 * Salesforce's reference-compressed JSON undone (VFRemote.js `__resolveRefs`): `{"s": id, "v": value}` registers
 * `value` at `id` and stands for it, `{"r": id}` stands for the value registered at `id`; anything else is walked
 * field by field. Harmless on an uncompressed answer.
 */
export function resolveRefs(json: unknown): unknown {
  const refs = new Map<unknown, unknown>();
  const walk = (v: unknown, into?: unknown[] | Record<string, unknown>): unknown => {
    if (Array.isArray(v)) {
      const out = (into as unknown[]) ?? [];
      for (const x of v) out.push(walk(x));
      return out;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.s !== undefined && "v" in o) {
        const target = Array.isArray(o.v) ? [] : {};
        refs.set(o.s, target);
        return walk(o.v, target);
      }
      if (o.r !== undefined && Object.keys(o).length === 1) return refs.get(o.r);
      const out = (into as Record<string, unknown>) ?? {};
      for (const [k, x] of Object.entries(o)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(json);
}

/* ------------------------------------------------------------------ */
/* Events, both flavours                                               */
/* ------------------------------------------------------------------ */

/** One event as a TargetX site lists it, normalized across the two flavours. */
export interface TargetxEvent {
  /** The Salesforce record id as given. */
  id: string;
  title: string;
  /** The org's own type text ("Campus Tour", "College Fair"); null for ERx (its `Type` is a Campaign label). */
  type: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string | null;
  description: string | null;
  venue: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** ERx's `OnlineGuestEnabled__c`; null when the flavour has no flag (legacy). */
  online: boolean | null;
  availability: VisitAvailability;
  bookUrl: string;
}

type Sobject = Record<string, unknown>;

/** The value of the field whose name ends with `suffix` after a namespace (`TargetX_Base__City__c` for "City__c"). */
export function bySuffix(o: Sobject | null | undefined, suffix: string): unknown {
  if (!o) return undefined;
  for (const [k, v] of Object.entries(o)) if (k === suffix || k.endsWith(`__${suffix}`)) return v;
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const isoOfMs = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString() : null);
/** `zone` when it is an IANA zone name this runtime knows, else null. */
export function ianaZone(zone: string | null | undefined): string | null {
  if (!zone || !/^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}
const zip5 = (v: unknown): string | null => /^(\d{5})(?:-\d{4})?$/.exec(str(v) ?? "")?.[1] ?? null;
const state2 = (v: unknown): string | null => (/^[A-Z]{2}$/.test(str(v) ?? "") ? (str(v) as string) : null);

/** Legacy availability: cancelled is closed; no slots left and no waitlist is full; else open. */
export function legacyAvailability(oe: Sobject): VisitAvailability {
  if (bySuffix(oe, "Cancelled__c") === true) return "closed";
  const slots = bySuffix(oe, "Slots_Available__c");
  if (bySuffix(oe, "unlimited_attendees__c") === true || /^unlimited$/i.test(String(slots ?? ""))) return "open";
  const n = Number(slots);
  if (slots != null && Number.isFinite(n) && n <= 0 && bySuffix(oe, "Waiting_List__c") !== true) return "full";
  return "open";
}

/**
 * The events in a resolved `getFutureEvents` result (`result[i].oe`). `bookBase` is the org's
 * `SingleEventRegistrationURL__c` (else the site page plus `#/esr`); each booking URL is `<bookBase>?eid=<Id>`.
 */
export function parseFutureEvents(resolved: unknown, opts: { bookBase: string; orgZone?: string | null }): TargetxEvent[] {
  if (!Array.isArray(resolved)) return [];
  const out: TargetxEvent[] = [];
  for (const item of resolved) {
    const oe = (item as { oe?: Sobject } | null)?.oe;
    if (!oe || typeof oe !== "object") continue;
    const id = str(oe.Id);
    const title = str(oe.Name);
    const startsAt = isoOfMs(bySuffix(oe, "Start_Date_Time__c"));
    if (!id || !title || !startsAt) continue;
    const loc = bySuffix(oe, "Location_Lookup__r") as Sobject | undefined;
    const venue = str(bySuffix(oe, "Location__c")) ?? str(bySuffix(loc, "Building__c")) ?? str(bySuffix(loc, "Campus__c"));
    const zone = str(bySuffix(oe, "Time_Zone__c"));
    out.push({
      id,
      title,
      type: str(bySuffix(oe, "type__c")),
      startsAt,
      endsAt: isoOfMs(bySuffix(oe, "End_Date_Time__c")),
      timezone: ianaZone(zone) ?? zoneFor(zone) ?? opts.orgZone ?? null,
      description: str(bySuffix(oe, "Description__c")),
      venue,
      street: str(bySuffix(loc, "Street__c")),
      city: str(bySuffix(loc, "City__c")),
      state: state2(bySuffix(loc, "State__c")),
      zip: zip5(bySuffix(loc, "Postal_Code__c")),
      online: null,
      availability: legacyAvailability(oe),
      bookUrl: `${opts.bookBase}?eid=${id}`,
    });
  }
  return out;
}

/** The IANA zone in ERx's display string: "(GMT-06:00) Central Standard Time (America/Chicago)" gives America/Chicago. */
export function erxZone(text: unknown): string | null {
  return ianaZone(/\(([A-Za-z_]+\/[A-Za-z_/+-]+)\)\s*$/.exec(str(text) ?? "")?.[1]);
}

/**
 * An ERx start. `StartDateTime__c` is ISO with "+0000", but every MACU event's own display time
 * (`Event_Time__c`, "09:00AM - 12:00PM") equals that clock reading, and an ACT sitting at 9:00 UTC would be 3 AM in
 * Oklahoma: the org enters wall-clock time and Salesforce labels it UTC. So when the display time's start matches the
 * "UTC" clock, the clock is read as local time in the event's zone; otherwise the instant is taken as given.
 */
export function erxStart(e: Sobject, zone: string | null): string | null {
  const raw = str(bySuffix(e, "StartDateTime__c"));
  const m = raw ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(raw) : null;
  if (!raw || !m || Number.isNaN(Date.parse(raw.replace(/\+0000$/, "Z")))) return null;
  const shown = /^\s*(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(str(bySuffix(e, "Event_Time__c")) ?? "");
  if (shown && zone) {
    const h = (Number(shown[1]) % 12) + (/p/i.test(shown[3]) ? 12 : 0);
    if (h === Number(m[2]) && shown[2] === m[3]) return toInstant(`${m[1]}T${m[2]}:${m[3]}:00`, zone);
  }
  return new Date(Date.parse(raw.replace(/\+0000$/, "Z"))).toISOString();
}

/** ERx availability: inactive is closed; registrations at the cap is full; no cap or room left is open. */
export function erxAvailability(e: Sobject): VisitAvailability {
  if (e.IsActive === false) return "closed";
  const cap = Number(bySuffix(e, "Maximum_Registrations__c") ?? 0);
  const total = Number(bySuffix(e, "Total_Event_Registrations__c") ?? 0);
  if (!Number.isFinite(cap) || cap <= 0) return "open";
  return total < cap ? "open" : "full";
}

/**
 * One JavaScript string-literal layer undone: `\"`, `\'`, `\\` become the character; JSON's own escapes (`\n`, `\t`,
 * `\r`, `\u`, `\/`, `\b`, `\f`) are kept for `JSON.parse`; any other backslash (stray escaping from double-encoded
 * rich text) is dropped.
 */
export function unescapeJsLiteral(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\" || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === '"' || n === "'" || n === "\\") out += n;
    else if ("ntrubf/".includes(n)) out += `\\${n}`;
    else out += n;
  }
  return out;
}

/** The raw `var a = '[…]'` literal on an ERx page, or null. */
export function erxLiteral(html: string): string | null {
  return /var\s+a\s*=\s*'(\[[\s\S]*?\])';/.exec(html)?.[1] ?? null;
}

/**
 * The Campaign records in an ERx literal: the whole array when it parses; otherwise split at each top-level record
 * (`},{"attributes":{"type":"<the first record's type>"`) and parsed one by one, a record that won't parse skipped
 * and counted.
 */
export function erxRecords(literal: string): { records: Sobject[]; errors: string[] } {
  const json = unescapeJsLiteral(literal);
  try {
    const all = JSON.parse(json);
    if (Array.isArray(all)) return { records: all.filter((x) => x && typeof x === "object"), errors: [] };
  } catch {
    /* one bad record: split below */
  }
  const type = /^\[\s*\{\s*"attributes"\s*:\s*\{\s*"type"\s*:\s*"([^"]+)"/.exec(json)?.[1] ?? "Campaign";
  const boundary = new RegExp(`\\}\\s*,\\s*(?=\\{\\s*"attributes"\\s*:\\s*\\{\\s*"type"\\s*:\\s*"${type.replace(/[^\w]/g, "")}")`, "g");
  const body = json.replace(/^\s*\[/, "").replace(/\]\s*$/, "");
  const pieces = body.split(boundary).map((p, i, a) => (i < a.length - 1 ? `${p}}` : p));
  const records: Sobject[] = [];
  const errors: string[] = [];
  for (const p of pieces) {
    try {
      records.push(JSON.parse(p));
    } catch (err) {
      const id = /"Id"\s*:\s*"([A-Za-z0-9]{15,18})"/.exec(p)?.[1] ?? "?";
      errors.push(`ERx event ${id} skipped: ${(err as Error).message}`);
    }
  }
  return { records, errors };
}

/** The events on an ERx listing page; null when the page has no `var a = '[…]'` literal (a collapse). */
export function parseErxListing(html: string): { events: TargetxEvent[]; errors: string[] } | null {
  const literal = erxLiteral(html);
  if (literal == null) return null;
  const { records, errors } = erxRecords(literal);
  const events: TargetxEvent[] = [];
  for (const e of records) {
    try {
      const id = str(e.Id);
      const title = str(e.Name);
      const zone = erxZone(bySuffix(e, "Campaign_Time_Zone__c"));
      const startsAt = erxStart(e, zone);
      const bookUrl = str(bySuffix(e, "Event_URL__c"));
      if (!id || !title || !startsAt || !bookUrl) {
        errors.push(`ERx event ${id ?? "?"} skipped: no ${!id ? "Id" : !title ? "Name" : !startsAt ? "start" : "Event_URL__c"}`);
        continue;
      }
      const desc = str(bySuffix(e, "Event_Description__c"));
      events.push({
        id,
        title: decodeEntities(title),
        type: null,
        startsAt,
        endsAt: null,
        timezone: zone,
        description: desc ? htmlToText(desc) || null : null,
        venue: str(bySuffix(e, "Location__c")),
        street: null,
        city: null,
        state: null,
        zip: null,
        online: bySuffix(e, "OnlineGuestEnabled__c") === true,
        availability: erxAvailability(e),
        bookUrl,
      });
    } catch (err) {
      errors.push(`ERx event ${str(e.Id) ?? "?"} skipped: ${(err as Error).message}`);
    }
  }
  return { events, errors };
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export interface TargetxRowContext {
  host: string;
  unitId: string;
  sourceUrl: string;
  zips: ZipTable;
  /** The campus city, lower-cased. */
  campusCity: string | null;
  campusLat: number | null;
  campusLng: number | null;
}

/**
 * An event's kind: the title alone first (a staff title stays staff), then, when the org gave a type, the title with
 * the type ("On-Campus Visit" typed "Campus Tour" is a tour; "Charlotte-Mecklenburg Schools CACRAO" typed
 * "College Fair" is travel). The place is "City, ST" only when the city is known (venue text is not a city).
 */
export function targetxKind(e: Pick<TargetxEvent, "title" | "type" | "city" | "state" | "online">, campusCity: string | null) {
  const place = e.city ? [e.city, e.state].filter(Boolean).join(", ") : "";
  const online = e.online === true;
  const byTitle = kindOf({ title: e.title, online, place, campusCity });
  if (byTitle === "staff" || !e.type) return byTitle;
  return kindOf({ title: `${e.title} (${e.type})`, online, place, campusCity });
}

/** Tonight's rows for a TargetX site's events. Pure. */
export function targetxRows(events: readonly TargetxEvent[], flavour: Exclude<TargetxFlavour, "lightning">, ctx: TargetxRowContext): ReadEvent[] {
  const rows: ReadEvent[] = [];
  for (const e of events) {
    const kind = targetxKind(e, ctx.campusCity);
    const online = kind === "online" || e.online === true;
    const away = kind === "travel" || (!!e.city && (!ctx.campusCity || e.city.toLowerCase() !== ctx.campusCity));
    let where: { lat: number | null; lng: number | null } = { lat: null, lng: null };
    if (!online) {
      const byZip = locate(ctx.zips, { zip: e.zip, online: false });
      if (byZip.by) where = byZip;
      else if (!away && ctx.campusLat != null && ctx.campusLng != null) where = { lat: ctx.campusLat, lng: ctx.campusLng };
    }
    const slateId = e.id.toLowerCase();
    rows.push({
      id: visitEventId(ctx.host, slateId),
      unit_id: ctx.unitId,
      host: ctx.host,
      slate_id: slateId,
      title: e.title.slice(0, 300),
      kind,
      starts_at: e.startsAt,
      ends_at: flavour === "erx" ? null : e.endsAt,
      timezone: e.timezone,
      all_day: false,
      online,
      venue: e.venue?.slice(0, 300) ?? null,
      address: e.street?.slice(0, 300) ?? null,
      city: e.city,
      state: e.state,
      zip: e.zip,
      lat: where.lat,
      lng: where.lng,
      availability: e.availability,
      book_url: e.bookUrl,
      source_url: ctx.sourceUrl,
      description: e.description?.slice(0, 4000) ?? null,
      date_confirmed: true,
      pageRead: true,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Reading a site                                                      */
/* ------------------------------------------------------------------ */

/** A host row's TargetX config, checked. */
export function targetxConfig(hostRow: Pick<SlateHostRow, "host" | "config">): TargetxConfig {
  const c = (hostRow.config ?? {}) as Partial<TargetxConfig>;
  if (typeof c.site !== "string" || !c.site || !["legacy", "erx", "lightning"].includes(String(c.flavour))) {
    throw new Error(`${hostRow.host}: TargetX config needs { site, flavour }, got ${JSON.stringify(hostRow.config)}`);
  }
  return { site: c.site.replace(/^\/+/, ""), flavour: c.flavour as TargetxFlavour };
}

function hasPost(http: ReaderHttp): http is TargetxHttp {
  return typeof (http as Partial<TargetxHttp>).post === "function";
}

async function pageText(http: ReaderHttp, url: string): Promise<string> {
  const res = await http.get(url);
  if (!res) throw new Error(`robots.txt disallows ${url}, or the host didn't answer it`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

interface Envelope {
  statusCode?: number;
  type?: string;
  tid?: number;
  method?: string;
  ref?: boolean;
  result?: unknown;
  message?: string;
}

/** POSTs one remoting call and returns its envelope; a refusal (402, an exception) is an error, not a collapse. */
async function remote(http: TargetxHttp, url: string, origin: string, body: object, method: RemotingMethodName): Promise<Envelope> {
  const res = await http.post(url, JSON.stringify(body), {
    "Content-Type": "application/json",
    Referer: origin,
    Origin: origin,
    "X-User-Agent": "Visualforce-Remoting",
  });
  if (!res) throw new Error(`robots.txt disallows ${url}, or the host didn't answer it`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method} at ${url}`);
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CollapsedSearchError(`${url}: ${method} answered something that isn't JSON (collapsed: protocol changed?)`);
  }
  const env = (Array.isArray(parsed) ? parsed.find((e) => (e as Envelope)?.method === method) ?? parsed[0] : parsed) as Envelope | undefined;
  if (!env || typeof env !== "object") throw new CollapsedSearchError(`${url}: ${method} answered no envelope (collapsed: protocol changed?)`);
  if ((env.statusCode != null && env.statusCode !== 200) || env.type === "exception") {
    throw new Error(`${method} refused (${env.statusCode ?? env.type}): ${String(env.message ?? "").slice(0, 200)}`);
  }
  return env;
}

/** The org settings `initialize` returns (`cs` is a JSON string of the settings record). */
export function orgSettings(result: unknown): { useLocationLookup: boolean; bookBase: string | null; zone: string | null } {
  let cs = (result as { cs?: unknown } | null)?.cs;
  if (typeof cs === "string") {
    try {
      cs = JSON.parse(cs);
    } catch {
      cs = null;
    }
  }
  const o = (cs && typeof cs === "object" ? cs : {}) as Sobject;
  return {
    useLocationLookup: bySuffix(o, "Use_Location_Lookup__c") === true,
    bookBase: str(bySuffix(o, "SingleEventRegistrationURL__c")),
    zone: str(bySuffix(o, "Org_Time_Zone__c")),
  };
}

/**
 * Reads one TargetX site (both flavours): tonight's rows, `date_confirmed` true, no detail pages, `searchTotal` the row
 * count. Throws `CollapsedSearchError` when a legacy page has no descriptor, `getFutureEvents` answers without a
 * `result` array, or an ERx page has no literal; a plain error for anything else (robots, HTTP, a refused call, a
 * Lightning site).
 */
export async function readTargetxSite(hostRow: Pick<SlateHostRow, "unit_id" | "host" | "config">, deps: ReadDeps): Promise<HostRead> {
  const { host, unit_id: unitId } = hostRow;
  const cfg = targetxConfig(hostRow);
  if (cfg.flavour === "lightning") throw new Error(`${host}/${cfg.site}: a TargetX Lightning site is not readable`);
  const origin = `https://${host}`;
  const siteUrl = `${origin}/${cfg.site}`;
  const ctx: TargetxRowContext = {
    host,
    unitId,
    sourceUrl: siteUrl,
    zips: deps.zips,
    campusCity: deps.campusCity,
    campusLat: deps.campusLat,
    campusLng: deps.campusLng,
  };
  const log = deps.log ?? (() => {});

  if (cfg.flavour === "erx") {
    const html = await pageText(deps.http, siteUrl);
    const listing = parseErxListing(html);
    if (!listing) throw new CollapsedSearchError(`${siteUrl}: no "var a = '[" event literal on the ERx listing (collapsed: markup changed?)`);
    const rows = targetxRows(listing.events, "erx", ctx);
    log(`  ${host}: ${rows.length} ERx events${listing.errors.length ? `, ${listing.errors.length} skipped` : ""}`);
    return { rows, fetched: 1, pagesRead: 0, widgetFailed: false, searchTotal: rows.length, errors: listing.errors };
  }

  if (!hasPost(deps.http)) throw new Error("the TargetX reader needs an http client with post()");
  // The page and its tokens, fetched in this read: tokens are minted per page load and never reused.
  const html = await pageText(deps.http, siteUrl);
  const desc = parseRemotingDescriptor(html);
  if (!desc) throw new CollapsedSearchError(`${siteUrl}: no TargetX events remoting descriptor on the page (collapsed: markup changed?)`);
  const endpoint = `${origin}/${desc.service}`;
  const init = await remote(deps.http, endpoint, origin, remotingBody("initialize", [{}], desc, 1), "initialize");
  const settings = orgSettings(init.ref ? resolveRefs(init.result) : init.result);
  const env = await remote(deps.http, endpoint, origin, remotingBody("getFutureEvents", [{}, settings.useLocationLookup, "", []], desc, 2), "getFutureEvents");
  const result = env.ref ? resolveRefs(env.result) : env.result;
  if (!Array.isArray(result)) throw new CollapsedSearchError(`${endpoint}: getFutureEvents answered with no result array (collapsed: protocol changed?)`);
  const events = parseFutureEvents(result, { bookBase: settings.bookBase ?? `${siteUrl}#/esr`, orgZone: ianaZone(settings.zone) });
  const rows = targetxRows(events, "legacy", ctx);
  const errors = result.length > events.length ? [`${result.length - events.length} listed event(s) had no id, name, or start`] : [];
  log(`  ${host}: ${rows.length} TargetX events${env.ref ? " (reference-compressed answer)" : ""}`);
  return { rows, fetched: 3, pagesRead: 0, widgetFailed: false, searchTotal: rows.length, errors };
}
