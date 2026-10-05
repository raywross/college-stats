"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, Lock, Trash2 } from "lucide-react";
import { Crest } from "@/components/school/Crest";
import { MetricLabel, Term } from "@/components/ui/info-tip";
import { pctSmart, moneyCompact } from "@/lib/format";
import type { Cited } from "@/lib/lineage";
import type { TermKey } from "@/lib/glossary";
import {
  CATEGORY_LABELS,
  LIST_CATEGORIES,
  LIST_OUTCOMES,
  LIST_ROUNDS,
  LIST_STATUSES,
  OUTCOME_LABELS,
  ROUND_LABELS,
  STATUS_LABELS,
  balanceLine,
  type ListCategory,
  type ListItem,
  type ListNote,
  type ListOutcome,
  type ListRound,
  type ListStatus,
  addedByLabel,
} from "@/lib/list-rules";
import {
  addNote,
  deleteNote,
  removeFromList,
  reorderItem,
  setCategory,
  setDeadlineOverride,
  setEnrolling,
  setItemStatus,
  setOutcome,
  setRound,
} from "@/lib/lists";
import { CompareButton } from "@/components/compare/CompareButton";
import { cn } from "@/lib/utils";

const CATEGORY_TERM: Record<ListCategory, TermKey | null> = { reach: "reach-school", target: "target-school", likely: "likely-school", unsorted: null };

export interface BoardSchoolInfo {
  unit_id: string;
  name: string;
  city: string | null;
  state: string | null;
  brand?: Parameters<typeof Crest>[0]["brand"];
  admitRate: number | null;
  admitRateCited: Cited | null;
  avgCost: number | null;
  avgCostCited: Cited | null;
  deadline: { date: string | null; text: string | null; source: "reported" | "student" | null };
}

export interface BoardItem extends ListItem {
  school: BoardSchoolInfo;
  notes: ListNote[];
  addedByName: string | null;
  addedBySelf: boolean;
}

/**
 * The interactive body of /me/list and /me/lists/[id] (specs/product/saved-lists.md "Display"): colleges grouped
 * by category, with status/round/outcome pickers, notes, reordering (buttons, not drag — the spec's noted
 * deviation), and removal. Read-only when `canEdit` is false (a guardian without edit access).
 */
export function ListBoard({ items, canEdit, viewerId }: { items: BoardItem[]; canEdit: boolean; viewerId: string }) {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const groups = LIST_CATEGORIES.map((category) => ({ category, items: sorted.filter((i) => i.category === category) }));

  return (
    <div className="space-y-6">
      <p className="text-sm font-semibold text-muted-foreground">{balanceLine(items)}</p>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.category}>
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-lg font-bold">
                {CATEGORY_TERM[g.category] ? <Term term={CATEGORY_TERM[g.category]!}>{CATEGORY_LABELS[g.category]}</Term> : CATEGORY_LABELS[g.category]}
                <span className="text-sm font-medium text-muted-foreground">({g.items.length})</span>
              </h2>
              <div className="space-y-2">
                {g.items.map((item, i) => (
                  <ItemRow key={item.id} item={item} canEdit={canEdit} viewerId={viewerId} isFirst={i === 0} isLast={i === g.items.length - 1} />
                ))}
              </div>
            </section>
          ),
      )}
      {items.length === 0 && (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          No colleges here yet. Use &quot;Add to list&quot; on a college&apos;s page.
        </p>
      )}
    </div>
  );
}

