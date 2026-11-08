import type { CardTone, CheckSummaryHost, SlateHostStatus, VisitEventsHealth, VisitRunRow } from "@/lib/admin/visit-events";
import { cardTone } from "@/lib/admin/visit-events";
import { timeLabel } from "@/lib/admin/ops-view";
import { Panel, Empty } from "@/components/admin/Panel";
import { ResponsiveTable, type Column } from "@/components/admin/ResponsiveTable";
import { cn } from "@/lib/utils";

/** Exported so the console landing page's tile can show the same word (specs/product/visit-events.md "Nobody sees
 * it break": the tile links to `/admin/data/health#visit-events`). */
export const VISIT_EVENTS_TONE_LABEL: Record<CardTone, string> = { red: "Check this", amber: "Worth a look", green: "All clear" };
const TONE_RING: Record<CardTone, string> = {
  red: "border-destructive ring-1 ring-destructive/50",
  amber: "border-warning ring-1 ring-warning/50",
  green: "border-border",
};
const TONE_DOT: Record<CardTone, string> = {
  red: "bg-destructive ring-2 ring-destructive/30",
  amber: "bg-warning/70",
  green: "border border-muted-foreground/60",
};

const HOST_STATUS_LABEL: Record<SlateHostStatus, string> = { active: "Active", unreachable: "Unreachable", no_events: "No events", off: "Off" };
const HOST_STATUS_ORDER: readonly SlateHostStatus[] = ["active", "unreachable", "no_events", "off"];

const num = (n: number) => n.toLocaleString("en-US");

/**
 * "637 failed (630 weekly retries of unreachable hosts), 0 collapsed": the retries are expected failures the guard
 * leaves out (specs/product/visit-events.md "Keeping it running", 2026-11-01), so the note says how many of the
 * failures they were.
 */
export function failedNote(run: Pick<VisitRunRow, "hostsFailed" | "hostsCollapsed" | "retriesFailed">): string {
  const retries = run.retriesFailed > 0 ? ` (${num(run.retriesFailed)} weekly retr${run.retriesFailed === 1 ? "y" : "ies"} of unreachable hosts)` : "";
  return `${num(run.hostsFailed)} failed${retries}, ${num(run.hostsCollapsed)} collapsed`;
}

/**
 * The Visit events card on `/admin/data/health` (specs/product/visit-events.md "Keeping it running", "Nobody sees it
 * break"): the last 7 nights, hosts by status, and the newest run's data-check summary. `now` is passed in (rather
 * than read with `new Date()` here) so the page and its tests agree on one clock.
 */
export function VisitEventsCard({ health, now }: { health: VisitEventsHealth; now: Date }) {
  const tone = cardTone(health.newest, now);
  return (
    <Panel
      id="visit-events"
      title="Visit events"
      aside={
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium">
          <span aria-hidden className={cn("size-2.5 rounded-full", TONE_DOT[tone])} />
          {VISIT_EVENTS_TONE_LABEL[tone]}
        </span>
      }
      className={TONE_RING[tone]}
    >
      {!health.newest ? (
        <Empty>No visit-events run has been recorded yet.</Empty>
      ) : (
        <div className="space-y-4">
          <NewestRunSummary run={health.newest} now={now} />
          <HostsByStatus hostsByStatus={health.hostsByStatus} />
          <RunsTable runs={health.runs} />
          <CheckSummary run={health.newest} />
        </div>
      )}
    </Panel>
  );
}

