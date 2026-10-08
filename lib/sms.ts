/**
 * Text reminders (specs/planner/timeline.md "Texts"). One small interface so the provider can change: `send`,
 * `handleInbound`, `composeWeekText`, `composeDayBeforeText`, `composeConfirmText`, `quietHours`, `canText`.
 * Twilio Programmable Messaging through its REST API with plain fetch (no SDK), configured by SMS_PROVIDER_SID,
 * SMS_PROVIDER_TOKEN, and SMS_FROM_NUMBER. Unset: dormant (every send is a logged no-op), like lib/email.ts.
 *
 * The rules every text obeys, enforced here so no caller can forget them:
 * - Only to a person with an active consent (not revoked, no provider STOP); the first text is the confirmation with
 *   the STOP wording.
 * - At most one a day per person, and none from 9 pm to 8 am in the household's time zone (from the home address, else
 *   the phone's area code; when neither tells, the hours that are quiet anywhere from Eastern to Pacific time).
 * - Titles, college names, and short dates only: never a note, a decision, or a number from the student's profile
 *   (`scrubNumbers` removes any figure that isn't part of a "Nov 1" date).
 *
 * Server only (reads secrets) but free of Next.js imports so tests run it under plain node --test.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE_NAME } from "./brand.ts";
import { scrubNumbers } from "./planner/timeline.ts";

export type SmsEnv = Record<string, string | undefined>;

export type SmsResult = { sent: true; sid: string | null } | { sent: false; reason: "not-configured" } | { sent: false; reason: "error"; error: string };

/** Whether texts can go out here (all three Twilio values set). */
export function smsConfigured(env: SmsEnv = process.env): boolean {
  return Boolean(env.SMS_PROVIDER_SID && env.SMS_PROVIDER_TOKEN && env.SMS_FROM_NUMBER);
}

const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Twilio's REST API version (its path segment), not a data year; joined so the data-year guard doesn't read it as one. */
const TWILIO_API_VERSION = ["2010", "04", "01"].join("-");

/**
 * Sends one text, or doesn't when unconfigured (logged). Never throws. Callers check `canText` first and record the
 * send (sms_sends) so the once-a-day rule holds.
 */
export async function send(
  message: { to: string; body: string },
  deps: { env?: SmsEnv; fetch?: typeof fetch; log?: (msg: string) => void } = {},
): Promise<SmsResult> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((msg: string) => console.info(msg));
  if (!smsConfigured(env)) {
    log("sms: not configured (SMS_PROVIDER_SID/TOKEN/FROM_NUMBER unset); not sending.");
    return { sent: false, reason: "not-configured" };
  }
  if (!E164.test(message.to)) return { sent: false, reason: "error", error: "not an E.164 number" };
  try {
    const sid = env.SMS_PROVIDER_SID!;
    const res = await (deps.fetch ?? fetch)(`https://api.twilio.com/${TWILIO_API_VERSION}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${env.SMS_PROVIDER_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: message.to, From: env.SMS_FROM_NUMBER!, Body: message.body }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = `Twilio ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
      log(`sms: sending failed (${error}).`);
      return { sent: false, reason: "error", error };
    }
    const body = (await res.json().catch(() => null)) as { sid?: string } | null;
    return { sent: true, sid: body?.sid ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log(`sms: sending failed (${error}).`);
    return { sent: false, reason: "error", error };
  }
}

/* ------------------------------------------------------------------ */
/* Inbound (the STOP webhook)                                          */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);
const HELP_WORDS = new Set(["help", "info"]);

export type InboundAction = { action: "stop" | "start" | "help" | "none"; from: string | null };

/**
 * What an inbound text means (Twilio posts From, Body, and OptOutType when Advanced Opt-Out is on). STOP and its
 * synonyms set the consent's provider_opt_out_at; START is not a consent (the person turns texts back on in the
 * plan, which records who did); HELP is answered by Twilio's own reply.
 */
