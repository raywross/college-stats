"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { PLATFORM_LABELS } from "@/lib/planner/requirements";
import { markComplete, markWithdrawn, setCounts, setPlatform, setPortalUrl, setTranscriptShared } from "@/lib/planner/store-apply";
import type { PlanItem } from "@/lib/planner/types";

/**
 * The rest of an Apply-stage card's controls (specs/planner/applications.md "Display"): platform, the portal link
 * and its <Term term="application-portal">portal</Term> button, the recommendation/supplement counts, whether this
 * college's transcript request is shared, "the portal shows everything" (complete), and withdraw. Status and
 * outcome are `ApplyStatusControl`'s job. Each field saves itself on change or blur; no save-all button.
 */
export function ApplyCardControls({ item, canEdit }: { item: PlanItem; canEdit: boolean }) {
  const [platform, setPlatformLocal] = useState(item.application_platform ?? "");
  const [portalUrl, setPortalLocal] = useState(item.portal_url ?? "");
  const [portalError, setPortalError] = useState<string | null>(null);
  const [recs, setRecs] = useState(item.recommendations_count ?? 0);
  const [supps, setSupps] = useState(item.supplements_count ?? 0);
  const [complete, setCompleteLocal] = useState(item.complete_on !== null);
  const [withdrawn, setWithdrawnLocal] = useState(item.withdrawn_on !== null);
  const [ownTranscript, setOwnTranscript] = useState(item.transcript_shared === false);
  const [, startTransition] = useTransition();

  const disabled = !canEdit;

  return (
    <div className="flex flex-wrap items-end gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="font-semibold text-muted-foreground">Platform</span>
        <select
          value={platform}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value as typeof item.application_platform;
            setPlatformLocal(e.target.value);
            startTransition(async () => void (await setPlatform(item.id, value || null)));
          }}
          className="h-9 rounded-full border bg-background px-2.5 font-semibold disabled:opacity-70"
        >
          <option value="">Not set</option>
          {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-muted-foreground">Recommendations</span>
        <input
          type="number"
          min={0}
          max={20}
          value={recs}
          disabled={disabled}
          onChange={(e) => setRecs(Number(e.target.value))}
          onBlur={() => startTransition(async () => void (await setCounts(item.id, { recommendations: recs })))}
          className="h-9 w-16 rounded-full border bg-background px-2.5"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-muted-foreground">Supplements</span>
        <input
          type="number"
          min={0}
          max={20}
          value={supps}
          disabled={disabled}
          onChange={(e) => setSupps(Number(e.target.value))}
          onBlur={() => startTransition(async () => void (await setCounts(item.id, { supplements: supps })))}
          className="h-9 w-16 rounded-full border bg-background px-2.5"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-semibold text-muted-foreground">
          <Term term="application-portal">Portal link</Term>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <input
            type="url"
            value={portalUrl}
            disabled={disabled}
            placeholder="https://portal.college.edu"
            onChange={(e) => setPortalLocal(e.target.value)}
            onBlur={() =>
              startTransition(async () => {
                const result = await setPortalUrl(item.id, portalUrl.trim() || null);
                setPortalError(result.ok ? null : result.message);
              })
            }
            className="h-9 w-44 rounded-full border bg-background px-2.5"
          />
          {item.portal_url && (
            <a href={item.portal_url} target="_blank" rel="noopener" className="inline-flex size-9 items-center justify-center rounded-full border hover:bg-muted" aria-label="Open the portal">
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </span>
        {portalError && <span className="text-destructive">{portalError}</span>}
      </label>

      <label className="inline-flex items-center gap-1.5 self-center font-medium">
        <input
          type="checkbox"
          checked={ownTranscript}
          disabled={disabled}
          onChange={(e) => {
            setOwnTranscript(e.target.checked);
            startTransition(async () => void (await setTranscriptShared(item.id, !e.target.checked)));
          }}
          className="size-3.5 accent-primary"
        />
        {ownTranscript ? "Transcript: requested separately for this college" : "Transcript: shared with the rest of the list"}
      </label>

      {item.applied_on && (
        <label className="inline-flex items-center gap-1.5 self-center font-medium">
          <input
            type="checkbox"
            checked={complete}
            disabled={disabled}
            onChange={(e) => {
              const checked = e.target.checked;
              setCompleteLocal(checked);
              startTransition(async () => void (await (checked ? markComplete(item.id) : markComplete(item.id, null))));
            }}
            className="size-3.5 accent-primary"
          />
          The portal shows everything received
        </label>
      )}

      <label className="inline-flex items-center gap-1.5 self-center font-medium text-destructive">
        <input
          type="checkbox"
          checked={withdrawn}
          disabled={disabled}
          onChange={(e) => {
            setWithdrawnLocal(e.target.checked);
            startTransition(async () => void (await markWithdrawn(item.id, e.target.checked)));
          }}
          className="size-3.5 accent-destructive"
        />
        Withdrawn
      </label>
    </div>
  );
}
