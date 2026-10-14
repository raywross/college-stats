/**
 * The nightly visit alert (specs/product/visit-events.md, "Alerting"): one email per person, grouped by college, each
 * event one line ("Mon 19 Oct · 11:40 am · Decatur High School, Decatur, GA · 14 miles") with Sign up and Add to
 * calendar, then a footer with the farther-away counts, the radius, a per-college stop link, and one-click
 * unsubscribe. Pure string templates like lib/digest.ts: the HTML and the plain text render from one list of blocks,
 * so they can't drift apart. app/api/cron/visit-alerts/route.ts sends it; tests/visit-alert-email.test.mts reads it.
 *
 * Links back to the site carry utm_source=visit-alert (no pixels, no click tracking); a college's sign-up link is its
 * own page, untouched.
 */
import { SITE_NAME } from "../brand.ts";
import type { AlertEvent, AlertPlan } from "../visit-events/alerts.ts";
import type { VisitEventRow } from "../visit-events/types.ts";

export interface VisitAlertCollegeInfo {
  /** "University of Florida". */
  name: string;
  /** "Florida" (lib/brand.ts shortName): the subject and the footer lines. */
  short: string;
}

export interface VisitAlertInput {
  plan: AlertPlan;
  colleges: ReadonlyMap<string, VisitAlertCollegeInfo>;
  /** Origin, no trailing slash. */
  siteUrl: string;
}

export interface BuiltVisitAlert {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  unsubscribeHref: string;
  collegeCount: number;
  eventCount: number;
}

/** Shown when an event's zone isn't known yet (the event page not read): the zone most Slate hosts publish in. */
const FALLBACK_ZONE = "America/New_York";

function utm(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}utm_source=visit-alert`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function parts(iso: string, zone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: zone });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: FALLBACK_ZONE });
  }
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** "Mon 19 Oct · 11:40 am", or "Mon 19 Oct · all day", in the event's own zone. */
export function eventWhen(event: Pick<VisitEventRow, "starts_at" | "timezone" | "all_day">): string {
  const zone = event.timezone ?? FALLBACK_ZONE;
  const d = parts(event.starts_at, zone, { weekday: "short", day: "numeric", month: "short" });
  const day = `${d.weekday} ${d.day} ${d.month}`;
  if (event.all_day) return `${day} · all day`;
  const t = parts(event.starts_at, zone, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${day} · ${t.hour}:${t.minute} ${(t.dayPeriod ?? "").toLowerCase()}`;
}

/** "Oct 19" (the subject). */
export function eventDay(event: Pick<VisitEventRow, "starts_at" | "timezone">): string {
  const d = parts(event.starts_at, event.timezone ?? FALLBACK_ZONE, { day: "numeric", month: "short" });
  return `${d.month} ${d.day}`;
}

/** "14 miles", "1 mile", "under 1 mile". */
export function milesText(miles: number): string {
  const n = Math.round(miles);
  if (n < 1) return "under 1 mile";
  return `${n.toLocaleString("en-US")} mile${n === 1 ? "" : "s"}`;
}

/** "Decatur High School, Decatur, GA"; a non-visit event leads with its title ("Campus tour at Visitor Center, …"). */
function placeText(event: VisitEventRow): string {
  if (event.online || event.kind === "online") return `${event.title} · Online`;
  const town = [event.city, event.state].filter(Boolean).join(", ");
  const where = event.kind === "travel" ? (event.venue ?? event.title) : event.venue ? `${event.title} at ${event.venue}` : event.title;
  return town ? `${where}, ${town}` : where;
}

