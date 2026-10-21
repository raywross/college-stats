"use server";

import { refresh } from "next/cache";
import { callAdminRpc, withAdmin } from "@/lib/admin/console-actions";
import { BAD_FORM_MESSAGE, type AdminActionState } from "@/lib/admin/console";
import { ALL_MOVES_SETTING } from "@/lib/planner/all-moves-server";

/** Site settings (specs/product/admin.md "Settings"): one switch per setting. The database checks the key and value. */

/** Turn the planner's all-moves preview on or off (`on` = "1" or "0"). */
export async function setAllMoves(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("setting change", async (ctx) => {
    const on = form.get("on");
    if (on !== "1" && on !== "0") return { status: "error", message: BAD_FORM_MESSAGE };
    const failed = await callAdminRpc(ctx, "setting change", "admin_set_setting", { p_key: ALL_MOVES_SETTING, p_value: on === "1" });
    if (failed) return failed;
    refresh();
    return { status: "done", message: on === "1" ? "On. Each plan shows every move on its next open." : "Off. Each plan is back to the normal tab on its next open." };
  });
}
