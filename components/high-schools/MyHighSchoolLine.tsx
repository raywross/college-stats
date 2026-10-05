"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { myHighSchoolMatriculation, type MyHighSchoolMatriculation } from "@/lib/student-profile-store";

/**
 * Quiet line on a college profile overview (specs/product/high-school-data.md "Display"): "From your high school:
 * 6 enrolled in 2023–2025 (school profile, 2025–26)", for a signed-in student whose high school's profile lists this
 * college. Renders nothing until signed in and matched, and nothing at all otherwise — the college profile is static
 * (tests/accounts.test.mts), so this fetches client-side after mount, same pattern as ScoreCheckerWithProfile.
 */
export function MyHighSchoolLine({ unitId }: { unitId: string }) {
  const [info, setInfo] = useState<MyHighSchoolMatriculation | null>(null);

  useEffect(() => {
    let cancelled = false;
    myHighSchoolMatriculation(unitId)
      .then((r) => {
        if (!cancelled) setInfo(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  if (!info) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      <span>From your high school,</span>
      <Link href={`/high-schools/${info.schoolId}`} className="font-semibold text-foreground hover:text-primary hover:underline">
        {info.schoolName}
      </Link>
      <span>: {info.line}</span>
    </p>
  );
}
