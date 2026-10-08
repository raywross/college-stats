import Link from "next/link";
import { Crest } from "@/components/school/Crest";
import type { CrestBrand } from "@/lib/brand";
import type { PlanSchool } from "@/lib/planner/types";
import { cn } from "@/lib/utils";

/**
 * A college's crest and name, the way every planner stage names a college (specs/planner/model.md "Shared code").
 * No hooks, so server and client components both render it. `link` makes the name go to the college's profile.
 * A task with no college (a shared step: the FAFSA) shows "For every college" instead.
 */
export function CollegeChip({
  school,
  size = "xs",
  link = false,
  className,
}: {
  school: Pick<PlanSchool, "unit_id" | "name" | "brand"> | null;
  size?: "xs" | "sm" | "md";
  link?: boolean;
  className?: string;
}) {
  if (!school) {
    return <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground", className)}>For every college</span>;
  }
  const name = <span className="min-w-0 truncate">{school.name}</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold", className)}>
      <Crest id={school.unit_id} name={school.name} size={size} brand={school.brand as CrestBrand | undefined} />
      {link ? (
        <Link href={`/schools/${school.unit_id}`} className="min-w-0 truncate hover:text-primary">
          {school.name}
        </Link>
      ) : (
        name
      )}
    </span>
  );
}
