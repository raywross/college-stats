/**
 * A Slate event page, `GET https://<host>/register/?id=<guid>` (specs/product/visit-events.md, "How Slate publishes"):
 * the title (`<h1>`), the date line (`#register_date_string`, "Wednesday, October 28, 2026 at 6:30 PM until 7:30 PM",
 * then the zone "Eastern Daylight Time UTC -04:00"), the place (`#register_location`: venue, street, "City, ST 12345",
 * "United States"), the description (`#form_description`), and, when closed, "Registration is no longer available
 * because the registration deadline has passed." The page's static map is centred on the venue, so its coordinates
 * are kept as a fallback for a place with no ZIP. The source of truth for a new event's year, zone, and venue. Pure.
 */
import { parseEventPageWhen } from "../../../lib/visit-events/dates.ts";
import { cleanText } from "./slate-search.mts";

export interface EventPage {
  title: string | null;
  /** Local start, "2026-10-28T18:30:00". */
  start: string | null;
  end: string | null;
  zone: string | null;
  /** The page's offset at the start, "-04:00". */
  offset: string | null;
  allDay: boolean;
  venue: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** The static map's centre (Slate geocodes the venue), when the page has one. */
  mapLat: number | null;
  mapLng: number | null;
  closed: boolean;
  description: string | null;
}

/** The inner HTML of the first element with `id`, for the simple, non-nested blocks Slate prints (p, span, div). */
function byId(html: string, id: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return m ? m[1] : null;
}

/** "Gainesville, FL 32611" (or "…, FL 32611-1234", or "…, FL" alone). */
const CITY_LINE = /^(.+?),\s*([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/;

/** The address block's lines: venue, street, city line; the country line dropped. */
function parseLocation(lines: string[]): Pick<EventPage, "venue" | "address" | "city" | "state" | "zip"> {
  const kept = lines.filter((l) => !/^(United States|USA|US)$/i.test(l));
  const at = kept.findIndex((l) => CITY_LINE.test(l));
  if (at < 0) return { venue: kept[0] ?? null, address: kept.slice(1).join(", ") || null, city: null, state: null, zip: null };
  const m = CITY_LINE.exec(kept[at])!;
  const before = kept.slice(0, at);
  let venue: string | null = null;
  let address: string | null = null;
  if (before.length === 1) {
    if (/^\d/.test(before[0])) address = before[0];
    else venue = before[0];
  } else if (before.length > 1) {
    venue = before[0];
    address = before.slice(1).join(", ");
  }
  return { venue, address, city: m[1].trim(), state: m[2], zip: m[3] ?? null };
}

/** The map centre from Slate's static map URL (`center%3d29.646%252c-82.348`, encoded twice). */
function mapCentre(html: string): { lat: number; lng: number } | null {
  const m = /center%3d(-?\d+(?:\.\d+)?)%252c(-?\d+(?:\.\d+)?)/i.exec(html) ?? /center=(-?\d+(?:\.\d+)?)(?:%2c|,)(-?\d+(?:\.\d+)?)/i.exec(html);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export function parseEventPage(html: string): EventPage {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const content = body.slice(Math.max(0, body.indexOf('id="content"')));
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(content);
  const dateBlock = byId(content, "register_date", "p");
  // The date line and the zone are two spans in #register_date; without it, look for a full date in the page's text.
  const dateText = dateBlock ? cleanText(dateBlock) : cleanText(content).slice(0, 2000);
  const when = parseEventPageWhen(dateText);
  const locationHtml = byId(content, "register_location", "p");
  const location = locationHtml
    ? parseLocation(
        locationHtml
          .split(/<br\s*\/?>/i)
          .map(cleanText)
          .filter(Boolean),
      )
    : { venue: null, address: null, city: null, state: null, zip: null };
  const descHtml = /<div[^>]*\bid="form_description"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*\bid="form_start"/i.exec(content)?.[1] ?? byId(content, "form_description", "div");
  // Inline tags join their words ("<b>seniors</b>."); block tags and line breaks separate them.
  const description = descHtml ? cleanText(descHtml.replace(/<\/?(?:b|i|em|strong|span|a|u|font)\b[^>]*>/gi, "")).slice(0, 4000) || null : null;
  const centre = locationHtml ? mapCentre(content) : null;
  return {
    title: h1 ? cleanText(h1[1]).slice(0, 300) || null : null,
    start: when?.start ?? null,
    end: when?.end ?? null,
    zone: when?.zone ?? null,
    offset: when?.offset ?? null,
    allDay: when?.allDay ?? false,
    ...location,
    mapLat: centre?.lat ?? null,
    mapLng: centre?.lng ?? null,
    closed: /registration is no longer available|registration (?:for this event )?(?:is|has) closed|registration deadline has passed/i.test(cleanText(content)),
    description,
  };
}
