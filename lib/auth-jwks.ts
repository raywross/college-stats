/**
 * The project's public signing keys, bundled at build time (specs/product/accounts.md "Checking the session without
 * fetching the keys").
 *
 * `scripts/fetch-jwks.mts` (the prebuild, and the postinstall with `--ensure`) writes `.data/auth/jwks.json` from
 * `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, or the empty set when Supabase isn't configured. The file is
 * imported statically, so the bundler inlines it into every function that checks a session, proxy.ts included,
 * without depending on file tracing; it is read once per instance.
 *
 * Why: auth.getClaims() looks a token's `kid` up in the key set it is given first, then in the library's in-memory
 * cache (per instance, 10 minutes), and only then fetches the key set over the network. A fresh instance has an empty
 * cache, so before this every cold request paid that fetch (1–1.6 s in production) before anything else. With the
 * bundled keys it pays nothing. A key rotated in since the build isn't in the bundled set, and getClaims() then does
 * exactly what it did without one (cache, then fetch), so a rotation never signs anyone out.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import bundled from "../.data/auth/jwks.json" with { type: "json" };

type GetClaims = SupabaseClient["auth"]["getClaims"];
type ClaimsOptions = NonNullable<Parameters<GetClaims>[1]>;
/** A JSON Web Key Set as getClaims() takes it (`options.jwks`). */
export type Jwks = NonNullable<ClaimsOptions["jwks"]>;

const BUNDLED: Jwks = { keys: Array.isArray((bundled as { keys?: unknown }).keys) ? (bundled as Jwks).keys : [] };

/** The key set bundled at build time; `{ keys: [] }` when the build had no SUPABASE_URL. */
export function bundledJwks(): Jwks {
  return BUNDLED;
}

/**
 * auth.getClaims() for the session's own token, verified against `jwks` (the bundled set unless given) before the
 * library's cache or network. The library falls back to its own cache and fetch for a `kid` the set lacks.
 */
export function getClaimsWithKeys(auth: Pick<SupabaseClient["auth"], "getClaims">, jwks: Jwks = bundledJwks()): ReturnType<GetClaims> {
  return auth.getClaims(undefined, { jwks });
}
