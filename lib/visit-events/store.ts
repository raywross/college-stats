"use server";
/**
 * Visit events: the signed-in user's writes (specs/product/visit-events.md "People's data"). `saveVisitPrefs`
 * upserts the caller's own `visit_alert_prefs` row (created by the first-follow trigger, but upserted here in case
 * it's missing); `setVisitMute` adds or removes a `visit_alert_mutes` row for one college — the per-college "off"
 * switch the settings page, the college's mute switch on /me/visits, and the alert email's footer link all call.
 */
import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { isRadiusOption, MEASURE_FROM_OPTIONS, type MeasureFrom } from "@/lib/visit-events/types";

const UNIT_ID_RE = /^[0-9]{1,10}$/;

export interface VisitPrefsPatch {
  radius_miles?: number;
  measure_from?: string;
  include_online?: boolean;
  email_visit_alerts?: boolean;
}

export type SaveVisitPrefsResult = { ok: true } | { ok: false; message: string };

/** Validates and upserts a patch of the caller's visit-alert preferences. Rejects an unlisted radius or measuring point. */
export async function saveVisitPrefs(patch: VisitPrefsPatch): Promise<SaveVisitPrefsResult> {
  if (!authConfigured()) return { ok: false, message: "Sign-in isn't available here." };
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in to change this." };

  if (patch.radius_miles !== undefined && !isRadiusOption(patch.radius_miles)) {
    return { ok: false, message: "Pick one of the listed radii." };
  }
  if (patch.measure_from !== undefined && !(MEASURE_FROM_OPTIONS as readonly string[]).includes(patch.measure_from)) {
    return { ok: false, message: "Pick a valid measuring point." };
  }

  const row: Record<string, unknown> = { user_id: user.id, updated: new Date().toISOString() };
  if (patch.radius_miles !== undefined) row.radius_miles = patch.radius_miles;
  if (patch.measure_from !== undefined) row.measure_from = patch.measure_from as MeasureFrom;
  if (patch.include_online !== undefined) row.include_online = patch.include_online;
  if (patch.email_visit_alerts !== undefined) row.email_visit_alerts = patch.email_visit_alerts;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("visit_alert_prefs").upsert(row, { onConflict: "user_id" });
  if (error) {
    console.error(`visit_alert_prefs: saving failed: ${error.message}`);
    return { ok: false, message: "We couldn't save that. Try again in a moment." };
  }
  return { ok: true };
}

/** Mutes or unmutes visit alerts for one college (never the hub's data-digest Updates switch). */
export async function setVisitMute(unitId: string, muted: boolean): Promise<{ ok: boolean }> {
  if (!authConfigured()) return { ok: false };
  const user = await getUser();
  if (!user || !UNIT_ID_RE.test(unitId)) return { ok: false };
  const supabase = await createServerSupabase();
  if (muted) {
    // ON CONFLICT DO NOTHING: the row has nothing to update, and the grant is insert/delete only (an upsert's DO UPDATE
    // needs the update privilege even when no row conflicts; QA 2026-10-13).
    const { error } = await supabase
      .from("visit_alert_mutes")
      .upsert({ user_id: user.id, unit_id: unitId }, { onConflict: "user_id,unit_id", ignoreDuplicates: true });
    if (error) {
      console.error(`visit_alert_mutes: muting ${unitId} failed: ${error.message}`);
      return { ok: false };
    }
  } else {
    const { error } = await supabase.from("visit_alert_mutes").delete().eq("user_id", user.id).eq("unit_id", unitId);
    if (error) {
      console.error(`visit_alert_mutes: unmuting ${unitId} failed: ${error.message}`);
      return { ok: false };
    }
  }
  return { ok: true };
}
