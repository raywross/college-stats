"use client";

import { useId } from "react";

/**
 * "Type the word to confirm" for an action with a cost (the full run). Controlled by its parent so the submit button can
 * stay disabled until the word matches; the Server Action asks for the same word again, so this is a convenience.
 */
export function TypedConfirm({ word, value, onChange, name = "confirm" }: { word: string; value: string; onChange: (value: string) => void; name?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">
        Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.95em]">{word}</span> to confirm
      </label>
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-xs dark:bg-input/30"
      />
    </div>
  );
}

/** Whether the typed text matches the word (the same trim the Server Action applies). */
export function confirmMatches(word: string, typed: string): boolean {
  return typed.trim() === word;
}
