import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { doorByKey, type AdminDoorKey } from "@/lib/admin/console";
import { cn } from "@/lib/utils";

/**
 * A door's screens as a card list, one line each (specs/product/admin-redesign.md "Navigation": each tab opens its
 * door's landing page, which lists its screens). The People door's landing is the People list, so it shows this only
 * below `lg` where the rail doesn't list the screens (`compact`).
 */
export function DoorScreens({ door, skip, compact = false, className }: { door: AdminDoorKey; skip?: readonly string[]; compact?: boolean; className?: string }) {
  const screens = doorByKey(door).screens.filter((s) => !skip?.includes(s.key));
  return (
    <nav aria-label={`${doorByKey(door).label} screens`} className={cn(compact && "lg:hidden", className)}>
      <ul className={cn("grid gap-2", compact ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {screens.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-2.5 transition-colors hover:bg-muted">
              <span className="min-w-0">
                <span className="block font-semibold">{s.label}</span>
                <span className="block text-sm text-muted-foreground">{s.hint}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
