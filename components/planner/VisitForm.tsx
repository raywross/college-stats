"use client";

import { useState, useTransition, type FormEvent } from "react";
import { VISIT_KINDS, VISIT_KIND_LABELS, VISIT_NOTE_PROMPTS } from "@/lib/planner/actions";
import { logVisit, updateVisit } from "@/lib/planner/store-actions";
import type { PlanVisit, VisitKind, VisitNotes } from "@/lib/planner/types";

function todayIsoClient(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputCls = "h-10 w-full rounded-xl border bg-background px-3 text-sm";

/**
 * The visit form (specs/planner/actions.md "Visits"): kind, date and time, registered (with the link), who's
 * going, a rating once the visit's in the past, the notes prompts (optional, expanding), and the interviewer fields
 * for an interview. One column at every width (mobile.md). Creates a visit without `visit`, else edits it.
 *
 * Visit notes are never private (model.md "Rules": a visit is a family event); a student who wants private
 * thoughts uses a private list note instead, which this form points to.
 */
export function VisitForm({
  itemId,
  visit,
  householdNames,
  onDone,
  onCancel,
}: {
  itemId: string;
  visit?: PlanVisit | null;
  /** Names from the household roster, for the "who's going" checklist; free text covers anyone else. */
  householdNames: readonly string[];
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<VisitKind>(visit?.kind ?? "campus_tour");
  const [onDate, setOnDate] = useState(visit?.on_date ?? "");
  const [atTime, setAtTime] = useState(visit?.at_time ?? "");
  const [registered, setRegistered] = useState(visit?.registered ?? false);
  const [registrationUrl, setRegistrationUrl] = useState(visit?.registration_url ?? "");
  const [who, setWho] = useState<string[]>(visit?.who ?? []);
  const [whoFreeText, setWhoFreeText] = useState("");
  const [rating, setRating] = useState<number | null>(visit?.rating ?? null);
  const [notes, setNotes] = useState<VisitNotes>(visit?.notes ?? {});
  const [interviewer, setInterviewer] = useState(visit?.notes?.interviewer ?? "");
  const [interviewerKind, setInterviewerKind] = useState<"alumni" | "admissions" | "">(visit?.notes?.interviewer_kind ?? "");

  const isPast = onDate !== "" && onDate <= todayIsoClient();

  const toggleWho = (name: string) =>
    setWho((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!onDate) {
      setError("Pick a date.");
      return;
    }
    const extraWho = whoFreeText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const finalWho = [...who, ...extraWho].slice(0, 8);
    const finalNotes: VisitNotes = { ...notes };
    if (kind === "interview") {
      if (interviewer.trim()) finalNotes.interviewer = interviewer.trim();
      if (interviewerKind) finalNotes.interviewer_kind = interviewerKind;
    }
    setError(null);
    startTransition(async () => {
      const input = {
        kind,
        onDate,
        atTime: atTime || null,
        registered,
        registrationUrl: registrationUrl || null,
        who: finalWho,
        rating: isPast ? rating : null,
        notes: finalNotes,
      };
      const result = visit ? await updateVisit(visit.id, input) : await logVisit(itemId, input);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone?.();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="visit-kind" className="text-xs font-semibold text-muted-foreground">
          Kind
        </label>
        <select id="visit-kind" value={kind} onChange={(e) => setKind(e.target.value as VisitKind)} className={inputCls}>
          {VISIT_KINDS.map((k) => (
            <option key={k} value={k}>
              {VISIT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="visit-date" className="text-xs font-semibold text-muted-foreground">
            Date
          </label>
          <input id="visit-date" type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} className={inputCls} required />
        </div>
        <div className="space-y-1">
          <label htmlFor="visit-time" className="text-xs font-semibold text-muted-foreground">
            Time (optional)
          </label>
          <input id="visit-time" type="time" value={atTime ?? ""} onChange={(e) => setAtTime(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={registered} onChange={(e) => setRegistered(e.target.checked)} className="size-4 accent-primary" />
          Registered
        </label>
        {registered && (
          <input
            type="url"
            value={registrationUrl ?? ""}
            onChange={(e) => setRegistrationUrl(e.target.value)}
            placeholder="Registration link (optional)"
            className={inputCls}
          />
        )}
      </div>

      {kind === "interview" && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed p-2.5">
          <input type="text" value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="Interviewer's name" className={inputCls} />
          <select value={interviewerKind} onChange={(e) => setInterviewerKind(e.target.value as "alumni" | "admissions" | "")} className={inputCls}>
            <option value="">Alumni or admissions?</option>
            <option value="alumni">Alumni</option>
            <option value="admissions">Admissions</option>
          </select>
        </div>
      )}

      {householdNames.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Who&apos;s going</p>
          <div className="flex flex-wrap gap-1.5">
            {householdNames.map((name) => (
              <label key={name} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
                <input type="checkbox" checked={who.includes(name)} onChange={() => toggleWho(name)} className="size-3.5 accent-primary" />
                {name}
              </label>
            ))}
          </div>
          <input type="text" value={whoFreeText} onChange={(e) => setWhoFreeText(e.target.value)} placeholder="Anyone else (comma-separated)" className={inputCls} />
        </div>
      )}
      {householdNames.length === 0 && (
        <input type="text" value={whoFreeText} onChange={(e) => setWhoFreeText(e.target.value)} placeholder="Who's going (comma-separated)" className={inputCls} />
      )}

      {isPast && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">How did it feel? (optional)</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                aria-pressed={rating === n}
                className={`inline-flex size-9 items-center justify-center rounded-full border text-sm font-semibold ${rating !== null && n <= rating ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {isPast && (
        <details className="rounded-xl border p-2.5" open>
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Notes (optional; the family can read these, never private)</summary>
          <div className="mt-2 space-y-2">
            {VISIT_NOTE_PROMPTS.map((p) => (
              <div key={p.key} className="space-y-1">
                <label htmlFor={`note-${p.key}`} className="text-xs text-muted-foreground">
                  {p.label}
                </label>
                <textarea
                  id={`note-${p.key}`}
                  rows={2}
                  value={notes[p.key] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [p.key]: e.target.value }))}
                  className="w-full rounded-xl border bg-background p-2 text-sm"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label htmlFor="note-free" className="text-xs text-muted-foreground">
                Anything else
              </label>
              <textarea
                id="note-free"
                rows={2}
                value={notes.free ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, free: e.target.value }))}
                className="w-full rounded-xl border bg-background p-2 text-sm"
              />
            </div>
          </div>
        </details>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="h-10 flex-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {visit ? "Save" : "Log this visit"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-10 rounded-full border px-4 text-sm font-semibold">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
