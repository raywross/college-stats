"use client";

/**
 * A guide's act button (specs/planner/v3/guides/show-interest.md "Tracking", layer 1; build-plan.md review note 11):
 * an ordinary link to the college's own page (or a test's registration page) that opens in a new tab, styled as a
 * button. The click is never blocked: the browser opens the page, and alongside it `recordAct` records a pending act
 * and hands it to the page's ReturnPrompt, which asks when the tab comes back. `plan_interest_act { action }` on click.
 *
 * Without edit access (`track={false}`) it is the plain link: nothing is recorded for someone who can't write the plan.
 * The test guide (U5) reuses it with `act: "test_register"`, `itemId: null`, and the test date as the event.
 */
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { track as trackEvent } from "@/lib/analytics";
import type { InterestAct, InterestActRow } from "@/lib/planner/interest-acts";
import { recordAct } from "@/lib/planner/store-interest";
import type { SocialNetwork } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useInterestActs } from "./ReturnPrompt";

export interface ActButtonProps {
  href: string;
  itemId: string | null;
  act: InterestAct;
  network?: SocialNetwork | null;
  event?: { id: string; startsAt: string | null; place: string | null; title: string | null } | null;
  /** Record the click (the viewer can edit the plan). False: a plain link. */
  track?: boolean;
  /** Called with the new act's id once it is recorded. */
  onRecorded?: (id: string) => void;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}

export const ACT_BUTTON_CLASS = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold";

export function ActButton({ href, itemId, act, network = null, event = null, track = true, onRecorded, className, children, ...rest }: ActButtonProps) {
  const acts = useInterestActs();

  const onClick = () => {
    if (!track) return;
    trackEvent("plan_interest_act", { action: act });
    const clickedAt = new Date().toISOString();
    void recordAct({ itemId, act, network, url: href, event })
      .then((r) => {
        if (!r.ok) return;
        const row: InterestActRow = {
          id: r.id,
          item_id: itemId,
          user_id: "",
          act,
          network: act === "follow" ? network : null,
          url: href,
          event_id: event?.id ?? null,
          event_starts_at: event?.startsAt ?? null,
          event_place: event?.place ?? null,
          event_title: event?.title ?? null,
          clicked_at: clickedAt,
          prompted_at: null,
          emailed_at: null,
          status: "pending",
          resolved_at: null,
          resolved_via: null,
          visit_id: null,
          confirm_token: "",
        };
        acts?.arm(row);
        onRecorded?.(r.id);
      })
      .catch(() => {});
  };

  return (
    <a href={href} target="_blank" rel="noopener" onClick={onClick} className={cn(ACT_BUTTON_CLASS, className)} aria-label={rest["aria-label"]}>
      {children}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

export default ActButton;
