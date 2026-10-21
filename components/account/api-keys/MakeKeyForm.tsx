"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { createKey, type CreateKeyState } from "@/app/account/api-keys/actions";
import { ConnectionSnippets } from "@/components/api/ConnectionSnippets";
import { CopyButton } from "@/components/api/CopyButton";
import { API_KEY_LIMITS, API_KEY_NAME_MAX } from "@/lib/api/keys";
import { TERMS_LINE } from "@/lib/api-terms";
import { canMakeKey } from "@/lib/api-snippets";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * "Make a key": a name, the terms line, and Create. The new key is shown once, in a monospace box with Copy, then the
 * three connection snippets with the real key in them. Leaving the result ("I've saved it") drops the key from the page
 * for good; the server never shows it again.
 */
export function MakeKeyForm({ origin, activeKeys }: { origin: string; activeKeys: number }) {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createKey, { status: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (state.status === "created" && dismissed !== state.key) {
    return (
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold">
            Your new key, “{state.name}”
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              data-testid="new-key"
              className="min-w-0 flex-1 rounded-xl border bg-muted/50 px-3.5 py-2.5 font-mono text-sm break-all select-all"
            >
              {state.key}
            </code>
            <CopyButton text={state.key} label="Copy key" className="self-start sm:self-auto" />
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-2xl border border-pop bg-pop/15 px-3.5 py-3 text-sm" role="status">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Copy it now. This is the only time it&apos;s shown: we keep a fingerprint, not the key. If you lose it, revoke it and make another.
            </span>
          </p>
        </div>
        <div>
          <h3 className="font-display text-lg font-bold">Connect</h3>
          <p className="mb-3 text-sm text-muted-foreground">These already have your key in them.</p>
          <ConnectionSnippets origin={origin} apiKey={state.key} />
        </div>
        <button
          type="button"
          onClick={() => setDismissed(state.key)}
          className="inline-flex h-10 items-center justify-center rounded-full border px-5 text-sm font-semibold hover:bg-muted"
        >
          I&apos;ve saved it
        </button>
      </div>
    );
  }

  if (!canMakeKey(activeKeys)) {
    return (
      <p className="rounded-xl bg-muted/60 px-3.5 py-3 text-sm text-muted-foreground">
        You have {API_KEY_LIMITS.keysPerUser} active keys, the most an account can have. Revoke one above to make another.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="block text-sm font-semibold" htmlFor="key-name">
          Name
        </label>
        <input
          id="key-name"
          name="name"
          required
          maxLength={API_KEY_NAME_MAX}
          autoComplete="off"
          placeholder="My notebook"
          className={`${inputCls} mt-1.5`}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">So you can tell your keys apart. Up to {API_KEY_NAME_MAX} characters.</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {TERMS_LINE}{" "}
        <Link href="/developers#terms" className="font-semibold text-primary hover:underline">
          Read the terms
        </Link>
      </p>
      {state.status === "error" && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Making…" : "Create key"}
      </button>
    </form>
  );
}
