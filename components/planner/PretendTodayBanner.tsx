import Link from "next/link";
import { plannerTodayOverride } from "@/lib/planner/today-server";
import { pretendTodayLine } from "@/lib/planner/today";

/**
 * The line above a plan while the pretend-today setting is on (specs/planner/v3/pretend-today.md), so nobody reads a
 * shifted plan as the real one. Nothing when the setting is off, which is always the case in production. `day`: the
 * pretend day a page already read with its data (the caseload's bundle carries the setting), so the line costs no read
 * of its own; left out, the banner reads the setting itself.
 */
export async function PretendTodayBanner({ day: known }: { day?: string | null } = {}) {
  const day = known === undefined ? await plannerTodayOverride() : known;
  if (!day) return null;
  return (
    <p role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-foreground print:hidden">
      <span className="font-semibold">{pretendTodayLine(day)}</span> Every season, move, and date on this page follows that day.{" "}
      <Link href="/admin/settings#pretend-today" className="font-semibold text-primary underline-offset-4 hover:underline">
        Change it
      </Link>
    </p>
  );
}
