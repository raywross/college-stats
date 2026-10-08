/**
 * Holds one copy of a dataset in memory per server instance: load once, serve forever. The files it is read from ship
 * with the deploy (specs/serving-architecture.md#1-the-deploy-carries-the-dataset), so they can't change while the
 * process runs and there is nothing to check for. Plain module (no Next.js imports) so tests can drive it;
 * lib/data.ts wires it to the files under data/.
 */

/**
 * Returns `get()`. The first call loads; concurrent callers share that one load. Once it succeeds every later call
 * returns the same value without loading again. If it fails, that call throws (loudly: a site without its dataset
 * can't render), and the next call tries again.
 */
export function createDatasetLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: { value: T } | null = null;
  let inflight: Promise<T> | null = null;

  return async function get(): Promise<T> {
    if (loaded) return loaded.value;
    inflight ??= load()
      .then((value) => {
        loaded = { value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
