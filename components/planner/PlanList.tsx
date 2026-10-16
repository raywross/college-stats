"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AddCollegeBox } from "@/components/planner/AddCollegeBox";
import { PlanRow, type RowPill } from "@/components/planner/PlanRow";
import { EdPill } from "@/components/planner/EdPill";
import { InterestPill } from "@/components/planner/InterestPill";
import { edOpportunities, type EdCandidate } from "@/lib/planner/ed-opportunities";
import { isOpen } from "@/lib/planner/tasks";
import { GUIDES, guideHref } from "@/lib/planner/guides";
import { ListExplainer } from "@/components/planner/ListExplainer";
import { PlanNotice } from "@/components/planner/PlanNotice";
import type { PlanTabProps } from "@/components/planner/tabs/types";
import { removeFromList } from "@/lib/lists";
import { track } from "@/lib/analytics";
import { setPlanDream } from "@/lib/planner/store-plan";
import type { PlanRowView } from "@/lib/planner/plan-view";
import { GROUP_HEADING, SEASON_STATUS_LABEL, groupedRows, headerCountsLine } from "@/lib/planner/list-row";
import { GROUP_CLASS } from "@/lib/planner/colors";
import { seasonRank } from "@/lib/planner/seasons";
import type { ListCategory } from "@/lib/list-rules";
import { cn } from "@/lib/utils";

/** applying.md "On the list row": the status word shows from senior fall on. */
const SENIOR_FALL_RANK = seasonRank("senior_fall");

/**
 * The Colleges tab: the list as the plan (specs/planner/redesign/list.md). Grouped by Reach / Target / Likely, then
 * "Not sorted yet" — Quad's groups only, no chip to cycle and no sort menu. Owns its own copy of the rows so every
 * tap (the Dream, the capture panel's remove) updates at once; a refused write rolls the row back and shows
 * an inline message, and a successful one refreshes the server page so the notices, balance line, and tasks that
 * depend on more than one row stay correct.
 */
