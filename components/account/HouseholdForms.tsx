"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  addManagedStudent,
  createHousehold,
  inviteToHousehold,
  type HouseholdActionState,
  type InviteState,
} from "@/app/account/household/actions";
import { cn } from "@/lib/utils";

/** Forms on /account and /account/household: create a household, add a managed student, invite someone. */

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const primaryBtn = "inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60";

function Message({ state }: { state: HouseholdActionState | InviteState }) {
  if (state.status === "error")
    return (
      <p className="text-sm font-medium text-destructive" role="alert">
        {state.message}
      </p>
    );
  if (state.status === "done" && state.message)
    return (
      <p className="text-sm font-medium text-muted-foreground" role="status">
        {state.message}
      </p>
    );
  return null;
}

/** Name the household and say which side you're on. Opens /account/household when created. */
export function CreateHouseholdForm({ defaultRole, compact = false }: { defaultRole: "guardian" | "student"; compact?: boolean }) {
  const [state, action, pending] = useActionState<HouseholdActionState, FormData>(createHousehold, { status: "idle" });
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label className="block text-sm font-semibold" htmlFor="household-name">
          {compact ? "Start a household" : "Household name"}
        </label>
        <input id="household-name" name="name" required maxLength={80} placeholder="The Garcias" className={`${inputCls} mt-1.5`} />
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:col-span-2 sm:row-start-2">
        <legend className="sr-only">You&apos;re joining as</legend>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="role" value="guardian" defaultChecked={defaultRole === "guardian"} className="size-4 accent-primary" />
          I&apos;m a parent or guardian
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" name="role" value="student" defaultChecked={defaultRole === "student"} className="size-4 accent-primary" />
          I&apos;m the student
        </label>
      </fieldset>
      <button type="submit" disabled={pending} className={primaryBtn}>
        {pending ? "Creating…" : "Create household"}
      </button>
      <div className="sm:col-span-2">
        <Message state={state} />
      </div>
    </form>
  );
}

/** A child who doesn't have an account yet: a record the guardian keeps until the child claims it. */
export function AddManagedStudentForm({ household }: { household: string }) {
  const [state, action, pending] = useActionState<HouseholdActionState, FormData>(addManagedStudent, { status: "idle" });
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
      <input type="hidden" name="household" value={household} />
      <div>
        <label className="block text-sm font-semibold" htmlFor={`managed-name-${household}`}>
          Student&apos;s name
        </label>
        <input id={`managed-name-${household}`} name="name" required maxLength={80} placeholder="First name is fine" className={`${inputCls} mt-1.5`} />
      </div>
      <div>
        <label className="block text-sm font-semibold" htmlFor={`managed-year-${household}`}>
          Class of
        </label>
        <input id={`managed-year-${household}`} name="grad_year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="YYYY" className={`${inputCls} mt-1.5`} />
      </div>
      <button type="submit" disabled={pending} className={primaryBtn}>
        {pending ? "Adding…" : "Add student"}
      </button>
      <div className="sm:col-span-3">
        <Message state={state} />
      </div>
    </form>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className={cn(inputCls, "h-10 font-mono text-xs")} />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Invite by email. Guardians may invite either side (and link a managed student for the child to claim); students
 * invite guardians and decide whether they may edit. The link is shown once, to copy, whether or not it was emailed.
 */
export function InviteForm({
  household,
  canInviteStudents,
  isStudent,
  managedStudents,
  handoverOnly = false,
}: {
  household: string;
  canInviteStudents: boolean;
  isStudent: boolean;
  managedStudents: { id: string; name: string }[];
  /** A full household: only handing a managed student over to their own account (which takes no new seat). */
  handoverOnly?: boolean;
}) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteToHousehold, { status: "idle" });
  const [side, setSide] = useState<"guardian" | "student">(handoverOnly ? "student" : "guardian");
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-3">
        <input type="hidden" name="household" value={household} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="block text-sm font-semibold" htmlFor={`invite-email-${household}`}>
              Their email
            </label>
            <input id={`invite-email-${household}`} name="email" type="email" required autoComplete="off" placeholder="name@example.com" className={`${inputCls} mt-1.5`} />
          </div>
          <button type="submit" disabled={pending} className={primaryBtn}>
            {pending ? "Creating link…" : "Create invitation"}
          </button>
        </div>
        {handoverOnly ? (
          <>
            <input type="hidden" name="side" value="student" />
            <div>
              <label className="block text-sm font-semibold" htmlFor={`invite-student-${household}`}>
                Which student
              </label>
              <select id={`invite-student-${household}`} name="student" required defaultValue={managedStudents[0]?.id ?? ""} className={`${inputCls} mt-1.5 sm:max-w-xs`}>
                {managedStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">When they accept, the record becomes theirs and you keep access through the household.</p>
            </div>
          </>
        ) : canInviteStudents ? (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <legend className="sr-only">Invite them as</legend>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="side" value="guardian" checked={side === "guardian"} onChange={() => setSide("guardian")} className="size-4 accent-primary" />
              A parent or guardian
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="side" value="student" checked={side === "student"} onChange={() => setSide("student")} className="size-4 accent-primary" />
              A student
            </label>
          </fieldset>
        ) : (
          <input type="hidden" name="side" value="guardian" />
        )}
        {!handoverOnly && side === "student" && managedStudents.length > 0 && (
          <div>
            <label className="block text-sm font-semibold" htmlFor={`invite-student-${household}`}>
              Hand over a student you added
            </label>
            <select id={`invite-student-${household}`} name="student" defaultValue="" className={`${inputCls} mt-1.5 sm:max-w-xs`}>
              <option value="">No, they&apos;ll start fresh</option>
              {managedStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted-foreground">When they accept, the record becomes theirs and you keep access through the household.</p>
          </div>
        )}
        {side === "guardian" && isStudent && (
          <label className="inline-flex items-start gap-2 text-sm">
            <input type="checkbox" name="can_edit" className="mt-0.5 size-4 accent-primary" />
            <span>
              Let them edit my list and profile <span className="text-muted-foreground">(otherwise they can only look)</span>
            </span>
          </label>
        )}
        <Message state={state} />
      </form>

      {state.status === "created" && (
        <div className="space-y-2 rounded-2xl border border-pop bg-pop/10 p-3.5 sm:p-4" role="status">
          <p className="text-sm font-semibold">
            {state.emailed ? `We emailed an invitation to ${state.email}.` : `Send this link to ${state.email}.`}
          </p>
          <p className="text-xs text-muted-foreground">
            {state.emailed
              ? "You can also send them this link yourself."
              : "Email isn't set up on this copy of the site yet, so send it by text or your own email."}{" "}
            It works once, for {state.email} only, until {state.expires}. We won&apos;t show it again.
          </p>
          <CopyLink link={state.link} />
        </div>
      )}
    </div>
  );
}
