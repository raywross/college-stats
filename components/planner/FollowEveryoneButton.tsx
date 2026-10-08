"use client";

import { useRef, useState } from "react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { SOCIAL_LABELS, SOCIAL_NETWORKS } from "@/lib/social";
import { followUrl, hasFollowIntent } from "@/lib/planner/actions";
import { recordFollow } from "@/lib/planner/store-actions";
import type { SocialNetwork } from "@/lib/types";

export interface FollowTarget {
  itemId: string;
  schoolName: string;
  social: Partial<Record<SocialNetwork, string>> | null | undefined;
  followedNetworks: readonly SocialNetwork[];
}

interface QueueEntry {
  itemId: string;
  schoolName: string;
  network: SocialNetwork;
  handle: string;
}

function buildQueue(targets: readonly FollowTarget[]): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const t of targets) {
    if (!t.social) continue;
    for (const network of SOCIAL_NETWORKS) {
      const handle = t.social[network];
      if (!handle || t.followedNetworks.includes(network)) continue;
      out.push({ itemId: t.itemId, schoolName: t.schoolName, network, handle });
    }
  }
  return out;
}

/**
 * "Follow everyone" (specs/planner/actions.md "Display"): runs through every college's unfollowed accounts in
 * list order. X and YouTube's intents are the real one-click follow; the click itself is the record. The rest open
 * one at a time, each waiting for "Did you follow?" before moving to the next, so the family isn't asked about six
 * colleges at once.
 */
export function FollowEveryoneButton({ targets }: { targets: readonly FollowTarget[] }) {
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<QueueEntry | null>(null);
  const resolveRef = useRef<((yes: boolean) => void) | null>(null);

  const total = buildQueue(targets).length;
  if (total === 0) return null;

  const run = async () => {
    setRunning(true);
    for (const entry of buildQueue(targets)) {
      window.open(followUrl(entry.network, entry.handle), "_blank", "noopener,width=520,height=640");
      if (hasFollowIntent(entry.network)) {
        await recordFollow(entry.itemId, entry.network, true);
        continue;
      }
      const yes = await new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setCurrent(entry);
      });
      setCurrent(null);
      if (yes) await recordFollow(entry.itemId, entry.network, true);
    }
    setRunning(false);
  };

  const answer = (yes: boolean) => {
    resolveRef.current?.(yes);
    resolveRef.current = null;
  };

  return (
    <>
      <button type="button" onClick={run} disabled={running} className="h-9 shrink-0 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
        {running ? "Following…" : `Follow everyone (${total})`}
      </button>
      <SheetDialog
        open={current !== null}
        onOpenChange={(v) => !v && answer(false)}
        title="Did you follow?"
        description={current ? `On ${SOCIAL_LABELS[current.network]}, for ${current.schoolName}` : undefined}
      >
        <div className="flex gap-2">
          <button type="button" onClick={() => answer(true)} className="h-11 flex-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Yes, I followed
          </button>
          <button type="button" onClick={() => answer(false)} className="h-11 flex-1 rounded-full border px-4 text-sm font-semibold">
            Not yet
          </button>
        </div>
      </SheetDialog>
    </>
  );
}
