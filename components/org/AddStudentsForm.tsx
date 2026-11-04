"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { CopyLinkField } from "@/components/account/InvitationControls";
import { inviteStudents, type InviteStudentsState } from "@/app/org/actions";
import { ORG_INVITE_BATCH_MAX, parseStudentLines, type StudentInviteLine } from "@/lib/org-caseload";
import { cn } from "@/lib/utils";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

type Row = { firstName: string; lastName: string; email: string; gradYear: string };
const blank = (): Row => ({ firstName: "", lastName: "", email: "", gradYear: "" });
const fromLine = (l: StudentInviteLine): Row => ({ firstName: l.firstName, lastName: l.lastName ?? "", email: l.email, gradYear: l.gradYear ? String(l.gradYear) : "" });

/**
 * Add students (specs "How a student joins", the invitation door): first name, last name (optional), email,
 * graduation year (optional), a row each; or paste lines ("Jordan Lee, jordan@example.com, 2027"), which fill the
 * rows. Each invitation's link is shown to copy and emailed when email is set up; each line succeeds or fails alone.
 */
export function AddStudentsForm({ orgId }: { orgId: string }) {
  const [state, run, pending] = useActionState<InviteStudentsState, FormData>(inviteStudents, { status: "idle" });
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [paste, setPaste] = useState("");
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (state.status === "invited") {
    const ok = state.results.filter((r) => r.link);
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold" role="status">
          {ok.length === state.results.length ? `${ok.length} invited.` : `${ok.length} of ${state.results.length} invited.`}{" "}
          {ok.some((r) => !r.emailed) && "Email isn't set up here, so send each student their link."}
        </p>
        <ul className="space-y-3">
          {state.results.map((r) => (
            <li key={r.email} className="space-y-1.5 rounded-2xl border bg-card p-3.5">
              <p className="text-sm font-semibold break-words">
                {r.name} <span className="font-normal text-muted-foreground">· {r.email}</span>
              </p>
              {r.error ? (
                <p className="text-sm text-destructive">{r.error}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{r.emailed ? `Emailed. The link works until ${r.expires}.` : `The link works until ${r.expires}.`}</p>
                  {r.link && <CopyLinkField link={r.link} />}
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link href="/org" className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Back to the caseload
          </Link>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-10 items-center rounded-full border px-5 text-sm font-semibold hover:bg-muted">
            Add more
          </button>
        </div>
      </div>
    );
  }

  const filled = rows.filter((r) => r.firstName.trim() || r.email.trim());
  return (
    <form action={run} className="space-y-6">
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="rows" value={JSON.stringify(filled)} />
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-2 gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-[1fr_1fr_1.6fr_7rem_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
            <input aria-label="First name" placeholder="First name" value={r.firstName} onChange={(e) => set(i, { firstName: e.target.value })} className={inputCls} maxLength={60} />
            <input aria-label="Last name (optional)" placeholder="Last name" value={r.lastName} onChange={(e) => set(i, { lastName: e.target.value })} className={inputCls} maxLength={60} />
            <input aria-label="Email" type="email" placeholder="Email" value={r.email} onChange={(e) => set(i, { email: e.target.value })} className={cn(inputCls, "col-span-2 sm:col-span-1")} />
            <input
              aria-label="Graduation year (optional)"
              inputMode="numeric"
              placeholder="Class of"
              value={r.gradYear}
              onChange={(e) => set(i, { gradYear: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              className={inputCls}
            />
            <button
              type="button"
              aria-label="Remove this row"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="inline-flex size-11 items-center justify-center justify-self-end rounded-full border hover:bg-muted disabled:opacity-40"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={rows.length >= ORG_INVITE_BATCH_MAX}
        onClick={() => setRows([...rows, blank()])}
        className="inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
      >
        <Plus className="size-4" aria-hidden />
        Another student
      </button>

      <details className="rounded-2xl border bg-card p-3.5 sm:p-4">
        <summary className="cursor-pointer text-sm font-semibold">Paste a list</summary>
        <p className="mt-2 text-xs text-muted-foreground">One student per line: name, email, and class year if you have it.</p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          placeholder={"Jordan Lee, jordan@example.com, 2027\nSam Ortiz, sam@example.com"}
          className="mt-2 w-full rounded-xl border border-input bg-background p-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <button
          type="button"
          onClick={() => {
            const parsed = parseStudentLines(paste);
            const kept = rows.filter((r) => r.firstName.trim() || r.email.trim());
            setRows([...kept, ...parsed.rows.map(fromLine)].slice(0, ORG_INVITE_BATCH_MAX));
            setPasteErrors(parsed.errors.map((e) => `Line ${e.line}: ${e.message}`));
            if (parsed.errors.length === 0) setPaste("");
          }}
          className="mt-2 inline-flex h-10 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted"
        >
          Add these
        </button>
        {pasteErrors.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-destructive" role="alert">
            {pasteErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </details>

      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending || filled.length === 0} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? "Inviting…" : filled.length > 1 ? `Invite ${filled.length} students` : "Invite"}
      </button>
    </form>
  );
}
