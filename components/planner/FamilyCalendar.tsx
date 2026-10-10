import type { CalendarTabProps } from "@/components/planner/tabs/types";

/**
 * The Calendar tab: the family calendar across the school year (specs/planner/redesign/calendar.md). A placeholder
 * from the foundation unit (U1); unit U5 (Calendar) owns this file and replaces it.
 */
export default function FamilyCalendar({ children, everyone }: CalendarTabProps) {
  return (
    <section className="rounded-3xl border bg-card p-5 text-sm text-muted-foreground sm:p-6">
      Calendar: coming soon{everyone ? ` (${children.length} children)` : ""}.
    </section>
  );
}
