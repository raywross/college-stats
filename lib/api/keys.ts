/**
 * Data API keys (specs/product/data-api.md "Who may call, and how"): the key format, how a key is made, hashed, and
 * shown, the bearer header, and the limits every page and check reads. A key is "quad_" + 40 lowercase base-32
 * characters (200 bits from crypto.randomBytes); only its SHA-256 hash is stored (api_keys.key_hash,
 * supabase/migrations/20261020130000_api_keys.sql), with "quad_" + 8 characters kept for display.
 *
 * Pure module (node:crypto only, no Next imports), so tests and scripts load it directly.
 */
import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "quad_";

/**
 * One tier for now ("account"): requests a day per key (counted by api_key_use() in the database, which holds the same
 * 5,000), requests a minute per key (the in-memory burst guard in lib/api/auth.ts), and active keys per person (the
 * api_keys_limit trigger holds the same 5). tests/api-keys-policies.test.mts compares these with the migration.
 */
export const API_KEY_LIMITS = { perDay: 5000, perMinute: 60, keysPerUser: 5 } as const;

/** Characters after the prefix: 40 base-32 characters carry exactly 200 bits (25 random bytes). */
export const API_KEY_BODY_LENGTH = 40;

/** Characters after the prefix kept for display (api_keys.key_prefix). */
export const API_KEY_DISPLAY_LENGTH = 8;

/** RFC 4648 base-32, lowercased: a–z and 2–7, nothing a reader confuses with 0, 1, or 8. */
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

const KEY_SHAPE = new RegExp(`^${API_KEY_PREFIX}[a-z2-7]{${API_KEY_BODY_LENGTH}}$`);

/** Lowercase base-32 of `bytes`, without padding. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/** A new key: "quad_" + 40 characters of lowercase base 32 (200 bits). Shown once; store only `hashApiKey(key)`. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + base32(randomBytes((API_KEY_BODY_LENGTH * 5) / 8));
}

/** Whether `value` has a key's shape (says nothing about whether the key exists). */
export function isApiKey(value: string): boolean {
  return KEY_SHAPE.test(value);
}

/** SHA-256 of the whole key, as lowercase hex: what api_keys.key_hash stores and api_key_use() looks up. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** "quad_" + the first 8 characters after it ("quad_ab3k9x2m"), for showing a key without revealing it. */
export function apiKeyPrefix(key: string): string {
  const body = key.startsWith(API_KEY_PREFIX) ? key.slice(API_KEY_PREFIX.length) : key;
  return API_KEY_PREFIX + body.slice(0, API_KEY_DISPLAY_LENGTH);
}

/** The token of an `Authorization: Bearer <token>` header (scheme in any case), else null. */
export function bearerToken(authorization: string | null): string | null {
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  return match ? match[1] : null;
}

/** Longest key name (api_keys.name's check holds the same 1–60 after trimming). */
export const API_KEY_NAME_MAX = 60;

/** A key's name, trimmed, with inner runs of whitespace made single spaces; refused when empty or over 60 characters. */
export function normalizeKeyName(name: string): { ok: true; name: string } | { ok: false; message: string } {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (clean.length === 0) return { ok: false, message: "Give the key a name, such as “My notebook”." };
  if (clean.length > API_KEY_NAME_MAX) return { ok: false, message: `Keep the name to ${API_KEY_NAME_MAX} characters.` };
  return { ok: true, name: clean };
}
