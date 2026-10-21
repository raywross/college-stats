import "server-only";
/**
 * The all-moves preview's setting (lib/planner/all-moves.ts): the `planner.all_moves` row of public.app_settings,
 * switched by an admin on /admin/settings (supabase/migrations/20261021120000_app_settings.sql). Off when the row is
 * missing, the table isn't there yet, or the read fails, so a fresh database stays on the normal Next steps tab. Read
 * once per request with the viewer's own session (anyone may read a setting).
 */
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase-server";

export const ALL_MOVES_SETTING = "planner.all_moves";

export const allMovesEnabled = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", ALL_MOVES_SETTING).maybeSingle();
    if (error) return false;
    return data?.value === true;
  } catch {
    return false;
  }
});
