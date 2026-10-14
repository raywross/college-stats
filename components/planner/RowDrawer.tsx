"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, X } from "lucide-react";
import { Chip, FieldLabel } from "@/components/activities/chips";
import { AboutYouAndCollege } from "@/components/planner/AboutYouAndCollege";
import { EdSheet } from "@/components/planner/EdSheet";
import { MetricLabel } from "@/components/ui/info-tip";
import { ED_PILL_TEXT, type EdCandidate } from "@/lib/planner/ed-opportunities";
import { earlyFor } from "@/lib/planner/rounds";
import type { AnyCited } from "@/lib/lineage";
import { VisitForm } from "@/components/planner/VisitForm";
import { SOCIAL_GLYPHS } from "@/components/school/SocialIcons";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { setVisited } from "@/lib/lists";
import { followTargets, visitedState, visitPageLink } from "@/lib/planner/capture";
import { dayLabel } from "@/lib/planner/list-row";
import { deleteVisit, logVisit, markInfoRequested, recordFollow, updateVisit } from "@/lib/planner/store-actions";
import type { PlanRowView } from "@/lib/planner/plan-view";
import type { PlanContext, PlanVisit } from "@/lib/planner/types";
import type { SocialNetwork } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The row's capture panel (specs/planner/redesign/list.md "The capture panel"; owner, 2026-10-12: "The info icon on
 * the college is information overload… What we're really looking for here is to capture some more information"):
 * opened by the row's (i), inline under the row, and nothing but short one-tap inputs for this college:
 * - **Legacy** and **Recruited** (AboutYouAndCollege),
 * - **Visited**: "We visited" logs a visit dated today (a `plan_visits` row, which sets `list_items.visited_on`), with
 *   the date editable and the visit's notes one tap away (VisitForm in a sheet),
 * - **Requested info**: one tap records `list_items.info_requested_on` as today, the date editable, tapping again clears it,
 * - **Following on social**: one toggle per account the college has, each beside a link that opens the account,
 * - **Quick links**: the college's visit page (else virtual tour, else admissions page),
 * - and, for an editor, Remove from the list.
 * Visits and follows count as demonstrated interest for the estimate (lib/planner/hooks.ts), so a saved change refreshes
 * the page and the college's level reads it. How the level is worked out is explained once for the whole list
 * ("How Quad reads your list", components/planner/ListExplainer.tsx), not per college.
 *
 * Next steps (ed-opportunities.md "The sheet"): opened with `panel="ed"` (the row's ED pill, or a move's `open_row`
 * link) on a Good ED opportunity, the ED sheet (EdSheet) sits on top; opened from Details, a one-line link leads to it.
 * An ED college that hasn't published its ED counts says so here, and nothing shows on the row.
 */

