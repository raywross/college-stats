"use client";

/**
 * A guide's footer (specs/planner/v3/now.md "The guide pattern"; build-plan.md "The guide page"): with an open move
 * and edit access, **Done with this** and **Skip for now** (the built `tick` / `dismiss`, optimistic: the buttons
 * lock at once, a refused write unlocks them and shows its message), each then back to the plan's Next steps; always
 * "Back to your plan". A guardian never skips for the student (review note 14), so Skip is the student's alone.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { track } from "@/lib/analytics";
import { planHref } from "@/lib/planner/plan-tabs";
import type { Season } from "@/lib/planner/seasons";
import { dismiss, tick } from "@/lib/planner/store";
import type { TaskKind } from "@/lib/planner/types";

export interface GuideFooterProps {
  /** The open move, when one led here and it's still open; null otherwise. */
  move: { id: string; kind: TaskKind; season: Season } | null;
  canEdit: boolean;
  isGuardian: boolean;
  person: string | null;
}

export function GuideFooter({ move, canEdit, isGuardian, person }: GuideFooterProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<"done" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const back = planHref({ person, tab: "next" });

  function act(which: "done" | "skip") {
    if (!move) return;
    setError(null);
    setBusy(which);
    startTransition(async () => {
      const result = which === "done" ? await tick(move.id) : await dismiss(move.id, true);
      if (!result.ok) {
        setBusy(null);
        setError(result.message);
        return;
      }
      if (which === "done") track("plan_move_done", { kind: move.kind, season: move.season, by: isGuardian ? "guardian" : "student" });
      else track("plan_move_skipped", { kind: move.kind, season: move.season });
      router.push(back);
    });
  }

  const showMove = move !== null && canEdit;
  return (
    <footer className="mt-8 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {showMove && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("done")}
              className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-60"
            >
              {busy === "done" ? "Saving…" : "Done with this"}
            </button>
            {!isGuardian && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act("skip")}
                className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold ring-1 ring-border hover:bg-muted disabled:opacity-60"
              >
                {busy === "skip" ? "Saving…" : "Skip for now"}
              </button>
            )}
          </>
        )}
        <Link href={back} className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-primary hover:underline sm:ml-auto">
          Back to your plan
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </footer>
  );
}

export default GuideFooter;
