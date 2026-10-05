"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearHome, saveHomeAddress, type HomeRow } from "@/lib/home-store";
import { DEFAULT_WITHIN, exploreNearHref } from "@/lib/home";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The Home section on /account (specs/product/home-and-distance.md): one address (or a ZIP code), looked up with
 * the Census geocoder by `saveHomeAddress` and saved as the match. Shows the saved match back, with a link to
 * Explore's nearest-first view, "Change", and "Remove".
 */
export function HomeForm({ home }: { home: HomeRow | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(home === null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveHomeAddress(text);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.message });
        return;
      }
      setMessage({ kind: "ok", text: `Saved as ${result.home.label}.` });
      setText("");
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await clearHome();
      if (!result.ok) {
        setMessage({ kind: "error", text: "We couldn't remove it. Try again in a moment." });
        return;
      }
      setEditing(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {home && !editing && (
        <div className="rounded-2xl border bg-background p-3.5">
          <p className="text-sm font-semibold">{home.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Distances on Explore and on lists count from here.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {home.zip && (
              <Link href={exploreNearHref(home.zip)} className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
                Colleges within {DEFAULT_WITHIN} miles
              </Link>
            )}
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
              Change
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {editing && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="block text-sm font-semibold" htmlFor="home-address">
            Street address, city, state, and ZIP
          </label>
          <input
            id="home-address"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            autoComplete="street-address"
            placeholder="123 Main St, Springfield, IL 62701 — or just 62701"
            className={inputCls}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending || !text.trim()}
              className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Looking it up…" : "Save home"}
            </button>
            {home && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setMessage(null);
                }}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {message && (
        <p className={message.kind === "error" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-muted-foreground"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        We look the address up with the U.S. Census Bureau&apos;s public geocoder and keep the matched address and its map location (to about
        100 m), not what you typed. Only you can see it: the other people in your household see distances from their own homes.
      </p>
    </div>
  );
}
