import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { SITE_NAME } from "@/lib/brand";
import { icsCalendar } from "@/lib/ics";
import { supabaseClient } from "@/lib/supabase";
import { readListTasks } from "@/lib/planner/reminders-server";
import { feedEvents } from "@/lib/planner/timeline";

/**
 * The plan's calendar feed (specs/planner/timeline.md "Display"): `webcal://{host}/api/plan/{token}.ics`, subscribed
 * from Apple, Google, or Outlook calendars. The token is the only secret: it's hashed (sha256) and looked up with
 * plan_for_calendar_token(), which returns the list only while the token isn't revoked. Read with the secret-key client
 * (a calendar has no session), so the response carries titles and dates only: every open dated task and every visit,
 * "Michigan: apply (ED I)", never a detail, a note, or a number.
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
    client = supabaseClient("publish");
  } catch {
    return notFound();
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: listId, error } = await client.rpc("plan_for_calendar_token", { p_token_hash: hash });
  if (error) {
    console.error(`plan feed: token lookup failed: ${error.message}`);
    return new Response("Try again later", { status: 503 });
  }
  if (typeof listId !== "string") return notFound();

  const { tasks, names } = await readListTasks(client, listId);
  const itemIds = Object.keys(names);
  const visits = itemIds.length
    ? ((await client.from("plan_visits").select("id, item_id, kind, on_date, at_time").in("item_id", itemIds)).data ?? [])
    : [];
  const events = feedEvents(
    tasks.filter((t) => t.done_at === null),
    visits as Parameters<typeof feedEvents>[1],
    names,
  );
  const body = icsCalendar(events, { name: `${SITE_NAME} plan` });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="plan.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
