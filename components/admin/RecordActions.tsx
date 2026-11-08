import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A record's actions (a person, a household, a student record, an organization, a college), at the top of the page
 * instead of a side column (specs/product/admin-redesign.md "People"): a wrapping row of 44 px buttons. Each child is
 * an `AdminForm` or `ConfirmTyped` already built for the page, passed `sheet`, so below `md` its panel opens in a
 * `SheetDialog` instead of expanding inline into the row.
 */
export function RecordActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label="Actions" className={cn("mb-5 flex flex-wrap items-start gap-2", className)}>
      {children}
    </div>
  );
}
