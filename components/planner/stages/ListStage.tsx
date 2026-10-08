import Link from "next/link";
import { Crest } from "@/components/school/Crest";
import { StagePanel } from "@/components/planner/StagePanel";
import { SortMenu } from "@/components/lists/SortMenu";
import { ExploreFitChips } from "@/components/me/ExploreFitChips";
import { AcceptAllButton, AddOrSuggestButton } from "@/components/planner/stages/ListStageControls";
import { ListStageRow } from "@/components/planner/stages/ListStageRow";
import { getData } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { similarSchools } from "@/lib/insights";
import { balanceLine, CATEGORY_LABELS, LIST_CATEGORIES, type ListCategory } from "@/lib/list-rules";
import { extendedBalanceLines, sortItems, suggestCategory, type SuggestResult } from "@/lib/planner/suggest";
import { nextTaskByItem, taskDate } from "@/lib/planner/tasks";
import type { PlanContext, PlanItem, PlanSchool } from "@/lib/planner/types";

/**
 * Stage 1, the list (specs/planner/list-building.md), built by U2. The balance line extended with the facts this
 * stage adds, the rows grouped by category or the chosen sort with their suggestion, Dream star, and category
 * picker (`ListStageRow`), "Accept all suggestions" while anything's unsorted, and the finding rail: colleges like
 * the ones already here, the built "Fits my scores"/"Fits my preferences" chips, and an Add (or Suggest, for a
 * view-only guardian) button on each. A server component: it reads the dataset once for the similar-colleges rail;
 * everything else comes from `PlanContext`.
 */
export default async function ListStage({ ctx }: { ctx: PlanContext }) {
  const { list, items, schools, profile, viewer, today, tasks, home } = ctx;
  const sort = list.sort ?? "category";
  const nextByItem = nextTaskByItem(items, tasks, today);

  interface Row {
    item: PlanItem;
    school: PlanSchool;
    suggestion: SuggestResult;
    nextDate: string | null;
  }
  const rows: Row[] = items.flatMap((item) => {
    const school = schools[item.unit_id];
    if (!school) return [];
    const next = nextByItem[item.id] ?? null;
    return [{ item, school, suggestion: suggestCategory(school, profile), nextDate: next ? taskDate(next) : null }];
  });

  const ordered = sortItems(
    rows.map((r) => ({
      id: r.item.id,
      category: r.item.category,
      position: r.item.position,
      dream: r.item.dream,
      priority: r.item.priority,
      admitRate: r.school.admitRate,
      avgCost: r.school.avgCost,
      distanceMiles: r.school.distanceMiles,
      nextDate: r.nextDate,
      standing: r.suggestion.category,
    })),
    sort,
  );
  const byId = new Map(rows.map((r) => [r.item.id, r]));
  const sortedRows = ordered.map((s) => byId.get(s.id)!);
  const grouped = sort === "category" || sort === "mine";
  const groups: { category: ListCategory | null; rows: Row[] }[] = grouped
    ? LIST_CATEGORIES.map((category) => ({ category, rows: sortedRows.filter((r) => r.item.category === category) }))
    : [{ category: null, rows: sortedRows }];

  const dreamItem = items.find((i) => i.dream) ?? null;
  const dreamName = dreamItem ? (schools[dreamItem.unit_id]?.name ?? dreamItem.unit_id) : null;
  const unsortedCount = items.filter((i) => i.category === "unsorted").length;
  const extraLines = extendedBalanceLines(
    items.map((i) => ({ category: i.category, avgCost: schools[i.unit_id]?.avgCost ?? null })),
    { maxAverageCost: profile?.preferences.maxAverageCost ?? null },
  );

  // Finding rail: colleges like the ones already on the list (lib/insights.ts similarSchools), excluding the list
  // itself and duplicates, up to six.
  const data = await getData();
  const onList = new Set(items.map((i) => i.unit_id));
  const seen = new Set<string>();
  const similar: { unitId: string; name: string; brand: ReturnType<typeof crestBrand> }[] = [];
  outer: for (const item of items) {
    const school = data.getSchoolById(item.unit_id);
    if (!school) continue;
    for (const { school: s } of similarSchools(data, school, 4)) {
      if (onList.has(s.unit_id) || seen.has(s.unit_id)) continue;
      seen.add(s.unit_id);
      similar.push({ unitId: s.unit_id, name: s.name, brand: crestBrand(s) });
      if (similar.length >= 6) break outer;
    }
  }
  const canSuggestOnly = !viewer.canEdit && viewer.isGuardian;
  const unavailableSorts = [...(profile ? [] : (["standing"] as const)), ...(home ? [] : (["distance"] as const))];

  return (
    <StagePanel
      stage={1}
      ctx={ctx}
      actions={items.length > 1 ? <SortMenu listId={list.id} value={list.sort} canEdit={viewer.canEdit} unavailable={unavailableSorts} /> : undefined}
    >
      <div className="space-y-1 text-sm">
        <p className="font-semibold text-muted-foreground">{balanceLine(items)}</p>
        {extraLines.map((l, i) => (
          <p key={i} className="text-muted-foreground">
            {l.text}
          </p>
        ))}
        <p className="text-muted-foreground">
          {dreamName ? (
            <>
              Dream: <span className="font-semibold text-foreground">{dreamName}</span>
            </>
          ) : (
            "Dream: none yet"
          )}
        </p>
      </div>

      {unsortedCount > 0 && viewer.canEdit && <AcceptAllButton listId={list.id} />}

      {items.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">No colleges here yet. Use &quot;Add to list&quot; on a college&apos;s page.</p>
      ) : (
        <div className="space-y-5">
          {groups.map(
            (g) =>
              g.rows.length > 0 && (
                <section key={g.category ?? "sorted"}>
                  {grouped && (
                    <h3 className="mb-1.5 font-display text-base font-bold">
                      {CATEGORY_LABELS[g.category!]} <span className="text-xs font-medium text-muted-foreground">({g.rows.length})</span>
                    </h3>
                  )}
                  <ul className="divide-y rounded-2xl border bg-card">
                    {g.rows.map(({ item, school, suggestion }) => (
                      <ListStageRow
                        key={item.id}
                        itemId={item.id}
                        unitId={item.unit_id}
                        name={school.name}
                        brand={school.brand as Parameters<typeof Crest>[0]["brand"]}
                        category={item.category}
                        dream={Boolean(item.dream)}
                        dreamName={dreamItem && dreamItem.id !== item.id ? dreamName : null}
                        admitRate={school.admitRate}
                        avgCost={school.avgCost}
                        distanceMiles={school.distanceMiles}
                        suggestion={suggestion}
                        canEdit={viewer.canEdit}
                      />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}

      <div className="space-y-3 border-t pt-4">
        <h3 className="font-display text-lg font-bold">Find more colleges</h3>
        <ExploreFitChips />
        {similar.length > 0 && (
          <div className="grid gap-2 max-sm:rail max-sm:[--rail-item:72%] sm:grid-cols-2 lg:grid-cols-3">
            {similar.map((s) => (
              <div key={s.unitId} className="flex items-center gap-2 rounded-2xl border bg-card p-2.5">
                <Crest id={s.unitId} name={s.name} size="sm" brand={s.brand} />
                <Link href={`/schools/${s.unitId}`} className="min-w-0 flex-1 truncate font-display text-sm font-bold hover:text-primary">
                  {s.name}
                </Link>
                <AddOrSuggestButton listId={list.id} unitId={s.unitId} canSuggestOnly={canSuggestOnly} />
              </div>
            ))}
          </div>
        )}
      </div>
    </StagePanel>
  );
}
