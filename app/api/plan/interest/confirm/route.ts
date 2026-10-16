import type { NextRequest } from "next/server";
import { supabaseClient } from "@/lib/supabase";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import { trackServer } from "@/lib/analytics-server";
import { todayIso } from "@/lib/planner/context";
import { actLabel, isActToken, testOf, whenLabel, type InterestActRow } from "@/lib/planner/interest-acts";
import { actByToken, resolveActRow, zonesForEvents } from "@/lib/planner/interest-acts-server";
import { SOCIAL_LABELS } from "@/lib/social";
import { escapeHtml, unsubscribePage } from "@/app/unsubscribe/[token]/visits/shell";

/**
 * The confirmation email's Yes / No links (specs/planner/v3/guides/show-interest.md "The confirmation email"):
 * `/api/plan/interest/confirm?token=…&answer=yes|no`, no sign-in. The token names one act and resolves it once, with
 * the secret key, writing only that act's own records (lib/planner/interest-acts-server.ts resolveActRow, the same
 * writer the guide's Server Action uses, `via: "email"`).
 *
 * GET shows the answer as one button; POST writes it, as every one-click link in the repo's emails does
 * (app/unsubscribe/[token]/visits): mail scanners open links on their own, and an assumed tour on a family calendar is
 * worse than a missing one (spec "Tracking": the owner's fallback is not adopted). The plan regenerates on its next
 * open, which closes the interest move.
 */
const TITLE = "Your plan";
const INVALID = `<p style="margin:0;">That link isn't valid. Open <a href="/plan">your plan</a> to answer it there.</p>`;
const BUTTON = "background:#5b3df5;color:#ffffff;border:none;border-radius:999px;font-weight:600;font-size:15px;padding:12px 24px;cursor:pointer;";

type Answer = "yes" | "no";
const parseAnswer = (v: string | null): Answer | null => (v === "yes" || v === "no" ? v : null);

async function collegeName(client: ReturnType<typeof supabaseClient>, itemId: string | null): Promise<{ name: string | null; unitId: string | null }> {
  if (!itemId) return { name: null, unitId: null };
  const { data } = await client.from("list_items").select("unit_id").eq("id", itemId).maybeSingle();
  const unitId = (data as { unit_id: string } | null)?.unit_id ?? null;
  if (!unitId) return { name: null, unitId: null };
  const { getSchoolsByIds } = await getData();
  const [school] = getSchoolsByIds([unitId]);
  return { name: school ? shortName(school) : null, unitId };
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** "Duke's tour on Nov 3", "following Duke on Instagram", "the SAT on Nov 7". */
function describe(row: InterestActRow, name: string | null, zone: string | null): string {
  const college = name ?? "the college";
  const when = whenLabel(row, zone, { time: false });
  switch (row.act) {
    case "follow":
      return `following ${college}${row.network ? ` on ${SOCIAL_LABELS[row.network]}` : ""}`;
    case "info_request":
      return `${possessive(college)} information request`;
    case "mailing_list":
      return `${possessive(college)} mailing list`;
    case "test_register":
      return `the ${testOf(row) ?? "test"}${when ? ` on ${when}` : ""}`;
    default:
      return `${possessive(college)} ${actLabel(row.act, row.event_title)}${when ? ` on ${when}` : ""}`;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function lookup(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const answer = parseAnswer(request.nextUrl.searchParams.get("answer"));
  if (!isActToken(token) || !answer) return null;
  const client = supabaseClient("publish");
  const row = await actByToken(client, token);
  if (!row) return null;
  const [{ name, unitId }, zones] = await Promise.all([collegeName(client, row.item_id), zonesForEvents(client, [row.event_id])]);
  const zone = row.event_id ? (zones[row.event_id] ?? null) : null;
  return { client, row, answer, name, unitId, zone, token };
}

function alreadyPage(status: InterestActRow["status"]): Response {
  if (status === "expired") return unsubscribePage(TITLE, `<p style="margin:0;">This one has expired, so nothing was added. You can still log it from <a href="/plan">your plan</a>.</p>`);
  return unsubscribePage(TITLE, `<p style="margin:0;">You already answered this one. <a href="/plan">Open your plan</a>.</p>`);
}

export async function GET(request: NextRequest) {
  try {
    const found = await lookup(request);
    if (!found) return unsubscribePage(TITLE, INVALID);
    const { row, answer, name, zone, token } = found;
    if (row.status !== "pending") return alreadyPage(row.status);
    const what = escapeHtml(describe(row, name, zone));
    const action = `/api/plan/interest/confirm?token=${encodeURIComponent(token)}&answer=${answer}`;
    const question =
      row.act === "follow" ? `Are you ${what}?` : row.act === "info_request" ? `Did you send ${what}?` : row.act === "mailing_list" ? `Did you join ${what}?` : `Did you register for ${what}?`;
    const label = answer === "yes" ? (row.act === "follow" ? "Yes, I'm following" : "Yes, I did") : "No, not this time";
    return unsubscribePage(
      TITLE,
      `<p style="margin:0 0 20px;">${question}</p>
<form method="post" action="${escapeHtml(action)}"><button type="submit" style="${BUTTON}">${label}</button></form>`,
    );
  } catch (err) {
    console.error(`interest confirm: ${err instanceof Error ? err.message : err}`);
    return unsubscribePage(TITLE, `<p style="margin:0;">Something went wrong. Try again in a moment, or answer it on <a href="/plan">your plan</a>.</p>`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const found = await lookup(request);
    if (!found) return unsubscribePage(TITLE, INVALID);
    const { client, row, answer, name, unitId, zone } = found;
    const now = new Date();
    const outcome = await resolveActRow(client, row, answer === "yes" ? "confirmed" : "declined", "email", {}, { now, today: todayIso(now), timeZone: zone });
    if (outcome.kind === "already") return alreadyPage(outcome.status);
    if (outcome.kind === "need_date") {
      const href = unitId ? `/plan/guide/interest?college=${encodeURIComponent(unitId)}` : "/plan";
      return unsubscribePage(TITLE, `<p style="margin:0;">Great. Pick the date on <a href="${escapeHtml(href)}">your plan</a> and it goes on the calendar.</p>`);
    }
    if (outcome.kind === "error") throw new Error(outcome.message);
    if (outcome.answer === "declined") return unsubscribePage(TITLE, `<p style="margin:0;font-weight:600;">Okay, we won't add it.</p>`);
    await trackServer("plan_interest_confirmed", { action: row.act, via: "email" }, row.user_id);
    const what = escapeHtml(capitalize(describe(row, name, zone)));
    const where = outcome.visitId ? "on your calendar" : "on your plan";
    return unsubscribePage(TITLE, `<p style="margin:0;font-weight:600;">Thanks. ${what} is ${where}.</p><p style="margin:12px 0 0;"><a href="/plan">Open your plan</a></p>`);
  } catch (err) {
    console.error(`interest confirm: ${err instanceof Error ? err.message : err}`);
    return unsubscribePage(TITLE, `<p style="margin:0;">Something went wrong. Try again in a moment, or answer it on <a href="/plan">your plan</a>.</p>`);
  }
}
