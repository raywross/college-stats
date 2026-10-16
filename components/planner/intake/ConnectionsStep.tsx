"use client";
/**
 * Step 6, Connections (specs/planner/v3/connections.md "The Connections step"): a search over the college index with
 * the list's own colleges offered first, a card per college (ConnectionCard), and the one-tap None the activity
 * steps use. Optional like them: Skip in the phone header, "I'll add these later" on desktop (PlanIntake.tsx).
 */
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Chip } from "@/components/activities/chips";
import { ConnectionCard } from "@/components/planner/intake/ConnectionCard";
import { Headline } from "@/components/planner/intake/Headline";
import { track } from "@/lib/analytics";
import type { SchoolIndexEntry } from "@/lib/dataset";
import { newIntakeConnection, type IntakeDraft } from "@/lib/planner/intake";
import { searchSchoolsApi, useSchoolEntries } from "@/lib/school-api";
import { CONNECTIONS_MAX, type ConnectionEntry } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

export function ConnectionsStep({
  draft,
  setDraft,
  listColleges,
}: {
  draft: IntakeDraft;
  setDraft: (next: IntakeDraft) => void;
  /** The list's own colleges (PlanFrame, from ctx.items/ctx.schools): the first suggestions, since a connection on a
   * college already on the list is the common case. */
  listColleges: { unitId: string; name: string; state: string | null }[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolIndexEntry[]>([]);
  const none = draft.activitiesNone.connections === true;
  const existingIds = draft.connections.map((c) => c.unitId);
  const atCap = draft.connections.length >= CONNECTIONS_MAX;

  useEffect(() => {
    const q = query.trim();
    // Nothing to search: `matches` below already hides stale results while the query is empty (AddCollegeBox's
    // own pattern), so there's no need to reset state synchronously inside the effect.
    if (!q) return;
    const controller = new AbortController();
    searchSchoolsApi(q, { limit: 6, exclude: existingIds, signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setResults(rows);
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // The cards' own display data (name, crest, state, type for the ban line), resolved from the search index for
  // every connection — whether it just came from a search result or was loaded from a saved profile.
  const entries = useSchoolEntries(existingIds);
  const byId = new Map(entries.map((e) => [e.id, e]));

  const listPicks = listColleges.filter((c) => !existingIds.includes(c.unitId)).slice(0, 8);

  const clearNone = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping `connections` is the point
    const { connections: _drop, ...rest } = draft.activitiesNone;
    return rest;
  };

  const add = (unitId: string) => {
    if (atCap || existingIds.includes(unitId)) return;
    const entry = newIntakeConnection(unitId);
    setDraft({ ...draft, connections: [...draft.connections, entry], activitiesNone: clearNone() });
    setQuery("");
    setResults([]);
  };

  /** Telemetry fires on the family/recruiting change that first gives the card something (connections.md; the
   * kind is "family" for a family chip, "recruited" when it's the first (and only) thing set). */
  const update = (next: ConnectionEntry) => {
    const before = draft.connections.find((c) => c.id === next.id);
    const familyAdded = (before?.family.length ?? 0) < next.family.length;
    const recruitedAdded = before?.recruited === "none" && next.recruited !== "none";
    setDraft({ ...draft, connections: draft.connections.map((c) => (c.id === next.id ? next : c)) });
    if (familyAdded) track("plan_connection_added", { kind: "family" });
    else if (recruitedAdded) track("plan_connection_added", { kind: "recruited" });
  };

  const remove = (id: string) => setDraft({ ...draft, connections: draft.connections.filter((c) => c.id !== id) });

  const chooseNone = () => {
    if (!none && draft.connections.length > 0 && !window.confirm("Remove the colleges you've added on this step?")) return;
    if (none) {
      setDraft({ ...draft, activitiesNone: clearNone() });
    } else {
      setDraft({ ...draft, connections: [], activitiesNone: { ...draft.activitiesNone, connections: true } });
    }
  };

  const showingMatches = query.trim() !== "";
  const matches = showingMatches ? results : [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Headline lead="Any" pop="connections" tail="to a college?" />
        <p className="text-sm text-muted-foreground">
          A parent, grandparent, or sibling who went somewhere, or a coach who&apos;s recruiting you. Some colleges weigh these; we only use them where
          the college says it does.
        </p>
      </div>

      <Chip role="checkbox" selected={none} onClick={chooseNone} ariaLabel="None: no connections to any college" className="min-h-11 px-5">
        {none ? "✓ None" : "None"}
      </Chip>

      {draft.connections.length > 0 && (
        <div className="space-y-3">
          {draft.connections.map((c) => (
            <ConnectionCard key={c.id} entry={c} school={byId.get(c.unitId) ?? null} onChange={update} onRemove={() => remove(c.id)} />
          ))}
        </div>
      )}

      {!atCap && (
        <div className="space-y-3">
          <div className="relative">
            <label className="flex h-12 items-center gap-2 rounded-full border bg-card px-4">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a college"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>

          {!showingMatches && listPicks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">On your list</p>
              <div className="flex flex-wrap gap-2">
                {listPicks.map((c) => (
                  <button
                    key={c.unitId}
                    type="button"
                    onClick={() => add(c.unitId)}
                    className="min-h-9 rounded-full border border-dashed px-3.5 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground"
                  >
                    + {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showingMatches && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Matches</p>
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No college matches &quot;{query.trim()}&quot;</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {matches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => add(s.id)}
                      className={cn("min-h-9 rounded-full border border-dashed px-3.5 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground")}
                    >
                      + {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
