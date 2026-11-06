import "server-only";
/**
 * The planner's "today", with the pretend-today setting applied (lib/planner/today.ts; specs/planner/v3/pretend-today.md):
 * the `planner.today` row of public.app_settings, set by an admin on /admin/settings, read once per request with the
 * viewer's own session (anyone may read a setting), ignored in production. Every planner page and Server Action that
 * needs the date asks here instead of todayIso(), so a plan opened under the setting is the plan of that day: seasons,
 * moves, deadlines, the calendar, and the dates it stamps (applied on, decided on). Cron jobs and the rest of the
 * site keep the real clock.
 */
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase-server";
import { todayIso } from "./context";
import { parseTodaySetting, TODAY_SETTING } from "./today";

/** The pretend day, or null when the setting is unset, unreadable, or this is production. */
export const plannerTodayOverride = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", TODAY_SETTING).maybeSingle();
    if (error) return null;
    return parseTodaySetting(data?.value);
  } catch {
    return null;
  }
});

/** Today for the planner: the pretend day when one is set, else the real one (todayIso). */
export const plannerToday = cache(async (): Promise<string> => (await plannerTodayOverride()) ?? todayIso());
