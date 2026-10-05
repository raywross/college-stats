"use client";

import { useEffect, useState } from "react";
import { RangeBar } from "@/components/charts/RangeBar";
import { myScores } from "@/lib/student-profile-store";

/**
 * A "You" row under Compare's SAT/ACT middle-50% lists (specs/product/student-profile.md "Display": "a 'You'
 * column in Test scores when the profile has scores"). Compare's page is public and static, so this client
 * component fetches the signed-in student's saved score after mount — the page itself never reads a cookie.
 */
export function YouScoreRow({ test, lo, hi }: { test: "sat" | "act"; lo: number; hi: number }) {
  const [value, setValue] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    myScores()
      .then((s) => {
        if (cancelled) return;
        setValue((test === "sat" ? s.satTotal : s.actComposite) ?? null);
      })
      .catch(() => setValue(null));
    return () => {
      cancelled = true;
    };
  }, [test]);

  if (value === null) return null;

  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 border-t pt-7 sm:grid-cols-[6rem_1fr_5rem]">
      <span className="truncate text-xs font-semibold text-primary">You</span>
      <RangeBar low={value} high={value} you={value} scale={[lo, hi]} color="transparent" compact />
      <span className="text-right text-sm font-bold whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}