/** One event line, as the text body shows it and the HTML wraps it. */
export function eventLine(e: AlertEvent): string {
  const bits = [eventWhen(e.event), placeText(e.event)];
  if (e.miles != null) bits.push(milesText(e.miles));
  if (e.event.availability === "full") bits.push("full");
  if (e.event.availability === "closed") bits.push("registration closed");
  const line = bits.join(" · ");
  return e.change === "moved" ? `Moved to ${line}` : line;
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function subjectFor(plan: AlertPlan, info: (unitId: string) => VisitAlertCollegeInfo): string {
  const shown = plan.colleges;
  if (shown.length > 1) {
    const n = plan.eventCount;
    return `${joinNames(shown.map((c) => info(c.unitId).short))}: ${n} new visit${n === 1 ? "" : "s"} near you`;
  }
  const college = shown[0];
  const nearest = college.events[0];
  const short = info(college.unitId).short;
  const day = eventDay(nearest.event);
  const ev = nearest.event;
  const what =
    ev.kind === "travel" && ev.venue
      ? nearest.change === "moved"
        ? `${short} moved its visit to ${ev.venue} to ${day}`
        : `${short} is visiting ${ev.venue} on ${day}`
      : `${short}: ${ev.title} on ${day}${nearest.change === "moved" ? " (moved)" : ""}`;
  const others = plan.eventCount - 1;
  return others > 0 ? `${what}, and ${others} more near you` : what;
}

type Inline = string | { text: string; href: string };
type Block =
  | { kind: "p"; parts: Inline[]; muted?: boolean }
  | { kind: "college"; name: string; href: string }
  | { kind: "event"; line: string; links: { text: string; href: string }[] }
  | { kind: "rule" };

const COLORS = { text: "#1c1f26", muted: "#6b7280", border: "#e4e4e7", bg: "#ffffff", card: "#fafafa", link: "#5b4bda" };

function inlineHtml(parts: Inline[]): string {
  return parts
    .map((p) => (typeof p === "string" ? escapeHtml(p) : `<a href="${escapeHtml(p.href)}" style="color:${COLORS.link};">${escapeHtml(p.text)}</a>`))
    .join("");
}

function inlineText(parts: Inline[]): string {
  return parts.map((p) => (typeof p === "string" ? p : `${p.text}: ${p.href}`)).join("");
}

function renderHtml(blocks: Block[]): string {
  const body = blocks
    .map((b) => {
      switch (b.kind) {
        case "college":
          return `<p style="margin:20px 0 8px;"><a href="${escapeHtml(b.href)}" style="color:${COLORS.text};font-weight:700;font-size:16px;text-decoration:none;">${escapeHtml(b.name)}</a></p>`;
        case "event":
          return `<div style="border:1px solid ${COLORS.border};border-radius:12px;padding:10px 14px;margin:0 0 8px;background:${COLORS.card};">
        <div>${escapeHtml(b.line)}</div>
        <div style="margin-top:4px;font-size:13px;">${b.links
          .map((l, i) => `<a href="${escapeHtml(l.href)}" style="color:${COLORS.link};${i === 0 ? "font-weight:700;" : ""}">${escapeHtml(l.text)}</a>`)
          .join(" · ")}</div>
      </div>`;
        case "rule":
          return `<hr style="border:none;border-top:1px solid ${COLORS.border};margin:20px 0 16px;" />`;
        case "p":
          return `<p style="margin:0 0 8px;${b.muted ? `color:${COLORS.muted};font-size:12px;` : ""}">${inlineHtml(b.parts)}</p>`;
      }
    })
    .join("\n      ");
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${COLORS.bg};">
    <div style="font-family:Arial,Helvetica,sans-serif;color:${COLORS.text};font-size:14px;line-height:1.55;max-width:600px;margin:0 auto;padding:24px 20px;">
      ${body}
    </div>
  </body>
</html>`;
}

function renderText(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "college":
        if (lines.length) lines.push("");
        lines.push(b.name, b.href);
        break;
      case "event":
        lines.push(`- ${b.line}`, ...b.links.map((l) => `  ${l.text}: ${l.href}`));
        break;
      case "rule":
        lines.push("", "--");
        break;
      case "p":
        lines.push(inlineText(b.parts));
        break;
    }
  }
  return lines.join("\n");
}

export function buildVisitAlert({ plan, colleges, siteUrl }: VisitAlertInput): BuiltVisitAlert {
  const info = (unitId: string): VisitAlertCollegeInfo => colleges.get(unitId) ?? { name: unitId, short: unitId };
  const unsubscribeHref = `${siteUrl}/unsubscribe/${plan.unsubscribeToken}/visits`;
  const visitsHref = (unitId?: string) => utm(`${siteUrl}/me/visits${unitId ? `?unit=${unitId}` : ""}`);

  const blocks: Block[] = [{ kind: "p", parts: [`New events near you at colleges on your list.`] }];
  for (const c of plan.colleges) {
    blocks.push({ kind: "college", name: info(c.unitId).name, href: utm(`${siteUrl}/schools/${c.unitId}`) });
    for (const e of c.events) {
      blocks.push({
        kind: "event",
        line: eventLine(e),
        links: [
          { text: "Sign up", href: e.event.book_url },
          { text: "Add to calendar", href: visitsHref(c.unitId) },
        ],
      });
    }
    if (c.more > 0) blocks.push({ kind: "p", parts: [`and ${c.more} more on your `, { text: "visits page", href: visitsHref(c.unitId) }] });
  }

  blocks.push({ kind: "rule" });
  for (const c of plan.colleges) {
    if (c.farther > 0) {
      blocks.push({
        kind: "p",
        muted: true,
        parts: [`${info(c.unitId).short} also added ${c.farther} event${c.farther === 1 ? "" : "s"} farther away; `, { text: "see them", href: visitsHref(c.unitId) }],
      });
    }
  }
  blocks.push({
    kind: "p",
    muted: true,
    parts: [`Within ${plan.radiusMiles} miles of ${plan.pointLabels.join(" or ")} · `, { text: "change", href: `${utm(`${siteUrl}/me`)}#visit-alerts` }],
  });
  for (const c of plan.colleges) {
    blocks.push({ kind: "p", muted: true, parts: [{ text: `Stop alerts for ${info(c.unitId).short}`, href: `${siteUrl}/unsubscribe/${plan.unsubscribeToken}/visits/${c.unitId}` }] });
  }
  blocks.push({
    kind: "p",
    muted: true,
    parts: [`You get this because visit alerts are on for your ${SITE_NAME} account. `, { text: "Unsubscribe from visit alerts", href: unsubscribeHref }],
  });

  return {
    subject: subjectFor(plan, info),
    html: renderHtml(blocks),
    text: renderText(blocks),
    headers: { "List-Unsubscribe": `<${unsubscribeHref}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    unsubscribeHref,
    collegeCount: plan.colleges.length,
    eventCount: plan.eventCount,
  };
}
