"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { HighSchoolHit } from "@/lib/high-school-types";
import { searchHighSchoolsApi } from "@/lib/high-school-api";
import { cn } from "@/lib/utils";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 disabled:opacity-60";

/**
 * The `/me` high school field (specs/product/high-school-data.md "Display", student-profile.md): a typeahead over
 * `/api/high-schools` that fills a hidden id (`basics.highSchoolId`) when the student picks a result, alongside the
 * free-text display name the form already saves (`basics.highSchool`). Typing without picking anything keeps the id
 * blank — the school isn't in the directory yet, or hasn't loaded — so the free-text fallback still saves.
 */
export function HighSchoolPicker({
  idName,
  nameName,
  defaultId,
  defaultName,
  disabled,
}: {
  idName: string;
  nameName: string;
  defaultId: string | null;
  defaultName: string | null;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState(defaultName ?? "");
  const [id, setId] = useState(defaultId ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<HighSchoolHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      searchHighSchoolsApi(q, { limit: 8, signal: controller.signal })
        .then((rows) => {
          setResults(rows);
          setActive(0);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const pick = (hit: HighSchoolHit) => {
    setId(hit.id);
    setQuery(hit.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const showList = open && query.trim().length >= 2 && results.length > 0;

  return (
    <div className="relative">
      <input type="hidden" name={idName} value={id} />
      <input
        ref={inputRef}
        id={nameName}
        name={nameName}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        maxLength={200}
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          if (next.trim().length < 2) setResults([]);
          // Free typing invalidates a previous pick: the id only ever names the school actually selected.
          if (id) setId("");
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
          } else if (e.key === "Enter" && showList && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`${inputCls} mt-1.5`}
        placeholder="Start typing your high school's name"
      />
      {showList && (
        <div id={listId} role="listbox" className="absolute inset-x-0 z-50 mt-1.5 overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-2xl shadow-black/10">
          {results.map((h, i) => (
            <button
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h)}
              className={cn("flex w-full flex-col items-start rounded-xl px-2.5 py-2 text-left transition-colors", i === active ? "bg-accent" : "hover:bg-muted")}
            >
              <span className="text-sm font-semibold">{h.name}</span>
              <span className="text-xs text-muted-foreground">
                {h.city ? `${h.city}, ${h.state}` : h.state} · {h.kind === "private" ? "Private" : "Public"} · Grades {h.grades}
              </span>
            </button>
          ))}
        </div>
      )}
      {!id && query.trim().length >= 2 && (
        <p className="mt-1 text-xs text-muted-foreground">Not finding it? It&apos;s saved as typed; search keeps checking as you type.</p>
      )}
    </div>
  );
}
