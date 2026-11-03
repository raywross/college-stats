import Link from "next/link";
import type { ReactNode } from "react";
import { StatusChip } from "@/components/admin/StatusChip";
import type { ChipTone } from "@/lib/admin/console";
import { TODO_STATUS_LABEL, documentHref, linkCls } from "@/lib/admin/steward-view";
import { ISSUE_KIND_LABEL, ISSUE_STATUS_LABEL, PROPOSAL_KIND_LABEL, PROPOSAL_STATUS_LABEL, type IssueKind, type IssueStatus, type ProposalKind, type ProposalStatus, type Recommendation, type TodoStatus } from "@/lib/steward/types";

/**
 * The small pieces every Data Steward screen shares (specs/product/data-steward.md "The console: where it all
 * shows"): a document opened at its page, and the chips for a kind, a status and a recommendation. The links and
 * words themselves are lib/admin/steward-view.ts.
 */

/** A document link ("cornell.edu · p. 4, line 12") opening the document at the page. */
export function DocLink({ url, page, line, children }: { url: string | null | undefined; page?: number | null; line?: number | null; children?: ReactNode }) {
  const href = documentHref(url, page);
  let host = "the document";
  try {
    if (url) host = new URL(url).host.replace(/^www\./, "");
  } catch {
    host = "the document";
  }
  const where = [page ? `p. ${page}` : null, line ? `line ${line}` : null].filter(Boolean).join(", ");
  const label = children ?? (where ? `${host} · ${where}` : host);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`break-all ${linkCls}`}>
      {label}
    </a>
  ) : (
    <span className="text-muted-foreground">{url ? label : "No document"}</span>
  );
}

const KIND_TONE: Record<IssueKind, ChipTone> = { value: "info", systemic: "warn", acquisition: "neutral", policy: "good" };
export function KindChip({ kind }: { kind: IssueKind }) {
  return <StatusChip label={ISSUE_KIND_LABEL[kind]} tone={KIND_TONE[kind]} />;
}

const ISSUE_TONE: Record<IssueStatus, ChipTone> = { new: "neutral", investigating: "info", proposed: "info", waiting: "warn", left: "neutral" };
export function IssueStatusChip({ status }: { status: IssueStatus }) {
  return <StatusChip label={ISSUE_STATUS_LABEL[status]} tone={ISSUE_TONE[status]} />;
}

const PROPOSAL_TONE: Record<ProposalStatus, ChipTone> = { open: "warn", asked: "info", approved: "info", applied: "good", declined: "neutral" };
export function ProposalStatusChip({ status }: { status: ProposalStatus }) {
  return <StatusChip label={PROPOSAL_STATUS_LABEL[status]} tone={PROPOSAL_TONE[status]} />;
}

export function ProposalKindChip({ kind }: { kind: ProposalKind }) {
  return <StatusChip label={PROPOSAL_KIND_LABEL[kind]} tone={kind === "systemic" ? "warn" : "neutral"} />;
}

/** "Approve (the Steward checked the document)" or "Your call", with the reason when it is. */
export function Recommends({ recommends, why }: { recommends: Recommendation | null; why?: string | null }) {
  if (!recommends) return <span className="text-muted-foreground">—</span>;
  if (recommends === "approve") return <span className="font-semibold">Approve (the Steward checked the document)</span>;
  return (
    <span>
      <span className="font-semibold">Your call</span>
      {why ? <span className="block text-xs text-muted-foreground">{why}</span> : null}
    </span>
  );
}

const TODO_TONE: Record<TodoStatus, ChipTone> = { open: "warn", found: "info", "no-document": "neutral", done: "good" };
export function TodoStatusChip({ status }: { status: TodoStatus }) {
  return <StatusChip label={TODO_STATUS_LABEL[status]} tone={TODO_TONE[status]} />;
}

/** The Data section's back link. */
export function DataBack() {
  return (
    <Link href="/admin/data" className={linkCls}>
      Data
    </Link>
  );
}
