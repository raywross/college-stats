/**
 * The plan loader's second wave (specs/serving-architecture.md: /advisor in two database waves; lib/planner/load.ts):
 * work that needs one first-wave read, started the moment that read resolves rather than when the whole first wave
 * has. Pure (no server imports) so tests can drive it with fake promises (tests/plan-waves.test.mts).
 */

/**
 * `start(value)` as soon as `first` resolves, without waiting for anything else. The returned promise never rejects
 * unhandled: a failure (of `first` or of `start`) surfaces where it is awaited.
 */
export function afterOne<T, R>(first: Promise<T>, start: (value: T) => Promise<R>): Promise<R> {
  const p = first.then(start);
  p.catch(() => {});
  return p;
}
