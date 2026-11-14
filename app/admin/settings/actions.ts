"use server";

import { refresh } from "next/cache";
import { callAdminRpc, withAdmin } from "@/lib/admin/console-actions";
import { BAD_FORM_MESSAGE, type AdminActionState } from "@/lib/admin/console";
import { ALL_MOVES_SETTING } from "@/lib/planner/all-moves-server";
import { isoDay, pretendTodayLine, TODAY_SETTING } from "@/lib/planner/today";
import { PRICE_LIVE_SETTING } from "@/lib/billing";

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

/**
 * Turn the Advisor's price on (`live` = "1": the setting becomes this moment) or off (`live` = "0": cleared, and the
 * Advisor is free for everyone again). Accounts created before the moment are early accounts (specs/product/open-doors.md).
 */
export async function setPriceLive(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("setting change", async (ctx) => {
    const live = form.get("live");
    if (live !== "1" && live !== "0") return { status: "error", message: BAD_FORM_MESSAGE };
    const value = live === "1" ? new Date().toISOString() : null;
    const failed = await callAdminRpc(ctx, "setting change", "admin_set_setting", { p_key: PRICE_LIVE_SETTING, p_value: value });
    if (failed) return failed;
    refresh();
    return { status: "done", message: value ? "The price is live. New accounts start a trial; accounts made before this moment keep the advisor free through the cycle." : "Cleared. The advisor is free for everyone again." };
  });
}

/** Set the planner's pretend today (`today` = a YYYY-MM-DD) or clear it (`today` = ""). Ignored in production either way. */
export async function setPretendToday(_prev: AdminActionState, form: FormData): Promise<AdminActionState> {
  return withAdmin("setting change", async (ctx) => {
    const raw = form.get("today");
    if (typeof raw !== "string") return { status: "error", message: BAD_FORM_MESSAGE };
    const day = raw.trim() === "" ? null : isoDay(raw.trim());
    if (raw.trim() !== "" && !day) return { status: "error", message: "That isn't a date. Use YYYY-MM-DD." };
    const failed = await callAdminRpc(ctx, "setting change", "admin_set_setting", { p_key: TODAY_SETTING, p_value: day });
    if (failed) return failed;
    refresh();
    return { status: "done", message: day ? `${pretendTodayLine(day)} Every plan follows it on its next open.` : "Cleared. Every plan is back on the real date on its next open." };
  });
}
