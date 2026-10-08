"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import Link from "next/link";
import { tick, untick } from "@/lib/planner/store";
import { taskDateLabel } from "@/lib/planner/tasks";
import { Term } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

export interface YourPartTaskView {
  id: string;
  title: string;
  detail: string | null;
  due_on: string | null;
  window_start: string | null;
  window_end: string | null;
  assignee: "student" | "guardian" | "either";
  done_at: string | null;
}

export interface YourPartGroupView {
  studentId: string;
  name: string | null;
  tasks: YourPartTaskView[];
}

/**
 * "Your part" (specs/planner/parents.md "The parent's tasks"): every open task assigned to a guardian or either,
 * grouped by student, above the guardian's own list. The same ticks and dates as the plan itself; ticking here is
 * the same fact as ticking it there.
 */
export function YourPart({ groups, today }: { groups: YourPartGroupView[]; today: string }) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="your-part" className="rounded-3xl border bg-card p-4 sm:p-5">
      <h2 id="your-part" className="font-display text-lg font-bold">
        <Term term="your-part">Your part</Term>
      </h2>
      <div className="mt-2 space-y-4">
        {groups.map((g) => (
          <div key={g.studentId}>
            <Link href={`/household/${g.studentId}/plan`} className="text-sm font-semibold text-primary underline-offset-2 hover:underline">
              {g.name ?? "Student"}
            </Link>
            <ul className="mt-1 divide-y">
              {g.tasks.map((t) => (
                <YourPartRow key={t.id} task={t} today={today} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function YourPartRow({ task, today }: { task: YourPartTaskView; today: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(task.done_at !== null);
  const date = taskDateLabel(task, today);

  const toggle = () => {
    const next = !done;
    setDone(next);
    startTransition(async () => {
      const r = next ? await tick(task.id) : await untick(task.id);
      if (!r.ok) setDone(!next);
    });
  };

  return (
    <li className={cn("flex items-start gap-3 py-2", pending && "opacity-70")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Done" : "Mark done"}: ${task.title}`}
        onClick={toggle}
        className="mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:size-9"
      >
        <span aria-hidden className={cn("inline-flex size-6 items-center justify-center rounded-full border-2", done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
          {done && <Check className="size-3.5" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-semibold break-words", done && "text-muted-foreground line-through")}>{task.title}</p>
        {date && <p className="text-xs text-muted-foreground">{date}</p>}
        {task.detail && <p className="mt-0.5 text-xs text-muted-foreground">{task.detail}</p>}
      </div>
    </li>
  );
}