function ItemRow({ item, canEdit, viewerId, isFirst, isLast }: { item: BoardItem; canEdit: boolean; viewerId: string; isFirst: boolean; isLast: boolean }) {
  const [pending, startTransition] = useTransition();
  const [notesOpen, setNotesOpen] = useState(false);
  const s = item.school;

  const run = (fn: () => Promise<unknown>) => {
    if (!canEdit) return;
    startTransition(async () => {
      await fn();
    });
  };

  return (
    <article className={cn("rounded-2xl border bg-card p-3", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-3">
        <Crest id={s.unit_id} name={s.name} size="sm" brand={s.brand} />
        <div className="min-w-0 flex-1">
          <Link href={`/schools/${s.unit_id}`} className="font-display font-bold hover:text-primary">
            {s.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {s.city && s.state ? `${s.city}, ${s.state} · ` : ""}
            {s.admitRate !== null && (
              <MetricLabel cited={s.admitRateCited ?? undefined}>
                <span>{pctSmart(s.admitRate)} admit</span>
              </MetricLabel>
            )}
            {s.avgCost !== null && (
              <>
                {" · "}
                <MetricLabel cited={s.avgCostCited ?? undefined}>
                  <span>{moneyCompact(s.avgCost)}/yr</span>
                </MetricLabel>
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{addedByLabel(item.addedByName, item.addedBySelf)}</p>
        </div>

        <select
          value={item.category}
          disabled={!canEdit}
          onChange={(e) => run(() => setCategory(item.id, e.target.value as ListCategory))}
          className="h-8 rounded-full border bg-background px-2 text-xs font-semibold disabled:opacity-60"
          aria-label="Category"
        >
          {LIST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>

        <select
          value={item.round ?? ""}
          disabled={!canEdit}
          onChange={(e) => run(() => setRound(item.id, (e.target.value || null) as ListRound | null))}
          className="h-8 rounded-full border bg-background px-2 text-xs disabled:opacity-60"
          aria-label="Application round"
        >
          <option value="">Round</option>
          {LIST_ROUNDS.map((rnd) => (
            <option key={rnd} value={rnd}>
              {ROUND_LABELS[rnd]}
            </option>
          ))}
        </select>

        <select
          value={item.status}
          disabled={!canEdit}
          onChange={(e) => run(() => setItemStatus(item.id, e.target.value as ListStatus))}
          className="h-8 rounded-full border bg-background px-2 text-xs disabled:opacity-60"
          aria-label="Status"
        >
          {LIST_STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABELS[st]}
            </option>
          ))}
        </select>

        {item.status === "decided" && (
          <select
            value={item.outcome ?? ""}
            disabled={!canEdit}
            onChange={(e) => e.target.value && run(() => setOutcome(item.id, e.target.value as ListOutcome, null))}
            className="h-8 rounded-full border bg-background px-2 text-xs disabled:opacity-60"
            aria-label="Outcome"
          >
            <option value="">Outcome</option>
            {LIST_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        )}

        {item.outcome === "admitted" && (
          <label className="inline-flex items-center gap-1.5 text-xs font-medium">
            <input type="checkbox" checked={item.enrolling} disabled={!canEdit} onChange={(e) => run(() => setEnrolling(item.id, e.target.checked))} className="size-3.5 accent-primary" />
            Enrolling here
          </label>
        )}

        <DeadlineCell item={item} canEdit={canEdit} />

        <CompareButton id={s.unit_id} variant="icon" />

        <button type="button" onClick={() => setNotesOpen((v) => !v)} className="inline-flex h-8 items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", notesOpen && "rotate-180")} />
          Notes ({item.notes.length})
        </button>

        {canEdit && (
          <div className="flex items-center gap-1">
            <button type="button" disabled={isFirst} onClick={() => run(() => reorderItem(item.id, "up"))} className="rounded-full border p-1.5 disabled:opacity-30" aria-label="Move up">
              <ArrowUp className="size-3.5" />
            </button>
            <button type="button" disabled={isLast} onClick={() => run(() => reorderItem(item.id, "down"))} className="rounded-full border p-1.5 disabled:opacity-30" aria-label="Move down">
              <ArrowDown className="size-3.5" />
            </button>
            <button type="button" onClick={() => run(() => removeFromList(item.id))} className="rounded-full border p-1.5 text-destructive" aria-label="Remove from list">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {notesOpen && <NotesPanel item={item} canEdit={canEdit} viewerId={viewerId} />}
    </article>
  );
}

function DeadlineCell({ item, canEdit }: { item: BoardItem; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const d = item.school.deadline;

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setEditing(true)}
        className="inline-flex h-8 items-center rounded-full border px-2 text-xs disabled:opacity-80"
        title={d.source === "reported" ? "From the college's own reported data" : d.source === "student" ? "Your own note" : "Set a deadline"}
      >
        {d.date ?? d.text ?? "No deadline set"}
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(async () => {
          await setDeadlineOverride(item.id, String(form.get("text") ?? ""), String(form.get("date") ?? "") || null);
          setEditing(false);
        });
      }}
    >
      <input type="date" name="date" defaultValue={item.deadline_date ?? ""} className="h-8 rounded-lg border bg-background px-1.5 text-xs" />
      <input type="text" name="text" defaultValue={item.deadline_text ?? ""} placeholder="or a note" className="h-8 w-24 rounded-lg border bg-background px-1.5 text-xs" />
      <button type="submit" disabled={pending} className="h-8 rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
        Save
      </button>
    </form>
  );
}

function NotesPanel({ item, canEdit, viewerId }: { item: BoardItem; canEdit: boolean; viewerId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      {item.notes.map((note) => (
        <div key={note.id} className="flex items-start justify-between gap-2 rounded-xl bg-muted/50 p-2 text-sm">
          <p className="flex-1">
            {note.private && <Lock className="mr-1 inline size-3 text-muted-foreground" aria-label="Private" />}
            {note.body}
          </p>
          {note.author_id === viewerId && (
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  await deleteNote(note.id);
                })
              }
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Delete
            </button>
          )}
        </div>
      ))}
      {item.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      {canEdit && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const body = String(form.get("body") ?? "");
            const priv = form.get("private") === "on";
            if (!body.trim()) return;
            startTransition(async () => {
              await addNote(item.id, body, priv);
            });
            e.currentTarget.reset();
          }}
        >
          <textarea name="body" rows={2} placeholder="Add a note…" className="flex-1 rounded-xl border bg-background p-2 text-sm" />
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="private" className="size-3.5 accent-primary" />
            Private
          </label>
          <button type="submit" disabled={pending} className="h-9 shrink-0 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
            Add
          </button>
        </form>
      )}
    </div>
  );
}
