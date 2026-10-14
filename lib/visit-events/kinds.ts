/**
 * Which kind of event a Slate title describes (specs/product/visit-events.md, "Model"). Pure, shared by the reader
 * (which stores the kind) and the pages (which label it). The rules are ordered: staff rows first, since a college leaves
 * logistics public ("CO (Denver) - Hotel Shipping", "Requested Group / Filled"); then online; then open houses; then
 * tours (checked before travel, so "Pratt School of Engineering Campus Tour" is a tour, not a visit to a school); then
 * the travel calendar (high schools, fairs, the ACACs, named evenings in a city); then sessions. Anything left that
 * happens away from the campus city is travel too (a school's name alone, like "Homewood-Flossmoor"), and anything left
 * on campus is `other`. Tuned on UF, Duke, UNC, and UT (1,900 titles, 2026-10-13); tests/visit-events-kinds.test.mts
 * holds the cases.
 */
import type { VisitEventKind } from "./types.ts";
import type { VisitKind } from "../planner/types.ts";

const STAFF =
  /shipping|materials? (for )?(pick[ -]?up|request|drop ?off)|\bpick[ -]?up\b|(visit|hsv|trip|travel|fair) materials\s*\)?\s*$|requested group \/ filled|no activit|request a group tour appointment|travel shipment|placeholder|^test\b|do not use|^hold\b/i;
/**
 * Student-success, advancement, and graduate events a Slate database shares with undergraduate admissions (UNC's
 * scholars lunches and Carolina Covenant, alumni councils, graduate school fairs). Tuned on the 795-host universe of
 * 2026-10-14: "Covenant Classical School" and "Earth Materials" (a course) must stay.
 */
const NOT_ADMISSIONS =
  /alumni|homecoming|scholars (lunch|dinner|@|research)|council meeting|carolina covenant|covenant connections|mentorship|graduate (school|program|admission|student)|friendsgiving|scholarship lunch|reunion/i;
const ONLINE = /virtual|online|zoom|webinar/i;
const OPEN_HOUSE = /open house|preview\b|admitted|explore day|showcase/i;
const TOUR = /\btours?\b/i;
const NOT_A_TOUR = /high school|\bhs\b|fair/i;
const TRAVEL =
  /college night|fair\b|nacac|acac\b|\bhsv\b|high school|\bhs\b|\bhigh\b|academy|schools?\b|prep\b|preparatory|senior meeting|symposium|summit|college & trades|clubs?\b|county|consolidated|isd\b|cisd\b|magnet|kipp|uplift|\bidea\b|discover [a-z]+ - /i;
const SESSION = /session|workshop|chat|informational|interactive|check-in|campus visit|visit\b|drop-in|appointment|recruitment day|becoming a/i;

export interface KindInput {
  title: string;
  /** The widget's data-online flag, when the row came from a portal widget. */
  online?: boolean;
  /** "Gainesville, FL", "Online", a venue name, or "" when unknown. */
  place?: string | null;
  /** The college's campus city, lower-cased ("gainesville"); away-from-campus rows that match nothing become travel. */
  campusCity?: string | null;
}

export function kindOf({ title, online = false, place = "", campusCity = null }: KindInput): VisitEventKind {
  const t = title.trim();
  const p = (place ?? "").trim();
  if (STAFF.test(t) || NOT_ADMISSIONS.test(t)) return "staff";
  if (online || ONLINE.test(t) || /^online$/i.test(p)) return "online";
  if (OPEN_HOUSE.test(t)) return "open_house";
  if (TOUR.test(t) && !NOT_A_TOUR.test(t)) return "tour";
  if (TRAVEL.test(t)) return "travel";
  if (SESSION.test(t)) return "info_session";
  if (campusCity && p && !p.toLowerCase().includes(campusCity)) return "travel";
  return "other";
}

/** Whether an event happens away from the campus: travel always; otherwise when the place names another city. */
export function isAwayFromCampus(kind: VisitEventKind, place: string | null | undefined, campusCity: string | null | undefined): boolean {
  if (kind === "online") return false;
  if (kind === "travel") return true;
  const p = (place ?? "").toLowerCase();
  if (!p || !campusCity) return false;
  return !p.includes(campusCity.toLowerCase());
}

/** The planner's visit-log kind for an event the family registered for (lib/planner/actions.ts VISIT_KINDS). */
export function planVisitKind(kind: VisitEventKind): VisitKind {
  switch (kind) {
    case "tour":
      return "campus_tour";
    case "info_session":
      return "info_session";
    case "open_house":
      return "open_house";
    case "online":
      return "virtual";
    case "travel":
      return "fair";
    default:
      return "other";
  }
}
