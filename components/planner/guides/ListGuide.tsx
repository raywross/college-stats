"use client";

/**
 * Build your list (specs/planner/v3/guides/list-size.md): what a good list looks like this season, where this list
 * stands against it, and colleges **like the ones already on it** at the level that's missing. Three parts, in order:
 *
 * 1. **The shape**: the slot row (ShapeRow) with the season's sentence and "Why this shape" (ShapeExplainer), a
 *    "Show me more" link per level into Explore at that level (specs/planner/record/explore-levels.md), and under the
 *    table "Not seeing it?" with the add-college search. (The "Your list has the shape" card is gone.)
 * 2. **The gaps**: one section per gap in `shapeGaps` order, the open one first (or the one the move's `?level=`
 *    names), the rest folded `<details>` that fetch their cards when opened; unsorted colleges get their own section
 *    at the end. The over-maximum gap names its High reaches and asks which to drop; nothing is removed.
 * 3. **Colleges like yours** in each level section: AlikeCards, twelve at a time ("Show more" asks POST
 *    /api/plan/list-guide), then "Not seeing it?": the inline add-college search.
 *
 * Freshmen, sophomores, and an empty list get one section instead: "Places that might interest you", preference chips
 * pre-set from the profile and the colleges that fit them, nearest first. Nothing about levels.
 *
 * Adding refreshes the server page, so the shape row, the gaps, and the open section all follow; when an add closes
 * the gap of the move that led here, the move is ticked (`tick`). Everything comes from the server's `load`
 * (lib/planner/list-guide-server.ts listGuideFor) as `data`; no estimate number reaches this component.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddCollegeBox } from "@/components/planner/AddCollegeBox";
import { track } from "@/lib/analytics";
import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import {
  hasExplorePreferences,
  NO_PREFERENCES_LINE,
  nothingAlikeLine,
  openSectionsFor,
  SETTING_CHIPS,
  showMoreLinks,
  SIZE_CHIPS,
  TYPE_CHIPS,
  unsortedSectionLine,
  type AlikeCard as AlikeCardData,
  type GuidePageResult,
  type GuideSection,
  type ListGuideData,
  type PreferenceChips,
} from "@/lib/planner/list-guide";
import type { ShapeGapKind } from "@/lib/planner/list-shape";
import { planHref } from "@/lib/planner/plan-tabs";
import { RECORD_STEPS, recordHref } from "@/lib/planner/record";
import { tick } from "@/lib/planner/store";
import { isOpen } from "@/lib/planner/tasks";
import type { PlanContext, PlanTask } from "@/lib/planner/types";
import { cn } from "@/lib/utils";
import { AlikeCard } from "./AlikeCard";
import { ShapeExplainer } from "./ShapeExplainer";
import { ShapeKey, ShapeRow } from "./ShapeRow";
import type { GuideProps } from "./types";

const PILL = "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold";

async function fetchPage(body: Record<string, unknown>): Promise<GuidePageResult | null> {
  try {
    const r = await fetch("/api/plan/list-guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    return (await r.json()) as GuidePageResult;
  } catch {
    return null;
  }
}

/** The gap a `shape_gap` move is about: its key ends `:shape_gap:{kind}` (lib/planner/list-shape.ts shapeTasks). */
function moveGap(move: PlanTask | null): string | null {
  if (!move || move.kind !== "shape_gap" || !move.key) return null;
  const m = /:shape_gap:([a-z_]+)$/.exec(move.key);
  return m ? m[1] : null;
}

