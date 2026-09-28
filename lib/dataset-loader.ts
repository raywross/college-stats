/**
 * Holds one copy of the dataset in memory per server instance and reloads it when the store has a newer
 * publish. Plain module (no Next.js imports) so tests can drive it; lib/data.ts wires it to data/*.json or
 * Supabase. Why it checks the version on every call instead of on a timer: specs/supabase.md#revalidation.
 */

export interface Versioned<T> {
  value: T;
  /** Which publish `value` came from; null for a store without versions (the JSON files). */
  version: string | null;
}

export interface LoaderOptions<T> {
  load: () => Promise<Versioned<T>>;
  /** The version the store serves now. Omit for a store that can't change while the process runs. */
  currentVersion?: () => Promise<string | null>;
  onError?: (message: string, err: unknown) => void;
}

/**
 * Returns `get()`. The first call loads and throws if that fails. Later calls ask the store for its current
 * version: if it matches the copy in memory they return it; otherwise they wait for a reload, so the caller never
 * renders a publish older than the one the store is serving. If the store can't be reached, they keep serving the
 * copy in memory.
 */
export function createDatasetLoader<T>({ load, currentVersion, onError = console.error }: LoaderOptions<T>) {
  let loaded: Versioned<T> | null = null;
  let inflight: Promise<Versioned<T>> | null = null;

  function reload(): Promise<Versioned<T>> {
    inflight ??= load()
      .then((fresh) => (loaded = fresh))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return async function get(): Promise<T> {
    if (!loaded) return (await reload()).value;
    if (!currentVersion) return loaded.value;
    try {
      const version = await currentVersion();
      if (version === loaded.version) return loaded.value;
      // A reload already in flight may have started before this publish; if it returns an older version, load again.
      let fresh = await reload();
      if (fresh.version !== version) fresh = await reload();
      return fresh.value;
    } catch (err) {
      onError("Checking or reloading the dataset failed; serving the copy in memory.", err);
      return loaded.value;
    }
  };
}
