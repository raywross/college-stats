/**
 * The project's public signing keys as served at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`: the URL, and the
 * filter that keeps only public asymmetric keys with a `kid`. Pure, shared by the build-time download
 * (scripts/fetch-jwks.mts) and the per-instance refresh (lib/auth-jwks.ts), so both keep exactly the same keys.
 */

export type PublicJwk = { kty: string; kid: string; key_ops?: string[]; [member: string]: unknown };
export type JwkSet = { keys: PublicJwk[] };

/** The project's key set URL: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. */
export const jwksUrl = (supabaseUrl: string) => `${supabaseUrl.trim().replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Downloads the key set; throws on a failed request or a body that isn't a key set. */
export async function downloadJwks(supabaseUrl: string, fetcher: Fetch = fetch, timeoutMs = 10_000): Promise<JwkSet> {
  const url = jwksUrl(supabaseUrl);
  const res = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return publicKeys(await res.json());
}

/** The public, asymmetric keys with a `kid` from a key set as served; anything else is dropped. Throws without a keys array. */
export function publicKeys(body: unknown): JwkSet {
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) throw new Error("the response has no keys array");
  return {
    keys: keys.filter(
      (k): k is PublicJwk =>
        typeof k === "object" &&
        k !== null &&
        typeof k.kid === "string" &&
        k.kid !== "" &&
        (k.kty === "EC" || k.kty === "RSA" || k.kty === "OKP") &&
        !("d" in k),
    ),
  };
}
