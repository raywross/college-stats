"use client";

import { useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { LIST_EXPLAINER_TITLE, listExplainer } from "@/lib/chances/notes";
import { cn } from "@/lib/utils";

/**
 * "How Quad reads your list" (specs/planner/redesign/list.md "Around the list"; owner, 2026-10-12): the one info link
 * for the whole list, replacing the per-college estimate text the row drawer used to carry. A bottom sheet on phones,
 * a centered card from `sm` (SheetDialog). The text lives in one place, lib/chances/notes.ts `listExplainer`: kinds
 * of inputs and the five levels, never how they're combined. Section headings link their glossary entries.
 */
export function ListExplainer({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const sections = listExplainer();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className={cn("inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline", className)}
      >
        <Info className="size-4" aria-hidden />
        {LIST_EXPLAINER_TITLE}
      </button>
      <SheetDialog open={open} onOpenChange={setOpen} title={LIST_EXPLAINER_TITLE}>
        <div className="space-y-5 text-sm">
          {sections.map((s) => (
            <section key={s.heading} className="space-y-1.5">
              <h3 className="font-semibold">
                {s.term ? (
                  <Link href={`/glossary#${s.term}`} className="underline decoration-dotted underline-offset-4 hover:text-primary">
                    {s.heading}
                  </Link>
                ) : (
                  s.heading
                )}
              </h3>
              {s.paragraphs.map((p) => (
                <p key={p} className="text-muted-foreground">
                  {p}
                </p>
              ))}
              {s.items && (
                <ul className="space-y-1.5">
                  {s.items.map((i) => (
                    <li key={i.label}>
                      <span className="font-semibold">{i.label}:</span> <span className="text-muted-foreground">{i.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </SheetDialog>
    </>
  );
}
