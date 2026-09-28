import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks the `Authorization: Bearer <secret>` header on POST /api/revalidate against REVALIDATE_SECRET.
 * Plain module (no Next.js imports) so `npm test` can run it. See specs/deployment.md.
 *
 * - "unconfigured": the server has no secret (or a short one), so the route refuses every call.
 * - "denied": missing or wrong token.
 */
export type RevalidateAuth = "ok" | "denied" | "unconfigured";

/** Long enough that it can't be guessed; `openssl rand -hex 32` gives 64 characters. */
export const MIN_SECRET_LENGTH = 32;

export function checkRevalidateAuth(authorization: string | null, secret: string | undefined): RevalidateAuth {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return "unconfigured";
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return "denied";
  // Hash both sides so the comparison is constant-time whatever their lengths.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(token), digest(secret)) ? "ok" : "denied";
}
