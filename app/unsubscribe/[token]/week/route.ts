import type { NextRequest } from "next/server";
import { SITE_NAME } from "@/lib/brand";
import { supabaseClient } from "@/lib/supabase";
import { isUnsubscribeToken } from "@/lib/follow-state";

/**
 * One-click unsubscribe from "Your week" (specs/planner/timeline.md "Reminders"), no sign-in: the same token and
 * pattern as app/unsubscribe/[token]/route.ts (GET shows a button, POST, including RFC 8058's one-click POST, turns it
 * off), through unsubscribe_your_week_by_token (20261008130000_planner_timeline.sql).
 */
function page(body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Your week – ${SITE_NAME}</title></head>
<body style="margin:0;padding:40px 20px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:28px;text-align:center;">
${body}
</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

const INVALID = `<p style="margin:0;">That link isn't valid. You can turn off Your week on <a href="/account#reminders">your account page</a>.</p>`;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) return page(INVALID);
  return page(`<p style="margin:0 0 20px;">Stop the Your week email? Your plan stays as it is.</p>
<form method="post"><button type="submit" style="background:#5b3df5;color:#ffffff;border:none;border-radius:999px;font-weight:600;font-size:15px;padding:12px 24px;cursor:pointer;">Turn off Your week</button></form>`);
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) return page(INVALID);
  try {
    const { data, error } = await supabaseClient("read").rpc("unsubscribe_your_week_by_token", { p_token: token });
    if (error) throw new Error(error.message);
    return page(
      data
        ? `<p style="margin:0;font-weight:600;">Your week is off.</p><p style="margin:12px 0 0;color:#57516b;font-size:14px;">Turn it back on any time on <a href="/account#reminders">your account page</a>.</p>`
        : INVALID,
    );
  } catch (err) {
    console.error(`unsubscribe week: ${err instanceof Error ? err.message : err}`);
    return page(`<p style="margin:0;">Something went wrong. Try again in a moment, or turn off Your week on <a href="/account#reminders">your account page</a>.</p>`);
  }
}
