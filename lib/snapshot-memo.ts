/**
 * A value held once per server instance for as long as the served snapshot doesn't change (round 4,
 * specs/serving-architecture.md): the high-school `meta` and `medians` files are the same for every request until a
 * publish, and a publish makes a new snapshot, so a warm instance asks the database for them once per snapshot id.
 * Concurrent requests share one load; a failed load is not held (the next request tries again).
 *
 * Pure, so tests run it directly (tests/high-school-bundle.test.mts).
 *
 *   const meta = snapshotMemo(() => fetchHighSchoolFile(client, "meta"));
 *   await meta(String(currentSnapshotId()));
 */
export function snapshotMemo<T>(load: () => Promise<T>): (key: string) => Promise<T> {
  let held: { key: string; value: Promise<T> } | null = null;
  return (key) => {
    if (held && held.key === key) return held.value;
    const entry = { key, value: load() };
    held = entry;
    entry.value.catch(() => {
      if (held === entry) held = null;
    });
    return entry.value;
  };
}
