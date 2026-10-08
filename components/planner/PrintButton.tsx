"use client";

import { Printer } from "lucide-react";

/** "Print or save as PDF": the browser's print dialog, where "Save as PDF" is a destination. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 print:hidden">
      <Printer className="size-4" aria-hidden /> {label}
    </button>
  );
}