function NewestRunSummary({ run, now }: { run: VisitRunRow; now: Date }) {
  const staleHours = Math.round((now.getTime() - Date.parse(run.ranAt)) / (60 * 60 * 1000));
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-4">
      <Stat label="Last run" value={timeLabel(run.ranAt)} note={staleHours >= 36 ? `${num(staleHours)} h ago` : undefined} />
      <Stat label="Hosts read" value={num(run.hostsRead)} note={run.hostsFailed || run.hostsCollapsed ? failedNote(run) : undefined} />
      <Stat label="Events" value={`+${num(run.eventsNew)} / ~${num(run.eventsChanged)} / -${num(run.eventsRemoved)}`} note="new / changed / removed" />
      <Stat
        label="Data check"
        value={run.checkFailures === null && run.checkWarnings === null ? "—" : `${num(run.checkFailures ?? 0)} failing, ${num(run.checkWarnings ?? 0)} warnings`}
        note={run.missesWithheld ? "Misses withheld this run" : undefined}
      />
    </dl>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</dd>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function HostsByStatus({ hostsByStatus }: { hostsByStatus: Record<SlateHostStatus, number> }) {
  return (
    <ul className="flex flex-wrap gap-3 text-sm">
      {HOST_STATUS_ORDER.map((s) => (
        <li key={s} className="rounded-xl border border-border px-3 py-1.5">
          <span className="text-muted-foreground">{HOST_STATUS_LABEL[s]}</span> <span className="font-semibold tabular-nums">{num(hostsByStatus[s])}</span>
        </li>
      ))}
    </ul>
  );
}

const runsColumns: readonly Column<VisitRunRow>[] = [
  { key: "ran", header: "Ran", role: "title", cell: (run) => timeLabel(run.ranAt) },
  {
    key: "hosts",
    header: "Hosts",
    cell: (run) => (
      <>
        {num(run.hostsRead)}
        {(run.hostsFailed > 0 || run.hostsCollapsed > 0) && <span className="text-muted-foreground"> ({failedNote(run)})</span>}
      </>
    ),
  },
  { key: "events", header: "Events", cell: (run) => `+${num(run.eventsNew)} / ~${num(run.eventsChanged)} / -${num(run.eventsRemoved)}` },
  { key: "withheld", header: "Withheld", role: "detail", cell: (run) => (run.missesWithheld ? "Yes" : "No") },
  {
    key: "check",
    header: "Check",
    cell: (run) => (run.checkFailures === null && run.checkWarnings === null ? <span className="text-muted-foreground">—</span> : `${num(run.checkFailures ?? 0)} / ${num(run.checkWarnings ?? 0)}`),
  },
];

function RunsTable({ runs }: { runs: readonly VisitRunRow[] }) {
  return <ResponsiveTable rows={runs} columns={runsColumns} rowKey={(run) => String(run.id)} caption={`The last ${runs.length} visit-events runs, newest first`} empty="No run has been recorded yet." />;
}

function CheckSummary({ run }: { run: VisitRunRow }) {
  const summary = run.checkSummary;
  if (!summary) return null;
  if (!summary.listed.length) return <p className="text-sm text-muted-foreground">The data check found nothing to flag on the last run.</p>;
  const shown = summary.listed.slice(0, 10);
  const hiddenInListed = summary.listed.length - shown.length;
  const more = hiddenInListed + summary.omitted;
  return (
    <div className="space-y-1.5 text-sm">
      <p className="font-semibold">Hosts the data check flagged</p>
      <ul className="space-y-1">
        {shown.map((h, i) => (
          <HostFlag key={h.unit_id || h.host || i} host={h} />
        ))}
      </ul>
      {more > 0 && <p className="text-xs text-muted-foreground">and {num(more)} more.</p>}
    </div>
  );
}

function HostFlag({ host }: { host: CheckSummaryHost }) {
  return (
    <li className="rounded-lg border border-border px-3 py-1.5">
      <span className="font-medium">{host.host || host.unit_id || "Unknown host"}</span>
      {host.failures.length > 0 && <span className="ml-2 text-destructive">{host.failures.length === 1 ? host.failures[0] : `${num(host.failures.length)} failures`}</span>}
      {host.warnings.length > 0 && <span className="ml-2 text-muted-foreground">{host.warnings.length === 1 ? host.warnings[0] : `${num(host.warnings.length)} warnings`}</span>}
    </li>
  );
}
