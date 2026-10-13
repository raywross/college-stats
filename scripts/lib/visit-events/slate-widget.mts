/**
 * Slate portal event widgets (specs/product/visit-events.md, "How Slate publishes"). A portal page (`/portal/<name>`)
 * embeds its calendar as `<div … data-service="/portal/widget/event?portal_id=…&part=…">`; `<service>&cmd=event_list`
 * (and `&page=N`) returns items:
 *   <div class="item" data-online="0|1"><div class="calendar_legend available|unavailable"></div>
 *   <div class="event" data-date="2026-10-14T12:00:00" data-location="…">… <a href="/register/?id=<guid>">Title</a> …
 * The inner markup is each college's own template (UF's campus-tour widget prints a table with "23 spots available"
 * and no legend, and a date with no time), so only the attributes and the legend are read. The widget is the only
 * source of online events, and of open/full where the college shows the legend. Pure: the sync fetches.
 */
import { decodeEntities } from "../college-reported/documents.mts";
import { cleanText } from "./slate-search.mts";
import type { VisitAvailability } from "../../../lib/visit-events/types.ts";

/** Every event widget service a portal page embeds ("/portal/widget/event?portal_id=…&part=…"), entities decoded, once each. */
export function findWidgetServices(portalHtml: string): string[] {
  const out: string[] = [];
  for (const m of portalHtml.matchAll(/data-service="(\/portal\/widget\/event\?[^"]+)"/gi)) {
    const service = decodeEntities(m[1]);
    if (!out.includes(service)) out.push(service);
  }
  return out;
}

export interface WidgetRow {
  slateId: string;
  /** The link's text; a template's button text ("Sign Up For a Tour") when it has no title, so other sources win. */
  title: string;
  /** "2026-10-14T12:00:00", or "2026-10-21" when the template gives the day alone; local time, no zone. */
  whenIso: string;
  online: boolean;
  /** "Online" for an online item, else the widget's data-location ("welcome center"), or "". */
  place: string;
  /** From the legend: available → open, unavailable → full; null when the template shows none. */
  availability: VisitAvailability | null;
  bookUrl: string;
}

/** The items of one `event_list` answer, one per event id, in page order. */
export function parseWidgetList(html: string, host: string): WidgetRow[] {
  const rows: WidgetRow[] = [];
  const seen = new Set<string>();
  const parts = html.split(/<div class="item"/i).slice(1);
  for (const raw of parts) {
    const frag = `<div class="item"${raw}`;
    const online = /^<div class="item"[^>]*data-online="1"/i.test(frag);
    const date = /data-date="([^"]*)"/i.exec(frag)?.[1] ?? "";
    const location = decodeEntities(/data-location="([^"]*)"/i.exec(frag)?.[1] ?? "").trim();
    const link = /<a[^>]+href="[^"]*\/register\/\?id=([0-9a-fA-F-]{36})[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(frag);
    if (!link || !/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    const slateId = link[1].toLowerCase();
    if (seen.has(slateId)) continue;
    seen.add(slateId);
    const legend = /class="calendar_legend\s+(available|unavailable)"/i.exec(frag)?.[1]?.toLowerCase();
    rows.push({
      slateId,
      title: cleanText(link[2]),
      whenIso: date,
      online,
      place: online ? "Online" : location.replace(/\b\w/g, (c) => c.toUpperCase()),
      availability: legend === "available" ? "open" : legend === "unavailable" ? "full" : null,
      bookUrl: `https://${host}/register/?id=${slateId}`,
    });
  }
  return rows;
}

/** The `event_list` URL for a widget service, page 1 without a page parameter. */
export function widgetListUrl(host: string, service: string, page = 1): string {
  return `https://${host}${service}&cmd=event_list${page > 1 ? `&page=${page}` : ""}`;
}

/** Pages read per widget at most (the brief: stop when a page repeats or is empty, never more than five). */
export const MAX_WIDGET_PAGES = 5;
