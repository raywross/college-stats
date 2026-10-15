"use client";

/**
 * The rail of colleges a shape_gap move's "Show some" button opens (specs/planner/next-steps/list-shape.md "The
 * rail"): a horizontal scroll of cards at the missing level, fetched fresh from POST /api/plan/rail. Crest, name,
 * state, the level chip ("Likely for you", never a number), average cost with its ⓘ when the family has a limit
 * set, distance when known, and Add (Suggest for a view-only guardian). No ranking by quality: cards are "colleges
 * at this level for you", in whatever order the server sent them.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crest } from "@/components/school/Crest";
import { MetricLabel } from "@/components/ui/info-tip";
import type { AnyCited } from "@/lib/lineage";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { STANDING_LEVEL_LABELS } from "@/lib/chances/levels";
import type { StandingLevel } from "@/lib/chances/types";
import { addToList } from "@/lib/lists";
import { suggestCollege } from "@/lib/planner/store-list";
import type { ShapeGapKind } from "@/lib/planner/list-shape";
import { track } from "@/lib/analytics";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The card shape from POST /api/plan/rail (lib/planner/rail-server.ts RailCard), copied rather than imported: that
 * module reaches Quad's estimate (server-only, never a client bundle — tests/chances-client-guard.test.mts), and
 * even a type-only import would still be traced by the client-reach guard's import scan.
 */
interface RailCardData {
  unitId: string;
  name: string;
  state: string | null;
  brand?: Parameters<typeof Crest>[0]["brand"];
  level: StandingLevel;
  avgCost: number | null;
  avgCostCite?: unknown;
  distanceMiles: number | null;
}

type Fetched = { status: "loading" } | { status: "ready"; cards: RailCardData[] } | { status: "error" };

export function CollegeRail({
  listId,
  studentId,
  level,
  gap,
  canEdit,
  showCost,
  onAdded,
}: {
  listId: string;
  studentId: string;
  level: StandingLevel;
  gap: ShapeGapKind;
  /** Whether the signed-in viewer can edit this list (Add) or only suggest (Suggest). */
  canEdit: boolean;
  /** Average cost shows only once the family has set a limit (list-shape.md "The rail"), not just because a
   * college happens to report one. */
  showCost: boolean;
  onAdded: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<Fetched>({ status: "loading" });
  const [addedId, setAddedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/plan/rail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, level, gap }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: { cards?: RailCardData[] }) => setState({ status: "ready", cards: data.cards ?? [] }))
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error(`CollegeRail: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, level, gap]);

  function act(unitId: string) {
    startTransition(async () => {
      const result = canEdit ? await addToList(listId, unitId) : await suggestCollege(listId, unitId);
      if (result.ok) {
        setAddedId(unitId);
        track("plan_rail_added", { level });
        onAdded();
        router.refresh();
      }
    });
  }

  if (state.status === "loading") return <div className="h-32 animate-pulse rounded-2xl bg-muted/50" aria-hidden />;
  if (state.status === "error" || state.cards.length === 0) {
    return (
      <p className="rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        Quad didn&apos;t find a {STANDING_LEVEL_LABELS[level]} near your list; try{" "}
        <a href="/explore" className="font-semibold text-primary hover:underline">
          Explore
        </a>{" "}
        with your numbers.
      </p>
    );
  }

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {state.cards.map((card) => (
        <div key={card.unitId} className="flex w-44 shrink-0 flex-col gap-2 rounded-2xl border bg-card p-3">
          <Crest id={card.unitId} name={card.name} size="sm" brand={card.brand} />
          <div>
            <p className="line-clamp-2 text-sm font-semibold">{card.name}</p>
            {card.state && <p className="text-xs text-muted-foreground">{card.state}</p>}
          </div>
          <span className={cn("inline-flex h-6 w-fit items-center rounded-full px-2.5 text-xs font-bold", GROUP_CLASS[card.level])}>{STANDING_LEVEL_LABELS[card.level]} for you</span>
          {showCost && card.avgCost !== null && (
            <MetricLabel cited={card.avgCostCite as AnyCited | undefined} className="text-xs text-muted-foreground">
              {money(card.avgCost)}/yr avg
            </MetricLabel>
          )}
          {card.distanceMiles !== null && <p className="text-xs text-muted-foreground">{Math.round(card.distanceMiles)} mi away</p>}
          <button
            type="button"
            disabled={pending || addedId === card.unitId}
            onClick={() => act(card.unitId)}
            className="mt-1 min-h-9 rounded-full bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-60"
          >
            {addedId === card.unitId ? "Added" : canEdit ? "Add" : "Suggest"}
          </button>
        </div>
      ))}
    </div>
  );
}

export default CollegeRail;
