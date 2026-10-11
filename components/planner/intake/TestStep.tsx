"use client";

import { Headline } from "@/components/planner/intake/Headline";
import { scoreCheck, targetCheck, type IntakeDraft, type IntakeTest } from "@/lib/planner/intake";
import { cn } from "@/lib/utils";

const CARD_COPY: Record<"sat" | "act", { label: string; sub: string; placeholder: string }> = {
  sat: { label: "Total score", sub: "Scored 400 to 1600", placeholder: "e.g. 1450" },
  act: { label: "Composite score", sub: "Scored 1 to 36", placeholder: "e.g. 32" },
};

/** Step 1 (intake.md "Test"): SAT/ACT/neither, the score, practice, and the optional target. */
export function TestStep({ draft, setDraft }: { draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  const test = draft.test;
  const testing = test === "sat" || test === "act";
  const score = testing ? scoreCheck(test, draft.score) : null;
  const target = testing ? targetCheck(test, draft.score, draft.target) : null;

  const pick = (next: IntakeTest) => {
    if (next === draft.test) return;
    setDraft({ ...draft, test: next, score: "", target: "" });
  };

  return (
    <div className="space-y-8">
      <Headline lead="Your" pop="test" />

      <div className="space-y-2.5">
        <p className="text-sm font-semibold">Which test are you taking?</p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          {(["sat", "act"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={test === t}
              onClick={() => pick(t)}
              className={cn(
                "min-h-[84px] flex-1 rounded-2xl border p-4 text-left",
                test === t ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              <span className="block font-display text-2xl font-extrabold uppercase">{t}</span>
              <span className={cn("text-sm", test === t ? "text-background/80" : "text-muted-foreground")}>
                {t === "sat" ? "Scored 400 to 1600" : "Scored 1 to 36"}
              </span>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={test === "none"}
            onClick={() => pick("none")}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-semibold sm:self-start",
              test === "none" ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {test === "none" ? "✓ Not taking either test" : "I'm not taking either test"}
          </button>
        </div>
      </div>

      {testing && (
        <>
          <div className="space-y-2">
            <label htmlFor="intake-score" className="block text-sm font-semibold">
              {CARD_COPY[test].label}
            </label>
            <input
              id="intake-score"
              type="text"
              inputMode="numeric"
              value={draft.score}
              onChange={(e) => setDraft({ ...draft, score: e.target.value })}
              className="h-[72px] w-full max-w-48 rounded-2xl border px-4 font-display text-4xl font-extrabold outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {score && (
              <p className={cn("text-sm", score.hint && !score.ok ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{score.hint}</p>
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.practice}
                onChange={(e) => setDraft({ ...draft, practice: e.target.checked })}
                className="size-4 accent-primary"
              />
              This was a practice test
            </label>
          </div>

          <div className="space-y-2 border-t pt-6">
            <p className="text-sm">
              <span className="font-semibold">Score you&apos;re aiming for</span> <span className="text-muted-foreground">· optional</span>
            </p>
            <p className="text-sm text-muted-foreground">Still studying? Tell us where you think you&apos;ll land.</p>
            <input
              type="text"
              inputMode="numeric"
              placeholder={CARD_COPY[test].placeholder}
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              className="h-[72px] w-full max-w-48 rounded-2xl border px-4 font-display text-4xl font-extrabold outline-none placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {target?.hint && <p className={cn("text-sm", target.tone === "amber" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{target.hint}</p>}
          </div>
        </>
      )}

      {test === "none" && (
        <p className="text-sm text-muted-foreground">
          That&apos;s fine. We&apos;ll sort your colleges with grades and courses, and only show schools&apos; test policies when they matter.
        </p>
      )}
    </div>
  );
}
