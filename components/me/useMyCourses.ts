"use client";

import { useEffect, useState } from "react";
import { useLocalProfile } from "@/components/me/useLocalProfile";
import { myCourseState, rigorForLocal, type MyCourseState } from "@/lib/chances/rigor-store";
import type { RigorView } from "@/lib/chances/rigor-view";
import type { CourseEntry } from "@/lib/chances/types";
import type { CoreAtTopLevel } from "@/lib/student-profile";

/**
 * The visitor's course list wherever a static page needs it (the college profile's rigor line and You column, the high
 * school page): the signed-in student's own list from the server, else the list kept in the browser with the signed-out
 * profile (components/me/useLocalProfile.ts). The reading's sentences always come from the server (the rules never
 * reach the browser); this hook only asks. Concurrent callers on a page share one request.
 */
export interface MyCourses {
  status: "loading" | "ready";
  signedIn: boolean;
  courses: CourseEntry[];
  coreAtTopLevel: CoreAtTopLevel | null;
  highSchoolId: string | null;
  majors: string[];
  /** The reading with its sentences; null until it arrives or when there is nothing to read. */
  view: RigorView | null;
}

let inflight: Promise<MyCourseState> | null = null;
function fetchState(): Promise<MyCourseState> {
  inflight ??= myCourseState().catch((): MyCourseState => ({ signedIn: false })).finally(() => {
    inflight = null;
  });
  return inflight;
}

const localViews = new Map<string, Promise<RigorView | null>>();
function localView(key: string, input: unknown): Promise<RigorView | null> {
  let p = localViews.get(key);
  if (!p) {
    p = rigorForLocal(input).catch(() => null);
    localViews.set(key, p);
    if (localViews.size > 20) localViews.delete(localViews.keys().next().value as string);
  }
  return p;
}

export function useMyCourses(): MyCourses {
  const local = useLocalProfile().data;
  const [server, setServer] = useState<MyCourseState | null>(null);
  const [localRead, setLocalRead] = useState<{ key: string; view: RigorView | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchState().then((s) => {
      if (!cancelled) setServer(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const input = { courses: local.academics.courses, coreAtTopLevel: local.academics.coreAtTopLevel, highSchoolId: local.basics.highSchoolId, gradYear: local.basics.gradYear };
  const key = JSON.stringify(input);
  const signedOut = server !== null && !server.signedIn;
  useEffect(() => {
    if (!signedOut) return;
    let cancelled = false;
    localView(key, input).then((view) => {
      if (!cancelled) setLocalRead({ key, view });
    });
    return () => {
      cancelled = true;
    };
    // `input` is the parsed `key`; the key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut, key]);

  if (server === null) return { status: "loading", signedIn: false, courses: [], coreAtTopLevel: null, highSchoolId: null, majors: [], view: null };
  if (server.signedIn) {
    return { status: "ready", signedIn: true, courses: server.courses, coreAtTopLevel: server.coreAtTopLevel, highSchoolId: server.highSchoolId, majors: server.majors, view: server.view };
  }
  return {
    status: "ready",
    signedIn: false,
    courses: local.academics.courses,
    coreAtTopLevel: local.academics.coreAtTopLevel,
    highSchoolId: local.basics.highSchoolId,
    majors: local.plans.intendedMajors,
    view: localRead?.key === key ? localRead.view : null,
  };
}
