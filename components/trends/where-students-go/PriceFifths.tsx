"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { pct } from "@/lib/format";

export interface FifthRow {
  lo: number;
  hi: number;
  medianChange: number;
  totalChange: number;
  grewShare: number;
  n: number;
}

export interface FifthPanel {
  key: string;
  title: string;
  /** "change": lo/hi are % changes; "level": dollars. */
  kind: "change" | "level";
  byControl: { control: string; fifths: FifthRow[] }[];
}

const CONTROL_LABEL: Record<string, string> = { all: "All", public: "Public", "private-nonprofit": "Private nonprofit" };
const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${pct(Math.abs(v))}`;
const dollars = (v: number) => `$${Math.round(v / 1000).toLocaleString("en-US")}K`;
const rangeOf = (kind: FifthPanel["kind"], r: FifthRow) => (kind === "change" ? `${signedPct(r.lo)} to ${signedPct(r.hi)}` : `${dollars(r.lo)}–${dollars(r.hi)}`);

/**
 * Study 7's "price moved with enrollment" Colleges view (specs/trends/where-students-go.md, section 8): a public /
 * private switch over two small panels, colleges in fifths by the real change in what students pay and by the price
 * level at the start, each bar the fifth's total change in undergraduates (diverging from zero, one scale), with the
 * median college's change and the share that grew printed under it.
 */
export function PriceFifths({ panels }: { panels: FifthPanel[] }) {
  const [control, setControl] = useState(panels[0]?.byControl[0]?.control ?? "all");
  const max = Math.max(0.05, ...panels.flatMap((p) => p.byControl.flatMap((c) => c.fifths.map((f) => Math.abs(f.totalChange)))));
  return (
    <div>
      <SegmentedControl
        label="Public or private"
        value={control}
        options={(panels[0]?.byControl ?? []).map((c) => ({ value: c.control, label: CONTROL_LABEL[c.control] ?? c.control }))}
        onChange={setControl}
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {panels.map((p) => {
          const fifths = p.byControl.find((c) => c.control === control)?.fifths ?? [];
          return (
            <figure key={p.key} className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
              <figcaption className="text-sm font-semibold">{p.title}</figcaption>
              <ol className="mt-4 space-y-3">
                {fifths.map((f, i) => (
                  <li key={i} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{rangeOf(p.kind, f)}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{f.n.toLocaleString("en-US")} colleges</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted/40">
                        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                        <div
                          className="absolute inset-y-0 rounded-full"
                          style={{
                            backgroundColor: f.totalChange >= 0 ? "var(--d-access)" : "var(--d-size)",
                            left: f.totalChange >= 0 ? "50%" : `${50 - (Math.abs(f.totalChange) / max) * 50}%`,
                            width: `${(Math.abs(f.totalChange) / max) * 50}%`,
                          }}
                        />
                      </div>
                      <span className="w-12 shrink-0 text-right tabular-nums">{signedPct(f.totalChange)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      Median college {signedPct(f.medianChange)} · {pct(f.grewShare)} grew
                    </p>
                  </li>
                ))}
              </ol>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
