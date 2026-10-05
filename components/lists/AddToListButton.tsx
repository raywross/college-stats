"use client";

import { useEffect, useState, useTransition } from "react";
import { Popover } from "@base-ui/react/popover";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { addToMyDefaultList, isOnAnyList, removeFromMyLists } from "@/lib/lists";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { useMe } from "@/components/account/useMe";
import { cn } from "@/lib/utils";

/**
 * "Add to list" next to Compare on the profile hero, Explore cards/rows, and the compare tray ("Save these to my
 * list"; specs/product/saved-lists.md). A client component calling Server Actions, so the public pages around it
 * (profiles, Explore, compare) stay static: signed out, it shows SignInPrompt instead of hitting the database.
 *
 * `ids`: one college (the usual case) or several (the compare tray's "Save these"); all go to the student's
 * default list, created on first use.
 */
export function AddToListButton({
  ids,
  variant = "pill",
  label,
  className,
}: {
  ids: string | string[];
  variant?: "pill" | "icon" | "large";
  label?: string;
  className?: string;
}) {
  const unitIds = Array.isArray(ids) ? ids : [ids];
  const me = useMe();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [fetchedOn, setFetchedOn] = useState<boolean | null>(null);
  const single = unitIds.length === 1;

  // Single-college buttons reflect whether it's already saved; a multi-college "Save these" never shows a check.
  useEffect(() => {
    if (!single || !me?.signedIn) return;
    let cancelled = false;
    isOnAnyList(unitIds[0]).then((v) => {
      if (!cancelled) setFetchedOn(v);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitIds[0], me?.signedIn, single]);

  const on = !single ? null : me?.signedIn ? fetchedOn : false;

  if (!me) return <span className={cn("inline-block", variant === "icon" ? "size-8" : "h-8 w-20", className)} aria-hidden />;
  if (!me.configured) return null;

  const text = label ?? (single ? (on ? "On your list" : "Add to list") : "Save these to my list");
  const Icon = on ? BookmarkCheck : Bookmark;
  const btnCls = cn(
    "relative z-20 inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold transition-all outline-none select-none",
    "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95",
    variant === "icon" && "size-8 rounded-full border",
    variant === "pill" && "h-8 rounded-full border px-3 text-xs",
    variant === "large" && "h-10 rounded-full border px-4 text-sm",
    on ? "border-transparent bg-pop text-pop-foreground shadow-sm" : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary",
    className,
  );
  const iconCls = variant === "large" ? "size-4" : "size-3.5";

  if (!me.signedIn) {
    return (
      <Popover.Root>
        <Popover.Trigger nativeButton className={btnCls} aria-label={text} title={text}>
          <Icon className={iconCls} aria-hidden />
          {variant !== "icon" && <span>{text}</span>}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="center" sideOffset={8} className="z-50">
            <Popover.Popup className="w-72 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-xl outline-none">
              <SignInPrompt reason="save colleges to your list" next={pathname} variant="inline" />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={single ? on === true : undefined}
      aria-label={text}
      title={text}
      disabled={pending || (single && on === null)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          if (single) {
            const result = on ? await removeFromMyLists(unitIds[0]) : await addToMyDefaultList(unitIds);
            if (result.ok) setFetchedOn(!on);
          } else {
            await addToMyDefaultList(unitIds);
          }
        });
      }}
      className={btnCls}
    >
      <Icon className={iconCls} aria-hidden />
      {variant !== "icon" && <span>{pending ? "Saving…" : text}</span>}
    </button>
  );
}
