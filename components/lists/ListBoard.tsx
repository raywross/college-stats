"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Lock, Trash2 } from "lucide-react";
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
  showCategoryHeaders,
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
  moveItem,
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
import { TrackingRow } from "@/components/lists/TrackingRow";
import { distanceLine } from "@/lib/home";
import { cn } from "@/lib/utils";
import { sortItems as sortPlanItems, type Suggestion } from "@/lib/planner/suggest";
import type { ListSort } from "@/lib/planner/types";

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
  /** Straight-line miles from the viewer's own home (specs/product/home-and-distance.md); null without one or without campus coordinates. */
  distance: number | null;
  distanceCited: Cited | null;
  deadline: { date: string | null; text: string | null; source: "reported" | "student" | null };
  /**
   * The plan's next dated step for this college (specs/planner/model.md "Where it lives": "Apply by Jan 5 · ED II"),
   * shown at the end of the facts line; its citation when the date came from the college's data. Absent off the hub.
   */
  next?: { title: string; date: string; cited: Cited | null; overdue: boolean } | null;
}

export interface BoardItem extends ListItem {
  school: BoardSchoolInfo;
  notes: ListNote[];
  addedByName: string | null;
  addedBySelf: boolean;
  /**
   * U2 additions for the sort menu (specs/planner/list-building.md "Sorting"): the row's next step's raw date
   * (yyyy-mm-dd, for ordering — `school.next.date` is already a display label) and its suggested category
   * ("Where I stand"). Absent off the hub, or without the student's numbers.
   */
  nextDateRaw?: string | null;
  standing?: Suggestion | null;
}

/**
 * The interactive body of a list page (components/lists/ListPage.tsx; specs/product/saved-lists.md "Display",
 * household-hub.md "Redesign (2026-10-06)"). Decluttered after the owner's first preview: each row is
 *
 *   [crest] College name (link)                               [trash] [More v]
 *           City, ST · 12% admit · $28k/yr · 240 mi
 *
 * and everything else sits behind that row's "More" (closed by default): category, round, status, outcome,
 * enrolling, deadline, compare, move up/down, the tracking row (components/lists/TrackingRow.tsx), who added it, and
 * notes. Which rows are open is component state only, held here so a row that changes category stays open. Rows are
 * grouped under category headers with the balance line above; a list of only unsorted colleges has no header
 * (showCategoryHeaders()). Read-only when `canEdit` is false (a guardian without edit access, or someone else's own
 * list): no trash, and More shows the details with its controls disabled. One column at every width, so a phone
 * row is the same row.
 */
/** `BoardItem` → `lib/planner/suggest.ts`'s generic sort shape. */
function sortable(i: BoardItem) {
  return {
    id: i.id,
    category: i.category,
    position: i.position,
    dream: i.dream,
    priority: i.priority,
    admitRate: i.school.admitRate,
    avgCost: i.school.avgCost,
    distanceMiles: i.school.distance,
    nextDate: i.nextDateRaw ?? null,
    standing: i.standing ?? null,
  };
}