export default function PlanList({ ctx, view }: PlanTabProps) {
  const router = useRouter();
  const [rows, setRows] = useState<PlanRowView[]>(view.rows);
  const [viewSeen, setViewSeen] = useState(view);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canEdit = ctx.viewer.canEdit;
  // A move's `open_row` link (`?row=<item id>&panel=ed|capture`) opens that row's drawer on the panel.
  const params = useSearchParams();
  const openRow = params?.get("row") ?? null;
  const openPanelParam = params?.get("panel");
  const openPanel = openPanelParam === "ed" || openPanelParam === "capture" ? openPanelParam : "capture";
  // Good ED opportunities (ed-opportunities.md): computed once from the server's view; every candidate gets a pill.
  const edCandidates = edOpportunities(view.rows.map((r) => r.item), view.estimates, ctx.schools, { season: ctx.season, today: ctx.today });
  const edByItem = new Map<string, EdCandidate>(edCandidates.map((c) => [c.itemId, c]));
  // Interest pill (interest-and-visits.md "The pill": "a list row with an open interest move"): the row-level rendering
  // of the move the Next steps tab shows, read from the same generated rows, so the pill and the card never disagree
  // (QA 2026-10-15: recomputing the rule here drifted from the generated set once the senior-fall dating applied).
  const interestItemIds = new Set(
    ctx.tasks.filter((t) => (t.kind === "show_interest" || t.kind === "visit_ed") && t.item_id && isOpen(t, ctx.today)).map((t) => t.item_id as string),
  );
  const pillFor = (row: PlanRowView): RowPill | undefined => {
    const c = edByItem.get(row.item.id);
    if (c) {
      return function edPill(open) {
        return <EdPill candidate={c} onOpen={() => open("ed")} />;
      };
    }
    if (interestItemIds.has(row.item.id)) {
      return function interestPill(open) {
        return <InterestPill onOpen={() => open("capture")} />;
      };
    }
    return undefined;
  };

  // The server's view (a refresh, a different child, a data publish) replaces whatever's local. Resetting state
  // during render (rather than in an effect) avoids an extra render each time the view changes.
  if (view !== viewSeen) {
    setViewSeen(view);
    setRows(view.rows);
  }

  const setRowError = (id: string, message: string | null) =>
    setErrors((e) => {
      if (message) return { ...e, [id]: message };
      if (!(id in e)) return e;
      const rest = { ...e };
      delete rest[id];
      return rest;
    });


  async function handleDream(row: PlanRowView) {
    const before = rows;
    const next = !row.dream;
    setRowError(row.item.id, null);
    setRows((rs) => rs.map((r) => (r.item.id === row.item.id ? { ...r, dream: next } : next && r.dream ? { ...r, dream: false } : r)));
    track("plan_dream_set", { on: next });
    const result = await setPlanDream(row.item.id, next);
    if (!result.ok) {
      setRows(before);
      setRowError(row.item.id, result.message);
      return;
    }
    router.refresh();
  }

  async function handleRemove(row: PlanRowView) {
    const before = rows;
    setRowError(row.item.id, null);
    setRows((rs) => rs.filter((r) => r.item.id !== row.item.id));
    track("plan_college_removed", { dream: row.dream });
    const result = await removeFromList(row.item.id);
    if (!result.ok) {
      setRows(before);
      setRowError(row.item.id, result.message);
      return;
    }
    router.refresh();
  }

  const groups = groupedRows(rows);
  const dreamRow = rows.find((r) => r.dream) ?? null;
  const showStatusWord = seasonRank(ctx.season) >= SENIOR_FALL_RANK;
  const firstName = ctx.student?.display_name?.trim().split(/\s+/)[0] || null;
  const addLabel = ctx.viewer.isGuardian && firstName ? `Add a college for ${firstName}` : "Add a college";

  return (
    <div className="space-y-4">
      <PlanNotice ctx={ctx} view={view} className="lg:hidden" />

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          <p>No colleges here yet.{canEdit ? " Add one below." : ""}</p>
          {ctx.viewer.isGuardian && ctx.student && ctx.student.user_id === null && (
            // A record the parent made that no account has claimed: colleges saved on the student's own account sit
            // on that account's list until the student accepts the household invitation (found in owner testing).
            <p className="mx-auto mt-2 max-w-md">
              {firstName || "Your student"} hasn&apos;t joined your household yet, so colleges saved on their own
              account don&apos;t show here. Send an invitation from{" "}
              <Link href="/household" className="font-semibold text-primary hover:underline">
                Household
              </Link>
              ; once it&apos;s accepted, their colleges appear here.
            </p>
          )}
        </div>
      ) : (
        <section className="overflow-hidden rounded-3xl border bg-card">
          {/* The list's header, on every width (owner, 2026-10-12): the count and the one info link for the whole
              list. Round, Deadline, and Status columns are gone for now (they return with recommendations). */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 border-b px-4 py-1.5">
            <p className="text-sm font-semibold">{headerCountsLine(rows)}</p>
            <ListExplainer />
          </div>
          {groups.map(({ group, rows: groupRows }) => (
            <div key={group}>
              <div className="border-b px-4 py-3">
                <GroupHeading group={group} count={groupRows.length} />
              </div>
              <ul className="divide-y">
                {groupRows.map((row) => (
                  <PlanRow
                    key={row.item.id}
                    row={row}
                    ctx={ctx}
                    dreamName={dreamRow && dreamRow.item.id !== row.item.id ? (dreamRow.school?.name ?? null) : null}
                    error={errors[row.item.id] ?? null}
                    status={showStatusWord && row.seasonStatus ? SEASON_STATUS_LABEL[row.seasonStatus] : null}
                    onToggleDream={handleDream}
                    onRemove={handleRemove}
                    pill={pillFor(row)}
                    edCandidate={edByItem.get(row.item.id) ?? null}
                    openPanel={openRow === row.item.id ? openPanel : null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* The add pill, and beside it the Build your list guide (specs/planner/v3/guides/list-size.md). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {canEdit && (
          <div className="min-w-0 flex-1 basis-60">
            <AddCollegeBox listId={ctx.list.id} excludeIds={rows.map((r) => r.item.unit_id)} label={addLabel} onAdded={() => router.refresh()} />
          </div>
        )}
        {ctx.student && (
          <Link
            href={guideHref("list", { person: ctx.viewer.relation === "self" ? null : ctx.student.id, from: "pill" })}
            className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-primary hover:underline"
          >
            {GUIDES.list.button}
          </Link>
        )}
      </div>
    </div>
  );
}

/** list.md "Grouped by...": the section heading pill, High reach pink, Reach violet, Target sky, Likely emerald,
 * Safe green, "Not sorted yet" muted — calm tints, never a warning, with the group's count. */
function GroupHeading({ group, count }: { group: ListCategory; count: number }) {
  return (
    <p className={cn("inline-flex h-8 items-center rounded-full px-3 text-xs font-bold", GROUP_CLASS[group])}>
      {GROUP_HEADING[group]} · {count}
    </p>
  );
}
