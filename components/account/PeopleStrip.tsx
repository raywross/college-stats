"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { revokeInvitation } from "@/app/household/actions";
import { chipActive, chipCaption, chipName, statusLabel } from "@/lib/household-hub";
import { isPending, memberInitial, memberName, personHref, type RosterMember } from "@/lib/household-rules";
import { cn } from "@/lib/utils";
import { HouseholdActionButton } from "./HouseholdActionButton";
import { CopyInvitationButton, ResendInvitationButton } from "./InvitationControls";

/**
 * The people strip (specs/product/household-hub.md "Redesign (2026-10-06)"): the household's roster as one row of
 * chips at the top of every /household page, rendered once by app/household/layout.tsx so moving between people never
 * changes the frame. A chip is an avatar letter (a dashed ring while someone hasn't joined), the first name, and a tiny
 * caption from chipCaption() ("Student · Class of 2028", "Invited", "No account yet"). The chip for the page being
 * shown is ink-filled (usePathname(), chipActive()); the rest are outlined. `add` (the "+" chip, AddPersonDialog, or
 * the full-household chip) comes last.
 *
 * Someone with a page (every member, managed students included) is a link to it. A pending invitation has no page
 * yet, so its chip opens a small popover instead: the expiry line, then Copy link · Send again · Cancel.
 *
 * Phones: one sideways-scrolling row that bleeds to the screen edge and snaps chip by chip (specs/mobile.md "People
 * strip"), with the active chip scrolled into view; chips are 44px tall. From `sm` the chips wrap instead.
 */
export function PeopleStrip({ householdId, members, add, label = "People in the household" }: { householdId: string; members: RosterMember[]; add: ReactNode; label?: string }) {
  const pathname = usePathname();
  const listRef = useRef<HTMLUListElement>(null);

  // Bring the active chip into view in the sideways row (phones), without scrolling the page itself.
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>("[aria-current=page]");
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const left = active.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + active.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollTo({ left: Math.max(0, left - 16) });
  }, [pathname]);

  return (
    <nav aria-label={label}>
      <ul
        ref={listRef}
        className="flex gap-2 pb-1 max-sm:-mx-4 max-sm:snap-x max-sm:snap-mandatory max-sm:overflow-x-auto max-sm:scroll-px-4 max-sm:px-4 sm:flex-wrap"
      >
        {members.map((m) => (
          <li key={m.member_id ?? m.invitation_id ?? m.user_id ?? m.student_id} className="flex shrink-0 snap-start">
            <PersonChip m={m} householdId={householdId} active={chipActive(pathname, personHref(m))} />
          </li>
        ))}
        <li className="flex shrink-0 snap-start">{add}</li>
      </ul>
    </nav>
  );
}

const chipCls =
  "inline-flex min-h-11 items-center gap-2 rounded-full border py-1 pr-4 pl-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function ChipBody({ m, active }: { m: RosterMember; active: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
          isPending(m)
            ? "border border-dashed border-current"
            : active
              ? "bg-background/15 text-background"
              : "bg-primary/12 text-primary",
        )}
      >
        {memberInitial(m)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="max-w-36 truncate text-sm leading-tight font-semibold">{chipName(m)}</span>
        <span className={cn("text-[11px] leading-tight whitespace-nowrap", active ? "text-background/75" : "text-muted-foreground")}>{chipCaption(m)}</span>
      </span>
    </>
  );
}

function PersonChip({ m, householdId, active }: { m: RosterMember; householdId: string; active: boolean }) {
  const href = personHref(m);
  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        title={memberName(m)}
        className={cn(chipCls, active ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary/40 hover:bg-muted/60")}
      >
        <ChipBody m={m} active={active} />
      </Link>
    );
  }
  return <PendingChip m={m} householdId={householdId} />;
}

/** A pending invitation's chip: a popover with when it runs out and the three things you can do about it. */
function PendingChip({ m, householdId }: { m: RosterMember; householdId: string }) {
  const name = memberName(m);
  const status = statusLabel(m);
  return (
    <Popover.Root>
      <Popover.Trigger className={cn(chipCls, "border-dashed bg-card text-foreground hover:bg-muted/60 data-[popup-open]:bg-muted")} aria-label={`${name}: ${status ?? "invited"}`}>
        <ChipBody m={m} active={false} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className="w-80 max-w-[calc(100vw-24px)] origin-(--transform-origin) rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <Popover.Title className="font-semibold break-words">{name}</Popover.Title>
            <Popover.Description className="mt-0.5 text-xs text-muted-foreground break-all">
              {[status, m.role === "guardian" ? "parent or guardian" : "student", m.email].filter(Boolean).join(" · ")}
            </Popover.Description>
            {m.invitation_id && (
              <div className="mt-3 flex flex-wrap items-start gap-2">
                {m.status === "invited" && <CopyInvitationButton invitation={m.invitation_id} />}
                <ResendInvitationButton household={householdId} invitation={m.invitation_id} name={name} />
                <HouseholdActionButton
                  action={revokeInvitation}
                  fields={{ invitation: m.invitation_id }}
                  label="Cancel"
                  tone="danger"
                  confirm={`Cancel the invitation to ${name}? The link stops working and they leave the household.`}
                />
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
