import "server-only";
/**
 * A person's Data API keys (specs/product/data-api.md "Who may call, and how"; supabase/migrations/
 * 20261020130000_api_keys.sql): list, make, and revoke, all through the signed-in user's own session, so row-level
 * security, the column grants (no key_hash readable), the five-key trigger, and the revoke-only trigger decide. The
 * app makes the key (lib/api/keys.ts) and stores only its hash and display prefix; the key itself is returned once,
 * from createMyApiKey, and never again.
 *
 * Reads go through the view api_keys_public (the key columns without key_hash, plus today's request count). Before the
 * migration is applied, listMyApiKeys throws ApiKeysSetupError (its message is the page's notice) and the writes
 * answer `{ ok: false, message }` with the same words. Server only; /account/api-keys calls these from its page and
 * Server Actions.
 */
import { randomUUID } from "node:crypto";
import { authConfigured, getAccount } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase-server";
import { API_KEY_LIMITS, apiKeyPrefix, generateApiKey, hashApiKey, normalizeKeyName } from "@/lib/api/keys";

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  tier: string;
  created: string;
  last_used_at: string | null;
  revoked_at: string | null;
  used_today: number;
}

export const API_KEYS_NOT_SET_UP = "API keys aren't set up on this site yet. Check back soon.";

/** Supabase answers but the api_keys tables aren't there (the migration isn't applied yet). */
export class ApiKeysSetupError extends Error {
  constructor(detail: string) {
    super(API_KEYS_NOT_SET_UP);
    this.name = "ApiKeysSetupError";
    this.cause = detail;
  }
}

const KEY_COLUMNS = "id, name, key_prefix, tier, created, last_used_at, revoked_at, used_today";

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** Active keys first (newest first), then revoked ones (most recently revoked first). */
export function sortApiKeys(rows: ApiKeyRow[]): ApiKeyRow[] {
  return [...rows].sort((a, b) => {
    if ((a.revoked_at === null) !== (b.revoked_at === null)) return a.revoked_at === null ? -1 : 1;
    if (a.revoked_at && b.revoked_at) return b.revoked_at.localeCompare(a.revoked_at);
    return b.created.localeCompare(a.created);
  });
}

/** Turns a row as read (used_today may arrive as a string from a bigint) into an ApiKeyRow. */
function toRow(r: Record<string, unknown>): ApiKeyRow {
  return {
    id: String(r.id),
    name: String(r.name),
    key_prefix: String(r.key_prefix),
    tier: String(r.tier),
    created: String(r.created),
    last_used_at: (r.last_used_at as string | null) ?? null,
    revoked_at: (r.revoked_at as string | null) ?? null,
    used_today: Number(r.used_today ?? 0),
  };
}

/** The signed-in, unpaused account's id, or null. */
async function signedInId(): Promise<string | null> {
  if (!authConfigured()) return null;
  return (await getAccount())?.user.id ?? null;
}

/** Every key the signed-in person has made, active and revoked (revoked last), with today's request count. [] when signed out. */
export async function listMyApiKeys(): Promise<ApiKeyRow[]> {
  if (!(await signedInId())) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("api_keys_public").select(KEY_COLUMNS);
  if (error) {
    if (isMissingTable(error)) throw new ApiKeysSetupError(error.message);
    throw new Error(`Reading your API keys failed: ${error.message}`);
  }
  return sortApiKeys((data as Record<string, unknown>[]).map(toRow));
}

/**
 * Makes a key named `name` (1–60 characters after trimming) for the signed-in person: generates it, inserts its hash
 * and prefix with their session, and returns the key once with its row. Refuses a sixth active key (also refused by
 * the database's trigger, which a race between two requests would meet).
 */
export async function createMyApiKey(name: string): Promise<{ ok: true; key: string; row: ApiKeyRow } | { ok: false; message: string }> {
  const checked = normalizeKeyName(name);
  if (!checked.ok) return checked;
  const userId = await signedInId();
  if (!userId) return { ok: false, message: "Sign in to make an API key." };

  let existing: ApiKeyRow[];
  try {
    existing = await listMyApiKeys();
  } catch (err) {
    return { ok: false, message: err instanceof ApiKeysSetupError ? err.message : "We couldn't read your keys. Try again in a moment." };
  }
  const limitMessage = `You have ${API_KEY_LIMITS.keysPerUser} active keys, the most an account can have. Revoke one to make another.`;
  if (existing.filter((k) => k.revoked_at === null).length >= API_KEY_LIMITS.keysPerUser) return { ok: false, message: limitMessage };

  const key = generateApiKey();
  const id = randomUUID();
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("api_keys").insert({ id, user_id: userId, name: checked.name, key_prefix: apiKeyPrefix(key), key_hash: hashApiKey(key) });
  if (error) {
    if (/api_key_limit/.test(error.message)) return { ok: false, message: limitMessage };
    if (isMissingTable(error)) return { ok: false, message: API_KEYS_NOT_SET_UP };
    console.error(`api keys: creating a key failed: ${error.message}`);
    return { ok: false, message: "We couldn't make the key. Try again in a moment." };
  }
  const read = await supabase.from("api_keys_public").select(KEY_COLUMNS).eq("id", id).maybeSingle();
  const row: ApiKeyRow = read.data
    ? toRow(read.data as Record<string, unknown>)
    : { id, name: checked.name, key_prefix: apiKeyPrefix(key), tier: "account", created: new Date().toISOString(), last_used_at: null, revoked_at: null, used_today: 0 };
  return { ok: true, key, row };
}

/** Revokes one of the signed-in person's keys, at once and for good. */
export async function revokeMyApiKey(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, message: "That key wasn't found." };
  if (!(await signedInId())) return { ok: false, message: "Sign in to manage your API keys." };
  const supabase = await createServerSupabase();
  const { error, count } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }, { count: "exact" }).eq("id", id).is("revoked_at", null);
  if (error) {
    if (isMissingTable(error)) return { ok: false, message: API_KEYS_NOT_SET_UP };
    console.error(`api keys: revoking a key failed: ${error.message}`);
    return { ok: false, message: "We couldn't revoke the key. Try again in a moment." };
  }
  if (!count) return { ok: false, message: "That key wasn't found, or it's already revoked." };
  return { ok: true };
}
