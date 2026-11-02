import { after } from "next/server";
import { AskNoticeList } from "@/components/org/AskNoticeList";
import { openAsksForStudent } from "@/lib/orgs";
import { askSatisfied } from "@/lib/org-caseload";
import { createServerSupabase } from "@/lib/supabase-server";
import type { PlanContext } from "@/lib/planner/types";

/**
 * The asks notice at the top of the student's Next steps (specs/product/counselor-portal.md "Asking a student for
 * something"; rendered by components/planner/PlanTabs.tsx). Reads org_open_asks with the viewer's session. A
 * record-section ask whose section is now filled, or a list ask once the list has a college, is closed here
 * (org_ask_done) and not shown; the asks the family sees are marked seen (org_ask_seen), so the office reads "Seen".
 * Both writes run after the response. The student and a parent see it; a counselor reads asks on the caseload's
 * student page instead. Fails soft: no notice, never a broken plan.
 */
export async function AskNotice({ ctx }: { ctx: Pick<PlanContext, "student" | "profile" | "items" | "viewer"> }) {
  if (!ctx.student || ctx.viewer.isCounselor) return null;
  const studentId = ctx.student.id;
  let asks;
  try {
    asks = await openAsksForStudent(studentId);
  } catch {
    return null;
  }
  if (asks.length === 0) return null;
  const facts = { profile: ctx.profile, listCount: ctx.items.length };
  const done = asks.filter((a) => askSatisfied(a, facts));
  const shown = asks.filter((a) => !askSatisfied(a, facts));
  const unseen = shown.filter((a) => a.seen_at === null);
  if (done.length > 0 || unseen.length > 0) {
    try {
      const supabase = await createServerSupabase();
      after(async () => {
        for (const a of done) {
          const { error } = await supabase.rpc("org_ask_done", { p_request: a.id });
          if (error) console.error(`org: org_ask_done failed: ${error.message}`);
        }
        for (const a of unseen) {
          const { error } = await supabase.rpc("org_ask_seen", { p_request: a.id });
          if (error) console.error(`org: org_ask_seen failed: ${error.message}`);
        }
      });
    } catch (err) {
      console.error(`org: closing asks failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return <AskNoticeList asks={shown} person={ctx.viewer.relation === "self" ? null : studentId} canAct={ctx.viewer.canEdit || ctx.viewer.relation === "self"} />;
}
