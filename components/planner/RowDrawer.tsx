"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Lock, RotateCcw } from "lucide-react";
import { MetricLabel } from "@/components/ui/info-tip";
import ActionsRowControls from "@/components/planner/row/actions";
import ApplyRowControls from "@/components/planner/row/apply";
import type { RowControlProps } from "@/components/planner/row/props";
import { addNote, deleteNote, notesForItems } from "@/lib/lists";
import { actionsOptional, interestLine } from "@/lib/planner/actions";
import { considersInterest } from "@/lib/planner/rounds";
import { requirementsFor } from "@/lib/planner/requirements";
import { dayLabel, scoreDrawerLine } from "@/lib/planner/list-row";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext } from "@/lib/planner/types";
import type { ListNote } from "@/lib/list-rules";
import type { AnyCited } from "@/lib/lineage";

/**
 * The row's drawer (specs/planner/redesign/list.md "The drawer"): opened by (i), inline under the row, each line
 * only when it has content. Group and round reasons, a score move, Show interest (the Actions stage's controls,
 * collapsed unless the college weighs it), Requirements once the season starts (the Apply stage's controls), and
 * Notes.
 */
export function RowDrawer({
  row,
  ctx,
  onUseGroupSuggestion,
  onUseStartingRound,
}: {
  row: PlanRowView;
  ctx: PlanContext;
  onUseGroupSuggestion: () => void;
  onUseStartingRound: () => void;
}) {
  const { item, school, standing, group, groupAuto, roundWhy, roundAuto, decision } = row;
  const scoreLine = scoreDrawerLine(row);
  const cite = (field: string | null) => (school && field ? (school.cites[field] as AnyCited | undefined) : undefined);

  const controlProps: RowControlProps | null = school ? { item, school, canEdit: ctx.viewer.canEdit, today: ctx.today, viewerIsGuardian: ctx.viewer.isGuardian, profile: ctx.profile } : null;
  const interest = school?.profile?.factors?.interest ?? null;
  const [interestOpen, setInterestOpen] = useState(() => (school ? considersInterest(school) : false));

  const requirements = school ? requirementsFor(item, school, ctx.profile).filter((r) => r.key !== "interest" && r.key !== "interview") : [];

  return (
    <div className="space-y-4 bg-muted/40 px-4 py-4 text-sm sm:pl-16">
      <div className="space-y-2">
        <p>
          <span className="font-semibold">{group === "unsorted" ? "No group yet" : `${group[0].toUpperCase()}${group.slice(1)}`}:</span>{" "}
          {groupAuto ? standing?.reasons.join(" ") || "Add a GPA or a score to sort this one." : "You picked this group."}{" "}
          {!groupAuto && group !== "unsorted" && (
            <button type="button" onClick={onUseGroupSuggestion} disabled={!ctx.viewer.canEdit} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-60">
              <RotateCcw className="size-3" aria-hidden /> Use the suggestion
            </button>
          )}
        </p>
        <p>
          <span className="font-semibold">Round:</span> {roundWhy}{" "}
          {!roundAuto && (
            <button type="button" onClick={onUseStartingRound} disabled={!ctx.viewer.canEdit} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-60">
              <RotateCcw className="size-3" aria-hidden /> Use the starting round
            </button>
          )}
        </p>
        {decision && <p className="text-muted-foreground">Decision expected around {dayLabel(decision.iso)}.</p>}
        {scoreLine && <p className="text-muted-foreground">{scoreLine}</p>}
      </div>

      {school && (
        <div>
          {interestOpen ? (
            <div className="space-y-1.5">
              <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Show interest</p>
              <p className="text-muted-foreground">{interestLine(interest)}</p>
              <ActionsRowControls {...controlProps!} />
            </div>
          ) : (
            <button type="button" onClick={() => setInterestOpen(true)} className="font-semibold text-primary hover:underline">
              Show interest {actionsOptional(interest) ? "(optional)" : ""}
            </button>
          )}
        </div>
      )}

      {row.seasonStatus !== null && school && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Requirements</p>
          <ul className="space-y-1">
            {requirements.map((r) => (
              <li key={r.key} className={!r.published ? "text-muted-foreground" : undefined}>
                <span className="font-semibold">{r.label}:</span>{" "}
                <MetricLabel cited={cite(r.cite)}>
                  <span>{r.text}</span>
                </MetricLabel>
              </li>
            ))}
          </ul>
          <ApplyRowControls {...controlProps!} />
        </div>
      )}

      {school && <NotesPanel itemId={item.id} canEdit={ctx.viewer.canEdit} viewerId={ctx.viewer.userId} />}

      {school && (
        <Link href={`/schools/${school.unit_id}/admissions#early`} className="inline-flex text-xs font-semibold text-primary hover:underline">
          How early rounds work at {school.name}
        </Link>
      )}
    </div>
  );
}

function NotesPanel({ itemId, canEdit, viewerId }: { itemId: string; canEdit: boolean; viewerId: string }) {
  const [notes, setNotes] = useState<ListNote[] | null>(null);
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    notesForItems([itemId]).then((byItem) => {
      if (!cancelled) setNotes(byItem[itemId] ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const remove = (noteId: string) => {
    setNotes((n) => n?.filter((x) => x.id !== noteId) ?? n);
    startTransition(async () => {
      await deleteNote(noteId);
    });
  };

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setBody("");
    startTransition(async () => {
      const result = await addNote(itemId, text, isPrivate);
      if (result.ok) {
        const fresh = await notesForItems([itemId]);
        setNotes(fresh[itemId] ?? []);
      }
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Notes</p>
      {notes === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          {notes.map((note) => (
            <div key={note.id} className="flex items-start justify-between gap-2 rounded-xl bg-card p-2">
              <p className="flex-1">
                {note.private && <Lock className="mr-1 inline size-3 text-muted-foreground" aria-label="Private" />}
                {note.body}
              </p>
              {note.author_id === viewerId && (
                <button type="button" onClick={() => remove(note.id)} className="text-xs text-muted-foreground hover:text-destructive">
                  Delete
                </button>
              )}
            </div>
          ))}
          {notes.length === 0 && <p className="text-muted-foreground">No notes yet.</p>}
        </>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note"
            className="h-9 min-w-40 flex-1 rounded-full border bg-background px-3 text-sm"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="size-3.5 accent-primary" />
            Private
          </label>
          <button type="button" disabled={pending || !body.trim()} onClick={submit} className="h-9 rounded-full border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-60">
            Add
          </button>
        </div>
      )}
    </div>
  );
}
