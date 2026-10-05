"use client";

import { useActionState, useState } from "react";
import { importLocalProfileAction, type ImportState } from "@/app/me/actions";
import { markImportOffered, useLocalProfile, useShouldOfferImport } from "./useLocalProfile";

/**
 * The one-time "save what you entered before signing in?" offer (student-profile.md "Behavior"): shown once, right
 * after sign-in, when the browser has local answers worth keeping. Declining (or importing) hides it for good.
 */
export function ImportLocalProfile({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const { data } = useLocalProfile();
  const shouldOffer = useShouldOfferImport();
  const [dismissed, setDismissed] = useState(false);
  const [state, action, pending] = useActionState<ImportState, FormData>(importLocalProfileAction, { status: "idle" });

  if (!canEdit || !shouldOffer || dismissed || state.status !== "idle") return null;

  return (
    <div className="rounded-2xl border border-dashed bg-pop/10 p-4 text-sm">
      <p className="font-semibold">Save what you entered before signing in?</p>
      <p className="mt-1 text-muted-foreground">
        You answered some of this on this browser before signing in. Importing fills in only what&apos;s still blank — it won&apos;t overwrite anything you&apos;ve already saved.
      </p>
      <form
        action={action}
        className="mt-3 flex gap-2"
        onSubmit={() => {
          markImportOffered();
        }}
      >
        <input type="hidden" name="student_id" value={studentId} />
        <input type="hidden" name="local_profile" value={JSON.stringify(data)} />
        <button type="submit" disabled={pending} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? "Importing…" : "Import"}
        </button>
        <button
          type="button"
          onClick={() => {
            markImportOffered();
            setDismissed(true);
          }}
          className="inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted"
        >
          No thanks
        </button>
      </form>
    </div>
  );
}
