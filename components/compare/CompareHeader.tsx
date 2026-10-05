"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Plus, Search, X } from "lucide-react";
import { MAX_COMPARE, getCompareIds, setCompareIds } from "@/lib/compare";
import type { SchoolIndexEntry } from "@/lib/data";
import { searchSchoolsApi } from "@/lib/school-api";
import { SLOT_COLORS, shortName } from "@/lib/brand";
import { pctSmart } from "@/lib/format";
import { Crest } from "@/components/school/Crest";
import { FollowButton } from "@/components/FollowButton";

/** Keeps the saved compare list in step with the URL being viewed. */
function useSyncStorage(ids: string[]) {
  const key = ids.join(",");
  useEffect(() => {
    if (getCompareIds().join(",") !== key) setCompareIds(key ? key.split(",") : []);
  }, [key]);
}

function SchoolPicker({ exclude, onPick }: { exclude: string[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<SchoolIndexEntry[]>([]);
  const excludeKey = exclude.join(",");

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      searchSchoolsApi(query, { limit: 10, exclude: excludeKey.split(","), signal: controller.signal })
        .then(setOptions)
        .catch(() => {});
    }, 120);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, excludeKey]);

  return (
    <Popover.Root>
      <Popover.Trigger className="flex h-10 shrink-0 items-center justify-center gap-1 rounded-full border-2 border-dashed px-4 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary md:h-full md:min-h-20 md:w-full md:flex-col md:rounded-2xl md:px-0">
        <Plus className="size-4 md:size-5" />
        Add<span className="hidden md:inline"> school</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} collisionPadding={12} className="z-[60]">
          <Popover.Popup className="w-80 max-w-[calc(100vw-24px)] rounded-2xl border bg-popover p-2 shadow-2xl outline-none">
            <label className="flex items-center gap-2 rounded-xl border px-3 py-2">
              <Search className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  if (!e.target.value.trim()) setOptions([]);
                }}
                placeholder="Find a school"
                aria-label="Find a school to add"
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <div className="mt-1.5 max-h-72 overflow-y-auto">
              {options.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  {q.trim() ? "No matches yet. Keep typing." : "Type a college name, city, or state."}
                </p>
              )}
              {options.map((s) => (
                <Popover.Close
                  key={s.id}
                  onClick={() => onPick(s.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-muted"
                >
                  <Crest id={s.id} name={s.name} size="sm" brand={s.brand} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {s.name}
                      {s.matched && <span className="font-normal text-muted-foreground"> · &ldquo;{s.matched}&rdquo;</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {s.city}, {s.state}
                      {s.acceptance !== null && <> · {pctSmart(s.acceptance)} admit</>}
                    </span>
                  </span>
                </Popover.Close>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CompareHeader({ schools }: { schools: SchoolIndexEntry[] }) {
  const router = useRouter();
  const ids = schools.map((s) => s.id);
  useSyncStorage(ids);

  const go = (next: string[]) => {
    setCompareIds(next);
    router.replace(next.length ? `/compare?ids=${next.join(",")}` : "/compare", { scroll: false });
  };

  return (
    <div
      className="sticky z-30 -mx-4 border-b bg-background/85 px-4 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6 md:py-3"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + var(--header-h))" }}
    >
      {/* Phones: one swipeable row of slim pills so the sticky bar stays ~56px tall. md+: a card per school. */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:gap-3 md:overflow-visible md:px-0">
        {schools.map((s, i) => (
          <div
            key={s.id}
            className="relative flex min-w-0 shrink-0 items-center gap-2 rounded-full border bg-card py-1 pr-16 pl-1 md:shrink md:gap-2.5 md:rounded-2xl md:p-3 md:pr-18"
          >
            <span className="absolute inset-x-3 top-0 hidden h-1 rounded-b-full md:block" style={{ backgroundColor: SLOT_COLORS[i] }} />
            <Crest id={s.id} name={s.name} size="sm" brand={s.brand} className="size-8 rounded-full text-[10px] md:size-9 md:rounded-lg md:text-[11px]" />
            <Link href={`/schools/${s.id}`} className="min-w-0 hover:text-primary">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLOT_COLORS[i] }} />
                <span className="truncate text-sm font-bold">{shortName({ unit_id: s.id, name: s.name })}</span>
              </span>
              <span className="hidden truncate text-[11px] text-muted-foreground md:block">
                {s.city}, {s.state}
              </span>
            </Link>
            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1 md:top-2 md:right-2 md:translate-y-0">
              <FollowButton unitId={s.id} schoolName={s.name} variant="icon" className="size-6 border-none bg-transparent" />
              <button
                type="button"
                onClick={() => go(ids.filter((x) => x !== s.id))}
                aria-label={`Remove ${s.name}`}
                className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {schools.length < MAX_COMPARE && (
          <SchoolPicker exclude={ids} onPick={(id) => go([...ids, id])} />
        )}
      </div>
    </div>
  );
}
