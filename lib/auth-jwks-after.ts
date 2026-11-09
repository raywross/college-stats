/**
 * Schedules the instance's hourly signing-key refresh after the response (round 5; lib/auth-jwks.ts, lib/jwks-refresh.ts;
 * specs/product/accounts.md "Checking the session without fetching the keys"). Called by the session checks (lib/auth.ts
 * sessionClaims, proxy.ts) right after they verify a token: when the hour's refresh is due, `after()` runs it once the
 * response is sent, so the platform keeps the instance alive for it and no request waits on it (as lib/data.ts's
 * pointer check does). Outside a request (`after()` throws: a script, a test) it does nothing.
 */
import { after } from "next/server";
import { claimJwksRefresh, refreshInstanceJwks } from "@/lib/auth-jwks";

export function scheduleJwksRefresh(): void {
  if (!claimJwksRefresh()) return;
  try {
    after(() => refreshInstanceJwks());
  } catch {
    // No request to attach to: skip; the next request's check claims again after the interval.
  }
}
