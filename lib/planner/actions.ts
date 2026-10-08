/**
 * Stage 3, Actions, pure parts (specs/planner/actions.md): the follow URL per network (a documented one-click
 * intent for X and YouTube, a profile URL plus a phone deep link where one is documented elsewhere), the interest
 * and interview lines from CDS C7, the visit kinds and their labels, the before-you-go questions, the rule for
 * which past visit sets `visited_on`, and whether a visit's notes have actually been written. No server or browser
 * APIs, so tests, the generator, and client components can all import it.
 */
import type { FactorImportance, SocialNetwork } from "../types.ts";
import type { VisitKind, VisitNotes } from "./types.ts";

/* ------------------------------------------------------------------ */
/* Follow                                                              */
/* ------------------------------------------------------------------ */

/**
 * Whether `network` opens a true one-click follow (X's follow Web Intent, YouTube's `sub_confirmation`): the click
 * itself is the record, no "did you follow?" needed. The other four (Instagram, TikTok, Facebook, LinkedIn) open
 * the profile and ask on return (actions.md "What the site can and can't do", 2026-10-07).
 */
export function hasFollowIntent(network: SocialNetwork): boolean {
  return network === "x" || network === "youtube";
}

/**
 * The URL FollowRow opens for a stored handle: X's documented follow Web Intent, YouTube's `sub_confirmation`
 * prompt, else the plain profile URL (the same one `lib/social.ts` `socialUrl` builds — kept here too so this
 * module names every network's follow behavior in one place).
 */
export function followUrl(network: SocialNetwork, handle: string): string {
  const h = encodeURIComponent(handle);
  switch (network) {
    case "x":
      return `https://x.com/intent/follow?screen_name=${h}`;
    case "youtube":
      return `https://www.youtube.com/channel/${h}?sub_confirmation=1`;
    case "instagram":
      return `https://www.instagram.com/${h}`;
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "facebook":
      return `https://www.facebook.com/${h}`;
    case "linkedin":
      return `https://www.linkedin.com/school/${h}`;
  }
}

/**
 * A phone app deep link, only where one is documented: Instagram's `instagram://user?username=`. TikTok's needs a
 * numeric id the site doesn't have; Facebook's follow button was retired in 2018; LinkedIn and X publish none.
 */
export function appDeepLink(network: SocialNetwork, handle: string): string | null {
  if (network === "instagram") return `instagram://user?username=${encodeURIComponent(handle)}`;
  return null;
}

/** Colleges in the order the Actions stage shows them: the Dream first, then list order. */
export function orderForActions<T extends { dream?: boolean; position: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(!a.dream) - Number(!b.dream) || a.position - b.position);
}

export interface ActionsProgress {
  done: number;
  total: number;
}

/** "n of m done" for a college's card: follow (only when it has accounts), request information, and a visit. */
export function actionsProgress(opts: { hasAccounts: boolean; anyFollowed: boolean; infoRequested: boolean; hasVisit: boolean }): ActionsProgress {
  let total = 2;
  let done = (opts.infoRequested ? 1 : 0) + (opts.hasVisit ? 1 : 0);
  if (opts.hasAccounts) {
    total += 1;
    if (opts.anyFollowed) done += 1;
  }
  return { done, total };
}

/* ------------------------------------------------------------------ */
/* Interest and interview (CDS C7)                                     */
/* ------------------------------------------------------------------ */

/**
 * The line at the top of a college's card from C7's "level of applicant's interest" (actions.md "Why these
 * actions, per college"): very important/important get the firm line, considered the softer one, not considered
 * (or unpublished) says the actions are for the student, not the application.
 */
export function interestLine(interest: FactorImportance | null | undefined): string {
  switch (interest) {
    case "very_important":
    case "important":
      return "This college says it considers your interest; visits, information requests, and opening its emails count.";
    case "considered":
      return "This college says your interest can help, though it weighs less than other parts of the application.";
    case "not_considered":
      return "This college says interest isn't considered; do these for yourself, not for the application.";
    default:
      return "This college hasn't published whether it considers interest; do these for yourself either way.";
  }
}

