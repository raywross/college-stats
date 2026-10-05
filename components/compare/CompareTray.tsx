"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { MAX_COMPARE, clearCompare, toggleCompare, useCompareIds } from "@/lib/compare";
import { useSchoolEntries } from "@/lib/school-api";
import { Crest } from "@/components/school/Crest";
import { AddToListButton } from "@/components/lists/AddToListButton";

/** Floating pill that follows you around while you build a comparison. Phones use the tab bar's Compare badge instead. */
export function CompareTray() {
  const ids = useCompareIds();
  const pathname = usePathname();
  const selected = useSchoolEntries(ids);
  if (ids.length === 0 || pathname.startsWith("/compare")) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 hidden justify-center px-3 md:flex"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
    >
      <div className="pointer-events-auto flex w-full max-w-xl animate-rise items-center gap-3 rounded-full border bg-popover/95 p-1.5 pl-3 shadow-2xl shadow-primary/20 backdrop-blur-xl">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex -space-x-2">
            {selected.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleCompare(s.id)}
                className="group relative rounded-lg ring-2 ring-popover transition-transform hover:z-10 hover:-translate-y-0.5"
                aria-label={`Remove ${s.name} from compare`}
                title={`Remove ${s.name}`}
              >
                <Crest id={s.id} name={s.name} size="sm" brand={s.brand} />
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                  <X className="size-4 text-white" />
                </span>
              </button>
            ))}
            {Array.from({ length: MAX_COMPARE - ids.length }).map((_, i) => (
              <span
                key={i}
                className="hidden size-9 rounded-lg border-2 border-dashed border-border bg-muted/50 ring-2 ring-popover sm:inline-block"
              />
            ))}
          </div>
          <p className="hidden min-w-0 truncate text-sm sm:block">
            <span className="font-semibold">{ids.length}</span>
            <span className="text-muted-foreground"> of {MAX_COMPARE} picked</span>
          </p>
        </div>
        <button
          type="button"
          onClick={clearCompare}
          className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
        <AddToListButton ids={ids} variant="pill" label="Save these to my list" className="hidden sm:inline-flex" />
        <Link
          href={`/compare?ids=${ids.join(",")}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-md transition-transform hover:scale-[1.03] active:scale-95"
        >
          Compare{ids.length > 1 ? ` ${ids.length}` : ""}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
