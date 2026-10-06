"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearHome, saveHomeAddress, type HomeRow } from "@/lib/home-store";
import { DEFAULT_WITHIN, exploreNearHref } from "@/lib/home";
import { shortDate } from "@/lib/household-rules";
import { AddressField } from "./AddressField";

const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The household's home, inside its card on /account/household (specs/product/home-and-distance.md): one address
 * (or a ZIP code), looked up with the Census geocoder by `saveHomeAddress` and saved as the match for everyone in
 * the household. Shows the saved match back with who set it, a link to Explore's nearest-first view, "Change", and
 * "Remove".
 */
export function HomeForm({ household, home, suggestions = false }: { household: string; home: HomeRow | null; suggestions?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(home === null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveHomeAddress(household, text);
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
      const result = await clearHome(household);
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
          <p className="mt-0.5 text-xs text-muted-foreground">
            Set by {home.set_by_name?.trim() || "someone in this household"} on {shortDate(home.updated_at)}.
          </p>
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
          <label className="block text-sm font-semibold" htmlFor={`home-address-${household}`}>
            Street address, city, state, and ZIP
          </label>
          <AddressField
            id={`home-address-${household}`}
            value={text}
            onChange={setText}
            enabled={suggestions}
            placeholder={suggestions ? "Start typing: 123 Main St, Springfield… or just a ZIP code" : "123 Main St, Springfield, IL 62701 — or just 62701"}
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
        Anyone in the household can set or change it. {suggestions ? "Suggestions as you type come from Google; the address you save" : "The address you save"}{" "}
        is matched with the U.S. Census Bureau&apos;s public geocoder, and we keep that match and its map location (to about 100 m), not what you
        typed. Nobody outside the household can see it.
      </p>
    </div>
  );
}