export function ListGuide({ ctx, move, data, person }: GuideProps) {
  const d = data as ListGuideData;
  const router = useRouter();
  const [seen, setSeen] = useState(d);
  const [sections, setSections] = useState<GuideSection[]>(d.sections);
  const [opened, setOpened] = useState<ReadonlySet<ShapeGapKind>>(openSectionsFor(d.openGap));
  // Added optimistically so the just-added card disappears at once, while `router.refresh()` is still in flight;
  // cleared below once fresh data (which no longer lists it) actually arrives.
  const [pendingAdded, setPendingAdded] = useState<ReadonlySet<string>>(new Set());
  const added = useRef(false);

  // A refresh (after an add) brings new data: the counts, the gaps, and the open section follow it, so the open
  // section advances to the next gap once this one is filled.
  if (d !== seen) {
    setSeen(d);
    setSections(d.sections);
    setOpened(openSectionsFor(d.openGap));
    setPendingAdded(new Set());
  }

  // `plan_shape_gap_shown` (list-shape.md telemetry, built): once per open gap per visit.
  const shown = useRef(new Set<string>());
  useEffect(() => {
    if (!d.openGap || shown.current.has(d.openGap)) return;
    shown.current.add(d.openGap);
    track("plan_shape_gap_shown", { gap: d.openGap, season: ctx.season });
  }, [d.openGap, ctx.season]);

  // The move that led here closes when an add fills its gap (list-size.md "Card": "ticks the gap move when the gap
  // closes"). Only after an add on this page, never on arrival.
  useEffect(() => {
    if (!added.current) return;
    const gap = moveGap(move);
    if (!move || !gap || !ctx.viewer.canEdit || !isOpen(move, ctx.today)) return;
    const closed = gap === "unsorted" ? d.unsorted === 0 : !d.gaps.some((g) => g.kind === gap);
    if (!closed) return;
    added.current = false;
    void tick(move.id).then((r) => {
      if (r.ok) router.refresh();
    });
  }, [d, move, ctx.viewer.canEdit, ctx.today, router]);

  function onAdded(card: AlikeCardData | null) {
    added.current = true;
    if (card) setPendingAdded((prev) => new Set(prev).add(card.unitId));
    if (card?.level) track("plan_guide_added", { level: card.level, likeness: card.likeness });
    router.refresh();
  }

  const studentId = ctx.student?.id ?? null;

  const inFlight = useRef(new Set<string>());
  async function loadSection(s: GuideSection, offset: number) {
    if (!studentId || !s.level) return;
    const key = `${s.gap}:${offset}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const page = await fetchPage({ studentId, gap: s.gap, level: s.level, offset });
    inFlight.current.delete(key);
    if (!page) {
      // A failed first page reads as "nothing found" (the links below still work), never an endless skeleton.
      if (offset === 0) setSections((all) => all.map((x) => (x.gap === s.gap && x.cards.length === 0 ? { ...x, total: 0 } : x)));
      return;
    }
    setSections((all) => all.map((x) => (x.gap === s.gap ? { ...x, cards: offset === 0 ? page.cards : [...x.cards, ...page.cards], total: page.total, fallback: page.fallback } : x)));
  }

  function toggle(s: GuideSection, open: boolean) {
    setOpened((prev) => {
      if (prev.has(s.gap) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(s.gap);
      else next.delete(s.gap);
      return next;
    });
    // A folded level section asks the route for its first page when opened.
    if (open && s.level && s.cards.length === 0 && s.total !== 0) void loadSection(s, 0);
  }

  if (d.freshman) {
    return <FreshmanGuide ctx={ctx} data={d} studentId={studentId} onAdded={onAdded} />;
  }

  const whose = "your record";
  const hasOverflow = d.row?.levels.some((l) => l.slots.includes("overflow")) ?? false;
  const hasDream = d.row?.levels.some((l) => l.slots.includes("dream")) ?? false;
  const preferences = ctx.profile?.preferences ?? null;
  const links = d.row ? showMoreLinks(d.row, preferences) : null;
  const whereStep = RECORD_STEPS.find((s) => s.section === "where")?.step ?? null;
  const onShowMore = (level: StandingLevel, emphasized: boolean) => track("plan_show_more", { level, emphasized });

  return (
    <div className="space-y-6">
      {d.row && (
        <section aria-labelledby="shape-heading" className="space-y-3 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4">
            <h2 id="shape-heading" className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              What a good list looks like
            </h2>
            <ShapeExplainer season={ctx.season} sentence={d.sentence} />
          </div>
          {!move && d.countLine && <p className="font-semibold">{d.countLine}</p>}
          <ShapeRow row={d.row} links={links} onShowMore={onShowMore} />
          <ShapeKey hasDream={hasDream} hasOverflow={hasOverflow} />
          {!hasExplorePreferences(preferences) && (
            <p className="text-xs text-muted-foreground">
              {ctx.viewer.canEdit ? (
                <Link href={recordHref({ person, step: whereStep })} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                  {NO_PREFERENCES_LINE}
                </Link>
              ) : (
                NO_PREFERENCES_LINE
              )}
            </p>
          )}
          <NotSeeing ctx={ctx} onAdded={() => onAdded(null)} />
        </section>
      )}

      {sections.map((s0) => {
        // Strip out any card just added on this page, before the refresh that will drop it from `s0.cards` server
        // side actually lands (the "remove the added card optimistically" fix for the stale-guide finding).
        const s = pendingAdded.size === 0 ? s0 : { ...s0, cards: s0.cards.filter((c) => !pendingAdded.has(c.unitId)) };
        const gap = d.gaps.find((g) => g.kind === s.gap);
        const isOpenNow = opened.has(s.gap);
        return (
          <details
            key={s.gap}
            open={isOpenNow}
            onToggle={(e) => toggle(s, e.currentTarget.open)}
            className="group rounded-3xl bg-card ring-1 ring-border"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 sm:px-6 [&::-webkit-details-marker]:hidden">
              <h2 className="text-xs font-bold tracking-wide uppercase">{s.title}</h2>
              <span className="shrink-0 text-xs text-muted-foreground">
                {s.level && s.total > 0 && !s.fallback ? `${s.total} like your list` : ""}
                <span aria-hidden className="ml-2 inline-block transition-transform group-open:rotate-180">
                  ▾
                </span>
              </span>
            </summary>
            <div className="space-y-4 px-4 pb-4 sm:px-6 sm:pb-6">
              {s.level ? (
                <LevelSection
                  section={s}
                  whose={whose}
                  hasHome={ctx.home !== null}
                  ctx={ctx}
                  loading={isOpenNow && s.cards.length === 0 && s.total !== 0}
                  onMore={() => void loadSection(s, s.cards.length)}
                  onAdded={onAdded}
                />
              ) : s.gap === "over_max" ? (
                <div className="space-y-2">
                  <p className="text-sm">{d.overMaxLine}</p>
                  <ul className="flex flex-wrap gap-2">
                    {d.overMax.map((c) => (
                      <li key={c.unitId}>
                        <a href={`/college/${c.unitId}`} target="_blank" rel="noopener noreferrer" className={cn(PILL, "ring-1 ring-border hover:bg-muted")}>
                          {c.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">Quad never removes a college; the list is yours.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">{gap?.line}</p>
                  <NotSeeing ctx={ctx} onAdded={() => onAdded(null)} />
                </div>
              )}
            </div>
          </details>
        );
      })}

      {d.unsorted > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-card p-4 ring-1 ring-border sm:px-6">
          <p className="text-sm font-semibold">{unsortedSectionLine(d.unsorted)}</p>
          <Link href={planHref({ person, setup: true, step: 0 })} className={cn(PILL, "bg-foreground text-background")}>
            Add your numbers
          </Link>
        </section>
      )}
    </div>
  );
}

function LevelSection({
  section,
  whose,
  hasHome,
  ctx,
  loading,
  onMore,
  onAdded,
}: {
  section: GuideSection;
  whose: string;
  hasHome: boolean;
  ctx: PlanContext;
  loading: boolean;
  onMore: () => void;
  onAdded: (card: AlikeCardData | null) => void;
}) {
  const level = section.level!;
  const label = STANDING_LEVEL_LABELS[level];
  const [more, setMore] = useState(false);
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {section.fallback ? nothingAlikeLine(label, hasHome) : section.cards.length > 0 ? `Like the colleges you have, where ${whose} is ${label}.` : null}
      </p>
      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted/50" aria-hidden />
      ) : section.cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Quad didn&apos;t find a {label} for {whose === "your record" ? "you" : whose.replace(/'s record$/, "")} yet. Try Show me more above, or the search below.</p>
      ) : (
        <CardRail cards={section.cards} ctx={ctx} onAdded={onAdded} />
      )}
      {section.cards.length > 0 && section.cards.length < section.total && (
        <button
          type="button"
          disabled={more}
          onClick={() => {
            setMore(true);
            onMore();
            setTimeout(() => setMore(false), 400);
          }}
          className={cn(PILL, "ring-1 ring-border hover:bg-muted disabled:opacity-60")}
        >
          Show more
        </button>
      )}
      <NotSeeing ctx={ctx} onAdded={() => onAdded(null)} />
    </>
  );
}

/** Up to twelve cards: a horizontal rail inside its own box on phones (the page never scrolls sideways), a grid from md. */
function CardRail({ cards, ctx, onAdded }: { cards: AlikeCardData[]; ctx: PlanContext; onAdded: (card: AlikeCardData) => void }) {
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 md:overflow-visible md:pb-0 lg:grid-cols-3">
      {cards.map((c) => (
        <AlikeCard key={c.unitId} card={c} listId={ctx.list.id} canEdit={ctx.viewer.canEdit} onAdded={onAdded} />
      ))}
    </div>
  );
}

/**
 * "Not seeing it?": the inline add-college search (editors). The freshman view also passes `exploreHref`, the built
 * "Fits my scores" navigation; the shape's views don't, their per-level "Show me more" links replace it
 * (explore-levels.md).
 */
function NotSeeing({ ctx, exploreHref = null, onAdded }: { ctx: PlanContext; exploreHref?: string | null; onAdded: () => void }) {
  const [searching, setSearching] = useState(false);
  if (!ctx.viewer.canEdit && !exploreHref) return null;
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Not seeing it?</span>
        {ctx.viewer.canEdit && !searching && (
          <button type="button" onClick={() => setSearching(true)} className={cn(PILL, "ring-1 ring-border hover:bg-muted")}>
            Search any college
          </button>
        )}
        {exploreHref && (
          <Link href={exploreHref} className={cn(PILL, "ring-1 ring-border hover:bg-muted")}>
            Explore with your numbers
          </Link>
        )}
      </div>
      {searching && (
        <AddCollegeBox
          listId={ctx.list.id}
          excludeIds={ctx.items.map((i) => i.unit_id)}
          label="Search any college"
          startExpanded
          onAdded={() => onAdded()}
          studentId={ctx.student?.id ?? null}
        />
      )}
    </div>
  );
}

/** The freshman, sophomore, and empty-list view (list-size.md "Freshmen, sophomores, and empty lists"). */
function FreshmanGuide({ ctx, data, studentId, onAdded }: { ctx: PlanContext; data: ListGuideData; studentId: string | null; onAdded: (card: AlikeCardData | null) => void }) {
  const f = data.freshman!;
  const [chips, setChips] = useState<PreferenceChips>(f.chips);
  const [cards, setCards] = useState(f.cards);
  const [total, setTotal] = useState(f.total);
  const [loading, setLoading] = useState(false);
  const [seen, setSeen] = useState(f);
  if (f !== seen) {
    setSeen(f);
    setChips(f.chips);
    setCards(f.cards);
    setTotal(f.total);
  }

  async function load(next: PreferenceChips, offset: number) {
    if (!studentId) return;
    setLoading(true);
    const page = await fetchPage({ studentId, chips: next, offset });
    setLoading(false);
    if (!page) return;
    setCards((prev) => (offset === 0 ? page.cards : [...prev, ...page.cards]));
    setTotal(page.total);
  }

  function flip<K extends keyof PreferenceChips>(key: K, value: PreferenceChips[K][number]) {
    const list = chips[key] as string[];
    const next = { ...chips, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] } as PreferenceChips;
    setChips(next);
    void load(next, 0);
  }

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ring-1", on ? "bg-foreground text-background ring-foreground" : "ring-border hover:bg-muted")}
    >
      {label}
    </button>
  );

  return (
    <section aria-labelledby="places-heading" className="space-y-4 rounded-3xl bg-card p-4 ring-1 ring-border sm:p-6">
      <div className="space-y-1">
        <h2 id="places-heading" className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Places that might interest you
        </h2>
        <p className="text-sm text-muted-foreground">{data.sentence}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What you're looking for">
        {SIZE_CHIPS.map((c) => chip(chips.sizes.includes(c.key), c.label, () => flip("sizes", c.key)))}
        {SETTING_CHIPS.map((c) => chip(chips.settings.includes(c.key), c.label, () => flip("settings", c.key)))}
        {TYPE_CHIPS.map((c) => chip(chips.types.includes(c.key), c.label, () => flip("types", c.key)))}
        {f.places.map((p) => chip(chips.places.includes(p.key), p.label, () => flip("places", p.key)))}
      </div>
      {loading && cards.length === 0 ? (
        <div className="h-40 animate-pulse rounded-2xl bg-muted/50" aria-hidden />
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No college fits every chip. Turn one off to see more.</p>
      ) : (
        <CardRail cards={cards} ctx={ctx} onAdded={onAdded} />
      )}
      {cards.length > 0 && cards.length < total && (
        <button type="button" disabled={loading} onClick={() => void load(chips, cards.length)} className={cn(PILL, "ring-1 ring-border hover:bg-muted disabled:opacity-60")}>
          Show more
        </button>
      )}
      <NotSeeing ctx={ctx} exploreHref={data.exploreHref} onAdded={() => onAdded(null)} />
    </section>
  );
}

export default ListGuide;
