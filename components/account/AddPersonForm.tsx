"use client";

import { useActionState, useState } from "react";
import { GraduationCap, UserRound } from "lucide-react";
import { addPerson, type AddPersonState } from "@/app/household/actions";
import type { MemberRole } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { InviteLinkPanel, inputCls, primaryBtn } from "./InvitationControls";

function Field({ label, htmlFor, hint, children, className }: { label: React.ReactNode; htmlFor: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-sm font-semibold" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const optional = <span className="font-normal text-muted-foreground">(optional)</span>;

function RoleCard({
  value,
  checked,
  onChange,
  title,
  body,
  icon: Icon,
}: {
  value: MemberRole;
  checked: boolean;
  onChange: (v: MemberRole) => void;
  title: string;
  body: string;
  icon: typeof UserRound;
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-3 rounded-2xl border-2 p-3.5 transition-colors sm:p-4",
        checked ? "border-primary bg-primary/8" : "border-border hover:bg-muted/60",
      )}
    >
      <input type="radio" name="role" value={value} checked={checked} onChange={() => onChange(value)} className="sr-only" />
      <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}

/**
 * Add someone (specs/product/household-hub.md "Adding a person"): who they are first (two cards), then only what that
 * role needs. A guardian needs an email; a student's is optional (without one, a managed record). With `household`
 * empty (no household yet) it also names the household and asks which side the viewer is on, and adding the first
 * person creates the household.
 *
 * - `myRole`: the viewer's side in the household (or the default for a new one).
 * - `canAddStudents`: guardians add students; students add guardians only.
 * - `viewerIsStudent`: a student inviting a parent decides whether that parent may edit.
 */
export function AddPersonForm({
  household,
  myRole,
  canAddStudents,
  viewerIsStudent,
  defaultRole,
  defaultHouseholdName = "",
}: {
  household: string;
  myRole: MemberRole;
  canAddStudents: boolean;
  viewerIsStudent: boolean;
  defaultRole: MemberRole;
  defaultHouseholdName?: string;
}) {
  const [state, action, pending] = useActionState<AddPersonState, FormData>(addPerson, { status: "idle" });
  const solo = household === "";
  const [me, setMe] = useState<MemberRole>(myRole);
  const studentsAllowed = solo ? me === "guardian" : canAddStudents;
  const [role, setRole] = useState<MemberRole>(studentsAllowed ? defaultRole : "guardian");
  const effectiveRole: MemberRole = studentsAllowed ? role : "guardian";
  const studentInviting = solo ? me === "student" : viewerIsStudent;

  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4">
        <input type="hidden" name="household" value={household} />
        {solo && (
          <div className="grid gap-3 rounded-2xl bg-muted/50 p-3.5 sm:p-4">
            <Field label="Household name" htmlFor="household-name" hint="Everyone you add sees this name.">
              <input id="household-name" name="household_name" required maxLength={80} defaultValue={defaultHouseholdName} placeholder="The Garcia household" className={`${inputCls} mt-1.5`} />
            </Field>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <legend className="mb-1 text-sm font-semibold">You are</legend>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="my_role" value="guardian" checked={me === "guardian"} onChange={() => setMe("guardian")} className="size-4 accent-primary" />
                A parent or guardian
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="my_role" value="student" checked={me === "student"} onChange={() => setMe("student")} className="size-4 accent-primary" />
                The student
              </label>
            </fieldset>
          </div>
        )}

        <fieldset className="grid gap-2.5 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Who are you adding?</legend>
          <RoleCard
            value="guardian"
            checked={effectiveRole === "guardian"}
            onChange={setRole}
            icon={UserRound}
            title="A parent or guardian"
            body="They get a link by email to choose a password and join."
          />
          {studentsAllowed ? (
            <RoleCard
              value="student"
              checked={effectiveRole === "student"}
              onChange={setRole}
              icon={GraduationCap}
              title="A student"
              body="Start their list now. An email is optional."
            />
          ) : (
            <p className="self-center rounded-2xl border border-dashed p-3.5 text-xs text-muted-foreground sm:p-4">
              Only a parent or guardian can add a student. Add a parent, and they can add brothers or sisters.
            </p>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="add-first">
            <input id="add-first" name="first_name" required maxLength={60} autoComplete="off" className={`${inputCls} mt-1.5`} />
          </Field>
          <Field label={<>Last name {optional}</>} htmlFor="add-last">
            <input id="add-last" name="last_name" maxLength={60} autoComplete="off" className={`${inputCls} mt-1.5`} />
          </Field>
          <Field
            label={effectiveRole === "guardian" ? "Email" : <>Email {optional}</>}
            htmlFor="add-email"
            hint={effectiveRole === "student" ? "With an email, they get a link to set a password and the list becomes theirs." : undefined}
          >
            <input
              id="add-email"
              name="email"
              type="email"
              required={effectiveRole === "guardian"}
              autoComplete="off"
              placeholder="name@example.com"
              className={`${inputCls} mt-1.5`}
            />
          </Field>
          <Field label={<>Phone {optional}</>} htmlFor="add-phone" hint="Shown to your household only.">
            <input id="add-phone" name="phone" type="tel" autoComplete="off" placeholder="(615) 555-0100" className={`${inputCls} mt-1.5`} />
          </Field>
          {effectiveRole === "student" && (
            <Field label={<>High school class of {optional}</>} htmlFor="add-year">
              <input id="add-year" name="grad_year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="YYYY" className={`${inputCls} mt-1.5`} />
            </Field>
          )}
        </div>

        {effectiveRole === "guardian" && studentInviting && (
          <label className="inline-flex items-start gap-2 text-sm">
            <input type="checkbox" name="can_edit" className="mt-0.5 size-4 accent-primary" />
            <span>
              Let them edit my list and profile <span className="text-muted-foreground">(otherwise they can only look)</span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={primaryBtn}>
            {pending ? "Adding…" : solo ? "Start the household and add them" : "Add them"}
          </button>
          {state.status === "error" && (
            <p className="text-sm font-medium text-destructive" role="alert">
              {state.message}
            </p>
          )}
        </div>
      </form>

      {state.status === "added" && (
        <p className="rounded-2xl border border-pop bg-pop/10 px-3.5 py-3 text-sm font-semibold" role="status">
          Added {state.name}. Open their row above to start their list.
        </p>
      )}
      {state.status === "invited" && <InviteLinkPanel state={state} />}
    </div>
  );
}
