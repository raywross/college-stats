"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { addOwnTask } from "@/lib/planner/store";
import { deleteOwnTask, editOwnTask } from "@/lib/planner/store-timeline";
import type { Assignee } from "@/lib/planner/types";

interface CollegeOption {
  id: string;
  name: string;
}

const WHO: { value: Assignee; label: string }[] = [
  { value: "student", label: "The student" },
  { value: "guardian", label: "A parent" },
  { value: "either", label: "Either" },
];

const field = "h-11 w-full rounded-xl border bg-background px-3 text-sm sm:h-10";

/** The form an own task is added or edited with: a title, an optional date, whose step, and a college or "general". */
function OwnTaskForm({
  initial,
  colleges,
  submitLabel,
  onSubmit,
}: {
  initial: { title: string; due_on: string | null; assignee: Assignee; item_id: string | null };
  colleges: CollegeOption[];
  submitLabel: string;
  onSubmit: (v: { title: string; dueOn: string | null; assignee: Assignee; itemId: string | null }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = {
          title: String(f.get("title") ?? ""),
          dueOn: String(f.get("due") ?? "") || null,
          assignee: String(f.get("assignee") ?? "student") as Assignee,
          itemId: String(f.get("item") ?? "") || null,
        };
        setError(null);
        startTransition(async () => {
          const r = await onSubmit(v);
          if (!r.ok) setError(r.message ?? "That didn't work.");
        });
      }}
    >
      <label className="block text-sm font-semibold">
        What to do
        <input name="title" required maxLength={200} defaultValue={initial.title} className={`mt-1 ${field}`} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-semibold">
          Date (optional)
          <input name="due" type="date" defaultValue={initial.due_on ?? ""} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm font-semibold">
          Whose step
          <select name="assignee" defaultValue={initial.assignee} className={`mt-1 ${field}`}>
            {WHO.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          For
          <select name="item" defaultValue={initial.item_id ?? ""} className={`mt-1 ${field}`}>
            <option value="">Every college (general)</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {submitLabel}
      </button>
    </form>
  );
}

/** "Add your own step" (timeline.md "own"): free text with an optional date, whose step, and a college. */
export function AddOwnTask({ listId, colleges }: { listId: string; colleges: CollegeOption[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title="Add your own step"
      description="Anything the plan doesn't list: a scholarship form, a portfolio, an alumni interview."
      trigger={{
        className: "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-muted sm:h-9 print:hidden",
        label: "Add your own step",
        content: (
          <>
            <Plus className="size-4" aria-hidden /> Add a step
          </>
        ),
      }}
    >
      <OwnTaskForm
        initial={{ title: "", due_on: null, assignee: "student", item_id: null }}
        colleges={colleges}
        submitLabel="Add it"
        onSubmit={async (v) => {
          const r = await addOwnTask({ listId, title: v.title, dueOn: v.dueOn, itemId: v.itemId, assignee: v.assignee });
          if (r.ok) {
            setOpen(false);
            router.refresh();
          }
          return r;
        }}
      />
    </SheetDialog>
  );
}

/** Edit and Delete on one of the family's own tasks (generated tasks are dismissed or snoozed instead). */
export function OwnTaskControls({
  task,
  colleges,
}: {
  task: { id: string; title: string; due_on: string | null; assignee: Assignee; item_id: string | null };
  colleges: CollegeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="mt-1 flex flex-wrap gap-2 print:hidden">
      <SheetDialog
        open={open}
        onOpenChange={setOpen}
        title="Edit your step"
        trigger={{
          className: "inline-flex min-h-11 items-center gap-1 rounded-full px-3 sm:min-h-8 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
          label: `Edit: ${task.title}`,
          content: (
            <>
              <Pencil className="size-3" aria-hidden /> Edit
            </>
          ),
        }}
      >
        <OwnTaskForm
          initial={task}
          colleges={colleges}
          submitLabel="Save"
          onSubmit={async (v) => {
            const r = await editOwnTask(task.id, { title: v.title, dueOn: v.dueOn, assignee: v.assignee, itemId: v.itemId });
            if (r.ok) {
              setOpen(false);
              router.refresh();
            }
            return r;
          }}
        />
      </SheetDialog>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Delete "${task.title}"?`)) return;
          startTransition(async () => {
            const r = await deleteOwnTask(task.id);
            if (r.ok) router.refresh();
          });
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 sm:min-h-8 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-destructive"
        aria-label={`Delete: ${task.title}`}
      >
        <Trash2 className="size-3" aria-hidden /> Delete
      </button>
    </div>
  );
}
