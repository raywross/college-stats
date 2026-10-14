/**
 * The "Event calendar" button in the college hero, to the right of the social bar (specs/product/visit-events.md
 * "Display"; owner 2026-10-13: the calendar shows only when asked for). Signed in, it opens the calendar view of the
 * same page (`?view=events`), which keeps the college's header and replaces the stats below; signed out, it goes to
 * the sign-up form and comes back here afterwards. Nothing renders for a college with no events on file.
 */
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { authConfigured, getUser } from "@/lib/auth";
import { loginHref } from "@/lib/accounts";
import { countForUnit } from "@/lib/visit-events/read";
import { cn } from "@/lib/utils";

/** `/login?next=…&mode=signup`: the sign-in page opened on "Create an account". */
export function signupHref(next: string): string {
  const base = loginHref(next);
  return `${base}${base.includes("?") ? "&" : "?"}mode=signup`;
}

export async function EventCalendarButton({ unitId, active }: { unitId: string; active: boolean }) {
  if (!authConfigured()) return null;
  const [count, user] = await Promise.all([countForUnit(unitId), getUser()]);
  if (count === 0) return null;

  const calendar = `/schools/${unitId}?view=events`;
  const href = !user ? signupHref(calendar) : active ? `/schools/${unitId}` : calendar;
  const label = active ? "Back to the college" : "Event calendar";
  const Icon = active ? ArrowLeft : CalendarDays;
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors sm:h-8",
        active ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : "bg-card hover:border-primary hover:text-primary",
      )}
    >
      <Icon className="size-3.5" />
      {label}
      {!active && <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground tabular-nums">{count}</span>}
    </Link>
  );
}
