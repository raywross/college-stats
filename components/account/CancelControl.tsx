"use client";

import { useActionState } from "react";
import { setCancel, type BillingActionState } from "@/app/account/billing-actions";

/** Cancel (at the period's end) or Keep, with the outcome in a line under it. */
export function CancelControl({ subscriptionId, cancelled, trialing }: { subscriptionId: string; cancelled: boolean; trialing: boolean }) {
  const [state, action, pending] = useActionState<BillingActionState, FormData>(setCancel, { status: "idle" });
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="subscription" value={subscriptionId} />
      <input type="hidden" name="cancel" value={cancelled ? "0" : "1"} />
      <button type="submit" disabled={pending} className={`inline-flex h-9 items-center rounded-full border px-4 text-xs font-semibold disabled:opacity-60 ${cancelled ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
        {pending ? "One moment…" : cancelled ? "Keep it" : trialing ? "Cancel trial" : "Cancel"}
      </button>
      {state.status !== "idle" && (
        <p role="status" className={`text-xs ${state.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
