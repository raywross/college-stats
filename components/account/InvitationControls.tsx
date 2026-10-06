"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { copyInvitationLink, inviteManagedStudent, resendInvitation, type AddPersonState } from "@/app/household/actions";
import { SITE_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The invitation pieces of the household hub (specs/product/household-hub.md "The roster"): the link panel shown after
 * adding or re-sending, and the roster row's Copy link, Send again, and Invite them controls.
 */

export const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
export const primaryBtn =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60";
const rowBtn = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted disabled:opacity-60";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A read-only field with the link and a Copy button. */
export function CopyLinkField({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className={cn(inputCls, "h-10 font-mono text-xs")} />
      <button
        type="button"
        onClick={async () => {
          const ok = await writeClipboard(link);
          setCopied(ok);
          if (ok) setTimeout(() => setCopied(false), 2000);
        }}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** After an invitation is created or sent again: whether it was emailed, and the link to copy. */
export function InviteLinkPanel({ state, resent = false }: { state: Extract<AddPersonState, { status: "invited" }>; resent?: boolean }) {
  const first = state.name.split(" ")[0] || state.name;
  return (
    <div className="space-y-2 rounded-2xl border border-pop bg-pop/10 p-3.5 sm:p-4" role="status">
      <p className="text-sm font-semibold break-words">
        {state.emailed ? `We emailed ${resent ? "a new link" : "a link"} to ${first} at ${state.email}.` : `Send ${first} this ${resent ? "new " : ""}link.`}
      </p>
      <p className="text-xs text-muted-foreground">
        {state.emailed ? "You can also send it yourself, by text or your own email." : "Email isn't set up on this site yet, so send it by text or your own email."}{" "}
        Opening it lets {first} choose a password and join; it works for {state.email} only, until {state.expires}.
        {resent ? " The earlier link no longer works." : " Copy it again any time from their row."}
      </p>
      {state.link && <CopyLinkField link={state.link} />}
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="basis-full text-sm font-medium text-destructive" role="alert">
      {message}
    </p>
  );
}

/** "Copy link" on an invited row: the link already sent (nothing new is minted). */
export function CopyInvitationButton({ invitation }: { invitation: string }) {
  const [state, setState] = useState<"idle" | "copied" | { error: string } | { link: string }>("idle");
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={rowBtn}
        onClick={() =>
          start(async () => {
            const r = await copyInvitationLink(invitation);
            if ("error" in r) return setState({ error: r.error });
            // Clipboard access can be refused (an old browser, an iframe): show the link to copy by hand instead.
            if (await writeClipboard(r.link)) {
              setState("copied");
              setTimeout(() => setState("idle"), 2000);
            } else setState({ link: r.link });
          })
        }
      >
        {state === "copied" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {state === "copied" ? "Copied" : "Copy link"}
      </button>
      {typeof state === "object" && "error" in state && <ErrorLine message={state.error} />}
      {typeof state === "object" && "link" in state && (
        <div className="basis-full">
          <CopyLinkField link={state.link} />
        </div>
      )}
    </>
  );
}

/** "Send again": a fresh seven-day link (the old one stops working), emailed when email is set up. */
export function ResendInvitationButton({ household, invitation, name }: { household: string; invitation: string; name: string }) {
  const [state, action, pending] = useActionState<AddPersonState, FormData>(resendInvitation, { status: "idle" });
  return (
    <>
      <form action={action}>
        <input type="hidden" name="household" value={household} />
        <input type="hidden" name="invitation" value={invitation} />
        <input type="hidden" name="name" value={name} />
        <button type="submit" disabled={pending} className={rowBtn}>
          <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
          {pending ? "Sending…" : "Send again"}
        </button>
      </form>
      {state.status === "error" && <ErrorLine message={state.message} />}
      {state.status === "invited" && (
        <div className="basis-full">
          <InviteLinkPanel state={state} resent />
        </div>
      )}
    </>
  );
}

/**
 * "Invite them" on a managed student's row: their email, then a link that hands the record over when they set a
 * password. If they already have an account, accepting adds this record to theirs.
 */
export function InviteManagedStudent({ household, student, name }: { household: string; student: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AddPersonState, FormData>(inviteManagedStudent, { status: "idle" });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={rowBtn}>
        <Link2 className="size-3.5" />
        Invite them
      </button>
    );
  return (
    <div className="basis-full space-y-3 rounded-2xl border bg-muted/40 p-3.5 sm:p-4">
      {state.status === "invited" ? (
        <InviteLinkPanel state={state} />
      ) : (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="household" value={household} />
          <input type="hidden" name="student" value={student} />
          <input type="hidden" name="name" value={name} />
          <p className="text-sm">
            Enter the email {name} uses (or will use) for {SITE_NAME}. They get a link to choose a password, and the list you started becomes theirs. You
            keep access through the household.
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="block text-sm font-semibold" htmlFor={`invite-email-${student}`}>
                {name}&apos;s email
              </label>
              <input id={`invite-email-${student}`} name="email" type="email" required autoComplete="off" placeholder="name@example.com" className={`${inputCls} mt-1.5`} />
            </div>
            <button type="submit" disabled={pending} className={primaryBtn}>
              {pending ? "Sending…" : "Send link"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            {state.status === "error" && <ErrorLine message={state.message} />}
          </div>
        </form>
      )}
    </div>
  );
}
