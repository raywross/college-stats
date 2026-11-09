/**
 * Writes the Supabase project's public signing keys into `.data/auth/jwks.json`, which lib/auth-jwks.ts imports so
 * the session check verifies a token without fetching the keys over the network on a fresh instance
 * (specs/product/accounts.md "Checking the session without fetching the keys").
 *
 *   npm run fetch-jwks                 the prebuild: GET <SUPABASE_URL>/auth/v1/.well-known/jwks.json when SUPABASE_URL
 *                                      is set, else the empty set `{ "keys": [] }`
 *   npm run fetch-jwks -- --ensure     the postinstall: nothing when the file exists, else the same as above, so a
 *                                      fresh clone typechecks and builds
 *
 * Only public keys are kept (no private `d` member, never a symmetric `oct` key). A failed download never fails the
 * build: the file already there is kept, or the empty set written, and the library fetches the keys at run time as it
 * did before this file existed. Public URL, no key.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
/** Where lib/auth-jwks.ts imports the keys from. */
export const JWKS_FILE = join(ROOT, ".data", "auth", "jwks.json");

export type PublicJwk = { kty: string; kid: string; key_ops?: string[]; [member: string]: unknown };
export type JwkSet = { keys: PublicJwk[] };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The project's key set URL: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. */
export const jwksUrl = (supabaseUrl: string) => `${supabaseUrl.trim().replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json`;

/** The public, asymmetric keys with a `kid` from a key set as served; anything else is dropped. */
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

/** Downloads the key set; throws on a failed request or a body that isn't a key set. */
export async function downloadJwks(supabaseUrl: string, fetcher: Fetch = fetch): Promise<JwkSet> {
  const url = jwksUrl(supabaseUrl);
  const res = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  return publicKeys(await res.json());
}

function write(file: string, set: JwkSet) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(set, null, 2)}\n`);
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  options: { file?: string; fetch?: Fetch; cwd?: string } = {},
): Promise<number> {
  const file = options.file ?? JWKS_FILE;
  const where = relative(options.cwd ?? process.cwd(), file);
  if (argv.includes("--ensure") && existsSync(file)) {
    console.log(`[fetch-jwks] ${where} already holds ${(JSON.parse(readFileSync(file, "utf8")) as JwkSet).keys.length} key(s)`);
    return 0;
  }
  const url = env.SUPABASE_URL?.trim();
  if (!url) {
    write(file, { keys: [] });
    console.log(`[fetch-jwks] no SUPABASE_URL: wrote the empty key set to ${where} (the session check fetches the keys at run time)`);
    return 0;
  }
  try {
    const set = await downloadJwks(url, options.fetch);
    write(file, set);
    console.log(`[fetch-jwks] wrote ${set.keys.length} key(s) (${set.keys.map((k) => k.kid).join(", ")}) to ${where}`);
  } catch (err) {
    // Never fail a build over this: without the file's keys the library fetches them at run time, as before.
    if (!existsSync(file)) write(file, { keys: [] });
    console.warn(`[fetch-jwks] warning: ${(err as Error).message}; kept ${where} as it was (or wrote the empty set), so the session check fetches the keys at run time`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
