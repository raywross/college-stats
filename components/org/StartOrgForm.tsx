"use client";

import { useActionState, useState } from "react";
import { Building2 } from "lucide-react";
import { HighSchoolPicker } from "@/components/high-schools/HighSchoolPicker";
import { Term } from "@/components/ui/info-tip";
import { createOrganization, type OrgActionState } from "@/app/org/actions";
import { ORG_NAME_MAX } from "@/lib/org-rules";
import { cn } from "@/lib/utils";

/** The free line (specs "The counselor's pages: /org"), shown before the organization exists. */
export const ORG_FREE_LINE = "Quad is free for counselors and consultants. Your students’ families decide whether to buy the advisor; you never pay, and you never sell.";

const inputCls =
  "h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Start your organization (specs "The counselor's pages: /org"): a name, "I'm an independent consultant" or "I work
 * at a school", the high school picker for schools, a website if they like. Creating it makes the caller the owner
 * and lands on the caseload.
 */
export function StartOrgForm({ defaultName = "" }: { defaultName?: string }) {
  const [state, run, pending] = useActionState<OrgActionState, FormData>(createOrganization, { status: "idle" });
  const [kind, setKind] = useState<"iec" | "school">("iec");
  const choice = (value: "iec" | "school", label: string) => (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors",
        kind === value ? "border-primary bg-primary/8" : "hover:bg-muted",
      )}
    >
      <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
  return (
    <section className="rounded-3xl border bg-card p-5 sm:p-8">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-pop text-pop-foreground">
        <Building2 className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        Start your <Term term="counselor-organization">organization</Term>
      </h1>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground sm:text-base">{ORG_FREE_LINE}</p>
      <form action={run} className="mt-6 max-w-xl space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="org-name" className="text-sm font-semibold">
            Name
          </label>
          <input id="org-name" name="name" required maxLength={ORG_NAME_MAX} defaultValue={defaultName} placeholder="Rivera College Counseling" className={inputCls} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Which are you?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {choice("iec", "I’m an independent consultant")}
            {choice("school", "I work at a school")}
          </div>
        </fieldset>
        {kind === "school" && (
          <div className="space-y-1.5">
            <label htmlFor="highSchool" className="text-sm font-semibold">
              Your high school
            </label>
            <HighSchoolPicker idName="highSchoolId" nameName="highSchool" defaultId={null} defaultName={null} />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor="org-website" className="text-sm font-semibold">
            Website <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id="org-website" name="website" maxLength={200} inputMode="url" placeholder="riveracounseling.com" className={inputCls} />
        </div>
        {state.status === "error" && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {state.message}
          </p>
        )}
        <button type="submit" disabled={pending} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? "Starting…" : "Start the organization"}
        </button>
      </form>
    </section>
  );
}
