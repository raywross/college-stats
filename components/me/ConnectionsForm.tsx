"use client";
/**
 * Connections on the Numbers page (specs/planner/v3/connections.md "The Connections step"): the same cards as the
 * intake's Connections step, after Activities. A fact about the student and a college, entered once, read by
 * `hooksFromPlan` wherever that college is on the list — whether or not it's there yet. Saved through `saveProfile`
 * with `academics.connections` replaced; nothing else on the profile is touched. A guardian with edit access may
 * write, like any other profile field.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ConnectionCard } from "@/components/planner/intake/ConnectionCard";
import { newIntakeConnection } from "@/lib/planner/intake";
import { searchSchoolsApi, useSchoolEntries } from "@/lib/school-api";
import { CONNECTIONS_MAX, sanitizeConnections, type ConnectionEntry, type StudentProfileData } from "@/lib/student-profile";
import { saveProfile } from "@/lib/student-profile-store";
import type { SchoolIndexEntry } from "@/lib/dataset";

export function ConnectionsForm({ studentId, data, canEdit }: { studentId: string; data: StudentProfileData; canEdit: boolean }) {
  const router = useRouter();
  const [connections, setConnections] = useState<ConnectionEntry[]>(() => sanitizeConnections(data.academics.connections));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolIndexEntry[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const existingIds = connections.map((c) => c.unitId);
  const entries = useSchoolEntries(existingIds);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const atCap = connections.length >= CONNECTIONS_MAX;

  useEffect(() => {
    const q = query.trim();
    // Nothing to search: the dropdown below only renders while `query` is non-empty, so stale results don't show.
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

  const persist = (next: ConnectionEntry[]) => {
    if (!canEdit) return;
    const before = connections;
    setConnections(next);
    setError(null);
    startTransition(async () => {
      const result = await saveProfile(studentId, { ...data, academics: { ...data.academics, connections: next } });
      if (!result.ok) {
        setConnections(before);
        setError(result.message);
        return;
      }
      router.refresh();
    });
  };

  const add = (unitId: string) => {
    if (atCap || existingIds.includes(unitId)) return;
    persist([...connections, newIntakeConnection(unitId)]);
    setQuery("");
    setResults([]);
  };
  const update = (next: ConnectionEntry) => persist(connections.map((c) => (c.id === next.id ? next : c)));
  const remove = (id: string) => persist(connections.filter((c) => c.id !== id));

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="connections-heading">
      <div>
        <h2 id="connections-heading" className="font-display text-base font-bold">
          Connections
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A parent, grandparent, or sibling who went somewhere, or a coach who&apos;s recruiting you. Some colleges weigh these; we only use them where
          the college says it does.
        </p>
      </div>

      {connections.length > 0 && (
        <div className="space-y-3">
          {connections.map((c) => (
            <ConnectionCard key={c.id} entry={c} school={byId.get(c.unitId) ?? null} onChange={update} onRemove={() => remove(c.id)} disabled={!canEdit || pending} />
          ))}
        </div>
      )}

      {canEdit && !atCap && (
        <div className="relative">
          <label className="flex h-12 items-center gap-2 rounded-full border bg-background px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add a college…"
              disabled={pending}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          {query.trim() !== "" && results.length > 0 && (
            <div className="absolute inset-x-0 z-20 mt-1.5 overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-xl">
              {results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={pending}
                  onClick={() => add(s.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold hover:bg-muted disabled:opacity-60"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
