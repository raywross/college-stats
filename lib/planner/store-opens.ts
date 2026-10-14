"use server";
/**
 * When the signed-in person last opened a student's Next steps tab (next-steps notifications.md "Channels": the
 * header dot lights for a move added since). One plan_opens row per viewer and student, written with the person's own
 * session so row-level security (own rows only, 20261014120000_next_steps.sql) decides. Called by
 * components/planner/PlanOpened.tsx when the tab shown is Next steps. Quiet on every failure: a missed open only leaves
 * the dot on until the next one.
 */
import { authConfigured, getUser } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function recordPlanOpen(studentId: string): Promise<{ ok: boolean }> {
  if (!isUuid(studentId) || !authConfigured()) return { ok: false };
  try {
    const user = await getUser();
    if (!user) return { ok: false };
    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from("plan_opens")
      .upsert({ user_id: user.id, student_id: studentId, last_at: new Date().toISOString() }, { onConflict: "user_id,student_id" });
    if (error) {
      console.warn(`plan opens: recording failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`plan opens: recording failed: ${err instanceof Error ? err.message : err}`);
    return { ok: false };
  }
}
