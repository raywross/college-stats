import type { RunRow } from "@/lib/admin/ops";
import { formatDuration, runFailed, runOutcome, startedBy, timeLabel } from "@/lib/admin/ops-view";
import { RunChip } from "@/components/admin/ops/OpsStatusChip";

/**
 * The last runs of the workflows the console can start: status (a failed run names its failed step), who or what
 * started it, when, how long it took, and the data PR it opened while that PR is still open. Each links to GitHub.
 */
export function RunsTable({ runs }: { runs: RunRow[] }) {
  if (!runs.length) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">GitHub lists no runs of these workflows, or they could not be read just now.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">The last {runs.length} runs of the console&apos;s workflows, newest first</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Run
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Started
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Duration
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Opened
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map(({ run, consoleAdmin, failedStep, pull }) => {
            const outcome = runOutcome(run);
            return (
              <tr key={run.id} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  <a href={run.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                    {run.name || run.workflow} #{run.runNumber}
                  </a>
                  <div className="text-xs font-normal text-muted-foreground">{run.workflow}</div>
                </th>
                <td className="px-3 py-2">
                  <RunChip label={outcome.label} tone={outcome.tone} />
                  {runFailed(run) && failedStep && <div className="mt-0.5 text-xs text-muted-foreground">Failed at {failedStep}</div>}
                </td>
                <td className="px-3 py-2">
                  {timeLabel(run.startedAt ?? run.createdAt)}
                  <div className="text-xs text-muted-foreground">{startedBy(run, consoleAdmin)}</div>
                </td>
                <td className="px-3 py-2 tabular-nums">{formatDuration(run.durationMs)}</td>
                <td className="px-3 py-2">
                  {pull ? (
                    <a href={pull.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                      Pull request #{pull.number}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
