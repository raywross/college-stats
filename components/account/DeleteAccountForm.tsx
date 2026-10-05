"use client";

import { useActionState, useState } from "react";
import { deleteAccount, type DeleteState } from "@/app/account/delete/actions";
import { DELETE_CONFIRMATION } from "@/lib/household-rules";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** Type "delete", then the button deletes the account and signs out. */
export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccount, { status: "idle" });
  const [typed, setTyped] = useState("");
  const ready = typed.trim().toLowerCase() === DELETE_CONFIRMATION;
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="block text-sm font-semibold" htmlFor="delete-confirm">
          Type <span className="font-mono">{DELETE_CONFIRMATION}</span> to confirm
        </label>
        <input
          id="delete-confirm"
          name="confirm"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className={`${inputCls} mt-1.5 sm:max-w-xs`}
        />
      </div>
      <button
        type="submit"
        disabled={!ready || pending}
        className="inline-flex h-10 items-center rounded-full bg-destructive px-5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete my account"}
      </button>
      {state.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
