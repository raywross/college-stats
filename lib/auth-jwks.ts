/**
 * The project's public signing keys, bundled at build time and refreshed per instance (specs/product/accounts.md
 * "Checking the session without fetching the keys").
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
 *
 * Round 5: the set an instance verifies against is `instanceJwks()`, the bundled one until the instance's hourly
 * refresh (lib/jwks-refresh.ts) replaces it with the live set, after a response (lib/auth-jwks-after.ts
 * scheduleJwksRefresh, called by the session checks in lib/auth.ts and proxy.ts). So a key revoked since the build
 * stops being accepted within the hour without a deploy, and a key rotated in arrives without the library's fetch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import bundled from "../.data/auth/jwks.json" with { type: "json" };
import { downloadJwks } from "./jwks-public.ts";
import { createJwksHolder } from "./jwks-refresh.ts";

type GetClaims = SupabaseClient["auth"]["getClaims"];
type ClaimsOptions = NonNullable<Parameters<GetClaims>[1]>;
/** A JSON Web Key Set as getClaims() takes it (`options.jwks`). */
export type Jwks = NonNullable<ClaimsOptions["jwks"]>;

const BUNDLED: Jwks = { keys: Array.isArray((bundled as { keys?: unknown }).keys) ? (bundled as Jwks).keys : [] };

/** The key set bundled at build time; `{ keys: [] }` when the build had no SUPABASE_URL. */
export function bundledJwks(): Jwks {
  return BUNDLED;
}

/** How long the refresh waits for the key set before giving up (it runs after the response; this bounds the instance). */
const REFRESH_TIMEOUT_MS = 5_000;

/** This instance's key set: the bundled one, replaced by the live one at most once an hour. */
const holder = createJwksHolder<Jwks>({
  initial: BUNDLED,
  load: async () => {
    const url = process.env.SUPABASE_URL?.trim();
    if (!url) throw new Error("no SUPABASE_URL");
    return (await downloadJwks(url, fetch, REFRESH_TIMEOUT_MS)) as unknown as Jwks;
  },
});

/** The key set this instance verifies against now (the bundled one until the first refresh lands). */
export function instanceJwks(): Jwks {
  return holder.current();
}

/**
 * Whether this caller should run the refresh now (true at most once an hour per instance, and only with
 * SUPABASE_URL set); the caller then runs `refreshInstanceJwks()` after its response.
 */
export function claimJwksRefresh(): boolean {
  return !!process.env.SUPABASE_URL?.trim() && holder.claim();
}

/** Downloads the live key set and makes it this instance's; never throws (false when it failed). */
export function refreshInstanceJwks(): Promise<boolean> {
  return holder.refresh();
}

/**
 * auth.getClaims() for the session's own token, verified against `jwks` (the instance's set unless given) before the
 * library's cache or network. The library falls back to its own cache and fetch for a `kid` the set lacks.
 */
export function getClaimsWithKeys(auth: Pick<SupabaseClient["auth"], "getClaims">, jwks: Jwks = instanceJwks()): ReturnType<GetClaims> {
  return auth.getClaims(undefined, { jwks });
}
