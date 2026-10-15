"use client";

import { useActionState, useId, useState } from "react";
import type { DispatchableRun, FullRunCost, RunInput } from "@/lib/admin/workflows";
import { dayLabel, usd } from "@/lib/admin/ops-view";
import type { OpsState } from "@/lib/admin/ops-actions";
import { ActionResult, buttonClass } from "@/components/admin/ops/OpsActionForm";
import { TypedConfirm, confirmMatches } from "@/components/admin/ops/TypedConfirm";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function Field({ input, prefillUnit }: { input: RunInput; prefillUnit: string | null }) {
  const id = useId();
  switch (input.kind) {
    case "unit":
      return (
        <div>
          <label htmlFor={id} className="block text-sm font-semibold">
            {input.label}
          </label>
          <input id={id} name={input.name} defaultValue={prefillUnit ?? ""} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required placeholder="six digits" className={`${inputCls} mt-1.5 sm:max-w-[12rem]`} />
        </div>
      );
    case "boolean":
      return (
        <label className="flex min-h-10 items-center gap-2.5 text-sm">
          <input type="checkbox" name={input.name} defaultChecked={input.default} className="size-5 accent-primary" />
          {input.label}
        </label>
      );
    case "choice":
      return (
        <div>
          <label htmlFor={id} className="block text-sm font-semibold">
            {input.label}
          </label>
          <select id={id} name={input.name} defaultValue={input.default} className={`${inputCls} mt-1.5 sm:max-w-xs`}>
            {input.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    case "money":
      return (
        <div>
          <label htmlFor={id} className="block text-sm font-semibold">
            {input.label}
          </label>
          <input id={id} name={input.name} defaultValue={input.default} inputMode="decimal" pattern="[0-9]{1,5}(\.[0-9]{1,2})?" className={`${inputCls} mt-1.5 sm:max-w-[12rem]`} />
        </div>
      );
    case "text":
      return (
        <div>
          <label htmlFor={id} className="block text-sm font-semibold">
            {input.label}
          </label>
          <input id={id} name={input.name} defaultValue={input.default} className={`${inputCls} mt-1.5`} />
        </div>
      );
  }
}

/** What a full run cost last time and what the newest projection says; shown above the word to type. */
function CostNote({ cost }: { cost: FullRunCost | null }) {
  if (!cost || (!cost.last && !cost.projection)) {
    return <p className="text-sm text-muted-foreground">The cost of earlier runs couldn&apos;t be read from GitHub. A full run is the most expensive one; check the cap below.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {cost.last ? (
        <li>
          Last full run (run {cost.last.run}
          {cost.last.finished ? `, finished ${dayLabel(cost.last.finished)}` : ""}): <strong>{usd(cost.last.costUsd)}</strong> for {cost.last.colleges.toLocaleString("en-US")} colleges.
        </li>
      ) : (
        <li className="text-muted-foreground">No earlier full run is on record.</li>
      )}
      {cost.projection && (
        <li>
          Projected for a full run (from run {cost.projection.run}): <strong>{usd(cost.projection.fullRunUsd)}</strong>.
        </li>
      )}
    </ul>
  );
}

/**
 * One row of the Reruns table as a form: its typed inputs, the cost and the word to type for a full run, and the result.
 * The Server Action rebuilds the dispatch from the console's own table, checks the one-at-a-time guard, logs
 * `ops.dispatch`, and sends it; this form is typed for convenience, not as a guard.
 */
export function RunForm({
  run,
  prefillUnit,
  cost,
  action,
}: {
  run: DispatchableRun;
  prefillUnit: string | null;
  cost: FullRunCost | null;
  action: (previous: OpsState, form: FormData) => Promise<OpsState>;
}) {
  const [state, formAction, pending] = useActionState<OpsState, FormData>(action, { status: "idle" });
  const [typed, setTyped] = useState("");
  const word = run.guards.confirmWord ?? null;
  const ready = !word || confirmMatches(word, typed);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="run" value={run.id} />
      {run.inputs.map((input) => (
        <Field key={input.name} input={input} prefillUnit={prefillUnit} />
      ))}
      {run.ref === "pull-branch" && (
        <div>
          <label htmlFor={`branch-${run.id}`} className="block text-sm font-semibold">
            Pull request branch
          </label>
          <input id={`branch-${run.id}`} name="branch" required placeholder="data/identity-refresh-20261012" className={`${inputCls} mt-1.5 sm:max-w-md`} />
        </div>
      )}
      {run.guards.showCost && <CostNote cost={cost} />}
      {word && <TypedConfirm word={word} value={typed} onChange={setTyped} />}
      <button type="submit" disabled={pending || !ready} className={buttonClass("primary")}>
        {pending ? "Sending…" : run.label}
      </button>
      <ActionResult state={state} />
    </form>
  );
}