export function ListBoard({
  items,
  canEdit,
  viewerId,
  rowExtras,
  sort = "category",
}: {
  items: BoardItem[];
  canEdit: boolean;
  viewerId: string;
  /** Server-rendered planner controls per item id (components/planner/RowControls.tsx), shown in that row's More. */
  rowExtras?: Record<string, ReactNode>;
  /**
   * The list's remembered sort (specs/planner/list-building.md "Sorting"; `lists.sort`, `SortMenu`). "Category"
   * (today's default) and "My order" keep the category headers; every other sort is one flat list in that order,
   * since the headers would otherwise lie about what's being shown.
   */
  sort?: ListSort;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = sortPlanItems(items.map(sortable), sort).map((s) => byId.get(s.id)!);
  const grouped = sort === "category" || sort === "mine";
  const groups = grouped ? LIST_CATEGORIES.map((category) => ({ category, items: ordered.filter((i) => i.category === category) })) : [{ category: null as ListCategory | null, items: ordered }];
  const headers = grouped && showCategoryHeaders(items);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Drag-and-drop (pointer): the dragged row's id, so dropping on another row moves it there (lib/lists.ts moveItem).
  // Keyboard users keep the existing Move up/down buttons — dragging never replaces them.
  const draggingId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [, startMoveTransition] = useTransition();
  const onDrop = (targetId: string) => {
    const id = draggingId.current;
    draggingId.current = null;
    setDragOverId(null);
    if (!id || id === targetId || !canEdit) return;
    startMoveTransition(async () => {
      await moveItem(id, targetId);
    });
  };

  return (
    <div className="space-y-5">
      {items.length > 0 && <p className="text-sm font-semibold text-muted-foreground">{balanceLine(items)}</p>}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.category ?? "sorted"} aria-label={headers ? undefined : "Colleges"}>
              {headers && (
                <h2 className="mb-2 flex items-center gap-1.5 font-display text-lg font-bold">
                  {CATEGORY_TERM[g.category!] ? <Term term={CATEGORY_TERM[g.category!]!}>{CATEGORY_LABELS[g.category!]}</Term> : CATEGORY_LABELS[g.category!]}
                  <span className="text-sm font-medium text-muted-foreground">({g.items.length})</span>
                </h2>
              )}
              <ul className="divide-y rounded-2xl border bg-card">
                {g.items.map((item, i) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    canEdit={canEdit}
                    viewerId={viewerId}
                    isFirst={i === 0}
                    isLast={i === g.items.length - 1}
                    open={open.has(item.id)}
                    onToggle={() => toggle(item.id)}
                    extras={rowExtras?.[item.id]}
                    draggable={canEdit && g.items.length > 1}
                    draggedOver={dragOverId === item.id}
                    onDragStart={() => {
                      draggingId.current = item.id;
                    }}
                    onDragOverRow={() => setDragOverId(item.id)}
                    onDragEnd={() => {
                      draggingId.current = null;
                      setDragOverId(null);
                    }}
                    onDrop={() => onDrop(item.id)}
                  />
                ))}
              </ul>
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

/** The one facts line under a college's name: city, admit rate, average cost, distance from home (each cited). */
function FactsLine({ s }: { s: BoardSchoolInfo }) {
  const facts: ReactNode[] = [];
  if (s.city && s.state) facts.push(`${s.city}, ${s.state}`);
  if (s.admitRate !== null)
    facts.push(
      <MetricLabel cited={s.admitRateCited ?? undefined}>
        <span>{pctSmart(s.admitRate)} admit</span>
      </MetricLabel>,
    );
  if (s.avgCost !== null)
    facts.push(
      <MetricLabel cited={s.avgCostCited ?? undefined}>
        <span>{moneyCompact(s.avgCost)}/yr</span>
      </MetricLabel>,
    );
  if (s.distance !== null)
    facts.push(
      <MetricLabel term="distance-from-home" cited={s.distanceCited ?? undefined}>
        <span>{distanceLine(s.distance)}</span>
      </MetricLabel>,
    );
  if (s.next)
    facts.push(
      <MetricLabel cited={s.next.cited ?? undefined} className={cn("font-semibold", s.next.overdue ? "text-destructive" : "text-foreground")}>
        <span>
          Next: {s.next.title}, {s.next.date}
        </span>
      </MetricLabel>,
    );
  if (facts.length === 0) return null;
  return (
    <p className="mt-0.5 text-xs text-muted-foreground">
      {facts.map((f, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {f}
        </span>
      ))}
    </p>
  );
}

const selectCls = "h-9 rounded-full border bg-background px-2.5 text-xs disabled:opacity-60";

function ItemRow({
  item,
  canEdit,
  viewerId,
  isFirst,
  isLast,
  open,
  onToggle,
  extras,
  draggable = false,
  draggedOver = false,
  onDragStart,
  onDragOverRow,
  onDragEnd,
  onDrop,
}: {
  item: BoardItem;
  canEdit: boolean;
  viewerId: string;
  isFirst: boolean;
  isLast: boolean;
  open: boolean;
  onToggle: () => void;
  extras?: ReactNode;
  /** Pointer drag-and-drop ordering (list-building.md "Files (planned)": "keyboard: move up/down stays"), desktop and touch; the Move up/down buttons below stay for keyboard users. */
  draggable?: boolean;
  draggedOver?: boolean;
  onDragStart?: () => void;
  onDragOverRow?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const s = item.school;
  const detailsId = `item-more-${item.id}`;

  const run = (fn: () => Promise<unknown>) => {
    if (!canEdit) return;
    startTransition(async () => {
      await fn();
    });
  };

  return (
    <li
      className={cn("p-3 sm:px-4", pending && "opacity-70", draggedOver && "bg-primary/5")}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDragOverRow?.();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start gap-3">
        {draggable && (
          <span className="mt-1 hidden shrink-0 cursor-grab touch-none text-muted-foreground/60 sm:block" aria-hidden title="Drag to reorder">
            <GripVertical className="size-4" />
          </span>
        )}
        <Crest id={s.unit_id} name={s.name} size="sm" brand={s.brand} />
        <div className="min-w-0 flex-1">
          <Link href={`/schools/${s.unit_id}`} className="font-display font-bold break-words hover:text-primary">
            {s.name}
          </Link>
          <FactsLine s={s} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Remove ${s.name} from this list? Its notes and tracking go with it.`)) run(() => removeFromList(item.id));
              }}
              className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${s.name} from the list`}
              title="Remove from list"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`More about ${s.name} on this list`}
            className="inline-flex h-9 items-center gap-0.5 rounded-full pr-1.5 pl-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            More
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <div id={detailsId} className="mt-3 space-y-3 border-t pt-3 sm:ml-12">
          <div className="flex flex-wrap items-center gap-2">
            <select value={item.category} disabled={!canEdit} onChange={(e) => run(() => setCategory(item.id, e.target.value as ListCategory))} className={cn(selectCls, "font-semibold")} aria-label="Category">
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
              className={selectCls}
              aria-label="Application round"
            >
              <option value="">Round</option>
              {LIST_ROUNDS.map((rnd) => (
                <option key={rnd} value={rnd}>
                  {ROUND_LABELS[rnd]}
                </option>
              ))}
            </select>

            <select value={item.status} disabled={!canEdit} onChange={(e) => run(() => setItemStatus(item.id, e.target.value as ListStatus))} className={selectCls} aria-label="Status">
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
                className={selectCls}
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

            {canEdit && (
              <span className="inline-flex items-center gap-1">
                <button type="button" disabled={isFirst} onClick={() => run(() => reorderItem(item.id, "up"))} className="inline-flex size-9 items-center justify-center rounded-full border disabled:opacity-30" aria-label="Move up">
                  <ArrowUp className="size-3.5" />
                </button>
                <button type="button" disabled={isLast} onClick={() => run(() => reorderItem(item.id, "down"))} className="inline-flex size-9 items-center justify-center rounded-full border disabled:opacity-30" aria-label="Move down">
                  <ArrowDown className="size-3.5" />
                </button>
              </span>
            )}
          </div>

          <TrackingRow item={item} canEdit={canEdit} className="mt-0" />

          {extras}

          <p className="text-xs text-muted-foreground">{addedByLabel(item.addedByName, item.addedBySelf)}</p>

          <NotesPanel item={item} canEdit={canEdit} viewerId={viewerId} />
        </div>
      )}
    </li>
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
    <div className="space-y-2">
      <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Notes</h3>
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
          <textarea name="body" rows={2} placeholder="Add a note…" className="min-w-0 flex-1 rounded-xl border bg-background p-2 text-sm" />
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
