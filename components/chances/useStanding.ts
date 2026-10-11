"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocalProfile } from "@/components/me/useLocalProfile";
import type { EstimateContextInput } from "@/lib/chances/estimate-request";
import { gradeNow } from "@/lib/chances/courses";
import { estimateInputFromProfile } from "@/lib/chances/snapshot";
import { myStandingInput, type MyStanding } from "@/lib/chances/standing-store";
import type { EstimateResult, EstimateStudent } from "@/lib/chances/types";
import { hasNumbers, yourNumbersFrom, type YourNumbers } from "@/lib/chances/what-went-in";
import { planGpaLabel } from "@/lib/student-profile";

/** "Students like you" for the one college, as POST /api/estimate returns it (null until the data clears its thresholds). */
export interface LikeYou {
  n: number;
  admitted: number;
  seasons: [number, number];
  residency: boolean;
}

export type StandingState =
  /** Still finding out who is asking, or waiting for the answer. */
  | { status: "loading"; signedIn: boolean | null }
  /** Signed in or not, there is no GPA or test to estimate from. */
  | { status: "no-numbers"; signedIn: boolean }
  | { status: "failed"; signedIn: boolean }
  | { status: "ready"; signedIn: boolean; result: EstimateResult; yours: YourNumbers; student: EstimateStudent; likeYou: LikeYou | null };

interface Answer {
  result: EstimateResult | null;
  likeYou: LikeYou | null;
}

/** One request per (college, numbers) across the page: the hero chip, the overview card, and the card share it. */
const answers = new Map<string, Promise<Answer | null>>();

function ask(unitId: string, student: EstimateStudent, context: EstimateContextInput, wantLikeYou: boolean): Promise<Answer | null> {
  const key = JSON.stringify({ unitId, student, context, wantLikeYou });
  let p = answers.get(key);
  if (!p) {
    p = fetch("/api/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student, unitIds: [unitId], context, likeYou: wantLikeYou }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ results?: Record<string, EstimateResult>; likeYou?: LikeYou | null }>) : null))
      .then((body) => (body ? { result: body.results?.[unitId] ?? null, likeYou: body.likeYou ?? null } : null))
      .catch(() => null);
    answers.set(key, p);
    if (answers.size > 20) answers.delete(answers.keys().next().value as string);
    // A failed answer is not kept: the next mount asks again.
    void p.then((a) => {
      if (a === null) answers.delete(key);
    });
  }
  return p;
}

let mine: Promise<MyStanding> | null = null;
/** The signed-in student's numbers; components mounting together share one request (a later page asks again, in case they signed in or out). */
function fetchMine(): Promise<MyStanding> {
  mine ??= myStandingInput()
    .catch((): MyStanding => ({ signedIn: false }))
    .finally(() => {
      mine = null;
    });
  return mine;
}

/**
 * Quad's estimate for one college and the visitor's numbers: the signed-in student's saved profile, else the profile
 * kept in the browser (components/me/useLocalProfile.ts). The college pages are static, so this runs after mount.
 */
export function useStanding(unitId: string, opts: { likeYou?: boolean } = {}): StandingState {
  const local = useLocalProfile().data;
  const [server, setServer] = useState<MyStanding | null>(null);
  const [answer, setAnswer] = useState<{ key: string; value: Answer | null } | null>(null);
  const wantLikeYou = opts.likeYou === true;

  useEffect(() => {
    let cancelled = false;
    fetchMine().then((s) => {
      if (!cancelled) setServer(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const input = useMemo(() => {
    if (server === null) return null;
    if (server.signedIn) return server.hasNumbers ? { student: server.student, context: server.context, yours: server.yours } : "none";
    const { student } = estimateInputFromProfile(local, "", null);
    if (!hasNumbers(student)) return "none";
    return {
      student,
      context: { coreAtTopLevel: local.academics.coreAtTopLevel, grade: gradeNow(local.basics.gradYear, new Date().toISOString().slice(0, 10)) } satisfies EstimateContextInput,
      yours: yourNumbersFrom(student, planGpaLabel(local)),
    };
  }, [server, local]);

  const key = input && input !== "none" ? JSON.stringify({ unitId, student: input.student, context: input.context, wantLikeYou }) : null;
  useEffect(() => {
    if (!input || input === "none" || key === null) return;
    let cancelled = false;
    ask(unitId, input.student, input.context, wantLikeYou).then((value) => {
      if (!cancelled) setAnswer({ key, value });
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for the college and the numbers together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (server === null) return { status: "loading", signedIn: null };
  if (input === "none") return { status: "no-numbers", signedIn: server.signedIn };
  if (!input || answer?.key !== key) return { status: "loading", signedIn: server.signedIn };
  if (!answer.value?.result) return { status: "failed", signedIn: server.signedIn };
  return { status: "ready", signedIn: server.signedIn, result: answer.value.result, yours: input.yours, student: input.student, likeYou: answer.value.likeYou };
}
