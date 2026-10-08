"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ComponentType } from "react";
import { Menu } from "@base-ui/react/menu";
import { Copy, Eye, Link2, LogOut, MoreHorizontal, PencilLine, RefreshCw, UserMinus, UserRound, X } from "lucide-react";
import {
  copyInvitationLink,
  leaveHousehold,
  removeMember,
  resendInvitation,
  revokeInvitation,
  setMemberCanEdit,
  type AddPersonState,
  type HouseholdActionState,
} from "@/app/household/actions";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import type { PersonAction } from "@/lib/household-hub";
import { memberName, type RosterMember } from "@/lib/household-rules";
import { cn } from "@/lib/utils";
import { CopyLinkField, InviteLinkPanel, InviteManagedStudent, writeClipboard } from "./InvitationControls";

type Panel = { kind: "invite" } | { kind: "resent"; state: Extract<AddPersonState, { status: "invited" }> } | { kind: "link"; link: string } | null;
type Note = { tone: "ok" | "error"; text: string } | null;
type HouseholdAction = (prev: HouseholdActionState, form: FormData) => Promise<HouseholdActionState>;

const ITEMS: Record<PersonAction, { label: string; icon: ComponentType<{ className?: string }>; danger?: boolean }> = {
  "copy-link": { label: "Copy invitation link", icon: Copy },
  "send-again": { label: "Send the link again", icon: RefreshCw },
  "cancel-invite": { label: "Cancel the invitation", icon: X, danger: true },
  invite: { label: "Invite them", icon: Link2 },
  "allow-edit": { label: "Allow editing", icon: PencilLine },
  "view-only": { label: "View only", icon: Eye },
  "edit-profile": { label: "Edit your profile", icon: UserRound },
  remove: { label: "Remove from household", icon: UserMinus, danger: true },
  leave: { label: "Leave household", icon: LogOut, danger: true },
};

/**
 * The "⋯" at the right of a person's name line (PersonHeader; specs/product/household-hub.md "Redesign (2026-10-06)"):
 * the rare things to do about a person, out of the way of their list and numbers. `actions` comes from
 * personActions() (lib/household-hub.ts), which mirrors the database's rules: Copy link / Send again / Cancel on a
 * pending hand-over, Invite them on a managed student you added, Allow editing / View only on a guardian, Edit your
 * profile (/account) on your own page, Remove, and Leave on your own membership.
 *
 * Everything runs the same Server Actions the roster used. Remove, Leave, and Cancel ask first (a browser confirm);
 * Remove and Leave then go to /household, which lands on whoever is left. Invite them and a re-sent link open in a
 * dialog (a bottom sheet on phones); a refusal or "Link copied" shows as one line under the button.
 */
export function PersonMenu({
  actions,
  row,
  householdId,
  householdName,
  viewerIsStudent,
}: {
  actions: PersonAction[];
  row: RosterMember | null;
  householdId: string;
  householdName: string;
  viewerIsStudent: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState<Note>(null);
  const [pending, start] = useTransition();
  if (actions.length === 0) return null;
  const name = row ? memberName(row) : "";

  const runHousehold = (action: HouseholdAction, fields: Record<string, string>, confirmText?: string, after?: () => void) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setNote(null);
    start(async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      const result = await action({ status: "idle" }, form);
      if (result.status === "error") setNote({ tone: "error", text: result.message });
      else after?.();
    });
  };

  const pick = (key: PersonAction) => {
    if (!row && key !== "edit-profile") return;
    setNote(null);
    switch (key) {
      case "copy-link":
        start(async () => {
          const r = await copyInvitationLink(row!.invitation_id!);
          if ("error" in r) return setNote({ tone: "error", text: r.error });
          // Clipboard access can be refused (an old browser, an iframe): show the link to copy by hand instead.
          if (await writeClipboard(r.link)) setNote({ tone: "ok", text: "Link copied" });
          else setPanel({ kind: "link", link: r.link });
        });
        return;
      case "send-again":
        start(async () => {
          const form = new FormData();
          form.set("household", householdId);
          form.set("invitation", row!.invitation_id!);
          form.set("name", name);
          const r = await resendInvitation({ status: "idle" }, form);
          if (r.status === "invited") setPanel({ kind: "resent", state: r });
          else if (r.status === "error") setNote({ tone: "error", text: r.message });
        });
        return;
      case "cancel-invite":
        return runHousehold(
          revokeInvitation,
          { invitation: row!.invitation_id! },
          row!.member_id === null
            ? `Cancel the invitation to ${name}? The link stops working and they leave the household.`
            : `Cancel the link that hands ${name}'s record over? It stops working; ${name} stays in the household.`,
        );
      case "invite":
        return setPanel({ kind: "invite" });
      case "allow-edit":
        return runHousehold(setMemberCanEdit, { member: row!.member_id!, can_edit: "true" });
      case "view-only":
        return runHousehold(setMemberCanEdit, { member: row!.member_id!, can_edit: "false" });
      case "remove":
        return runHousehold(
          removeMember,
          { member: row!.member_id! },
          `Remove ${name} from ${householdName}? ${row!.role === "guardian" ? "They'll lose access to the students here right away." : "Guardians here will lose access to their information right away."}`,
          () => router.push("/household"),
        );
      case "leave":
        return runHousehold(
          leaveHousehold,
          { household: householdId },
          `Leave ${householdName}? ${viewerIsStudent ? "Its guardians will stop seeing your information right away." : "You'll stop seeing its students' information right away."} To come back you'll need a new invitation.`,
          () => router.push("/household"),
        );
      case "edit-profile":
        return;
    }
  };

  const itemCls = "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium outline-none data-[highlighted]:bg-muted";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Menu.Root>
        <Menu.Trigger
          aria-label={row?.is_me ? "More for you" : `More for ${name}`}
          disabled={pending}
          className="inline-flex size-10 items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 data-[popup-open]:bg-muted"
        >
          <MoreHorizontal className={cn("size-5", pending && "animate-pulse")} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50">
            <Menu.Popup className="w-60 origin-(--transform-origin) rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
              {actions.map((key) => {
                const { label, icon: Icon, danger } = ITEMS[key];
                const text = key === "view-only" && row?.is_me ? "Give up editing" : label;
                if (key === "edit-profile")
                  return (
                    <Menu.LinkItem key={key} closeOnClick render={<Link href="/account" />} className={itemCls}>
                      <Icon className="size-4" />
                      {text}
                    </Menu.LinkItem>
                  );
                return (
                  <Menu.Item key={key} onClick={() => pick(key)} className={cn(itemCls, danger && "text-destructive")}>
                    <Icon className="size-4" />
                    {text}
                  </Menu.Item>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={cn("max-w-56 text-right text-xs font-medium", note.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
          {note.text}
        </p>
      )}

      <SheetDialog
        open={panel !== null}
        onOpenChange={(open) => !open && setPanel(null)}
        title={panel?.kind === "invite" ? `Invite ${name}` : panel?.kind === "resent" ? "A new link" : "Invitation link"}
      >
        {panel?.kind === "invite" && row?.student_id && (
          <InviteManagedStudent household={householdId} student={row.student_id} name={name} startOpen onClose={() => setPanel(null)} />
        )}
        {panel?.kind === "resent" && <InviteLinkPanel state={panel.state} resent />}
        {panel?.kind === "link" && <CopyLinkField link={panel.link} />}
      </SheetDialog>
    </div>
  );
}