/** Whether the panel should mark its actions optional: not considered, or not published at all. */
export function actionsOptional(interest: FactorImportance | null | undefined): boolean {
  return interest == null || interest === "not_considered";
}

/** The C7 "interview" importance, shown beside the Interview visit kind (actions.md "Interviews"). */
export function interviewImportanceLine(interview: FactorImportance | null | undefined): string {
  switch (interview) {
    case "very_important":
      return "This college says the interview is very important.";
    case "important":
      return "This college says the interview is important.";
    case "considered":
      return "This college says the interview is considered, weighing less than other parts.";
    case "not_considered":
      return "This college says the interview isn't considered.";
    default:
      return "This college hasn't published how much the interview counts.";
  }
}

/* ------------------------------------------------------------------ */
/* Visits                                                               */
/* ------------------------------------------------------------------ */

export const VISIT_KINDS: readonly VisitKind[] = ["campus_tour", "info_session", "open_house", "virtual", "interview", "fair", "overnight", "other"];

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  campus_tour: "Campus tour",
  info_session: "Information session",
  open_house: "Open house",
  virtual: "Virtual tour",
  interview: "Interview",
  fair: "College fair",
  overnight: "Overnight",
  other: "Other",
};

export function isVisitKind(v: unknown): v is VisitKind {
  return typeof v === "string" && (VISIT_KINDS as readonly string[]).includes(v);
}

export interface NotePrompt {
  key: Exclude<keyof VisitNotes, "interviewer" | "interviewer_kind">;
  label: string;
}

/** The notes prompts (actions.md "Visits"), each a short optional field, written once and shown everywhere the visit appears. */
export const VISIT_NOTE_PROMPTS: readonly NotePrompt[] = [
  { key: "stood_out", label: "What stood out" },
  { key: "worried", label: "What worried you" },
  { key: "people", label: "People you met (names and roles, for thank-you notes and essays)" },
  { key: "questions", label: "Questions you still have" },
  { key: "live_here", label: "Would you want to live here?" },
];

/** Whether a visit's notes have anything written (the prompts or the free field) — not just an empty `{}`. */
export function hasVisitNotes(notes: VisitNotes | null | undefined): boolean {
  if (!notes) return false;
  return Boolean(notes.stood_out?.trim() || notes.worried?.trim() || notes.people?.trim() || notes.questions?.trim() || notes.live_here?.trim() || notes.free?.trim());
}

export interface BeforeYouGoQuestion {
  key: string;
  question: string;
}

/**
 * The fixed "before you go" list (actions.md "Visits"): questions the site's data can't answer, each with an "ask"
 * action that adds it to the visit's own questions note.
 */
export const BEFORE_YOU_GO_QUESTIONS: readonly BeforeYouGoQuestion[] = [
  { key: "housing_guarantee", question: "Is housing guaranteed, and for how many years?" },
  { key: "major_admission", question: "How does the major I want admit students, once I'm enrolled?" },
  { key: "merit_aid_timing", question: "When do merit aid offers come, and are they separate from the admission decision?" },
  { key: "support_services", question: "What support services are available (tutoring, disability services, mental health)?" },
];

/**
 * The first past visit's date (model.md "Rules"; the item's `visited_on`): the earliest `on_date` at or before
 * `today`, else null. A pure rule so logging, editing, or deleting a visit can all recompute it the same way.
 */
export function firstPastVisitOn(visitDates: readonly string[], today: string): string | null {
  const past = visitDates.filter((d) => d <= today).sort();
  return past[0] ?? null;
}

/** `PlanItem.visited_on`'s pure source: every visit's date, past-first, lowest wins (firstPastVisitOn). */
export function visitedOnFromVisits(visits: readonly { on_date: string }[], today: string): string | null {
  return firstPastVisitOn(visits.map((v) => v.on_date), today);
}
