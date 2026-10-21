"use client";

import { useActionState, useState } from "react";
import { revokeKey, type RevokeKeyState } from "@/app/account/api-keys/actions";

/**
 * Revoke with a confirm step: "Revoke" asks "Revoke this key? It stops working at once.", and only the second button
 * sends the Server Action. The refusal, if any, shows under it.
 */
export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<RevokeKeyState, FormData>(revokeKey, { status: "idle" });
  const [confirming, setConfirming] = useState(false);

  if (!confirming)
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-9 items-center rounded-full border border-destructive/40 px-3.5 text-sm font-semibold text-destructive hover:bg-destructive/10"
        aria-label={`Revoke ${name}`}
      >
        Revoke
      </button>
    );

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm">
        Revoke this key? It stops working at once.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center rounded-full bg-destructive px-3.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Revoking…" : "Yes, revoke"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-semibold hover:bg-muted disabled:opacity-60"
        >
          Keep
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
