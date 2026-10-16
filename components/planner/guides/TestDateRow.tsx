"use client";

/**
 * One upcoming test date (specs/planner/v3/guides/test-prep.md "Upcoming dates"): the date, days away, registration
 * deadline, the in-time sentence, **I'll take it** (the built `setPlannedDate`), and **Register** (`ActButton` with
 * `act: "test_register"`, the test date as the event — the show-interest guide's act tracking, reused).
 */
import { useState, useTransition } from "react";
import { track } from "@/lib/analytics";
import { dayLabel, daysBetween, registerByText, type TestDateEntry } from "@/lib/planner/test-guide";
import { setPlannedDate } from "@/lib/planner/store-plan";
import { TEST_LABEL, type TestKind } from "@/lib/planner/standing";
import { cn } from "@/lib/utils";
import { ACT_BUTTON_CLASS, ActButton } from "./ActButton";

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold disabled:opacity-60";
const SECONDARY = cn(BUTTON, "ring-1 ring-border hover:bg-muted");
const PRIMARY = cn(ACT_BUTTON_CLASS, "bg-foreground text-background hover:bg-foreground/90");

const OFFICIAL_URL: Record<TestKind, string> = {
  sat: "https://satsuite.collegeboard.org/sat/registration",
  act: "https://www.act.org/content/act/en/products-and-services/the-act/registration.html",
};

export function TestDateRow({
  entry,
  kind,
  today,
  state,
  studentId,
  canEdit,
}: {
  entry: TestDateEntry;
  kind: TestKind;
  today: string;
  /** Already planned, registered, or neither (lib/planner/test-guide.ts plannedState). */
  state: "planned" | "registered" | null;
  studentId: string | null;
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState(state !== null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    if (!studentId || !canEdit) return;
    const next = !picked;
    setPicked(next);
    startTransition(async () => {
      const result = await setPlannedDate(studentId, entry.key, next);
      if (!result.ok) setPicked(!next);
      else if (next) track("plan_test_date_picked", { test: kind });
    });
  };

  return (
    <li className="rounded-2xl border bg-background/70 px-3 py-3 text-sm">
      <p className="font-semibold">
        {TEST_LABEL[kind]} · {dayLabel(entry.date)} <span className="font-normal text-muted-foreground">({daysBetween(today, entry.date)} days)</span>
        {entry.projected && <span className="ml-1 font-normal text-muted-foreground">(projected date)</span>}
      </p>
      <p className="text-xs text-muted-foreground">{registerByText(entry.registerBy, today)}</p>
      {entry.inTime && <p className="mt-1 text-xs">{entry.inTime}</p>}
      {state === "registered" && <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Registered</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canEdit && studentId && (
          <button type="button" onClick={toggle} disabled={pending} className={cn(SECONDARY, picked && "border-primary bg-primary/10 text-primary ring-0")}>
            {picked ? "Taking it" : "I'll take it"}
          </button>
        )}
        <ActButton
          href={OFFICIAL_URL[kind]}
          itemId={null}
          act="test_register"
          event={{ id: entry.key, startsAt: `${entry.date}T00:00:00.000Z`, place: null, title: TEST_LABEL[kind] }}
          track={canEdit}
          className={PRIMARY}
          aria-label={`Register for the ${TEST_LABEL[kind]} on ${dayLabel(entry.date)} (opens the official site)`}
        >
          Register
        </ActButton>
      </div>
    </li>
  );
}

export default TestDateRow;
