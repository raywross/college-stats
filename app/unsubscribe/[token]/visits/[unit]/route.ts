import type { NextRequest } from "next/server";
import { supabaseClient } from "@/lib/supabase";
import { isUnitId, isUnsubscribeToken } from "@/lib/follow-state";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import { escapeHtml, unsubscribePage } from "../shell";

/**
 * "Stop alerts for UF" in a visit alert (specs/product/visit-events.md, "Alerting"), no sign-in: mutes one college's
 * visit alerts by the notification_prefs token through visit_alerts_mute_by_token (20261013180000_visit_events.sql).
 * GET shows a button, POST mutes, like the other unsubscribe routes. The college stays on the list; its update
 * emails and other colleges' visit alerts are unchanged.
 */
const SETTINGS = `<a href="/me/visits">your visits page</a>`;
const INVALID = `<p style="margin:0;">That link isn't valid. You can stop a college's visit alerts on ${SETTINGS}.</p>`;

async function collegeName(unitId: string): Promise<string | null> {
  const { getSchoolsByIds } = await getData();
  const [school] = getSchoolsByIds([unitId]);
  return school ? shortName(school) : null;
}

type Params = { params: Promise<{ token: string; unit: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { token, unit } = await params;
  if (!isUnsubscribeToken(token) || !isUnitId(unit)) return unsubscribePage("Visit alerts", INVALID);
  const name = (await collegeName(unit)) ?? "this college";
  return unsubscribePage(
    "Visit alerts",
    `<p style="margin:0 0 20px;">Stop visit alerts for ${escapeHtml(name)}? It stays on your list, and alerts for your other colleges keep coming.</p>
<form method="post"><button type="submit" style="background:#5b3df5;color:#ffffff;border:none;border-radius:999px;font-weight:600;font-size:15px;padding:12px 24px;cursor:pointer;">Stop alerts for ${escapeHtml(name)}</button></form>`,
  );
}

export async function POST(_request: NextRequest, { params }: Params) {
  const { token, unit } = await params;
  if (!isUnsubscribeToken(token) || !isUnitId(unit)) return unsubscribePage("Visit alerts", INVALID);
  try {
    const { data, error } = await supabaseClient("read").rpc("visit_alerts_mute_by_token", { p_token: token, p_unit_id: unit });
    if (error) throw new Error(error.message);
    const name = (await collegeName(unit)) ?? "this college";
    return unsubscribePage(
      "Visit alerts",
      data
        ? `<p style="margin:0;font-weight:600;">Visit alerts for ${escapeHtml(name)} are off.</p><p style="margin:12px 0 0;color:#57516b;font-size:14px;">Turn them back on any time on ${SETTINGS}.</p>`
        : INVALID,
    );
  } catch (err) {
    console.error(`mute visits: ${err instanceof Error ? err.message : err}`);
    return unsubscribePage("Visit alerts", `<p style="margin:0;">Something went wrong. Try again in a moment, or stop this college's alerts on ${SETTINGS}.</p>`);
  }
}
