"use server";

import { revalidatePath } from "next/cache";
import { createMyApiKey, revokeMyApiKey } from "@/lib/api-keys-store";
import { normalizeKeyName } from "@/lib/api/keys";

export type CreateKeyState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** The key is in this state once, to show it; it is never stored or logged here. */
  | { status: "created"; key: string; name: string; prefix: string };

export type RevokeKeyState = { status: "idle" } | { status: "done" } | { status: "error"; message: string };

/**
 * Makes a key for the signed-in person (lib/api-keys-store.ts checks the session, the five-key limit, and stores only the
 * hash). The name is checked here first so the refusal is in plain words; the key comes back once, to the form.
 */
export async function createKey(_prev: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const name = normalizeKeyName(String(form.get("name") ?? ""));
  if (!name.ok) return { status: "error", message: name.message };
  const made = await createMyApiKey(name.name);
  if (!made.ok) return { status: "error", message: made.message };
  revalidatePath("/account/api-keys");
  return { status: "created", key: made.key, name: made.row.name, prefix: made.row.key_prefix };
}

/** Revokes one of the signed-in person's keys, at once and for good. */
export async function revokeKey(_prev: RevokeKeyState, form: FormData): Promise<RevokeKeyState> {
  const revoked = await revokeMyApiKey(String(form.get("id") ?? ""));
  if (!revoked.ok) return { status: "error", message: revoked.message };
  revalidatePath("/account/api-keys");
  return { status: "done" };
}
