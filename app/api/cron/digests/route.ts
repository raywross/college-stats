import type { NextRequest } from "next/server";
import { isAuthorized } from "@/lib/revalidate";
import { supabaseClient, CHANGE_COLUMNS } from "@/lib/supabase";
import { buildDigest, eligiblePublishes, type DigestCollegeInput, type PublishRow } from "@/lib/digest";
import { EMAILED_KINDS, type StoredChange } from "@/lib/changes";
import { emailConfigured, sendEmail } from "@/lib/email";
import type { FollowSource } from "@/lib/follow-state";

/**
 * The daily update-digest job (specs/product/follow-colleges.md#the-digest). Vercel Cron issues a GET with
 * `Authorization: Bearer $CRON_SECRET` once a day (vercel.json, Vercel's own convention for cron requests); POST is
 * exported too so the job can also be triggered manually the way /api/revalidate is. Anyone else gets 401. Uses the
 * Supabase secret key (bypasses RLS, like scripts/purge-accounts.mts) because it reads and writes across every
 * user's follows, not just one signed-in session's own rows.
 *
 * For every publish between 24 hours and 14 days old (lib/digest.ts eligiblePublishes): for each user who follows a
 * college that changed in it, with email updates on and no `digests` row for that publish yet, sends one email
 * (lib/digest.ts buildDigest) and records a `digests` row — but only once it actually sent. When RESEND_API_KEY/
 * EMAIL_FROM aren't set, the job returns at once without reading anything (it would need the secret key, which isn't
 * in Vercel until email is set up) and records nothing, so nothing is skipped once email is turned on. The 14-day cap is what keeps that safe: turning email on
 * after a quiet patch can send at most two weeks of backlog, never a flood of every publish since launch.
 */
async function run(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Until email is configured (the new domain, specs/backlog.md) there is nothing to send, and the job needs the
  // secret key, which stays out of Vercel until then (specs/supabase.md#keys). Stop before touching the database.
  if (!emailConfigured()) {
    console.info("digests: email not configured; nothing to do.");
    return Response.json({ configured: false, publishes: [] });
  }

  const client = supabaseClient("publish");
  const siteUrl = request.nextUrl.origin;
  const now = new Date();

  const { data: publishRows, error: publishError } = await client.from("dataset_publishes").select("id, published_at").order("published_at", { ascending: false }).limit(60);
  if (publishError) return Response.json({ error: `Reading publishes failed: ${publishError.message}` }, { status: 500 });

  const publishes = eligiblePublishes((publishRows ?? []) as PublishRow[], now);
  const configured = emailConfigured();
  const summary: Record<string, unknown>[] = [];

  for (const publish of publishes) {
    const result = await processPublish(client, publish, siteUrl, configured);
    summary.push({ publish_id: publish.id, published_at: publish.published_at, ...result });
  }

  if (!configured) console.info(`digests: email not configured; dry run only. ${JSON.stringify(summary)}`);
  return Response.json({ configured, publishes: summary });
}

export const GET = run;
export const POST = run;

