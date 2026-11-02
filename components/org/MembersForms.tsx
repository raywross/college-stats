"use client";

import { useActionState, useState } from "react";
import { HighSchoolPicker } from "@/components/high-schools/HighSchoolPicker";
import { CopyLinkField } from "@/components/account/InvitationControls";
import { deleteOrganization, inviteCounselor, updateOrganization, type InviteCounselorState, type OrgActionState } from "@/app/org/actions";
import { ORG_NAME_MAX, type OrgKind } from "@/lib/org-rules";
import { ORG_DELETE_CONFIRMATION } from "@/lib/org-caseload";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const primaryBtn = "inline-flex h-10 shrink-0 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60";

function Message({ state }: { state: OrgActionState | InviteCounselorState }) {
  if (state.status === "error")
    return (
      <p role="alert" className="text-sm font-medium text-destructive">
        {state.message}
      </p>
    );
  if (state.status === "done" && state.message)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {state.message}
      </p>
    );
  return null;
}

/** The owner edits the organization's name, website, and (for a school) its high school. */
export function OrgSettingsForm({
  org,
}: {
  org: { id: string; name: string; kind: OrgKind; website: string | null; ncessch: string | null; highSchoolName: string | null };
}) {
  const [state, run, pending] = useActionState<OrgActionState, FormData>(updateOrganization, { status: "idle" });
  return (
    <form action={run} className="max-w-xl space-y-4">
      <input type="hidden" name="org" value={org.id} />
      <div className="space-y-1.5">
        <label htmlFor="org-name" className="text-sm font-semibold">
          Name
        </label>
        <input id="org-name" name="name" required maxLength={ORG_NAME_MAX} defaultValue={org.name} className={inputCls} />
      </div>
      {org.kind === "school" && (
        <div className="space-y-1.5">
          <label htmlFor="highSchool" className="text-sm font-semibold">
            High school
          </label>
          <HighSchoolPicker idName="highSchoolId" nameName="highSchool" defaultId={org.ncessch} defaultName={org.highSchoolName} />
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="org-website" className="text-sm font-semibold">
          Website <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input id="org-website" name="website" maxLength={200} defaultValue={org.website ?? ""} inputMode="url" className={inputCls} />
      </div>
      <Message state={state} />
      <button type="submit" disabled={pending} className={primaryBtn}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

/** Invite a counselor by email: a 30-day link, emailed when email is set up, always shown to copy. */
export function InviteCounselorForm({ orgId }: { orgId: string }) {
  const [state, run, pending] = useActionState<InviteCounselorState, FormData>(inviteCounselor, { status: "idle" });
  return (
    <div className="space-y-3">
      <form action={run} className="flex max-w-xl flex-col gap-2 sm:flex-row">
        <input type="hidden" name="org" value={orgId} />
        <label className="sr-only" htmlFor="counselor-email">
          The counselor&apos;s email
        </label>
        <input id="counselor-email" name="email" type="email" required placeholder="colleague@example.com" className={inputCls} />
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Inviting…" : "Invite"}
        </button>
      </form>
      <Message state={state} />
      {state.status === "invited" && (
        <div className="max-w-xl space-y-2 rounded-2xl border border-pop bg-pop/10 p-3.5" role="status">
          <p className="text-sm font-semibold break-words">
            {state.emailed ? `We emailed a link to ${state.email}.` : `Send ${state.email} this link.`} It works until {state.expires}.
          </p>
          <CopyLinkField link={state.link} />
        </div>
      )}
    </div>
  );
}

/** Delete the organization: the owner types the confirmation word. Every grant ends; the students' own data stays. */
export function DeleteOrgForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [state, run, pending] = useActionState<OrgActionState, FormData>(deleteOrganization, { status: "idle" });
  const [typed, setTyped] = useState("");
  return (
    <form action={run} className="max-w-xl space-y-2">
      <input type="hidden" name="org" value={orgId} />
      <label htmlFor="org-delete" className="text-sm">
        Type <span className="font-semibold">{ORG_DELETE_CONFIRMATION}</span> to delete {orgName}. Every student&apos;s access ends, and your notes and asks are deleted. Students keep
        everything that is theirs.
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="org-delete" name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={inputCls} />
        <button
          type="submit"
          disabled={pending || typed.trim().toLowerCase() !== ORG_DELETE_CONFIRMATION}
          className="inline-flex h-11 shrink-0 items-center rounded-full border border-destructive/40 px-5 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete organization"}
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
