"use client";

import { useEffect, useState } from "react";
import { ScoreChecker } from "@/components/school/ScoreChecker";
import { myScores } from "@/lib/student-profile-store";

type Props = Omit<Parameters<typeof ScoreChecker>[0], "initialTest" | "initialValue" | "fromProfile">;

/**
 * Wraps ScoreChecker to prefill from the signed-in student's saved scores (specs/product/student-profile.md
 * "Display": "a 'You' marker ... 'Using your SAT 1450 (edit)'"). Profile pages are static (tests/accounts.test.mts
 * forbids reading cookies while rendering a public page), so the fetch happens here, client-side, after the page
 * has already rendered — a Server Action call from the browser, same as useMe()'s /api/me fetch.
 */
export function ScoreCheckerWithProfile(props: Props) {
  const [profile, setProfile] = useState<{ test: "sat" | "act"; value: number } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    myScores()
      .then((s) => {
        if (cancelled) return;
        if (!s.signedIn) return setProfile(null);
        if (s.satTotal !== null) return setProfile({ test: "sat", value: s.satTotal });
        if (s.actComposite !== null) return setProfile({ test: "act", value: s.actComposite });
        setProfile(null);
      })
      .catch(() => setProfile(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // Before the fetch resolves (including the server-rendered first paint), render with no prefill: identical to
  // what the server sent, so there's no hydration mismatch.
  if (!profile) return <ScoreChecker {...props} />;
  return <ScoreChecker key={`${profile.test}-${profile.value}`} {...props} initialTest={profile.test} initialValue={profile.value} fromProfile />;
}
