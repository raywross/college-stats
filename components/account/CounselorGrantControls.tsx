"use client";

import { useState, useTransition } from "react";
import { endCounselorAccess, setCounselorCanEdit, type CounselorActionState } from "@/app/account/counselor-actions";
import { cn } from "@/lib/utils";

/**
 * One grant's controls in "Your counselors": Can edit / View only (a two-way switch; the change shows at once and
 * goes back if refused) and End access (after a browser confirm naming the organization).
 */
export function CounselorGrantControls({ grantId, orgName, canEdit: initial, whose }: { grantId: string; orgName: string; canEdit: boolean; whose: string }) {
  const [canEdit, setCanEdit] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: (prev: CounselorActionState, form: FormData) => Promise<CounselorActionState>, fields: Record<string, string>, undo?: () => void) => {
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set("grant", grantId);
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      const result = await action({ status: "idle" }, form);
      if (result.status === "error") {
        undo?.();
        setError(result.message);
      }
    });
  };
  const choose = (next: boolean) => {
    if (next === canEdit) return;
    setCanEdit(next);
    run(setCounselorCanEdit, { can_edit: next ? "1" : "0" }, () => setCanEdit(!next));
  };
  const end = () => {
    if (!window.confirm(`End ${orgName}'s access? They stop seeing ${whose} information right away. Joining again takes their code or a new invitation.`)) return;
    run(endCounselorAccess, {});
  };

  const seg = (on: boolean) =>
    cn("inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold transition-colors disabled:opacity-60", on ? "bg-primary text-primary-foreground" : "hover:bg-muted");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={`What ${orgName} can do`} className="inline-flex rounded-full border p-0.5">
          <button type="button" aria-pressed={canEdit} disabled={pending} onClick={() => choose(true)} className={seg(canEdit)}>
            Can edit
          </button>
          <button type="button" aria-pressed={!canEdit} disabled={pending} onClick={() => choose(false)} className={seg(!canEdit)}>
            View only
          </button>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={end}
          className="inline-flex h-9 items-center rounded-full border border-destructive/40 px-3.5 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
        >
          End access
        </button>
      </div>
      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
