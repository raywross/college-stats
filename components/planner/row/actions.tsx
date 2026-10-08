"use client";

import { useState, useTransition } from "react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { FollowRow } from "@/components/planner/FollowRow";
import { VisitForm } from "@/components/planner/VisitForm";
import { markInfoRequested } from "@/lib/planner/store-actions";
import type { RowControlProps } from "@/components/planner/row/props";
import type { SocialNetwork } from "@/lib/types";

/**
 * A list row's follow row and "Log a visit" (U4; specs/planner/actions.md "Display"): the tracking row's old
 * Visited and Following switches move here, so there is one place for them. Rendered by RowControls in the order
 * list → rounds → actions → apply → offers. Nothing for a read-only viewer (the row's facts and tracking chips
 * already say what's true; editing moves to the Plan tab's Actions stage, which still reads there for them).
 */
export default function ActionsRowControls({ item, school, canEdit, viewerIsGuardian }: RowControlProps) {
  const [logging, setLogging] = useState(false);
  if (!canEdit) return null;

  const social = school.social as Partial<Record<SocialNetwork, string>> | null | undefined;
  const hasAccounts = Boolean(social && Object.keys(social).length > 0);
  const canFollow = !viewerIsGuardian;

  return (
    <div className="space-y-2" data-planner-row-actions>
      {hasAccounts && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Follow</p>
          <FollowRow itemId={item.id} schoolName={school.name} social={social} followedNetworks={(item.followed_networks ?? []) as SocialNetwork[]} canFollow={canFollow} />
        </div>
      )}
      <button type="button" onClick={() => setLogging(true)} className="h-9 rounded-full border px-3 text-xs font-semibold hover:bg-muted">
        Log a visit
      </button>
      <SheetDialog open={logging} onOpenChange={setLogging} title={`Log a visit · ${school.name}`}>
        <VisitForm itemId={item.id} householdNames={[]} onDone={() => setLogging(false)} onCancel={() => setLogging(false)} />
      </SheetDialog>
    </div>
  );
}

/** "Request information" (actions.md "Request information"): opens the college's own page; marking done just records the date. */
export function InfoRequestButton({
  itemId,
  requestedOn,
  canEdit,
  admissionsUrl,
}: {
  itemId: string;
  requestedOn: string | null;
  canEdit: boolean;
  admissionsUrl: string | null;
}) {
  const [done, setDone] = useState(requestedOn !== null);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    if (!canEdit) return;
    const next = !done;
    setDone(next);
    startTransition(async () => {
      await markInfoRequested(itemId, next);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {admissionsUrl && (
        <a href={admissionsUrl} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-full border px-3 text-sm font-semibold hover:bg-muted">
          Request information
        </a>
      )}
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={done} disabled={!canEdit || pending} onChange={toggle} className="size-3.5 accent-primary" />
        {done ? `Requested${requestedOn ? ` ${requestedOn}` : ""}` : "Mark done"}
      </label>
    </div>
  );
}