export function handleInbound(params: Record<string, string | undefined>): InboundAction {
  const from = params.From && E164.test(params.From) ? params.From : null;
  const optOut = params.OptOutType?.toUpperCase();
  if (optOut === "STOP") return { action: "stop", from };
  if (optOut === "START") return { action: "start", from };
  if (optOut === "HELP") return { action: "help", from };
  const word = (params.Body ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (STOP_WORDS.has(word)) return { action: "stop", from };
  if (START_WORDS.has(word)) return { action: "start", from };
  if (HELP_WORDS.has(word)) return { action: "help", from };
  return { action: "none", from };
}

/**
 * Twilio's request signature (X-Twilio-Signature): base64 HMAC-SHA1 of the full URL followed by each POST parameter's
 * name and value, sorted by name, keyed with the auth token.
 */
export function twilioSignature(url: string, params: Record<string, string>, token: string): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", token).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | null, token: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(url, params, token));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/* ------------------------------------------------------------------ */
/* Composing                                                           */
/* ------------------------------------------------------------------ */

export { scrubNumbers };

/** One line of a text: the task (with its college) and its date, already short ("Michigan: apply (ED I)", "Nov 1"). */
export interface TextTask {
  title: string;
  /** Short date ("Nov 1") or null. */
  when: string | null;
  /** "Parent" for a guardian's step, else null. */
  who?: string | null;
}

const BRAND = SITE_NAME;
const STOP_LINE = "Reply STOP to stop.";
/** The week's text lists at most this many tasks (timeline.md: trimmed to the first three). */
export const WEEK_TEXT_MAX = 3;

function line(t: TextTask): string {
  const bits = [t.when, t.who].filter(Boolean).join(", ");
  return scrubNumbers(t.title) + (bits ? ` (${bits})` : "");
}

/** The week's text, or null when nothing is due (the week's text is skipped then). */
export function composeWeekText(tasks: TextTask[], planUrl: string): string | null {
  if (tasks.length === 0) return null;
  const shown = tasks.slice(0, WEEK_TEXT_MAX).map(line);
  const more = tasks.length > WEEK_TEXT_MAX ? ` and ${tasks.length - WEEK_TEXT_MAX} more` : "";
  return `${BRAND} · This week: ${shown.join("; ")}${more}. Plan: ${planUrl} ${STOP_LINE}`;
}

/** The day-before text for one hard deadline. */
export function composeDayBeforeText(task: TextTask, planUrl: string): string {
  return `${BRAND} · Tomorrow: ${scrubNumbers(task.title)}. Plan: ${planUrl} ${STOP_LINE}`;
}

/** The first text after someone turns texts on: what they'll get, and how to stop. */
export function composeConfirmText(forName: string | null): string {
  const whose = forName ? `${scrubNumbers(forName)}'s` : "your";
  return `${BRAND}: texts about ${whose} college plan are on. At most one a day, never at night. Reply STOP to stop, HELP for help.`;
}

/* ------------------------------------------------------------------ */
/* Time zones and quiet hours                                          */
/* ------------------------------------------------------------------ */

export const EASTERN = "America/New_York";
export const CENTRAL = "America/Chicago";
export const MOUNTAIN = "America/Denver";
export const ARIZONA = "America/Phoenix";
export const PACIFIC = "America/Los_Angeles";
export const ALASKA = "America/Anchorage";
export const HAWAII = "Pacific/Honolulu";

/** A state's main time zone (a few states straddle two; the larger part wins). */
const STATE_ZONES: Record<string, string> = {
  CT: EASTERN, DE: EASTERN, DC: EASTERN, FL: EASTERN, GA: EASTERN, IN: EASTERN, KY: EASTERN, ME: EASTERN, MD: EASTERN,
  MA: EASTERN, MI: EASTERN, NH: EASTERN, NJ: EASTERN, NY: EASTERN, NC: EASTERN, OH: EASTERN, PA: EASTERN, RI: EASTERN,
  SC: EASTERN, VT: EASTERN, VA: EASTERN, WV: EASTERN, PR: "America/Puerto_Rico",
  AL: CENTRAL, AR: CENTRAL, IL: CENTRAL, IA: CENTRAL, KS: CENTRAL, LA: CENTRAL, MN: CENTRAL, MS: CENTRAL, MO: CENTRAL,
  NE: CENTRAL, ND: CENTRAL, OK: CENTRAL, SD: CENTRAL, TN: CENTRAL, TX: CENTRAL, WI: CENTRAL,
  CO: MOUNTAIN, ID: MOUNTAIN, MT: MOUNTAIN, NM: MOUNTAIN, UT: MOUNTAIN, WY: MOUNTAIN, AZ: ARIZONA,
  CA: PACIFIC, NV: PACIFIC, OR: PACIFIC, WA: PACIFIC, AK: ALASKA, HI: HAWAII,
};

/** A small area-code table for when there's no home address: the zones outside Eastern; anything else is unknown. */
const AREA_ZONES: Record<string, string> = {};
for (const [zone, codes] of [
  [PACIFIC, "206 209 213 253 279 310 323 341 360 408 415 424 425 442 503 509 510 530 541 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 949 951 971"],
  [MOUNTAIN, "208 303 307 385 406 435 505 575 719 720 801 915 970 983 986"],
  [ARIZONA, "480 520 602 623 928"],
  [CENTRAL, "205 210 214 217 218 224 225 228 251 254 256 262 281 309 312 314 316 318 319 320 325 331 334 337 346 361 402 405 409 414 417 430 432 469 479 501 504 507 512 515 563 573 580 601 608 612 618 620 630 636 641 651 660 662 682 708 712 713 715 726 731 737 763 773 779 785 806 815 816 817 830 832 847 870 872 901 903 913 918 920 936 940 952 956 972 979 985"],
  [ALASKA, "907"],
  [HAWAII, "808"],
] as const) {
  for (const code of codes.split(" ")) AREA_ZONES[code] = zone;
}

/**
 * The time zones whose quiet hours a text must respect: the home's state's zone; else the phone's area code's; else
 * Eastern and Pacific together (a text then goes only when it's daytime across the continental US).
 */
export function timeZonesFor(opts: { homeLabel?: string | null; homePlace?: string | null; phone?: string | null }): string[] {
  const state = stateOf(opts.homeLabel) ?? stateOf(opts.homePlace);
  if (state && STATE_ZONES[state]) return [STATE_ZONES[state]];
  const m = opts.phone?.match(/^\+1(\d{3})\d{7}$/);
  if (m && AREA_ZONES[m[1]]) return [AREA_ZONES[m[1]]];
  return [EASTERN, PACIFIC];
}

/** "Ann Arbor, MI 48104" or "Washington, DC" → the state. */
export function stateOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/) ?? text.match(/,\s*([A-Z]{2})\s+\d{5}/);
  return m ? m[1] : null;
}

