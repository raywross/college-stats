/**
 * Auth for POST /api/revalidate (app/api/revalidate/route.ts). Plain module so tests can check it.
 * See specs/supabase.md#revalidation.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * True only for `Authorization: Bearer <secret>` with a configured secret. Compares digests in constant time,
 * so neither the secret's content nor its length leaks through timing.
 */
export function isAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(authorization.slice("Bearer ".length)), digest(secret));
}
