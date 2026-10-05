"use client";

import { useState } from "react";
import { RangeBar } from "@/components/charts/RangeBar";
import { InfoTip } from "@/components/ui/info-tip";
import { scoreScale } from "@/lib/score-scale";
import { yourBandSentence } from "@/lib/score-bands";
import type { Bands6 } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Ranges {
  satTotal: [number, number] | null;
  satReading: [number, number] | null;
  satMath: [number, number] | null;
  act: [number, number] | null;
  medianSatMid: number | null;
  medianActMid: number | null;
  actEnglish?: [number, number] | null;
  actMath?: [number, number] | null;
  /** ACT Reading and Science (a college's CDS C9), drawn under the composite with English and Math when present. */
  actReading?: [number, number] | null;
  actScience?: [number, number] | null;
}

/** This college's true medians (fall 2022 on); pass only when they describe the same report as the ranges. */
interface Medians {
  satTotal: number | null;
  satReading: number | null;
  satMath: number | null;
  act: number | null;
}

/** "Where do I land?" Enter a score and see it on the middle-50% bars. */
export function ScoreChecker({
  ranges,
  medians,
  color,
  bands,
  initialTest,
  initialValue,
  fromProfile,
}: {
  ranges: Ranges;
  medians?: Medians | null;
  color: string;
  /** SAT total and ACT composite score bands (CDS C9), for "Your score is in the … band" under the bar. */
  bands?: { sat: Bands6 | null; act: Bands6 | null } | null;
  /**
   * Prefills from the signed-in student's saved profile (specs/product/student-profile.md "Display"), fetched
   * client-side by components/me/ScoreCheckerWithProfile.tsx — this component itself takes no server dependency.
   * `fromProfile` shows "Using your saved score"; the input stays editable either way.
   */
  initialTest?: "sat" | "act";
  initialValue?: number;
  fromProfile?: boolean;
}) {
  const available = (["sat", "act"] as const).filter((t) => (t === "sat" ? ranges.satTotal : ranges.act));
  const [test, setTest] = useState<"sat" | "act">(initialTest ?? available[0] ?? "sat");
  const [raw, setRaw] = useState(initialValue !== undefined ? String(initialValue) : "");
  const [usingProfile, setUsingProfile] = useState(fromProfile ?? false);
  const value = Number(raw);
  const valid =
    raw !== "" && Number.isFinite(value) && (test === "sat" ? value >= 400 && value <= 1600 : value >= 1 && value <= 36);
  const you = valid ? Math.round(value) : null;
  const satAxis = scoreScale("sat", ranges.satTotal?.[0], test === "sat" ? you : null);
  const sectionAxis = scoreScale("sat-section", ranges.satReading?.[0], ranges.satMath?.[0]);
  const actAxis = scoreScale("act", ranges.act?.[0], test === "act" ? you : null);
  const actParts = (
    [
      ["English", ranges.actEnglish],
      ["Math", ranges.actMath],
      ["Reading", ranges.actReading],
      ["Science", ranges.actScience],
    ] as [string, [number, number] | null | undefined][]
  ).filter((r): r is [string, [number, number]] => !!r[1]);
  const actPartAxis = scoreScale("act", ...actParts.map(([, r]) => r[0]));
  const testBands = test === "sat" ? bands?.sat : bands?.act;
  const bandLine = you !== null && testBands ? yourBandSentence(you, testBands, test === "sat" ? "sat_composite" : "act_composite") : null;
  const hasMedian = test === "sat" ? medians?.satTotal != null || medians?.satReading != null : medians?.act != null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-dashed bg-surface-2 p-4 sm:flex-row sm:items-center">
        <div className="sm:mr-auto">
          <p className="text-sm font-semibold">Where would you land?</p>
          {usingProfile && raw !== "" && (
            <p className="text-xs text-muted-foreground">
              Using your {test.toUpperCase()} {raw} from{" "}
              <a href="/me" className="font-semibold underline-offset-2 hover:underline">
                your profile
              </a>{" "}
              (edit below).
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Test" className="inline-flex rounded-full border bg-card p-0.5">
            {available.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={test === t}
                onClick={() => {
                  setTest(t);
                  setRaw("");
                  setUsingProfile(false);
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold uppercase",
                  test === t ? "bg-foreground text-background" : "text-muted-foreground"
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            inputMode="numeric"
            aria-label={test === "sat" ? "Your SAT total (400–1600)" : "Your ACT composite (1–36)"}
            placeholder={test === "sat" ? "e.g. 1450" : "e.g. 32"}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value.replace(/[^0-9]/g, "").slice(0, 4));
              setUsingProfile(false);
            }}
            className="h-9 w-28 rounded-full border bg-card px-4 text-sm font-semibold tabular-nums outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/15"
          />
        </div>
      </div>

      {test === "sat" && ranges.satTotal ? (
        <>
          <RangeBar
            label="SAT total"
            term="sat"
            low={ranges.satTotal[0]}
            high={ranges.satTotal[1]}
            scale={satAxis.scale}
            ticks={satAxis.ticks}
            color={color}
            medianMid={ranges.medianSatMid ?? undefined}
            median={medians?.satTotal}
            you={you}
          />
          {bandLine && <p className="text-sm text-muted-foreground">{bandLine}</p>}
          {ranges.satReading && ranges.satMath && (
            <div className="grid gap-6 sm:grid-cols-2">
              <RangeBar label="Reading & Writing" term="sat-ebrw" low={ranges.satReading[0]} high={ranges.satReading[1]} scale={sectionAxis.scale} ticks={sectionAxis.ticks} color={color} median={medians?.satReading} />
              <RangeBar label="Math" term="sat-math" low={ranges.satMath[0]} high={ranges.satMath[1]} scale={sectionAxis.scale} ticks={sectionAxis.ticks} color={color} median={medians?.satMath} />
            </div>
          )}
        </>
      ) : ranges.act ? (
        <>
          <RangeBar
            label="ACT composite"
            term="act"
            low={ranges.act[0]}
            high={ranges.act[1]}
            scale={actAxis.scale}
            ticks={actAxis.ticks}
            color={color}
            medianMid={ranges.medianActMid ?? undefined}
            median={medians?.act}
            you={you}
          />
          {bandLine && <p className="text-sm text-muted-foreground">{bandLine}</p>}
          {actParts.length >= 2 && (
            <div className="grid gap-6 sm:grid-cols-2">
              {actParts.map(([label, r]) => (
                <RangeBar key={label} label={label} term="act" low={r[0]} high={r[1]} scale={actPartAxis.scale} ticks={actPartAxis.ticks} color={color} />
              ))}
            </div>
          )}
        </>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-full" style={{ backgroundColor: color }} /> Middle 50% of enrolled first-years who sent scores
          <InfoTip term="middle-50" />
        </span>
        {hasMedian && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 bg-card" style={{ borderColor: color }} /> This college&apos;s median
            <InfoTip term="median-vs-midpoint" />
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded-full bg-foreground/70" /> National median midpoint
        </span>
      </p>
    </div>
  );
}
