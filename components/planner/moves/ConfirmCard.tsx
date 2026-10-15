"use client";

/**
 * "Confirm {College} has everything" (specs/planner/next-steps/applying.md "The moves"; kind `confirm_complete`,
 * generators/apply.ts): the portal link (set here, same field the Colleges tab reads), and "It's complete"
 * (markComplete). The move disappears once complete_on is set: the generator stops emitting it and the regeneration
 * that follows orphans it, so no explicit tick is needed here.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Term } from "@/components/ui/info-tip";
import { markComplete, setPortalUrl } from "@/lib/planner/store-apply";
import type { MoveCardProps } from "./types";

export function ConfirmCard({ task, ctx, onSkip, pending: skipPending }: MoveCardProps) {
  const item = ctx.items.find((i) => i.id === task.item_id) ?? null;
  const school = item ? ctx.schools[item.unit_id] : null;
  const [portalUrl, setPortalLocal] = useState(item?.portal_url ?? "");
  const [portalError, setPortalError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!item || !school) return null;
  const canEdit = ctx.viewer.canEdit;

  const savePortal = () =>
    startTransition(async () => {
      const r = await setPortalUrl(item.id, portalUrl.trim() || null);
      setPortalError(r.ok ? null : r.message);
    });

  const complete_ = () =>
    startTransition(async () => {
      setComplete(true);
      const r = await markComplete(item.id);
      if (!r.ok) {
        setComplete(false);
        return;
      }
      router.refresh();
    });

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="font-semibold">Confirm {school.name} has everything</p>
      <p className="mt-1 text-sm text-muted-foreground">Colleges list missing pieces in the applicant portal, often weeks after the application.</p>
      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold text-muted-foreground">
          <Term term="application-portal">Portal link</Term>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <input
            type="url"
            value={portalUrl}
            disabled={!canEdit}
            placeholder="https://portal.college.edu"
            onChange={(e) => setPortalLocal(e.target.value)}
            onBlur={savePortal}
            className="h-11 w-56 rounded-full border bg-background px-3 sm:h-9"
          />
          {item.portal_url && (
            <a href={item.portal_url} target="_blank" rel="noopener" className="inline-flex size-9 items-center justify-center rounded-full border hover:bg-muted" aria-label="Open the portal">
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </span>
        {portalError && <span className="text-xs text-destructive">{portalError}</span>}
      </label>
      {canEdit && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending || complete}
            onClick={complete_}
            className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-60"
          >
            It&apos;s complete
          </button>
          <button type="button" disabled={pending || skipPending} onClick={() => onSkip(task)} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-border">
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

export default ConfirmCard;
