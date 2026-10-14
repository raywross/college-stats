import type { NextRequest } from "next/server";
import { SITE_NAME } from "@/lib/brand";
import { supabaseClient } from "@/lib/supabase";
import { isUnsubscribeToken } from "@/lib/follow-state";
import { unsubscribePage } from "./shell";

/**
 * One-click unsubscribe from visit alerts (specs/product/visit-events.md, "People's data"), no sign-in: the same token
 * and pattern as app/unsubscribe/[token]/route.ts (GET shows a button so a mail scanner's prefetch changes nothing;
 * POST, including RFC 8058's one-click POST from the List-Unsubscribe header, turns it off) through
 * visit_alerts_unsubscribe_by_token (20261013180000_visit_events.sql). Update digests stay as they are.
 */
const SETTINGS = `<a href="/me#visit-alerts">your profile</a>`;
const INVALID = `<p style="margin:0;">That link isn't valid. You can turn off visit alerts on ${SETTINGS}.</p>`;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) return unsubscribePage("Visit alerts", INVALID);
  return unsubscribePage(
    "Visit alerts",
    `<p style="margin:0 0 20px;">Stop emails about college visits near you? Your list and your update emails stay as they are.</p>
<form method="post"><button type="submit" style="background:#5b3df5;color:#ffffff;border:none;border-radius:999px;font-weight:600;font-size:15px;padding:12px 24px;cursor:pointer;">Turn off visit alerts</button></form>`,
  );
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) return unsubscribePage("Visit alerts", INVALID);
  try {
    const { data, error } = await supabaseClient("read").rpc("visit_alerts_unsubscribe_by_token", { p_token: token });
    if (error) throw new Error(error.message);
    return unsubscribePage(
      "Visit alerts",
      data
        ? `<p style="margin:0;font-weight:600;">Visit alerts are off.</p><p style="margin:12px 0 0;color:#57516b;font-size:14px;">You won't get visit emails from ${SITE_NAME} again. Turn them back on any time on ${SETTINGS}.</p>`
        : INVALID,
    );
  } catch (err) {
    console.error(`unsubscribe visits: ${err instanceof Error ? err.message : err}`);
    return unsubscribePage("Visit alerts", `<p style="margin:0;">Something went wrong. Try again in a moment, or turn off visit alerts on ${SETTINGS}.</p>`);
  }
}
