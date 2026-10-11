"use client";

import { useEffect, useState } from "react";
import { myCoursesOnHighSchool } from "@/lib/chances/rigor-store";

/**
 * "You've taken or planned 6 of these." on a high school's page (specs/chances/rigor-in-context.md "On the high school
 * page"), only for a signed-in student whose linked school it is, and only when their list has AP courses the school
 * offers. Nothing for anyone else. The page is static, so the line arrives after mount, the way MyHighSchoolLine does.
 */
export function MyCoursesLine({ schoolId }: { schoolId: string }) {
  const [sentence, setSentence] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    myCoursesOnHighSchool(schoolId)
      .then((r) => {
        if (!cancelled) setSentence(r?.sentence ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  if (!sentence) return null;
  return <p className="mt-3 text-sm font-semibold">{sentence}</p>;
}
