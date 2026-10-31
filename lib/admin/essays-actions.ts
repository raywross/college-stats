"use server";
/**
 * The hand-read form's Server Actions (specs/product/essays/sources.md "The hand read"; app/admin/essays/[unit]).
 * Owner, 2026-10-30: the database is the source of truth, so a save takes effect at once. Save rebuilds the record from
 * the posted draft with the college's id and name from the dataset (never from the form), validates it
 * (`validateConfirmed`, through `draftProblems`), and writes the row with `admin_set_essay_prompts` on the admin's own
 * session, as `admin_set_setting` is called (the function checks is_admin() and logs `essays.set`); Delete removes it
 * with `admin_delete_essay_prompts` after a typed confirmation. Both revalidate the advisor and the console's pages.
 * The next snapshot carries it to the public pages (the publisher reads the table); the console never writes a file
 * or opens a PR.
 *
 * Only Server Actions are exported here (every export of a "use server" module is callable from a browser).
 */
import { revalidatePath } from "next/cache";
import { withAdmin } from "@/lib/admin/console-actions";
import { BAD_FORM_MESSAGE, CONFIRM_DELETE_RECORD, typedMatches, type AdminActionState } from "@/lib/admin/console";
import { draftProblems, parseDraft, recordFromDraft } from "@/lib/admin/essays-form";
import { DELETED_MESSAGE, SAVED_MESSAGE, essaySaveErrorMessage } from "@/lib/admin/essays";
import { currentCycle } from "@/lib/planner/cycle";
import { getData } from "@/lib/data";

const UNIT = /^\d{6,8}$/;
const CYCLE = /^\d{4}-\d{2}$/;

function revalidate(unit: string) {
  revalidatePath("/advisor", "layout");
  revalidatePath("/admin/essays");
  revalidatePath(`/admin/essays/${unit}`);
}

/** Save one college's hand-read questions for the open cycle. Form: `unit`, `draft` (the form's state as JSON). */
export async function saveEssayPrompts(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("essay prompts save", async (ctx) => {
    const unit = form.get("unit");
    const rawDraft = form.get("draft");
    if (typeof unit !== "string" || !UNIT.test(unit) || typeof rawDraft !== "string" || rawDraft.length > 200_000) return { status: "error", message: BAD_FORM_MESSAGE };
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDraft);
    } catch {
      return { status: "error", message: BAD_FORM_MESSAGE };
    }
    const draft = parseDraft(parsed);
    if (!draft) return { status: "error", message: BAD_FORM_MESSAGE };
    const school = (await getData()).getSchoolById(unit);
    if (!school) return { status: "error", message: BAD_FORM_MESSAGE };

    const college = { unit_id: unit, name: school.name };
    const today = new Date().toISOString().slice(0, 10);
    const problems = draftProblems(draft, college, { openCycle: currentCycle(today), today });
    if (problems.length) return { status: "error", message: `Check the form: ${problems.join("; ")}.` };
    const record = recordFromDraft(draft, college);

    const { error } = await ctx.supabase.rpc("admin_set_essay_prompts", { p_unit: unit, p_cycle: record.cycle, p_record: record });
    if (error) {
      console.error(`admin: essay prompts save failed: ${error.message ?? "unknown error"}`);
      return { status: "error", message: essaySaveErrorMessage(error) };
    }
    revalidate(unit);
    return { status: "done", message: SAVED_MESSAGE };
  });
}

/** Delete one college's saved questions for a cycle. Form: `unit`, `cycle`, `confirm` (the word "delete"). */
export async function deleteEssayPrompts(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("essay prompts delete", async (ctx) => {
    const unit = form.get("unit");
    const cycle = form.get("cycle");
    if (typeof unit !== "string" || !UNIT.test(unit) || typeof cycle !== "string" || !CYCLE.test(cycle)) return { status: "error", message: BAD_FORM_MESSAGE };
    if (!typedMatches(form.get("confirm"), CONFIRM_DELETE_RECORD)) return { status: "error", message: `Type "${CONFIRM_DELETE_RECORD}" to confirm.` };
    const { error } = await ctx.supabase.rpc("admin_delete_essay_prompts", { p_unit: unit, p_cycle: cycle });
    if (error) {
      console.error(`admin: essay prompts delete failed: ${error.message ?? "unknown error"}`);
      return { status: "error", message: essaySaveErrorMessage(error) };
    }
    revalidate(unit);
    return { status: "done", message: DELETED_MESSAGE };
  });
}
