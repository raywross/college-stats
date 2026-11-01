"use client";

/**
 * The version list (specs/product/essays/workspace.md "Versions"): every version with its source and count, newest
 * first; any one opens read-only, and the student can restore it (a new version, so nothing is overwritten
 * silently). A guardian sees the same list without Restore.
 */
import { useState, useTransition } from "react";
import { openVersion } from "@/lib/essays/store";
import type { VersionRow, VersionSource } from "@/lib/essays/rows";
import { countLabel, type CountKind } from "@/lib/essays/count";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<VersionSource, string> = { typed: "Typed", pasted: "Pasted", uploaded: "Uploaded", docs: "From Docs", restored: "Restored", suggested: "Accepted changes" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function VersionList({
  essayId,
  versions,
  kind,
  canWrite,
  onRestore,
}: {
  essayId: string;
  versions: VersionRow[];
  kind: CountKind;
  canWrite: boolean;
  onRestore: (versionId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setText(null);
      return;
    }
    setOpenId(id);
    setText(null);
    setError(null);
    start(async () => {
      const r = await openVersion(essayId, id);
      if (r.ok) setText(r.body);
      else setError(r.message);
    });
  };

  if (versions.length === 0) return <p className="text-sm text-muted-foreground">No versions yet. One is kept every ten minutes you write, and whenever you mark one.</p>;

  return (
    <ul className="divide-y rounded-2xl border">
      {versions.map((v) => (
        <li key={v.id} className="px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => toggle(v.id)} className="min-h-11 min-w-0 flex-1 text-left text-sm" aria-expanded={openId === v.id}>
              <span className="font-semibold">{when(v.created)}</span>
              <span className="text-muted-foreground">
                {" · "}
                {v.label ? `${v.label} · ` : ""}
                {SOURCE_LABEL[v.source]} · {countLabel(v.count, null, kind)}
              </span>
            </button>
            {canWrite && (
              <button type="button" onClick={() => onRestore(v.id)} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ring-1 ring-border hover:bg-muted">
                Restore
              </button>
            )}
          </div>
          {openId === v.id && (
            <div className={cn("mt-2 rounded-xl bg-muted/50 p-3 text-sm whitespace-pre-wrap", pending && "opacity-60")}>
              {error ?? text ?? "Opening…"}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default VersionList;
