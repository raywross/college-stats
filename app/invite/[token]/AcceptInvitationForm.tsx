"use client";

import { useActionState } from "react";
import { acceptInvitation, type AcceptState } from "./actions";

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInvitation, { status: "idle" });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? "Joining…" : "Accept invitation"}
      </button>
      {state.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
