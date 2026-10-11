"use client";

import { useEffect, useState, useTransition } from "react";
import { Popover } from "@base-ui/react/popover";
import { Bookmark, BookmarkCheck, Check } from "lucide-react";
import { usePathname } from "next/navigation";
import { addToMyDefaultList, isOnAnyList, mySaveTargets, removeFromMyLists, type SaveTarget } from "@/lib/lists";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { useMe } from "@/components/account/useMe";
import { cn } from "@/lib/utils";

/** One fetch of the save targets per signed-in user, shared by every button on the page. */
let targetsFor: { userId: string; promise: Promise<SaveTarget[]> } | null = null;
function saveTargets(userId: string): Promise<SaveTarget[]> {
  if (targetsFor?.userId !== userId) targetsFor = { userId, promise: mySaveTargets().catch(() => []) };
  return targetsFor.promise;
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "your student";
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * "Add to list" next to Compare on the profile hero, Explore cards/rows, and the compare tray ("Save these to my
 * list"; specs/product/saved-lists.md). A client component calling Server Actions, so the public pages around it
 * (profiles, Explore, compare) stay static: signed out, it shows SignInPrompt instead of hitting the database.
 *
 * `ids`: one college (the usual case) or several (the compare tray's "Save these"). Where they go (lib/lists.ts
 * saveOwner): a student's own default list; a guardian with edit access, their child's list (several children: a
 * menu with one toggle per child); any other guardian, a list they own.
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
  const [targets, setTargets] = useState<SaveTarget[] | null>(null);
  /** Per owner key ("" for the save owner, else a student id): whether the college is on that list. */
  const [onFor, setOnFor] = useState<Record<string, boolean>>({});
  const single = unitIds.length === 1;
  const userId = me?.signedIn ? me.id : null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    saveTargets(userId).then((t) => {
      if (!cancelled) setTargets(t);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Single-college buttons reflect whether it's already saved (on each child's list, for a guardian of several); a
  // multi-college "Save these" never shows a check.
  const keys = targets === null ? null : targets.length > 1 ? targets.map((t) => t.studentId) : [""];
  const keysSig = keys?.join(",") ?? null;
  useEffect(() => {
    if (!single || !userId || keys === null) return;
    let cancelled = false;
    Promise.all(keys.map((k) => isOnAnyList(unitIds[0], k || undefined))).then((vals) => {
      if (!cancelled) setOnFor(Object.fromEntries(keys.map((k, i) => [k, vals[i]])));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitIds[0], userId, single, keysSig]);

  if (!me) return <span className={cn("inline-block", variant === "icon" ? "size-8" : "h-8 w-20", className)} aria-hidden />;
  if (!me.configured) return null;

  const several = (targets?.length ?? 0) > 1;
  const only = targets?.length === 1 ? targets[0] : null;
  const loaded = keys !== null && keys.every((k) => k in onFor);
  const on = !single ? null : me.signedIn ? (loaded ? keys!.some((k) => onFor[k]) : null) : false;
  const whose = only ? `${possessive(firstName(only.name))} list` : "your list";

  const text = label ?? (single ? (on ? `On ${whose}` : "Add to list") : several ? "Save these to a list" : `Save these to ${whose}`);
  const Icon = on ? BookmarkCheck : Bookmark;
  const btnCls = cn(
    "relative z-20 inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold transition-all outline-none select-none",
    "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 active:scale-95",
    variant === "icon" && "size-8 rounded-full border",
    variant === "pill" && "h-8 rounded-full border px-3 text-xs",
    variant === "large" && "h-10 rounded-full border px-2.5 text-xs whitespace-nowrap sm:px-4 sm:text-sm",
    on ? "border-transparent bg-pop text-pop-foreground shadow-sm" : "border-border bg-card text-foreground hover:border-primary/40 hover:text-primary",
    className,
  );
  const iconCls = variant === "large" ? "size-3.5 sm:size-4" : "size-3.5";

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

  /** Adds to (or, for one college already there, removes from) the list under `key`. */
  const toggle = (key: string) =>
    startTransition(async () => {
      const studentId = key || undefined;
      if (single) {
        const was = onFor[key] === true;
        const result = was ? await removeFromMyLists(unitIds[0], studentId) : await addToMyDefaultList(unitIds, studentId);
        if (result.ok) setOnFor((o) => ({ ...o, [key]: !was }));
      } else {
        await addToMyDefaultList(unitIds, studentId);
      }
    });

  if (several) {
    return (
      <Popover.Root>
        <Popover.Trigger
          nativeButton
          className={btnCls}
          aria-label={text}
          title={text}
          disabled={pending || (single && on === null)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Icon className={iconCls} aria-hidden />
          {variant !== "icon" && <span>{pending ? "Saving…" : text}</span>}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="center" sideOffset={8} className="z-50">
            <Popover.Popup className="w-60 rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none">
              {targets!.map((t) => {
                const has = single && onFor[t.studentId] === true;
                return (
                  <button
                    key={t.studentId}
                    type="button"
                    disabled={pending}
                    aria-pressed={single ? has : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(t.studentId);
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-semibold hover:bg-muted disabled:opacity-60"
                  >
                    <span className="flex size-4 items-center justify-center">{has && <Check className="size-4 text-primary" aria-hidden />}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {has ? "On" : single ? "Add to" : "Save to"} {possessive(firstName(t.name))} list
                    </span>
                  </button>
                );
              })}
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
      disabled={pending || targets === null || (single && on === null)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // "" is the save owner: a guardian's only child, or the person's own list (lib/lists.ts saveOwner).
        toggle("");
      }}
      className={btnCls}
    >
      <Icon className={iconCls} aria-hidden />
      {variant !== "icon" && <span>{pending ? "Saving…" : text}</span>}
    </button>
  );
}
