"use client";

import { useActionState, useEffect, useRef } from "react";
import { addOrgNote, askStudent, type OrgActionState } from "@/app/org/actions";
import { ORG_ASK_NOTE_MAX, ORG_NOTE_MAX } from "@/lib/org-rules";

const fieldCls =
  "w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const submitCls = "inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60";

/** Clears the form once its action succeeds. */
function useResetOnDone(state: OrgActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "done") ref.current?.reset();
  }, [state]);
  return ref;
}

/** A note for the office (every member reads and writes; the family never sees it). */
export function NoteForm({ orgId, studentId }: { orgId: string; studentId: string }) {
  const [state, run, pending] = useActionState<OrgActionState, FormData>(addOrgNote, { status: "idle" });
  const ref = useResetOnDone(state);
  return (
    <form ref={ref} action={run} className="space-y-2">
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="student" value={studentId} />
      <label className="sr-only" htmlFor={`note-${studentId}`}>
        A note
      </label>
      <textarea id={`note-${studentId}`} name="body" rows={2} maxLength={ORG_NOTE_MAX} required placeholder="Met Tuesday; wants to visit Ohio schools in March." className={`${fieldCls} py-2.5`} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={submitCls}>
          {pending ? "Saving…" : "Add note"}
        </button>
        {state.status === "error" && (
          <span role="alert" className="text-xs font-medium text-destructive">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

/** One custom line to the student ("Bring your activities list Thursday"), at most 200 characters. */
export function CustomAskForm({ orgId, studentId, firstName }: { orgId: string; studentId: string; firstName: string }) {
  const [state, run, pending] = useActionState<OrgActionState, FormData>(askStudent, { status: "idle" });
  const ref = useResetOnDone(state);
  return (
    <form ref={ref} action={run} className="space-y-2">
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="student" value={studentId} />
      <input type="hidden" name="kind" value="custom" />
      <label htmlFor={`ask-${studentId}`} className="text-xs font-semibold text-muted-foreground">
        Ask {firstName} for something else
      </label>
      <div className="flex gap-2">
        <input id={`ask-${studentId}`} name="note" required maxLength={ORG_ASK_NOTE_MAX} placeholder="Send me your activities list" className={`${fieldCls} h-10`} />
        <button type="submit" disabled={pending} className={submitCls}>
          {pending ? "Asking…" : "Ask"}
        </button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
