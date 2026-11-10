import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminSearch } from "@/components/admin/AdminSearch";
import { HelpTip } from "@/components/admin/HelpTip";
import { HowThingsAreSkeleton, NeedsYouSkeleton, StewardDidSkeleton } from "@/components/admin/InboxSkeletons";
import { Empty, PageHeader, Panel } from "@/components/admin/Panel";
import { StatusChip } from "@/components/admin/StatusChip";
import { requireAdmin } from "@/lib/admin/auth";
import { fmtDateTime } from "@/lib/admin/console";
import { RUN_MODE_LABEL, lastRunsByMode, needsYou, nothingNeedsYou, runWrote, tiles, type InboxItem } from "@/lib/admin/inbox";
import { loadHowThingsAre, loadNeedsYou, loadStewardDid } from "@/lib/admin/inbox-reads";
import { withTiming } from "@/lib/timing-server";

export const metadata: Metadata = { title: "Inbox", robots: { index: false, follow: false } };

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  "held-change": "Held change",
  job: "Job",
  decision: "Decision",
  proposal: "Proposal",
  deletion: "Being deleted",
  todo: "To do",
  invitation: "Invitation",
  collision: "Two files",
  publish: "Waiting to publish",
};

const SEVERITY_TONE = { 1: "danger", 2: "warn", 3: "neutral" } as const;

/**
 * `/admin`, the Steward's Inbox (specs/product/admin-redesign.md "The home: Steward › Inbox"): what needs you, in
 * order of consequence, each row with its one action; what the Steward did (its last run of each kind); and how things
 * are (six tiles, each a link into its door). The reads are lib/admin/inbox-reads.ts, soft: a source that can't be
 * read leaves its rows out and its tile says so. On a phone the search sits on top and the tiles go two across.
 *
 * The shell (the search and the header) renders at once; each of the three panels is an async component under its own
 * <Suspense>, with its frame as the fallback (components/admin/InboxSkeletons.tsx), so each streams in when its reads
 * finish and none waits on another (specs/product/admin-speed.md "As built: U3"). The reads are per-request cached, so
 * the panels and the layout's badge share them. Each panel's reads are timed under `/admin <panel>`: React renders the
 * panels after the page function has returned, outside any timing the page could start.
 */
export default async function InboxPage() {
  await connection();
  await requireAdmin();

  return (
    <>
      <AdminSearch id="inbox-search" className="mb-4 lg:hidden" />
      <PageHeader title="Inbox" help="inbox" subtitle="What needs you, what the Steward did, and how things are. Everything here is logged." />
      <div className="space-y-6">
        <Suspense fallback={<NeedsYouSkeleton />}>
          <NeedsYouPanel />
        </Suspense>
        <Suspense fallback={<StewardDidSkeleton />}>
          <StewardDidPanel />
        </Suspense>
        <Suspense fallback={<HowThingsAreSkeleton />}>
          <HowThingsArePanel />
        </Suspense>
      </div>
    </>
  );
}

/** "Needs you": every row, in order of consequence, with its one action. */
async function NeedsYouPanel() {
  const input = await withTiming("/admin needs-you", () => loadNeedsYou());
  const items = needsYou(input);
  return (
    <Panel title="Needs you" id="needs-you" help="needs-you" aside={items.length > 0 ? <span className="text-sm text-muted-foreground">{items.length} waiting</span> : undefined}>
      {items.length === 0 ? (
        <Empty>{nothingNeedsYou(input.runs)}</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={`${item.kind}-${item.href}-${item.title}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0" title={item.raw}>
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <StatusChip label={KIND_LABEL[item.kind]} tone={SEVERITY_TONE[item.severity]} />
                  <span className="break-words">{item.title}</span>
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.why}</p>
              </div>
              <Link
                href={item.href}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground sm:self-center"
              >
                {item.action}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.some((i) => i.kind === "todo") && (
        <p className="mt-3 text-sm text-muted-foreground">
          The To do rows can be worked by the assistant in your browser:{" "}
          <Link href="/admin/steward/todo?assistant=1" className="inline-flex min-h-11 items-center underline decoration-dotted underline-offset-2">
            open the assistant view
          </Link>
          .
        </p>
      )}
      {(input.jobs === null || input.todo === null || input.decisions === null || input.proposals === null) && (
        <p role="note" className="mt-3 text-xs text-muted-foreground">
          Some sources couldn&apos;t be read just now ({[input.jobs === null && "jobs", input.todo === null && "To do", input.decisions === null && "decisions", input.proposals === null && "proposals"].filter(Boolean).join(", ")}); their rows may be missing.
        </p>
      )}
    </Panel>
  );
}

/** "The Steward did": its last run of each kind. */
async function StewardDidPanel() {
  const input = await withTiming("/admin steward-did", () => loadStewardDid());
  const did = lastRunsByMode(input.runs);
  return (
    <Panel
      title="The Steward did"
      id="steward-did"
      help="steward-did"
      aside={
        <Link href="/admin/steward/runs" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
          Every run
        </Link>
      }
    >
      {did.length === 0 ? (
        <Empty>{input.runs === null ? "Couldn't read the Steward's runs." : "The Steward hasn't run yet."}</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {did.map((r) => (
            <li key={r.key} className="py-2.5 first:pt-0 last:pb-0">
              <p className="font-semibold">
                {RUN_MODE_LABEL[r.mode] ?? r.mode} · {fmtDateTime(r.started)}
              </p>
              <p className="text-muted-foreground">
                {runWrote(r)}. Spent ${r.spent_usd.toFixed(2)} of ${r.budget_usd.toFixed(2)}.{r.stopped ? ` Stopped early: ${r.stopped}.` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** "How things are": six tiles, each a link into its door. */
async function HowThingsArePanel() {
  const input = await withTiming("/admin how-things-are", () => loadHowThingsAre());
  return (
    <section aria-labelledby="how-things-are-title">
      <h2 id="how-things-are-title" className="mb-3 inline-flex items-center gap-1.5 font-display text-lg font-bold tracking-tight">
        How things are
        <HelpTip help="how-things-are" />
      </h2>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles(input).map((t) => (
          <li key={t.label} className="relative rounded-2xl border bg-card p-4">
            <p className="flex items-center justify-between gap-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t.label}
              <HelpTip help={t.help} />
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold break-words tabular-nums sm:text-3xl">
              <Link href={t.href} className="underline-offset-4 hover:underline">
                {t.value}
              </Link>
            </p>
            {t.note && <p className="mt-0.5 text-xs text-muted-foreground">{t.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
