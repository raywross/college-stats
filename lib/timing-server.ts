import "server-only";
/**
 * Request timing wired into Next (lib/timing.ts holds the pure parts; specs/serving-architecture.md "Timing a
 * request"). `withTiming(label, fn)` wraps a page's data work or a Server Action: with `QUAD_TIMING=1` it records
 * every Supabase round trip and span inside `fn`, and once the response has gone (`after()`), and any work scheduled
 * with `afterResponse` has finished, logs one line: `[timing] /plan save 812ms (+400ms after): db 6× …`. Off, it is
 * `fn()` and `after(fn)`.
 */
import { after } from "next/server";
import { currentTiming, RequestTiming, runWithTiming, timingEnabled } from "./timing";

const pendingWork = new WeakMap<RequestTiming, Promise<unknown>[]>();

/**
 * Runs `fn` timed as `label`. `respond: true` (a Server Action) marks the moment `fn` returns as the response time,
 * so work after it reads as "+N ms after".
 */
export async function withTiming<T>(label: string, fn: () => Promise<T>, opts: { respond?: boolean } = {}): Promise<T> {
  if (!timingEnabled() || currentTiming()) return fn();
  const t = new RequestTiming(label);
  try {
    after(async () => {
      // Every after() callback starts together once the response has closed: let the others register, then wait.
      await new Promise((r) => setTimeout(r, 0));
      await Promise.allSettled(pendingWork.get(t) ?? []);
      console.info(`[timing] ${t.line()}`);
    });
  } catch {
    // Outside a request: nothing to log after.
  }
  return runWithTiming(t, async () => {
    const out = await fn();
    if (opts.respond) t.responded();
    return out;
  });
}

/**
 * Work that must happen but needn't hold the response (a Server Action's follow-up pass): scheduled with `after()`
 * so it runs once the response has been sent, timed as `name` on the current request when timing is on. Outside a
 * request (a script or test) `after()` throws and the work runs inline, so it is never dropped.
 */
export async function afterResponse(name: string, fn: () => Promise<void>): Promise<void> {
  const t = currentTiming();
  const task = () => {
    if (!t) return fn();
    const p = runWithTiming(t, () => t.span(name, fn));
    const list = pendingWork.get(t) ?? [];
    list.push(p);
    pendingWork.set(t, list);
    return p;
  };
  try {
    after(task);
  } catch {
    await task();
  }
}
