"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import type { RowControlProps } from "@/components/planner/row/props";
import { PLATFORM_LABELS } from "@/lib/planner/requirements";
import { markApplied, setPlatform, setPortalUrl, unmarkApplied } from "@/lib/planner/store-apply";

/**
 * A list row's stage-5 controls inside ListBoard's "More" (specs/planner/applications.md "Display": "the status
 * picker already there gains the Applied date and the portal button"): the Applied date, the platform chip, and a
 * button that opens the saved portal link (or a small field to paste one). Rendered by RowControls in the order
 * list → rounds → actions → apply → offers.
 */
export default function ApplyRowControls({ item, canEdit }: RowControlProps) {
  const [applied, setAppliedLocal] = useState(item.applied_on ?? null);
  const [platform, setPlatformLocal] = useState(item.application_platform ?? "");
  const [portalUrl, setPortalLocal] = useState(item.portal_url ?? "");
  const [editingPortal, setEditingPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (item.status === "considering") return null;

  const toggleApplied = () => {
    const next = applied === null;
    const before = applied;
    setAppliedLocal(next ? new Date().toISOString().slice(0, 10) : null);
    setError(null);
    startTransition(async () => {
      const result = next ? await markApplied(item.id) : await unmarkApplied(item.id);
      if (!result.ok) {
        setAppliedLocal(before);
        setError(result.message);
      }
    });
  };

  const changePlatform = (value: string) => {
    const before = platform;
    setPlatformLocal(value);
    startTransition(async () => {
      const result = await setPlatform(item.id, (value || null) as typeof item.application_platform);
      if (!result.ok) setPlatformLocal(before);
    });
  };

  const savePortal = () => {
    setError(null);
    startTransition(async () => {
      const result = await setPortalUrl(item.id, portalUrl.trim() || null);
      if (result.ok) setEditingPortal(false);
      else setError(result.message);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-planner-row-apply>
      <label className="inline-flex items-center gap-1.5 font-medium">
        <input type="checkbox" checked={applied !== null} disabled={!canEdit || pending} onChange={toggleApplied} className="size-3.5 accent-primary" />
        {applied !== null ? `Applied ${applied}` : "Applied"}
      </label>

      <select
        value={platform}
        disabled={!canEdit || pending}
        onChange={(e) => changePlatform(e.target.value)}
        className="h-9 rounded-full border bg-background px-2.5 text-xs font-semibold disabled:opacity-70"
        aria-label="Application platform"
      >
        <option value="">Platform</option>
        {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {editingPortal ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            type="url"
            value={portalUrl}
            onChange={(e) => setPortalLocal(e.target.value)}
            placeholder="https://portal.college.edu"
            className="h-9 w-48 rounded-full border bg-background px-2.5 text-xs"
          />
          <button type="button" disabled={pending} onClick={savePortal} className="h-9 rounded-full border px-2.5 font-semibold hover:bg-muted">
            Save
          </button>
        </span>
      ) : item.portal_url ? (
        <a href={item.portal_url} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-1 rounded-full border px-2.5 font-semibold hover:bg-muted">
          Portal <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : (
        canEdit && (
          <button type="button" onClick={() => setEditingPortal(true)} className="h-9 rounded-full border px-2.5 font-semibold hover:bg-muted">
            Add portal link
          </button>
        )
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
