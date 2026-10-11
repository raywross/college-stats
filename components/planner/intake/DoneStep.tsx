"use client";

import { Check } from "lucide-react";

/** The Done screen (intake.md "Steps"): first-run only, after the save succeeds. */
export function DoneStep({ onAddCollege, onRunAgain }: { onAddCollege: () => void; onRunAgain: () => void }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-10 sm:px-0">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <Check className="size-8" aria-hidden />
      </div>
      <h1 className="mt-6 font-display text-3xl leading-tight font-extrabold tracking-[-0.025em] lg:text-5xl">
        Your numbers are <span className="rounded-md bg-pop px-1.5 py-0.5 text-pop-foreground lg:rounded-lg lg:px-2">in.</span>
      </h1>
      <p className="mt-3 text-muted-foreground">Add a college and we&apos;ll sort it into Reach, Target, or Likely right away.</p>
      <button type="button" onClick={onRunAgain} className="mt-4 self-start text-sm font-semibold text-primary hover:underline">
        Run the setup again
      </button>
      <button
        type="button"
        onClick={onAddCollege}
        className="mt-10 h-[52px] w-full rounded-full bg-primary text-base font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto sm:px-8"
      >
        Add your first college
      </button>
    </div>
  );
}
