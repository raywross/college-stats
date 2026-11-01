"use client";

/**
 * The reader's fixes, shared from the notes to the Editor (specs/product/essays/editors.md "The reader's fixes"): Notes
 * loads the reads in the browser, so it publishes the newest read's open mechanics notes with a fix, and a way to set a
 * note's state on its list once the Editor has accepted (done) or rejected (ignored) one in Review changes.
 *
 * Without a provider the hooks are no-ops with no fixes, so Notes and the Editor still work alone.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReaderFix } from "@/lib/essays/review-view";

export type NoteState = "open" | "done" | "ignored";
type SetNoteState = (noteId: string, state: NoteState) => void;

interface FixesApi {
  fixes: readonly ReaderFix[];
  /** Notes' own list takes the new state (the server already has it). */
  setNoteState: SetNoteState;
  publish: (fixes: readonly ReaderFix[], set: SetNoteState) => void;
}

const NO_FIXES: readonly ReaderFix[] = [];
const FixesContext = createContext<FixesApi>({
  fixes: NO_FIXES,
  setNoteState: () => {},
  publish: () => {},
});

export function ReaderFixesProvider({ children }: { children: ReactNode }) {
  const [fixes, setFixes] = useState<readonly ReaderFix[]>(NO_FIXES);
  const setter = useRef<SetNoteState>(() => {});
  // Stable, so a publisher's effects never re-run because the fixes changed.
  const publish = useCallback((next: readonly ReaderFix[], set: SetNoteState) => {
    setter.current = set;
    setFixes(next);
  }, []);
  const setNoteState = useCallback<SetNoteState>((id, state) => setter.current(id, state), []);
  const value = useMemo<FixesApi>(() => ({ fixes, setNoteState, publish }), [fixes, setNoteState, publish]);
  return <FixesContext.Provider value={value}>{children}</FixesContext.Provider>;
}

/** Notes: publish the newest read's fixes (a memoized array) and how its list takes a note's new state. */
export function usePublishReaderFixes(fixes: readonly ReaderFix[], setNoteState: SetNoteState): void {
  const { publish } = useContext(FixesContext);
  const latest = useRef(setNoteState);
  useEffect(() => {
    latest.current = setNoteState;
  });
  useEffect(() => publish(fixes, (id, state) => latest.current(id, state)), [fixes, publish]);
  useEffect(() => () => publish(NO_FIXES, () => {}), [publish]);
}

/** The Editor: the fixes to review, and how to tell the notes list a note's state changed. */
export function useReaderFixes(): {
  fixes: readonly ReaderFix[];
  setNoteState: SetNoteState;
} {
  const { fixes, setNoteState } = useContext(FixesContext);
  return { fixes, setNoteState };
}
