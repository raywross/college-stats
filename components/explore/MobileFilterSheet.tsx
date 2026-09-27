"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { FilterPanel, type FilterFacets } from "./FilterPanel";

/** Bottom sheet on phones/tablets; the sidebar takes over at lg. */
export function MobileFilterSheet({
  facets,
  activeCount,
  resultCount,
}: {
  facets: FilterFacets;
  activeCount: number;
  resultCount: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border bg-card px-4 text-sm font-semibold lg:hidden"
      >
        <SlidersHorizontal className="size-4" />
        Filters
        {activeCount > 0 && (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[55] lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 animate-in bg-black/45 backdrop-blur-sm fade-in-0" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] animate-in flex-col rounded-t-3xl border-t bg-background shadow-2xl slide-in-from-bottom-8 fade-in-0">
            <div className="flex justify-center pt-2.5">
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close filters"
              className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
            >
              <X className="size-5" />
            </button>
            <div className="flex-1 overflow-y-auto px-5 pt-10 pb-4">
              <FilterPanel facets={facets} />
            </div>
            <div className="border-t p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-12 w-full rounded-2xl bg-primary text-sm font-bold text-primary-foreground"
              >
                Show {resultCount} school{resultCount === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
