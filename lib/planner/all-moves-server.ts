import "server-only";
/**
 * The all-moves preview's setting (lib/planner/all-moves.ts): the `planner.all_moves` row of public.app_settings,
 * switched by an admin on /admin/settings (supabase/migrations/20261021120000_app_settings.sql). Off when the row is
 * missing, the table isn't there yet, or the read fails, so a fresh database stays on the normal Next steps tab. Read
 * once per request, together with pretend today, with the viewer's own session (anyone may read a setting).
 */
import { cache } from "react";
import { ALL_MOVES_SETTING, appSettings } from "./settings-server";

export { ALL_MOVES_SETTING };

/** On only when the row says `true`; read from the planner's one settings read (settings-server.ts appSettings). */
export const allMovesEnabled = cache(async (): Promise<boolean> => (await appSettings())?.get(ALL_MOVES_SETTING) === true);
