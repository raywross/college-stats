"use client";

import { useEffect, useState, useTransition } from "react";
import { Popover } from "@base-ui/react/popover";
import { Bell, BellRing, Check } from "lucide-react";
import { follow, getFollow, unfollow } from "@/lib/follows";
import type { FollowState } from "@/lib/follow-state";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { cn } from "@/lib/utils";

/**
 * Follow a college to get an email when its numbers change (specs/product/follow-colleges.md#in-the-app). On the
 * profile hero, next to CompareButton, and on each compare column header.
 *
 * Reads and writes go through the Server Actions in lib/follows.ts, called directly from this client component (no
 * cookies are read while a public page renders; the action itself refreshes the session when it runs). Renders
 * nothing once the first read says following isn't available on this deployment, so a copy of the site without
 * Supabase configured shows no Follow button at all.
 */
export function FollowButton({
  unitId,
  schoolName,
  next,
  variant = "pill",
  className,
}: {
  unitId: string;
  /** For the sign-in prompt's sentence and, on failure, the error toast. */
  schoolName: string;
  /** Where to return after signing in; defaults to the college's profile. */
  next?: string;
  variant?: "pill" | "icon" | "large";
  className?: string;
}) {
  const [state, setState] = useState<FollowState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    getFollow(unitId).then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, [unitId]);

  // Not yet answered: hold the space (sized like the pill) so nothing jumps when it resolves.
  if (state === null) {
    return <span aria-hidden className={cn(sizeClasses(variant), "inline-block invisible", className)} />;
  }
  // Sign-in isn't configured on this deployment: nothing to show.
  if (!state.available) return null;

  if (!state.signedIn) {
    return (
      <Popover.Root>
        <Popover.Trigger className={buttonClasses(variant, false, className)} aria-label={`Follow ${schoolName}`}>
          <Bell className={iconClasses(variant)} strokeWidth={2.5} />
          {variant !== "icon" && <span>Follow</span>}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} collisionPadding={12} className="z-[60]">
            <Popover.Popup className="w-72 max-w-[calc(100vw-24px)] rounded-2xl border bg-popover p-3 shadow-2xl outline-none">
              <SignInPrompt reason={`follow ${schoolName} and get an email when its numbers change`} next={next ?? `/schools/${unitId}`} variant="inline" />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const following = state.following;
  const label = !following ? "Follow" : state.source === "list" ? "On your list" : "Following";

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={following}
      aria-label={`${label}: ${schoolName}`}
      title={error ?? label}
      onClick={() => {
        setError(null);
        startTransition(async () => {
          const result = following ? await unfollow(unitId) : await follow(unitId);
          if (result.ok) setState(result.state);
          else setError(result.message);
        });
      }}
      className={buttonClasses(variant, following, className)}
    >
      {following ? (
        state.source === "list" ? (
          <BellRing className={iconClasses(variant)} strokeWidth={2.5} />
        ) : (
          <Check className={iconClasses(variant)} strokeWidth={3} />
        )
      ) : (
        <Bell className={iconClasses(variant)} strokeWidth={2.5} />
      )}
      {variant !== "icon" && <span>{label}</span>}
    </button>
  );
}

function sizeClasses(variant: "pill" | "icon" | "large"): string {
  return variant === "icon" ? "size-8" : variant === "large" ? "h-10 w-28" : "h-8 w-24";
}

function iconClasses(variant: "pill" | "icon" | "large"): string {
  return variant === "large" ? "size-3.5 sm:size-4" : "size-3.5";
}

function buttonClasses(variant: "pill" | "icon" | "large", active: boolean, className?: string): string {
  return cn(
    "relative z-20 inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold transition-all outline-none select-none",
    "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95",
    variant === "icon" && "size-8 rounded-full border",
    variant === "pill" && "h-8 rounded-full border px-3 text-xs",
    variant === "large" && "h-10 rounded-full border px-2.5 text-xs whitespace-nowrap sm:px-4 sm:text-sm",
    active
      ? "border-transparent bg-primary text-primary-foreground shadow-sm"
      : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary",
    className,
  );
}