async function processPublish(
  client: ReturnType<typeof supabaseClient>,
  publish: PublishRow,
  siteUrl: string,
  configured: boolean,
): Promise<{ changedColleges: number; candidates: number; sent: number; recorded: number; skipped: number; errors: number }> {
  const { data: changeRows, error: changesError } = await client.from("dataset_changes").select(CHANGE_COLUMNS).eq("publish_id", publish.id);
  if (changesError) throw new Error(`digests: reading changes for publish ${publish.id} failed: ${changesError.message}`);
  const changes = (changeRows ?? []) as StoredChange[];
  const emailable = changes.filter((c) => EMAILED_KINDS.has(c.kind));
  const changedUnitIds = [...new Set(emailable.map((c) => c.unit_id))];
  if (!changedUnitIds.length) return { changedColleges: 0, candidates: 0, sent: 0, recorded: 0, skipped: 0, errors: 0 };

  const changesByUnit = new Map<string, StoredChange[]>();
  for (const c of emailable) changesByUnit.set(c.unit_id, [...(changesByUnit.get(c.unit_id) ?? []), c]);

  const [followsRes, namesRes] = await Promise.all([
    client.from("follows").select("user_id, unit_id, source").in("unit_id", changedUnitIds),
    client.from("schools").select("unit_id, name").in("unit_id", changedUnitIds),
  ]);
  if (followsRes.error) throw new Error(`digests: reading follows failed: ${followsRes.error.message}`);
  if (namesRes.error) throw new Error(`digests: reading school names failed: ${namesRes.error.message}`);
  const names = new Map((namesRes.data as { unit_id: string; name: string }[]).map((r) => [r.unit_id, r.name]));

  const byUser = new Map<string, { unit_id: string; source: FollowSource }[]>();
  for (const row of followsRes.data as { user_id: string; unit_id: string; source: FollowSource }[]) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), { unit_id: row.unit_id, source: row.source }]);
  }
  const userIds = [...byUser.keys()];
  if (!userIds.length) return { changedColleges: changedUnitIds.length, candidates: 0, sent: 0, recorded: 0, skipped: 0, errors: 0 };

  const [prefsRes, digestsRes] = await Promise.all([
    client.from("notification_prefs").select("user_id, email_updates, unsubscribe_token").in("user_id", userIds),
    client.from("digests").select("user_id").eq("publish_id", publish.id).in("user_id", userIds),
  ]);
  if (prefsRes.error) throw new Error(`digests: reading notification_prefs failed: ${prefsRes.error.message}`);
  if (digestsRes.error) throw new Error(`digests: reading existing digests failed: ${digestsRes.error.message}`);
  const prefs = new Map((prefsRes.data as { user_id: string; email_updates: boolean; unsubscribe_token: string }[]).map((r) => [r.user_id, r]));
  const already = new Set((digestsRes.data as { user_id: string }[]).map((r) => r.user_id));

  let candidates = 0;
  let sent = 0;
  let recorded = 0;
  let skipped = 0;
  let errors = 0;

  for (const userId of userIds) {
    if (already.has(userId)) {
      skipped++;
      continue;
    }
    const pref = prefs.get(userId);
    if (pref && pref.email_updates === false) {
      skipped++;
      continue;
    }
    candidates++;

    const inputs: DigestCollegeInput[] = byUser.get(userId)!.map(({ unit_id, source }) => ({
      unit_id,
      source,
      name: names.get(unit_id) ?? unit_id,
      changes: changesByUnit.get(unit_id) ?? [],
    }));
    const unsubscribeToken = pref?.unsubscribe_token;
    if (!unsubscribeToken) {
      // Every follower gets a notification_prefs row from the follows_ensure_prefs trigger; missing one means the
      // migration predates the trigger or the row was removed out of band. Skip rather than send with no unsubscribe.
      console.error(`digests: user ${userId} follows a changed college but has no notification_prefs row; skipping.`);
      errors++;
      continue;
    }
    const built = buildDigest(inputs, { siteUrl, unsubscribeToken });
    if (!built) {
      skipped++;
      continue;
    }

    if (!configured) continue; // Dry run: nothing sent, nothing recorded (see module doc).

    const { data: userRes, error: userError } = await client.auth.admin.getUserById(userId);
    const email = userError ? null : userRes.user?.email ?? null;
    if (!email) {
      console.error(`digests: couldn't find an email for user ${userId}: ${userError?.message ?? "no email on the account"}.`);
      errors++;
      continue;
    }

    const result = await sendEmail({ to: email, subject: built.subject, html: built.html, text: built.text, headers: built.headers });
    if (!result.sent) {
      // Not configured can't happen here (checked above); a provider error is logged and retried on the next run,
      // still bounded by the 14-day cap.
      errors++;
      continue;
    }
    sent++;

    const { error: insertError } = await client.from("digests").insert({
      user_id: userId,
      publish_id: publish.id,
      published_at: publish.published_at,
      sent_at: new Date().toISOString(),
      provider_message_id: result.id,
      unit_ids: built.unitIds,
      college_count: built.collegeCount,
      change_count: built.changeCount,
    });
    if (insertError) console.error(`digests: sent to ${userId} but recording it failed: ${insertError.message}`);
    else recorded++;
  }

  return { changedColleges: changedUnitIds.length, candidates, sent, recorded, skipped, errors };
}
