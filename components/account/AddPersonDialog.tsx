"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Plus, X } from "lucide-react";
import type { MemberRole } from "@/lib/accounts";
import { AddPersonForm } from "./AddPersonForm";

/**
 * The "+" in the People card's corner (owner request 2026-10-06): opens a dialog holding AddPersonForm, so the hub
 * page stays a roster rather than a long form. The dialog is client state, so a server refresh after an add (or the
 * household being created by the first add) keeps it open with the link panel showing.
 */
export function AddPersonDialog({
  description,
  household,
  myRole,
  canAddStudents,
  viewerIsStudent,
  defaultRole,
  defaultHouseholdName,
}: {
  description: ReactNode;
  household: string;
  myRole: MemberRole;
  canAddStudents: boolean;
  viewerIsStudent: boolean;
  defaultRole: MemberRole;
  defaultHouseholdName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Add someone"
        title="Add someone"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <Plus className="size-5" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl border bg-card p-4 shadow-xl outline-none transition-all data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6 sm:data-[ending-style]:translate-y-0 sm:data-[starting-style]:translate-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-xl font-bold">Add someone</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="mt-4">
            <AddPersonForm
              household={household}
              myRole={myRole}
              canAddStudents={canAddStudents}
              viewerIsStudent={viewerIsStudent}
              defaultRole={defaultRole}
              defaultHouseholdName={defaultHouseholdName}
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