/** Which panel the drawer opens on: the ED sheet on top, or the capture panel's own (U3 adds its move's why). */
export type RowPanel = "ed" | "capture";
export function RowDrawer({
  row,
  ctx,
  name,
  onRemove,
  panel = null,
  edCandidate = null,
  onPanel,
}: {
  row: PlanRowView;
  ctx: PlanContext;
  /** The college's name, for the remove confirmation. */
  name: string;
  /** Takes the college off the list (after a confirmation). */
  onRemove: () => void;
  /** The panel the drawer was opened on (null: Details). */
  panel?: RowPanel | null;
  /** The row's Good ED opportunity, when it has one. */
  edCandidate?: EdCandidate | null;
  /** Switches the panel (the link to the ED sheet). */
  onPanel?: (panel: RowPanel | null) => void;
}) {
  const { item, school } = row;
  const canEdit = ctx.viewer.canEdit;
  const visitLink = visitPageLink(school?.links ?? null);
  const early = school ? earlyFor(school) : null;
  const noEdCounts = early?.offered === true && (school?.profile?.early_decision?.applicants == null || school?.profile?.early_decision?.admitted == null);

  return (
    <div data-capture-panel className="space-y-5 bg-muted/40 px-4 py-4 text-sm sm:pr-6 sm:pl-16">
      {school && edCandidate && panel === "ed" && <EdSheet row={row} ctx={ctx} candidate={edCandidate} onClose={() => onPanel?.(null)} />}
      {school && edCandidate && panel !== "ed" && (
        <button type="button" onClick={() => onPanel?.("ed")} className="min-h-11 text-left font-semibold text-primary hover:underline">
          {ED_PILL_TEXT[edCandidate.round].full}: the facts
        </button>
      )}
      {school && !edCandidate && noEdCounts && (
        <p className="text-xs text-muted-foreground">
          <MetricLabel term="early-decision" cited={school.cites[early!.field] as AnyCited | undefined}>
            <span>ED offered; {school.name} hasn&apos;t published its ED counts</span>
          </MetricLabel>
        </p>
      )}
      {school && (
        <>
          <AboutYouAndCollege item={item} school={school} canEdit={canEdit} />
          <VisitedControl itemId={item.id} visitedOn={item.visited_on} visits={ctx.visits.filter((v) => v.item_id === item.id)} today={ctx.today} canEdit={canEdit} schoolName={school.name} />
          <InfoRequestedControl itemId={item.id} requestedOn={item.info_requested_on ?? null} today={ctx.today} canEdit={canEdit} schoolName={school.name} />
          <FollowControl
            itemId={item.id}
            social={school.social as Partial<Record<SocialNetwork, string>> | null | undefined}
            followed={(item.followed_networks ?? []) as SocialNetwork[]}
            // A follow is the student's own account (specs/planner/actions.md "Rules"); a guardian sees the links.
            canMark={canEdit && !ctx.viewer.isGuardian}
            isGuardian={ctx.viewer.isGuardian}
            studentFirst={ctx.student?.display_name?.trim().split(/\s+/)[0] ?? null}
          />
          {visitLink && (
            <div className="space-y-2">
              <FieldLabel>Quick links</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <ExternalChip href={visitLink.href}>{visitLink.label}</ExternalChip>
              </div>
            </div>
          )}
        </>
      )}

      {ctx.viewer.canEdit && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Remove ${name} from the list? Its notes, visits, and any offer go with it.`)) onRemove();
          }}
          className="inline-flex min-h-11 items-center gap-1 font-semibold text-destructive hover:underline"
        >
          <X className="size-3.5" aria-hidden /> Remove from the list
        </button>
      )}
    </div>
  );
}

function ExternalChip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-3.5 text-sm font-semibold hover:bg-muted">
      {children}
      <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
    </a>
  );
}

/** Visited: one tap logs today's visit; the date can change, and the visit's notes are one tap away. */
function VisitedControl({
  itemId,
  visitedOn,
  visits,
  today,
  canEdit,
  schoolName,
}: {
  itemId: string;
  visitedOn: string | null;
  visits: PlanVisit[];
  today: string;
  canEdit: boolean;
  schoolName: string;
}) {
  const router = useRouter();
  const fromProps = visitedState(visitedOn, visits, today);
  // An optimistic override until the refreshed plan arrives (a new `visits`/`visitedOn` from the server resets it).
  const [override, setOverride] = useState<{ visited: boolean; date: string | null } | null>(null);
  const [seen, setSeen] = useState({ visitedOn, visits });
  if (seen.visitedOn !== visitedOn || seen.visits.length !== visits.length || seen.visits.some((v, i) => v !== visits[i])) {
    setSeen({ visitedOn, visits });
    setOverride(null);
  }
  const visited = override?.visited ?? fromProps.visited;
  const date = override ? override.date : fromProps.date;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const run = (next: { visited: boolean; date: string | null }, write: () => Promise<{ ok: boolean; message?: string }>) => {
    const before = override;
    setOverride(next);
    setError(null);
    startTransition(async () => {
      const result = await write();
      if (!result.ok) {
        setOverride(before);
        setError(result.message ?? "That didn't work. Try again in a moment.");
        return;
      }
      router.refresh();
    });
  };

  const tap = () => {
    if (!canEdit) return;
    if (!visited) {
      run({ visited: true, date: today }, () => logVisit(itemId, { kind: "campus_tour", onDate: today }));
      return;
    }
    const v = fromProps.visit;
    const hasNotes = v && Object.values(v.notes ?? {}).some((x) => typeof x === "string" && x.trim());
    if (hasNotes && !window.confirm("Remove this visit? Its notes go with it.")) return;
    run({ visited: false, date: null }, async () => {
      if (v) {
        const r = await deleteVisit(v.id);
        if (!r.ok) return r;
      }
      // A date set from the old tracking row has no visit behind it; clear it too.
      return setVisited(itemId, null);
    });
  };

  const changeDate = (next: string) => {
    if (!canEdit || !next || next > today) return;
    const v = fromProps.visit;
    run({ visited: true, date: next }, () => (v ? updateVisit(v.id, { onDate: next }) : setVisited(itemId, next)));
  };

  const many = fromProps.pastCount > 1;

  return (
    <div className="space-y-2">
      <FieldLabel>Visited</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <Chip role="checkbox" selected={visited} disabled={!canEdit || pending || (visited && many)} onClick={tap} className="min-h-11">
          {visited ? "✓ We visited" : "We visited"}
        </Chip>
        {visited && (
          <label className="inline-flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">On</span>
            <input
              type="date"
              value={date ?? ""}
              max={today}
              disabled={!canEdit || pending}
              onChange={(e) => changeDate(e.target.value)}
              aria-label={`When you visited ${schoolName}`}
              className="h-11 rounded-full border bg-background px-3 text-base sm:text-sm"
            />
          </label>
        )}
        {visited && fromProps.visit && (
          <button type="button" onClick={() => setNotesOpen(true)} className="min-h-11 px-1 text-sm font-semibold text-primary hover:underline">
            {canEdit ? "Visit notes" : "See visit notes"}
          </button>
        )}
      </div>
      {visited && many && <p className="text-xs text-muted-foreground">{fromProps.pastCount} visits logged; the first is shown.</p>}
      {fromProps.upcoming && <p className="text-xs text-muted-foreground">Visit planned for {dayLabel(fromProps.upcoming.on_date)}.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {fromProps.visit && (
        <SheetDialog open={notesOpen} onOpenChange={setNotesOpen} title={`Your visit · ${schoolName}`}>
          {canEdit ? (
            <VisitForm
              itemId={itemId}
              visit={fromProps.visit}
              householdNames={[]}
              onDone={() => {
                setNotesOpen(false);
                router.refresh();
              }}
              onCancel={() => setNotesOpen(false)}
            />
          ) : (
            <VisitNotesView visit={fromProps.visit} />
          )}
        </SheetDialog>
      )}
    </div>
  );
}

function VisitNotesView({ visit }: { visit: PlanVisit }) {
  const n = visit.notes ?? {};
  const lines = [n.stood_out && `Stood out: ${n.stood_out}`, n.worried && `Worried: ${n.worried}`, n.people && `People: ${n.people}`, n.live_here && `Would want to live here: ${n.live_here}`, n.free].filter(
    (x): x is string => !!x,
  );
  return lines.length ? (
    <ul className="space-y-1 text-sm">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">No notes yet.</p>
  );
}

/** Following on social: one toggle per account the college has, beside the link that opens it to follow. */
const followChip = "inline-flex min-h-11 flex-1 items-center gap-2 rounded-full border px-2 pr-3.5 text-sm font-semibold";
const followOn = "border-foreground bg-foreground text-background";
const followOff = "bg-card text-muted-foreground hover:bg-muted";

/** Requested info: one tap records today (editable), tapping again clears it. Counts as interest (lib/planner/hooks.ts). */
function InfoRequestedControl({ itemId, requestedOn, today, canEdit, schoolName }: { itemId: string; requestedOn: string | null; today: string; canEdit: boolean; schoolName: string }) {
  const router = useRouter();
  const [value, setValue] = useState(requestedOn);
  const [seen, setSeen] = useState(requestedOn);
  if (seen !== requestedOn) {
    setSeen(requestedOn);
    setValue(requestedOn);
  }
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = (next: string | null) => {
    if (!canEdit) return;
    const before = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await markInfoRequested(itemId, next !== null, next);
      if (!result.ok) {
        setValue(before);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <FieldLabel>Requested info</FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <Chip role="checkbox" selected={value !== null} disabled={!canEdit || pending} onClick={() => save(value === null ? today : null)} className="min-h-11">
          {value !== null ? "✓ We requested info" : "We requested info"}
        </Chip>
        {value !== null && (
          <label className="inline-flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">On</span>
            <input
              type="date"
              value={value}
              max={today}
              disabled={!canEdit || pending}
              onChange={(e) => e.target.value && e.target.value <= today && save(e.target.value)}
              aria-label={`When you requested information from ${schoolName}`}
              className="h-11 rounded-full border bg-background px-3 text-base sm:text-sm"
            />
          </label>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function FollowControl({
  itemId,
  social,
  followed,
  canMark,
  isGuardian,
  studentFirst,
}: {
  itemId: string;
  social: Partial<Record<SocialNetwork, string>> | null | undefined;
  followed: SocialNetwork[];
  canMark: boolean;
  isGuardian: boolean;
  studentFirst: string | null;
}) {
  const router = useRouter();
  const [on, setOn] = useState<ReadonlySet<SocialNetwork>>(() => new Set(followed));
  const [seen, setSeen] = useState(followed);
  if (seen !== followed && (seen.length !== followed.length || seen.some((n, i) => n !== followed[i]))) {
    setSeen(followed);
    setOn(new Set(followed));
  }
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const targets = followTargets(social, [...on]);
  if (targets.length === 0) return null;

  const toggle = (network: SocialNetwork) => {
    if (!canMark) return;
    const next = !on.has(network);
    const flip = (value: boolean) =>
      setOn((prev) => {
        const s = new Set(prev);
        if (value) s.add(network);
        else s.delete(network);
        return s;
      });
    flip(next);
    setError(null);
    startTransition(async () => {
      const result = await recordFollow(itemId, network, next);
      if (!result.ok) {
        flip(!next);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <FieldLabel>Following on social</FieldLabel>
      <ul className="grid gap-2 sm:grid-cols-2">
        {targets.map((t) => {
          const Glyph = SOCIAL_GLYPHS[t.network];
          const chipBody = (
            <>
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-background">
                <Glyph />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{t.label}</span>
              {t.followed ? (
                <span className="inline-flex items-center gap-1 text-xs">
                  <Check className="size-3.5" aria-hidden /> Following
                </span>
              ) : (
                <span className="text-xs font-normal">{canMark ? "Not yet" : "Not following"}</span>
              )}
            </>
          );
          return (
            <li key={t.network} className="flex items-center gap-2">
              {canMark ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.followed}
                  disabled={pending}
                  onClick={() => toggle(t.network)}
                  className={cn(followChip, t.followed ? followOn : followOff, "disabled:opacity-60")}
                >
                  {chipBody}
                </button>
              ) : (
                // Read-only (a guardian, or no edit access): the state is still plain to see, filled vs. outline,
                // not a greyed-out control (owner, 2026-10-12: "see that it is followed but not act").
                <span className={cn(followChip, t.followed ? followOn : "border-dashed bg-transparent text-muted-foreground")} aria-label={`${t.label}: ${t.followed ? "following" : "not following"}`}>
                  {chipBody}
                </span>
              )}
              <a
                href={t.href}
                target="_blank"
                rel="noopener"
                aria-label={`Open ${t.label} to follow`}
                title={`Open ${t.label} to follow`}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground hover:bg-muted"
              >
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </li>
          );
        })}
      </ul>
      {isGuardian && <p className="text-xs text-muted-foreground">{studentFirst ?? "Your student"} marks follows from their own account; the links open each account.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
