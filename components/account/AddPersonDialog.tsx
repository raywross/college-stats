"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Plus } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import type { MemberRole } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { AddPersonForm } from "./AddPersonForm";

/**
 * The people strip's last chip, "+ Add" (specs/product/household-hub.md "Redesign (2026-10-06)"): opens a dialog
 * holding AddPersonForm (a bottom sheet on phones), so the hub stays the strip and a person's list rather than a long
 * form. `variant="button"` is the same dialog behind a labelled button, for the "add the first person" state. The
 * dialog is client state, so a server refresh after an add (or the household being created by the first add) keeps it
 * open with the link panel showing.
 */
export function AddPersonDialog({
  description,
  household,
  myRole,
  canAddStudents,
  viewerIsStudent,
  defaultRole,
  defaultHouseholdName,
  variant = "chip",
}: {
  description: ReactNode;
  household: string;
  myRole: MemberRole;
  canAddStudents: boolean;
  viewerIsStudent: boolean;
  defaultRole: MemberRole;
  defaultHouseholdName: string;
  variant?: "chip" | "button";
}) {
  const [open, setOpen] = useState(false);
  return (
    <SheetDialog
      open={open}
      onOpenChange={setOpen}
      title="Add someone"
      description={description}
      trigger={
        variant === "chip"
          ? { className: addChipCls, label: "Add someone", content: <AddChipContent /> }
          : {
              className:
                "inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              label: "Add the first person",
              content: (
                <>
                  <Plus className="size-4" aria-hidden />
                  Add the first person
                </>
              ),
            }
      }
    >
      <AddPersonForm
        household={household}
        myRole={myRole}
        canAddStudents={canAddStudents}
        viewerIsStudent={viewerIsStudent}
        defaultRole={defaultRole}
        defaultHouseholdName={defaultHouseholdName}
      />
    </SheetDialog>
  );
}

/** The "+" chip: the same height and shape as a person's chip (PeopleStrip), dashed so it reads as an empty seat. */
const addChipCls =
  "inline-flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border border-dashed border-primary/50 py-1 pr-4 pl-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

function AddChipContent() {
  return (
    <>
      <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Plus className="size-5" />
      </span>
      Add
    </>
  );
}

/**
 * The "+" chip when the household is full: dimmed, and a tap explains why instead of opening the form (the six-seat
 * rule, specs/product/accounts.md "Built: one household, six seats").
 */
export function HouseholdFullChip({ max, canInviteManaged }: { max: number; canInviteManaged: boolean }) {
  return (
    <Popover.Root>
      <Popover.Trigger aria-label="Household full" className={cn(addChipCls, "border-border text-muted-foreground hover:bg-muted")}>
        <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Plus className="size-5" />
        </span>
        Full
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={12} className="z-50">
          <Popover.Popup className="w-72 max-w-[calc(100vw-24px)] rounded-2xl border bg-popover p-4 text-sm text-popover-foreground shadow-xl outline-none">
            Full: {max} people, counting invitations waiting for an answer. Cancel an invitation or remove someone to make room.
            {canInviteManaged && " Inviting a student you added (Invite them, in their ⋯ menu) takes no new seat."}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