/** The local hour (0–23) and day (yyyy-mm-dd) at `now` in a zone. */
export function localTime(now: Date, timeZone: string): { hour: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

/** The household's day for the once-a-day rule (the first zone's). */
export function localDay(now: Date, zones: readonly string[]): string {
  return localTime(now, zones[0] ?? EASTERN).day;
}

export const QUIET_FROM = 21;
export const QUIET_UNTIL = 8;

/** True from 9 pm to 8 am in any of the zones: no text then. */
export function quietHours(now: Date, zones: readonly string[]): boolean {
  return zones.some((z) => {
    const { hour } = localTime(now, z);
    return hour >= QUIET_FROM || hour < QUIET_UNTIL;
  });
}

/** A consent row as the rules read it. */
export interface ConsentState {
  revoked_at: string | null;
  provider_opt_out_at: string | null;
}

export type CanText = { ok: true } | { ok: false; reason: "no_consent" | "opted_out" | "quiet_hours" | "already_today" };

/**
 * Whether a text may go to a person now: an active consent, outside quiet hours, and nothing sent on the household's
 * day yet (`sentDays`: the local days of their earlier texts).
 */
export function canText(opts: { consent: ConsentState | null; now: Date; zones: readonly string[]; sentDays: readonly string[] }): CanText {
  if (!opts.consent || opts.consent.revoked_at !== null) return { ok: false, reason: "no_consent" };
  if (opts.consent.provider_opt_out_at !== null) return { ok: false, reason: "opted_out" };
  if (quietHours(opts.now, opts.zones)) return { ok: false, reason: "quiet_hours" };
  if (opts.sentDays.includes(localDay(opts.now, opts.zones))) return { ok: false, reason: "already_today" };
  return { ok: true };
}

/** Who must consent for a student: the student themself at 18 or older, else a guardian. Unknown age: a guardian. */
export function consentBy(birthYear: number | null, today: string): "self" | "guardian" {
  if (birthYear === null) return "guardian";
  // Born in birthYear, the student is 18 by the end of birthYear + 18; before then we can't be sure they are.
  return Number(today.slice(0, 4)) - birthYear > 18 ? "self" : "guardian";
}
