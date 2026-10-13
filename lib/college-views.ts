/**
 * College views (specs/product/college-views.md): the rules for recording one, shared by the browser beacon
 * (components/profile/ViewBeacon.tsx) and the route that writes it (app/api/college-view/route.ts). Pure.
 */
import type { TopicKey } from "@/lib/profile-topics";

/** The profile pages a view is recorded for: the overview and each topic page. */
export type ViewPage = "overview" | TopicKey;

export const VIEW_PAGES: readonly ViewPage[] = ["overview", "admissions", "students", "academics", "cost", "outcomes", "history"];

/** The same page of the same college opened again in one browser tab within this long isn't sent again. */
export const VIEW_REPEAT_MS = 10 * 60 * 1000;

/** A view request's body, or null when it isn't one: a six-digit unit id and a known page. */
export function parseViewBody(body: unknown): { unit: string; page: ViewPage } | null {
  if (!body || typeof body !== "object") return null;
  const { unit, page } = body as { unit?: unknown; page?: unknown };
  if (typeof unit !== "string" || !/^[0-9]{6}$/.test(unit)) return null;
  const p = page ?? "overview";
  if (typeof p !== "string" || !(VIEW_PAGES as readonly string[]).includes(p)) return null;
  return { unit, page: p as ViewPage };
}

/** Crawlers and link previewers (they rarely run the beacon, but some do). */
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|monitor/i;

/**
 * Whether the server should record this request: not when the browser sent a privacy signal (Sec-GPC or DNT, as the
 * privacy page promises: "we send nothing at all"), and not for an obvious bot.
 */
export function shouldRecordView(headers: { get(name: string): string | null }): boolean {
  if (headers.get("sec-gpc") === "1" || headers.get("dnt") === "1") return false;
  const ua = headers.get("user-agent") ?? "";
  return ua !== "" && !BOT.test(ua);
}

/** A view's page in words, as the profile's own tabs name it ("Getting in" for admissions). */
export function viewPageLabel(page: string, topicLabel: (key: TopicKey) => string | undefined): string {
  if (page === "overview") return "Overview";
  return (VIEW_PAGES as readonly string[]).includes(page) ? (topicLabel(page as TopicKey) ?? page) : page;
}
