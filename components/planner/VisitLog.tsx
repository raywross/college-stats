"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { VisitForm } from "@/components/planner/VisitForm";
import { BEFORE_YOU_GO_QUESTIONS, VISIT_KIND_LABELS } from "@/lib/planner/actions";
import { addVisitQuestion, deleteVisit } from "@/lib/planner/store-actions";
import type { PlanVisit } from "@/lib/planner/types";
import { distanceLine } from "@/lib/home";
import { dayLabel } from "@/lib/planner/tasks";

/**
 * The visit log for one college (specs/planner/actions.md "Visits"): future visits first, with "Add to calendar"
 * and the before-you-go questions, then past visits. Logging, editing, and deleting a visit all go through
 * `VisitForm`/`store-actions.ts`. Read-only (no log, edit, or delete) without edit access.
 */
export function VisitLog({
  itemId,
  schoolName,
  visits,
  canEdit,
  today,
  householdNames,
  distanceMiles,
  bookUrl,
}: {
  itemId: string;
  schoolName: string;
  visits: readonly PlanVisit[];
  canEdit: boolean;
  today: string;
  householdNames: readonly string[];
  distanceMiles: number | null;
  bookUrl?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PlanVisit | null>(null);
  const [, startTransition] = useTransition();

  const sorted = [...visits].sort((a, b) => a.on_date.localeCompare(b.on_date));
  const future = sorted.filter((v) => v.on_date >= today);
  const past = sorted.filter((v) => v.on_date < today).reverse();

  const remove = (id: string) => {
    if (!window.confirm("Remove this visit? Its notes go with it.")) return;
    startTransition(async () => {
      await deleteVisit(id);
    });
  };

  const askBeforeYouGo = (visitId: string, question: string) => {
    startTransition(async () => {
      await addVisitQuestion(visitId, question);
    });
  };

  return (
    <div className="space-y-3">
      {future.map((v) => (
        <div key={v.id} className="rounded-xl border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                {VISIT_KIND_LABELS[v.kind]} · {dayLabel(v.on_date, today)}
                {v.at_time ? ` at ${v.at_time}` : ""}
              </p>
              {v.registered ? (
                <p className="text-xs text-muted-foreground">
                  Registered{v.registration_url ? "" : " (no link on file)"}
                  {v.registration_url && (
                    <>
                      {" · "}
                      <a href={v.registration_url} target="_blank" rel="noopener" className="underline">
                        Registration
                      </a>
                    </>
                  )}
                </p>
              ) : bookUrl ? (
                <a href={bookUrl} target="_blank" rel="noopener" className="text-xs text-primary underline">
                  Book on the college&apos;s visit page
                </a>
              ) : null}
              {v.who.length > 0 && <p className="text-xs text-muted-foreground">Going: {v.who.join(", ")}</p>}
            </div>
            {canEdit && (
              <div className="flex shrink-0 gap-1">
                <a
                  href={`/api/plan/visits/${v.id}/ics`}
                  className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Add to calendar"
                  title="Add to calendar"
                >
                  <CalendarPlus className="size-4" />
                </a>
                <button type="button" onClick={() => setEditing(v)} className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Edit visit">
                  <Pencil className="size-4" />
                </button>
                <button type="button" onClick={() => remove(v.id)} className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remove visit">
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </div>
          <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs">
            <p className="font-semibold text-muted-foreground">Before you go</p>
            <ul className="mt-1 space-y-1">
              {BEFORE_YOU_GO_QUESTIONS.map((q) => (
                <li key={q.key} className="flex items-center justify-between gap-2">
                  <span>{q.question}</span>
                  {canEdit && (
                    <button type="button" onClick={() => askBeforeYouGo(v.id, q.question)} className="shrink-0 text-primary underline">
                      Ask
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {distanceMiles !== null && <p className="mt-1.5 text-muted-foreground">{distanceLine(distanceMiles)} from home</p>}
          </div>
        </div>
      ))}

      {past.map((v) => (
        <div key={v.id} className="rounded-xl border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                {VISIT_KIND_LABELS[v.kind]} · {dayLabel(v.on_date, today)}
                {v.rating ? ` · ${v.rating}/5` : ""}
              </p>
              {v.who.length > 0 && <p className="text-xs text-muted-foreground">Went with: {v.who.join(", ")}</p>}
              {v.notes.stood_out && <p className="mt-1 text-xs">Stood out: {v.notes.stood_out}</p>}
              {v.notes.worried && <p className="text-xs">Worried: {v.notes.worried}</p>}
              {v.notes.people && <p className="text-xs">People: {v.notes.people}</p>}
              {v.notes.live_here && <p className="text-xs">Would want to live here: {v.notes.live_here}</p>}
              {v.notes.free && <p className="text-xs">{v.notes.free}</p>}
              {v.kind === "interview" && v.notes.interviewer && (
                <p className="text-xs text-muted-foreground">
                  Interviewer: {v.notes.interviewer} {v.notes.interviewer_kind ? `(${v.notes.interviewer_kind})` : ""}
                </p>
              )}
            </div>
            {canEdit && (
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setEditing(v)} className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted" aria-label="Edit visit">
                  <Pencil className="size-4" />
                </button>
                <button type="button" onClick={() => remove(v.id)} className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remove visit">
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {visits.length === 0 && <p className="text-sm text-muted-foreground">No visits logged yet.</p>}

      {canEdit && (
        <button type="button" onClick={() => setAdding(true)} className="h-9 rounded-full border px-3 text-sm font-semibold hover:bg-muted">
          Log a visit
        </button>
      )}

      <SheetDialog open={adding} onOpenChange={setAdding} title={`Log a visit · ${schoolName}`}>
        <VisitForm itemId={itemId} householdNames={householdNames} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      </SheetDialog>
      <SheetDialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)} title={`Edit visit · ${schoolName}`}>
        {editing && <VisitForm itemId={itemId} visit={editing} householdNames={householdNames} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </SheetDialog>
    </div>
  );
}
