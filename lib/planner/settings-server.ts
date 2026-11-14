import "server-only";
/**
 * The planner's two settings in one read (specs/serving-architecture.md "Left, after this PR": /advisor read
 * `app_settings` twice, once for pretend today and once for the all-moves preview, in different waves). `appSettings()`
 * reads the `planner.today` and `planner.all_moves` rows of public.app_settings together, once per request (React
 * `cache`), and starts the moment it is first asked, so the plan loader can put it in its first wave
 * (lib/planner/load.ts). `plannerTodayOverride()` (today-server.ts) and `allMovesEnabled()` (all-moves-server.ts) read
 * from it and keep their own rules (null outside production for the day, off when missing for the preview).
 *
 * The viewer's own session reads it (anyone may read a setting). Null when the read fails or the table isn't there.
 */
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase-server";
import { TODAY_SETTING } from "./today";
import { PRICE_LIVE_SETTING } from "../billing.ts";

/** The all-moves preview's key (lib/planner/all-moves.ts; supabase/migrations/20261021120000_app_settings.sql). */
export const ALL_MOVES_SETTING = "planner.all_moves";

/** When the Advisor's price went live (lib/billing.ts; lib/entitlements.ts reads it from this same read). */
export const PRICE_LIVE_SETTING_KEY = PRICE_LIVE_SETTING;

/** Every key the planner reads, in one `.in("key", …)`: its two settings and the entitlement hook's one. */
export const PLANNER_SETTING_KEYS = [TODAY_SETTING, ALL_MOVES_SETTING, PRICE_LIVE_SETTING] as const;

/** The planner's settings by key (a missing row is a missing key), or null when the read failed. */
export const appSettings = cache(async (): Promise<ReadonlyMap<string, unknown> | null> => {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("app_settings").select("key, value").in("key", [...PLANNER_SETTING_KEYS]);
    if (error) return null;
    return new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  } catch {
    return null;
  }
});
