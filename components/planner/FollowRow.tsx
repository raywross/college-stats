"use client";

import { useEffect, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { SOCIAL_GLYPHS } from "@/components/school/SocialIcons";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { SOCIAL_LABELS, SOCIAL_NETWORKS } from "@/lib/social";
import { followUrl, hasFollowIntent } from "@/lib/planner/actions";
import { recordFollow } from "@/lib/planner/store-actions";
import type { SocialNetwork } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The follow row (specs/planner/actions.md "Follow"): the college's accounts in the site's order, one 44 px icon
 * each. X and YouTube are a real one-click follow/subscribe: the record is made the moment the intent opens, no
 * confirmation needed. The rest open the profile (the app on a phone, where a deep link is documented) and ask "Did
 * you follow?" in a bottom sheet when the tab regains focus — self-reported, which the tooltip says on hover.
 *
 * `canFollow` is false for a guardian (actions.md "Rules": a follow is the student's account) and for anyone
 * without edit access; the icons still show, just disabled, so the row reads the same everywhere.
 */
export function FollowRow({
  itemId,
  schoolName,
  social,
  followedNetworks,
  canFollow,
}: {
  itemId: string;
  schoolName: string;
  social: Partial<Record<SocialNetwork, string>> | null | undefined;
  followedNetworks: readonly SocialNetwork[];
  canFollow: boolean;
}) {
  const [followed, setFollowed] = useState<ReadonlySet<SocialNetwork>>(() => new Set(followedNetworks));
  const [awaiting, setAwaiting] = useState<SocialNetwork | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!awaiting) return;
    const onFocus = () => setSheetOpen(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [awaiting]);

  const networks = social ? SOCIAL_NETWORKS.filter((n) => social[n]) : [];
  if (networks.length === 0) {
    return <p className="text-sm text-muted-foreground">No accounts on record.</p>;
  }

  const mark = (network: SocialNetwork, value: boolean) => {
    setFollowed((prev) => {
      const next = new Set(prev);
      if (value) next.add(network);
      else next.delete(network);
      return next;
    });
    startTransition(async () => {
      await recordFollow(itemId, network, value);
    });
  };

  const open = (network: SocialNetwork) => {
    if (!canFollow) return;
    const handle = social?.[network];
    if (!handle) return;
    window.open(followUrl(network, handle), "_blank", "noopener,width=520,height=640");
    if (hasFollowIntent(network)) {
      mark(network, true);
      return;
    }
    setAwaiting(network);
  };

  const answer = (yes: boolean) => {
    setSheetOpen(false);
    setAwaiting(null);
    if (awaiting) mark(awaiting, yes);
  };

  return (
    <>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label={`Follow ${schoolName}`}>
        {networks.map((network) => {
          const Glyph = SOCIAL_GLYPHS[network];
          const on = followed.has(network);
          return (
            <li key={network}>
              <button
                type="button"
                disabled={!canFollow}
                onClick={() => open(network)}
                aria-pressed={on}
                title={canFollow ? `${on ? "Followed" : "Follow"} on ${SOCIAL_LABELS[network]} (self-reported)` : `Follow on ${SOCIAL_LABELS[network]}`}
                className={cn(
                  "relative inline-flex size-11 items-center justify-center rounded-full border-2 transition-colors",
                  on ? "border-primary" : "border-transparent hover:border-border",
                  !canFollow && "cursor-default opacity-60",
                )}
              >
                <Glyph />
                {on && (
                  <span className="absolute -right-0.5 -bottom-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-2.5" aria-hidden />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <SheetDialog open={sheetOpen} onOpenChange={(v) => !v && answer(false)} title="Did you follow?" description={awaiting ? `On ${SOCIAL_LABELS[awaiting]}, for ${schoolName}` : undefined}>
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
