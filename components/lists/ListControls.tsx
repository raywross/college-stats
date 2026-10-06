"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { createList, deleteList, importListCsv, renameList, setListShare, type CsvImportResult } from "@/lib/lists";
import { listOwner, type ListRecord } from "@/lib/list-rules";
import { cn } from "@/lib/utils";

const btn = "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted disabled:opacity-50";
const primaryBtn = "inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50";

/**
 * Switch between one person's lists, with a form to start another (no tier cap yet: specs/product/saved-lists.md)
 * when the viewer can edit them. `basePath` prefixes each list's link: `/me/lists` by default, or
 * `/household/<person>/lists` on a person's page.
 */
export function ListSwitcher({ lists, currentId, basePath = "/me/lists", canEdit = true }: { lists: ListRecord[]; currentId: string; basePath?: string; canEdit?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {lists.map((l) => (
        <Link
          key={l.id}
          href={`${basePath}/${l.id}`}
          className={cn("inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium", l.id === currentId ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
        >
          {l.name}
        </Link>
      ))}
      {!canEdit ? null : adding ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "");
            startTransition(async () => {
              // Every list here has the same owner (the page reads one person's lists).
              if (lists[0] && name.trim()) {
                const result = await createList(listOwner(lists[0]), name);
                if (result.ok) router.refresh();
              }
              setAdding(false);
            });
          }}
        >
          <input name="name" autoFocus maxLength={80} placeholder="List name" className="h-8 rounded-full border bg-background px-3 text-sm" />
          <button type="submit" disabled={pending} className="h-8 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground">
            Create
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="h-8 rounded-full border px-3 text-sm text-muted-foreground hover:text-foreground">
          + New list
        </button>
      )}
    </div>
  );
}

/**
 * Rename this list, and delete it if it isn't the default (the server refuses the default's deletion either way).
 * Just the name, as the page heading, for a viewer who can't edit it.
 */
export function ListMeta({ list, canEdit = true }: { list: ListRecord; canEdit?: boolean }) {
  const [name, setName] = useState(list.name);
  const [pending, startTransition] = useTransition();
  if (!canEdit) return <h2 className="font-display text-lg font-bold">{list.name}</h2>;
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
    });
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && name !== list.name) run(() => renameList(list.id, name));
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== list.name && run(() => renameList(list.id, name))}
        maxLength={80}
        className="h-9 rounded-xl border bg-background px-3 font-display text-lg font-bold"
        aria-label="List name"
      />
      {!list.is_default && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm(`Delete "${list.name}"? This removes it and its colleges from this list only.`)) run(() => deleteList(list.id));
          }}
          className="inline-flex size-9 items-center justify-center rounded-full border text-destructive"
          aria-label="Delete this list"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </form>
  );
}

/** Turns the read-only share link on or off (specs/product/saved-lists.md "Share"); the token shows once, to copy. */
export function ShareToggle({ list }: { list: ListRecord }) {
  const [enabled, setEnabled] = useState(list.share_enabled);
  const [token, setToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const link = token ? `${typeof window !== "undefined" ? window.location.origin : ""}/l/${token}` : null;

  return (
    <div className="rounded-2xl border bg-card p-4">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Share a read-only link</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            startTransition(async () => {
              const result = await setListShare(list.id, next);
              if (result.ok) {
                setEnabled(next);
                setToken(result.token);
              }
            });
          }}
          className="size-4 accent-primary"
        />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">No notes, statuses, or outcomes — just the colleges and their category. Turning it off (or back on) breaks any old link.</p>
      {link && (
        <div className="mt-2 flex items-center gap-2">
          <input readOnly value={link} className="h-8 flex-1 rounded-lg border bg-background px-2 text-xs" />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className="inline-flex h-8 items-center gap-1 rounded-full border px-2 text-xs"
          >
            <Copy className="size-3" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {enabled && !link && <p className="mt-2 text-xs text-muted-foreground">Sharing is on; turn it off and back on to get a fresh link to copy.</p>}
    </div>
  );
}

/** Download as CSV (Scoir-compatible columns) and paste-import a CSV from Scoir/Common App/a spreadsheet. */
export function CsvControls({ listId }: { listId: string }) {
  const [pasting, setPasting] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/me/lists/${listId}/export`} className={btn} download>
        Export CSV
      </a>
      <button type="button" onClick={() => setPasting((v) => !v)} className={btn}>
        Import CSV
      </button>
      {pasting && (
        <form
          className="w-full space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = String(new FormData(e.currentTarget).get("csv") ?? "");
            startTransition(async () => {
              const r = await importListCsv(listId, text);
              setResult(r);
              if (r.added > 0) window.location.reload();
            });
          }}
        >
          <textarea name="csv" rows={5} placeholder="Paste CSV text (College, Category, Round, Status, Outcome, Deadline, Enrolling, Notes)" className="w-full rounded-xl border bg-background p-2 text-xs" />
          <button type="submit" disabled={pending} className={primaryBtn}>
            {pending ? "Importing…" : "Add to list"}
          </button>
          {result && (
            <p className="text-xs text-muted-foreground">
              Added {result.added}. {result.unmatched.length > 0 && `Couldn't match: ${result.unmatched.join(", ")}.`}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
