"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gradeNow } from "@/lib/chances/courses";
import type { EstimateContextInput } from "@/lib/chances/estimate-request";
import { estimateInputFromProfile } from "@/lib/chances/snapshot";
import type { EstimateResult, EstimateStudent } from "@/lib/chances/types";
import { effectiveGradYear, type StudentProfileData } from "@/lib/student-profile";

/** How long the numbers must sit still before the estimate is asked again (the slider moves in steps). */
export const ESTIMATE_DEBOUNCE_MS = 400;
/** Colleges per request: the signed-out limit, which a signed-in caller is always within. */
const CHUNK = 20;

/** POST /api/estimate for one batch; null when it fails (the caller keeps what it had). */
async function fetchEstimates(student: EstimateStudent, context: EstimateContextInput, unitIds: string[], signal: AbortSignal): Promise<Record<string, EstimateResult> | null> {
  const res = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student, unitIds, context }),
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { results?: Record<string, EstimateResult> };
  return body.results ?? null;
}

/**
 * Quad's estimate for a list, asked of the server as the numbers change (specs/chances/estimate.md "Server only": the
 * numbers form "calls the endpoint with a short debounce instead"). Waits ESTIMATE_DEBOUNCE_MS after the last change,
 * cancels a request the next change makes stale, and keeps showing the previous results while a new answer loads.
 * `initial` seeds it (the server's estimates for the saved numbers). The request also carries what the server load
 * passes besides the student (the core-subject answers and the grade, from the profile's class year or `gradYear`), so
 * the live preview gives the answer the saved plan would.
 */
export function useEstimates(profile: StudentProfileData | null, unitIds: readonly string[], initial: Record<string, EstimateResult> = {}, opts: { gradYear?: number | null } = {}) {
  const student = useMemo(() => estimateInputFromProfile(profile, "", null).student, [profile]);
  const gradYear = profile ? effectiveGradYear(profile.basics, opts.gradYear ?? null) : (opts.gradYear ?? null);
  const context = useMemo<EstimateContextInput>(
    () => ({ coreAtTopLevel: profile?.academics.coreAtTopLevel ?? null, grade: gradeNow(gradYear, new Date().toISOString().slice(0, 10)) }),
    [profile?.academics.coreAtTopLevel, gradYear],
  );
  const ids = useMemo(() => [...new Set(unitIds)].sort(), [unitIds]);
  const key = JSON.stringify({ student, context, ids });
  const [results, setResults] = useState<Record<string, EstimateResult>>(initial);
  const [loading, setLoading] = useState(false);
  // The first render's numbers are the ones `initial` was computed for: no need to ask again until they change.
  const seeded = useRef(ids.length > 0 && ids.every((id) => id in initial));

  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    if (ids.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += CHUNK) batches.push(ids.slice(i, i + CHUNK));
      Promise.all(batches.map((b) => fetchEstimates(student, context, b, controller.signal).catch(() => null)))
        .then((answers) => {
          if (controller.signal.aborted) return;
          const merged = Object.assign({}, ...answers.filter((a): a is Record<string, EstimateResult> => a !== null));
          setResults((prev) => ({ ...prev, ...merged }));
          setLoading(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` stands for the student and the ids together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { results, loading };
}
