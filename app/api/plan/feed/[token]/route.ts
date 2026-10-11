import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { SITE_NAME } from "@/lib/brand";
import { getData } from "@/lib/data";
import { icsCalendar } from "@/lib/ics";
import { supabaseClient } from "@/lib/supabase";
import { viewerFeedEvents, type ViewerFeedRow } from "@/lib/planner/viewer-feed";

/**
 * The per-viewer calendar feed (specs/planner/redesign/calendar.md "Feed, print, share"):
 * `webcal://{host}/api/plan/feed/{token}.ics`, one subscription with every child the token's owner can see, each
 * title starting with the child's name ("Maya: Wake Forest, apply (ED I)"). The token is the only secret: it's hashed
 * (sha256) and passed to plan_viewer_feed(), which resolves the owner, applies the household grants for that person,
 * and returns nothing once the token is revoked. Read with the publishable key: the function is the only thing a
 * caller without a session can reach, and it returns titles and dates only, never a detail, a note, or a number.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!TOKEN_RE.test(token)) return notFound();
  let client;
  try {
    client = supabaseClient("read");
  } catch {
    return notFound();
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await client.rpc("plan_viewer_feed", { p_token_hash: hash });
  if (error) {
    console.error(`plan viewer feed: lookup failed: ${error.message}`);
    return new Response("Try again later", { status: 503 });
  }
  // An unknown or revoked token gets the same empty calendar as a live one with nothing dated yet: nothing tells a
  // stranger whether a token exists, and a parent who subscribes before the first deadline isn't shown an error.
  const rows = (Array.isArray(data) ? data : []) as ViewerFeedRow[];

  const { getSchoolsByIds } = await getData();
  const unitIds = [...new Set(rows.map((r) => r.unit_id).filter((u): u is string => !!u))];
  const names = new Map(getSchoolsByIds(unitIds).map((s) => [s.unit_id, s.name]));
  const body = icsCalendar(viewerFeedEvents(rows, (u) => names.get(u) ?? null), { name: `${SITE_NAME} family plan` });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="family-plan.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
