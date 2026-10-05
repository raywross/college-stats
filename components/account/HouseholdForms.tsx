"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import {
  addManagedStudent,
  createHousehold,
  inviteToHousehold,
  reissueInvitation,
  type HouseholdActionState,
  type InviteState,
} from "@/app/account/household/actions";
import { SITE_NAME } from "@/lib/brand";
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
}: {
  household: string;
  canInviteStudents: boolean;
  isStudent: boolean;
  managedStudents: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteToHousehold, { status: "idle" });
  const [side, setSide] = useState<"guardian" | "student">("guardian");
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
        {canInviteStudents ? (
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
        {side === "student" && managedStudents.length > 0 && (
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

      {state.status === "created" && <InviteLinkPanel state={state} />}
    </div>
  );
}

/** The invitation link to copy (and whether it was also emailed), after creating or reissuing one. */
function InviteLinkPanel({ state, reissued = false }: { state: Extract<InviteState, { status: "created" }>; reissued?: boolean }) {
  return (
    <div className="space-y-2 rounded-2xl border border-pop bg-pop/10 p-3.5 sm:p-4" role="status">
      <p className="text-sm font-semibold">
        {state.emailed
          ? `We emailed ${reissued ? "a new invitation link" : "an invitation"} to ${state.email}.`
          : `Send this ${reissued ? "new " : ""}link to ${state.email}.`}
      </p>
      <p className="text-xs text-muted-foreground">
        {state.emailed
          ? "You can also send them this link yourself."
          : "Email isn't set up on this site yet, so send it by text or your own email."}{" "}
        It works once, for {state.email} only, until {state.expires}.{reissued ? " Any earlier link for this invitation no longer works." : ""} Need it
        again later? Use &ldquo;New link&rdquo; under Waiting for an answer.
      </p>
      <CopyLink link={state.link} />
    </div>
  );
}

/**
 * "New link" on a pending invitation: makes a fresh link (the old one stops working), emails it when email is set up,
 * and shows it to copy either way.
 */
export function ReissueInvitation({ household, invitation }: { household: string; invitation: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(reissueInvitation, { status: "idle" });
  return (
    <>
      <form action={action}>
        <input type="hidden" name="household" value={household} />
        <input type="hidden" name="invitation" value={invitation} />
        <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted disabled:opacity-60">
          <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
          {pending ? "Making…" : "New link"}
        </button>
      </form>
      {state.status === "error" && (
        <p className="basis-full text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
      {state.status === "created" && (
        <div className="basis-full">
          <InviteLinkPanel state={state} reissued />
        </div>
      )}
    </>
  );
}

/**
 * "Link to their account" on a managed student: invites the student's email to take over the record. If they already
 * have an account and a record of their own, accepting merges this one into theirs (lists, numbers, household).
 */
export function LinkManagedStudent({ household, student, name }: { household: string; student: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteToHousehold, { status: "idle" });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted">
        <Link2 className="size-3.5" />
        Link to their account
      </button>
    );
  return (
    <div className="basis-full space-y-3 rounded-2xl border bg-muted/40 p-3.5 sm:p-4">
      {state.status === "created" ? (
        <InviteLinkPanel state={state} />
      ) : (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="household" value={household} />
          <input type="hidden" name="side" value="student" />
          <input type="hidden" name="student" value={student} />
          <p className="text-sm">
            Enter the email {name} uses (or will use) for {SITE_NAME}. When they accept, everything you started for them becomes
            theirs, and you keep access through the household. If they already have an account, it&apos;s added to theirs.
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="block text-sm font-semibold" htmlFor={`link-email-${student}`}>
                {name}&apos;s email
              </label>
              <input id={`link-email-${student}`} name="email" type="email" required autoComplete="off" placeholder="name@example.com" className={`${inputCls} mt-1.5`} />
            </div>
            <button type="submit" disabled={pending} className={primaryBtn}>
              {pending ? "Creating link…" : "Create link"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <Message state={state} />
          </div>
        </form>
      )}
    </div>
  );
}
