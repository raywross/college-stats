"use client";

import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";

/**
 * A controlled dialog that is a bottom sheet on phones and a centered card from `sm` (the household hub's pattern,
 * specs/product/household-hub.md "Redesign (2026-10-06)"): Add someone, Invite them, a re-sent link, a list's CSV
 * import and share link. Title row with a close button, then `children`. Open state belongs to the caller, so a
 * server refresh behind it (after an action) keeps it open with its result showing.
 *
 * Pass `trigger` (its class, label, and content) to have the dialog own its button; leave it out and open it from
 * elsewhere (a menu item) with `open`/`onOpenChange`.
 */
export function SheetDialog({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** The button that opens it, rendered as a `Dialog.Trigger`: its class, accessible label, and content. */
  trigger?: { className: string; label: string; content: ReactNode };
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <Dialog.Trigger aria-label={trigger.label} title={trigger.label} className={trigger.className}>
          {trigger.content}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl border bg-card p-4 shadow-xl outline-none transition-all data-[ending-style]:translate-y-4 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-4 data-[starting-style]:opacity-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-6 sm:data-[ending-style]:translate-y-0 sm:data-[starting-style]:translate-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-xl font-bold break-words">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">{description}</Dialog.Description>}
            </div>
            <Dialog.Close aria-label="Close" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="mt-4">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
