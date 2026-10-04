"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import type { SchoolIndexEntry } from "@/lib/data";
import { searchSchoolsApi } from "@/lib/school-api";
import { Crest } from "@/components/school/Crest";
import { pctSmart } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Typeahead that jumps straight to a school, or to Explore with the query. */
export function SchoolSearch({
  size = "hero",
  placeholder = "Search a college, city, or state…",
  autoFocus,
  className,
  onNavigate,
}: {
  size?: "hero" | "compact";
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<SchoolIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchSchoolsApi(q, { limit: 6, signal: controller.signal })
        .then((rows) => {
          setResults(rows);
          setActive(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 120);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    onNavigate?.();
    router.push(href);
  };

  const submit = () => {
    if (results[active]) go(`/schools/${results[active].id}`);
    else if (query.trim()) go(`/explore?q=${encodeURIComponent(query.trim())}`);
    else go("/explore");
  };

  const showList = open && query.trim().length > 0;
  const hero = size === "hero";

  return (
    <div className={cn("relative", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cn(
          "group flex items-center gap-2 border bg-card transition-shadow focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/15",
          hero ? "h-14 rounded-2xl pr-2 pl-4 shadow-lg shadow-primary/5 sm:h-16" : "h-9 rounded-full pr-1 pl-3"
        )}
      >
        <Search className={cn("shrink-0 text-muted-foreground", hero ? "size-5" : "size-4")} />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) setResults([]);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden",
            hero ? "text-base sm:text-lg" : "text-sm"
          )}
        />
        {hero ? (
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95 sm:h-11 sm:px-5"
          >
            <span className="hidden sm:inline">Search</span>
            <ArrowRight className="size-4" />
          </button>
        ) : (
          <kbd className="hidden rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline">
            Enter
          </kbd>
        )}
      </form>

      {showList && (
        <div
          id={listId}
          role="listbox"
          className={cn(
            "absolute inset-x-0 z-50 mt-2 overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-2xl shadow-black/10",
            !hero && "min-w-80"
          )}
        >
          {results.length === 0 && loading ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={submit}
              className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              No direct match. Search all schools for “{query}”
              <ArrowRight className="size-4" />
            </button>
          ) : (
            results.map((s, i) => (
              <button
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(`/schools/${s.id}`)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                  i === active ? "bg-accent" : "hover:bg-muted"
                )}
              >
                <Crest id={s.id} name={s.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {s.name}
                    {s.matched && <span className="font-normal text-muted-foreground"> · &ldquo;{s.matched}&rdquo;</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.city}, {s.state}
                    {s.acceptance !== null && <> · {pctSmart(s.acceptance)} admit rate</>}
                  </span>
                </span>
                {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
