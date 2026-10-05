"use client";

import { useState } from "react";
import { TrendLine } from "@/components/charts/TrendLine";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { historyYearLabel } from "@/lib/history";
import type { ConferenceMeasureKey, ConferenceMeasureMeta, MembershipRule } from "@/lib/trends";
import { measureInfo } from "./measures";

const RULES: { value: MembershipRule; label: string }[] = [
  { value: "today", label: "Today's members" },
  { value: "atTheTime", label: "Members at the time" },
];

/**
 * The conference page's "Over time" chart (specs/trends/conferences.md): one measure at a time, the conference's
 * median against every college's median, under either membership rule. Every value comes from conferences.json.
 */
export function ConferenceOverTime({
  name,
  measures,
  lines,
  membershipFrom,
  coverage,
  provisionalYear,
}: {
  /** "SEC" or the conference's name, for labels. */
  name: string;
  measures: ConferenceMeasureMeta[];
  lines: Record<ConferenceMeasureKey, Record<MembershipRule, (number | null)[]>>;
  /** First school year the conference series covers. */
  membershipFrom: number;
  /** Share of members that must report a year (the file's `coverage`). */
  coverage: number;
  provisionalYear?: number | null;
}) {
  const [key, setKey] = useState<ConferenceMeasureKey>(measures[0].key);
  const [rule, setRule] = useState<MembershipRule>("today");
  const meta = measures.find((m) => m.key === key) ?? measures[0];
  const info = measureInfo(meta.key);
  const values = lines[meta.key][rule];
  const year = (y: number) => historyYearLabel(y, meta.kind);
  const dollars = meta.dollarsOf !== undefined ? ` (in ${historyYearLabel(meta.dollarsOf, "academic")} dollars)` : "";
  const missingAtStart = rule === "atTheTime" && meta.from < membershipFrom;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-full max-sm:-mx-4 max-sm:overflow-x-auto max-sm:px-4">
          <SegmentedControl label="Measure" value={key} options={measures.map((m) => ({ value: m.key, label: measureInfo(m.key).short }))} onChange={setKey} />
        </div>
        <SegmentedControl label="Which members" value={rule} options={RULES} onChange={setRule} />
      </div>
      <div className="mt-4 rounded-3xl border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">
          {info.label}
          {dollars}, median member · {rule === "today" ? "today's members in every year" : "members at the time"}
        </p>
        <div className="mt-3">
          <TrendLine
            series={[
              { key: "conf", name: name, color: info.color, start: meta.from, values },
              { key: "all", name: "All colleges", color: "var(--muted-foreground)", dashed: true, start: meta.from, values: meta.national },
            ]}
            from={meta.from}
            to={meta.to}
            kind={meta.kind}
            format={info.format}
            cadence={meta.cadence}
            provisionalYear={provisionalYear}
            label={`${info.label}, median member of the ${name} and of all four-year colleges, ${year(meta.from)} to ${year(meta.to)}`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Dashed: the median of every four-year college on the site. A year is left out when fewer than {Math.round(coverage * 100)}% of the members report it.
          {missingAtStart && <> Membership is recorded from {historyYearLabel(membershipFrom, "academic")}, so the members-at-the-time line starts there.</>}
        </p>
      </div>
    </div>
  );
}
