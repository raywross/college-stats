/**
 * One result per request for reads a request makes more than once (U20 "real speed"). Server Components get this
 * from React `cache`, but a Server Action runs outside React's render, where `cache` is a pass-through: the intake's
 * save read the account twice in a row. `inRequestScope(fn)` gives an action (or anything else) a scope; inside it,
 * `requestMemo(key, load)` runs `load` once per key. Outside a scope it just calls `load`.
 *
 * Only for reads whose answer can't change within the request because of the request's own writes, or whose callers
 * know that (lib/bundles.ts says which). Pure (no Next imports) so tests run it directly.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Runs `fn` with a fresh memo scope (or inside the current one, when already in a scope). */
export function inRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  return scope.getStore() ? fn() : scope.run(new Map(), fn);
}

/** `load()` once per key in the current scope; a rejected load is forgotten so the next call retries. */
export function requestMemo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = scope.getStore();
  if (!memo) return load();
  const hit = memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = load();
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}

/** Drops a key, so the next read in this scope goes to the database again (after a write that changes it). */
export function forgetRequestMemo(key: string): void {
  scope.getStore()?.delete(key);
}
