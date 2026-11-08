/**
 * A value held once per server instance for as long as the served snapshot doesn't change (round 4,
 * specs/serving-architecture.md): the high-school `meta` and `medians` files are the same for every request until a
 * publish, and a publish makes a new snapshot, so a warm instance asks the database for them once per snapshot id.
 * Concurrent requests share one load; a failed load is not held (the next request tries again). The hold also
 * expires after `ttlMs` (ten minutes): the publisher moves the pointer before it writes the high-school tables
 * (scripts/publish-snapshot.mts), so an instance that swaps in that window would otherwise keep the previous
 * publish's files under the new snapshot's key until the one after.
 *
 * Pure, so tests run it directly (tests/high-school-bundle.test.mts).
 *
 *   const meta = snapshotMemo(() => fetchHighSchoolFile(client, "meta"));
 *   await meta(String(currentSnapshotId()));
 */
export function snapshotMemo<T>(load: () => Promise<T>, opts: { ttlMs?: number; now?: () => number } = {}): (key: string) => Promise<T> {
  const ttlMs = opts.ttlMs ?? 10 * 60_000;
  const now = opts.now ?? Date.now;
  let held: { key: string; at: number; value: Promise<T> } | null = null;
  return (key) => {
    if (held && held.key === key && now() - held.at < ttlMs) return held.value;
    const entry = { key, at: now(), value: load() };
    held = entry;
    entry.value.catch(() => {
      if (held === entry) held = null;
    });
    return entry.value;
  };
}
