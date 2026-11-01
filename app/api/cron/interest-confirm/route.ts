import type { NextRequest } from "next/server";
import { withJobRun } from "@/lib/jobs/record";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient } from "@/lib/supabase";
import { emailConfigured, sendEmail } from "@/lib/email";
import { getData } from "@/lib/data";
import { shortName } from "@/lib/brand";
import { trackServer } from "@/lib/analytics-server";
import { buildInterestConfirm } from "@/lib/emails/interest-confirm";
import { runInterestConfirm } from "@/lib/planner/interest-acts-server";

/**
 * The morning confirmation job (specs/planner/v3/guides/show-interest.md "The confirmation email"; build-plan.md
 * review note 12). Vercel Cron issues a GET with `Authorization: Bearer $CRON_SECRET` at 13:30 UTC (vercel.json), after
 * the visit alert; POST is exported too for a manual run. Uses the secret key, like the digest and visit-alert jobs,
 * because it reads every person's pending acts.
 *
 * First the expiry (pending acts past their window → `expired`, `plan_interest_expired` per act), then one email per
 * person about every act still pending, unemailed, and clicked before today (lib/planner/interest-acts-server.ts
 * runInterestConfirm; lib/emails/interest-confirm.ts). `emailed_at` is set only after a real send. The address is the
 * account's own (`auth.admin.getUserById`, as the visit alert and the weekly job read it). Anyone who turned Your week
 * off is skipped: the acts stay pending for the return prompt and the guide.
 *
 * When RESEND_API_KEY/EMAIL_FROM aren't set it returns `{ configured: false }` without reading anything (email is
 * dormant: the acts stay pending and the return prompt remains the way to confirm; nothing expires either, since the
 * secret key isn't in Vercel until then). `?dry=1` renders every email without sending or writing anything.
 */
async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  if (!dry && !emailConfigured()) {
    console.info("interest-confirm: email not configured; nothing to do.");
    return Response.json({ configured: false });
  }

  try {
    const client = supabaseClient("publish");
    const summary = await runInterestConfirm(client, {
      now: new Date(),
      siteUrl: request.nextUrl.origin,
      dry,
      namesFor: async (unitIds) => {
        const { getSchoolsByIds } = await getData();
        return new Map(getSchoolsByIds(unitIds).map((s) => [s.unit_id, shortName(s)]));
      },
      build: buildInterestConfirm,
      emailOf: async (userId) => {
        const { data, error } = await client.auth.admin.getUserById(userId);
        return error ? null : (data.user?.email ?? null);
      },
      send: (m) => sendEmail({ to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers }),
      track: (event, properties, userId) =>
        event === "interest_confirm_sent"
          ? trackServer("interest_confirm_sent", { acts: Number(properties.acts) }, userId)
          : trackServer("plan_interest_expired", { action: String(properties.action) }, userId),
    });
    return Response.json({ configured: !dry, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Every run leaves a row in job_runs for the admin console's Jobs pages (lib/jobs/record.ts).
const recorded = withJobRun("interest-confirm", run);
export const GET = recorded;
export const POST = recorded;
