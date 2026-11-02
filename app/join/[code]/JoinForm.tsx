"use client";

import { useActionState, useState } from "react";
import { joinOrganization, type JoinActionState } from "./actions";
import type { JoinStudentChoice } from "@/lib/join-rules";
import { cn } from "@/lib/utils";

const primary =
  "inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:w-auto";

/**
 * Join on /join/[code]: for the signed-in student's own record (no `students`), for one of the students a guardian
 * can see (`students`: pick one; the first is chosen to start), or, with `side="counselor"`, as a member. The Server
 * Action redirects on success; a refusal shows as one line under the button.
 */
export function JoinForm({
  segment,
  label,
  students,
  side = "student",
}: {
  segment: string;
  label: string;
  students?: JoinStudentChoice[];
  side?: "student" | "counselor";
}) {
  const [state, action, pending] = useActionState<JoinActionState, FormData>(joinOrganization, { status: "idle" });
  const [picked, setPicked] = useState(students?.[0]?.id ?? "");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="segment" value={segment} />
      <input type="hidden" name="side" value={side} />
      {students && students.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Which student is joining?</legend>
          {students.map((s) => (
            <label
              key={s.id}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm font-medium",
                picked === s.id ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <input type="radio" name="student" value={s.id} checked={picked === s.id} onChange={() => setPicked(s.id)} className="size-4 accent-primary" />
              <span className="min-w-0 break-words">{s.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Joining…" : label}
      </button>
      {state.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
