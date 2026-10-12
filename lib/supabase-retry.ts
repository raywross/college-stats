/**
 * Retry a Supabase call that the database cancelled for running too long ("canceling statement due to statement
 * timeout", SQLSTATE 57014): the API's statement timeout is a few seconds, and a batch that usually fits can miss it
 * while the table is busy (a previous cancelled write, a vacuum). Any other error is thrown at once. Pure except
 * for the wait, which `sleep` injects so tests run without it.
 */
export const isStatementTimeout = (message: string | null | undefined): boolean => /statement timeout|\b57014\b/i.test(message ?? "");

/** Waits before the second, third, and fourth attempt. */
export const TIMEOUT_RETRY_WAITS_MS: readonly number[] = [5_000, 15_000, 45_000];

export async function retryOnStatementTimeout<T>(
  call: () => PromiseLike<{ data: T; error: { message: string; code?: string } | null }>,
  what: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await call();
    if (!error) return data;
    const timedOut = isStatementTimeout(error.message) || error.code === "57014";
    if (!timedOut || attempt >= TIMEOUT_RETRY_WAITS_MS.length) throw new Error(`${what}: ${error.message}`);
    await sleep(TIMEOUT_RETRY_WAITS_MS[attempt]);
  }
}
