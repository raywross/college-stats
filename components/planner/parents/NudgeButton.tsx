"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { track } from "@/lib/analytics";
import { sendNudge, replyToNudge } from "@/lib/planner/store-parents";
import { addDays } from "@/lib/planner/stage";
import type { PlanNudge } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

function weekday(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(iso));
}

/**
 * The nudge slot in `TaskRow`'s `children` (specs/planner/parents.md "Nudges"). For a guardian: one line, optional,
 * on this task — the button greys out to "Nudged {day}" for three days after one goes, and says so up front when
 * the student has no account or has turned off nudge emails. For the student: every nudge on this task, "Nudged by
 * {first name}, {day}", with a tick (the task's own), a snooze (the task's own), or a one-line reply that closes it.
 * A bottom sheet on phones (specs/mobile.md).
 */
export function NudgeButton({
  taskId,
  taskTitle,
  nudges,
  viewerIsGuardian,
  viewerUserId,
  viewerFirstName,
  studentFirstName,
  studentHasAccount,
  studentNudgeEmailsOff,
  taskOpen,
  today,
}: {
  taskId: string;
  taskTitle: string;
  nudges: PlanNudge[];
  viewerIsGuardian: boolean;
  viewerUserId: string;
  viewerFirstName: string | null;
  studentFirstName: string | null;
  studentHasAccount: boolean;
  studentNudgeEmailsOff: boolean;
  taskOpen: boolean;
  /** yyyy-mm-dd, for the three-day cooldown (date granularity; the server's own clock enforces the real limit). */
  today: string;
}) {
  if (!viewerIsGuardian && nudges.length === 0) return null;
  return viewerIsGuardian ? (
    <GuardianNudge
      taskId={taskId}
      taskTitle={taskTitle}
      nudges={nudges}
      viewerUserId={viewerUserId}
      studentFirstName={studentFirstName}
      studentHasAccount={studentHasAccount}
      studentNudgeEmailsOff={studentNudgeEmailsOff}
      taskOpen={taskOpen}
      today={today}
    />
  ) : (
    <StudentNudges nudges={nudges} viewerFirstName={viewerFirstName} />
  );
}

function GuardianNudge({
  taskId,
  taskTitle,
  nudges,
  viewerUserId,
  studentFirstName,
  studentHasAccount,
  studentNudgeEmailsOff,
  taskOpen,
  today,
}: {
  taskId: string;
  taskTitle: string;
  nudges: PlanNudge[];
  viewerUserId: string;
  studentFirstName: string | null;
  studentHasAccount: boolean;
  studentNudgeEmailsOff: boolean;
  taskOpen: boolean;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const mine = nudges.filter((n) => n.from_user === viewerUserId);
  const lastMine = mine.sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0] ?? null;
  const onCooldown = lastMine !== null && lastMine.sent_at.slice(0, 10) > addDays(today, -3);
  const othersSent = nudges.some((n) => n.from_user !== viewerUserId);

  if (!studentHasAccount) {
    return <p className="mt-1 text-xs text-muted-foreground">They don&apos;t have an account yet, so there&apos;s nobody to deliver a nudge to.</p>;
  }

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const r = await sendNudge(taskId, note, "app");
      if (!r.ok) {
        setError(r.message);
        return;
      }
      track("plan_nudge_sent", { channel: r.channel });
      setSent(true);
      setNote("");
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="mt-1">
      <SheetDialog
        open={open}
        onOpenChange={setOpen}
        title="Nudge"
        description={`One line, about "${taskTitle}".`}
        trigger={
          !taskOpen || onCooldown
            ? undefined
            : {
                className: "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold hover:bg-muted",
                label: "Nudge",
                content: (
                  <>
                    <Bell className="size-3.5" aria-hidden /> Nudge
                  </>
                ),
              }
        }
      >
        <div className="space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            rows={3}
            placeholder="Optional: the essay first?"
            className="w-full rounded-xl border p-3 text-sm"
          />
          {studentNudgeEmailsOff && <p className="text-xs text-muted-foreground">{studentFirstName ?? "They"} reads nudges in the plan; email nudges are off for them.</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60 sm:h-10"
          >
            Send
          </button>
        </div>
      </SheetDialog>
      {!taskOpen ? null : onCooldown && lastMine ? (
        <p className="mt-1 text-xs text-muted-foreground">Nudged {weekday(lastMine.sent_at)}</p>
      ) : null}
      {sent && <p className="mt-1 text-xs text-muted-foreground">Sent.</p>}
      {othersSent && !mine.length && <p className="mt-1 text-xs text-muted-foreground">A nudge was sent on this step.</p>}
      <NudgeHistory nudges={mine} />
    </div>
  );
}

function NudgeHistory({ nudges }: { nudges: PlanNudge[] }) {
  if (nudges.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
      {nudges
        .slice()
        .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
        .map((n) => (
          <li key={n.id}>
            {n.note ? `"${n.note}" ` : ""}· {weekday(n.sent_at)}
            {n.reply && <span className="ml-1 font-semibold text-foreground">— reply: &ldquo;{n.reply}&rdquo;</span>}
          </li>
        ))}
    </ul>
  );
}

function StudentNudges({ nudges, viewerFirstName }: { nudges: PlanNudge[]; viewerFirstName: string | null }) {
  void viewerFirstName;
  return (
    <ul className="mt-1 space-y-2 text-xs">
      {nudges
        .slice()
        .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
        .map((n) => <StudentNudgeRow key={n.id} nudge={n} />)}
    </ul>
  );
}

function StudentNudgeRow({ nudge }: { nudge: PlanNudge }) {
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(Boolean(nudge.reply));
  const router = useRouter();

  const submit = () =>
    startTransition(async () => {
      const r = await replyToNudge(nudge.id, reply);
      if (r.ok) {
        setDone(true);
        router.refresh();
      }
    });

  return (
    <li className="rounded-xl border bg-muted/30 p-2">
      <p className="text-muted-foreground">
        Nudged by a parent, {weekday(nudge.sent_at)}
        {nudge.note ? `: "${nudge.note}"` : ""}
      </p>
      {done ? (
        <p className="mt-1 flex items-center gap-1 font-semibold text-foreground">
          <Check className="size-3.5" aria-hidden /> {nudge.reply ?? "Done"}
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={200}
            placeholder="Reply (closes it)"
            className={cn("min-w-0 flex-1 rounded-full border px-3 py-1 text-xs")}
          />
          <button type="button" disabled={pending || !reply.trim()} onClick={submit} className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60">
            Reply
          </button>
        </div>
      )}
    </li>
  );
}
