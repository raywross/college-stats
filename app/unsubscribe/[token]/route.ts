import type { NextRequest } from "next/server";
import { SITE_NAME } from "@/lib/brand";
import { supabaseClient } from "@/lib/supabase";
import { isUnsubscribeToken } from "@/lib/follow-state";

/**
 * One-click unsubscribe from update digests (specs/product/follow-colleges.md#the-digest), no sign-in. A route
 * handler, not a page, so the exact URL in the email's `List-Unsubscribe` header also answers a bare POST: mail
 * clients implementing one-click unsubscribe (RFC 8058, `List-Unsubscribe-Post: List-Unsubscribe=One-Click`) send
 * `Content-Type: application/x-www-form-urlencoded` with no cookies, same as a person clicking the page's own
 * button. Both paths call the same `unsubscribe_by_token` RPC with the publishable key (it's granted to anon and
 * reveals nothing about the account either way).
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Unsubscribe – ${SITE_NAME}</title></head>
<body style="margin:0;padding:40px 20px;background:#faf8f4;color:#1c1830;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
<div style="max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e7e2d8;border-radius:16px;padding:28px;text-align:center;">
${body}
</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function confirmForm(): string {
  return `<p style="margin:0 0 20px;">Turn off update emails from ${escapeHtml(SITE_NAME)} for this account? Your list stays as it is — you just won't be emailed about its colleges.</p>
<form method="post"><button type="submit" style="background:#5b3df5;color:#ffffff;border:none;border-radius:999px;font-weight:600;font-size:15px;padding:12px 24px;cursor:pointer;">Unsubscribe</button></form>`;
}

async function unsubscribe(token: string): Promise<boolean> {
  if (!isUnsubscribeToken(token)) return false;
  const client = supabaseClient("read");
  const { data, error } = await client.rpc("unsubscribe_by_token", { p_token: token });
  if (error) {
    console.error(`unsubscribe: ${error.message}`);
    return false;
  }
  return Boolean(data);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isUnsubscribeToken(token)) {
    return page(`<p style="margin:0;">That unsubscribe link isn't valid. If you still want to stop update emails, sign in and turn them off on <a href="/account#updates">your account page</a>.</p>`);
  }
  return page(confirmForm());
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const ok = await unsubscribe(token);
    return page(
      ok
        ? `<p style="margin:0;font-weight:600;">You're unsubscribed.</p><p style="margin:12px 0 0;color:#57516b;font-size:14px;">You won't get update emails from ${escapeHtml(SITE_NAME)} again. To turn them back on, sign in and use the switch on <a href="/account#updates">your account page</a>.</p>`
        : `<p style="margin:0;">That link isn't valid, or has already been used. If you still want to stop update emails, sign in and turn them off on <a href="/account#updates">your account page</a>.</p>`,
    );
  } catch (err) {
    console.error(`unsubscribe: ${err instanceof Error ? err.message : err}`);
    return page(`<p style="margin:0;">Something went wrong. Try again in a moment, or sign in and turn off update emails on <a href="/account#updates">your account page</a>.</p>`);
  }
}
