"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Trash2 } from "lucide-react";
import { revokeLetter, shareLetter } from "@/lib/planner/store-offers";
import { cn } from "@/lib/utils";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60 sm:min-h-10";

/**
 * The one question after saving an offer or a decision (specs/planner/offers.md "Letters", step 2): would the family
 * share the letter itself, so a reader that fills the form from a photo can be built and checked? Yes uploads a PDF
 * or a photo through a Server Action with the user's own session to the private bucket, under the uploader's folder;
 * no closes it. Says plainly that a person at Quad will read it, names covered, and that it's never shown to anyone
 * else or used for anything else. Revocable from the offer (`LetterList`).
 */
export function ShareLetter({ itemId, kind, collegeName, onDone }: { itemId: string; kind: "admission" | "aid"; collegeName: string; onDone?: () => void }) {
  const [state, setState] = useState<"ask" | "pick" | "done" | "declined">("ask");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);

  if (state === "declined") return null;
  if (state === "done") {
    return (
      <p role="status" className="rounded-2xl border bg-muted/40 p-3 text-sm">
        Thank you. The letter is shared; you can take it back from {collegeName}&apos;s offer any time.
      </p>
    );
  }

  const submit = (data: FormData) =>
    startTransition(async () => {
      setMessage(null);
      data.set("itemId", itemId);
      data.set("kind", kind);
      const r = await shareLetter(data);
      if (!r.ok) return setMessage(r.message);
      setState("done");
      router.refresh();
      onDone?.();
    });

  return (
    <div className="space-y-3 rounded-2xl border bg-muted/30 p-3 sm:p-4">
      <p className="text-sm font-semibold">Would you share the {kind === "aid" ? "award" : "admission"} letter itself?</p>
      <p className="text-sm text-muted-foreground">
        It helps us build a reader that fills this form from a photo. A person at Quad will read it, with names covered, to check the reader&apos;s work. It&apos;s
        never shown to anyone else and never used for anything but that; you can take it back from the offer.
      </p>
      {state === "ask" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(button, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")} onClick={() => setState("pick")}>
            Yes, share it
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setState("declined");
              onDone?.();
            }}
          >
            No thanks
          </button>
        </div>
      ) : (
        <form ref={form} action={submit} className="space-y-2">
          <label className="block text-sm font-semibold">
            The letter (a PDF or a photo, up to 4 MB)
            <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp" required className="mt-1 block w-full text-sm file:mr-3 file:min-h-10 file:rounded-full file:border file:bg-background file:px-4 file:font-semibold" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={cn(button, "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}>
              <FileUp className="size-4" aria-hidden /> {pending ? "Sharing…" : "Share the letter"}
            </button>
            <button type="button" className={button} onClick={() => setState("declined")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

export interface SharedLetter {
  id: string;
  kind: "admission" | "aid" | "other";
  created_at: string;
  /** The viewer shared it (only they can take it back: the file is in their folder). */
  mine: boolean;
}

/** The letters shared for a college, each with "Take it back" for whoever shared it. */
export function LetterList({ letters }: { letters: SharedLetter[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  if (!letters.length) return null;
  return (
    <div className="space-y-1">
      <ul className="space-y-1 text-sm">
        {letters.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2">
            <span>
              {l.kind === "aid" ? "Award letter" : l.kind === "admission" ? "Admission letter" : "Letter"} shared {l.created_at.slice(0, 10)}
              {l.mine ? "" : " by someone in your household"}
            </span>
            {l.mine && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setMessage(null);
                    const r = await revokeLetter(l.id);
                    if (!r.ok) return setMessage(r.message);
                    router.refresh();
                  })
                }
                className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-9"
              >
                <Trash2 className="size-3.5" aria-hidden /> Take it back
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
