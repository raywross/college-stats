"use client";

/**
 * Step 8's picked list (specs/planner/record/majors.md "Picked"): the first pick reads "first choice", ▲▼ arrows
 * (and drag, cheap enough over so few rows) reorder, ✕ removes. Pure display + callbacks; MajorStep owns the draft.
 */
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { MAJOR_FAMILIES, type MajorFamily } from "@/lib/majors";
import { moveMajor } from "@/lib/majors-search";
import { cn } from "@/lib/utils";

export function MajorChips({ majors, onChange }: { majors: readonly MajorFamily[]; onChange: (next: MajorFamily[]) => void }) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const move = (i: number, dir: -1 | 1) => onChange(moveMajor(majors, i, dir));
  const remove = (i: number) => onChange(majors.filter((_, idx) => idx !== i));

  const drop = (i: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === i) return;
    const next = [...majors];
    const [picked] = next.splice(from, 1);
    next.splice(i, 0, picked);
    onChange(next);
  };

  return (
    <ul className="space-y-2">
      {majors.map((m, i) => (
        <li
          key={m}
          draggable
          onDragStart={() => {
            dragFrom.current = i;
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(i);
          }}
          onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
          onDrop={() => drop(i)}
          className={cn("flex items-center gap-2 rounded-2xl border bg-card px-3.5 py-2.5", dragOver === i && "border-foreground")}
        >
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label={`Move ${MAJOR_FAMILIES[m]} up`}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === majors.length - 1}
              aria-label={`Move ${MAJOR_FAMILIES[m]} down`}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <ChevronDown className="size-4" aria-hidden />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{MAJOR_FAMILIES[m]}</p>
            {i === 0 && <p className="text-xs text-muted-foreground">First choice</p>}
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove ${MAJOR_FAMILIES[m]}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" aria-hidden />
          </button>
        </li>
      ))}
      {majors.length > 1 && <p className="text-xs text-muted-foreground">Drag or use the arrows to put your first choice first.</p>}
    </ul>
  );
}

export default MajorChips;
