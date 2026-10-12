import type { DataPull } from "@/lib/github-app";
import { CHECKS_LABELS, dayLabel, flagLabel, mergeBlock } from "@/lib/admin/ops-view";
import { renderPullBody } from "@/lib/admin/pr-markdown";
import { closeAction, holdAction, mergeAction, rerunCiAction } from "@/app/admin/operations/actions";
import { OpsActionForm } from "@/components/admin/ops/OpsActionForm";

/**
 * Open data pull requests (the pipelines' `data/` branches and the console's own `review/` ones): the ones waiting
 * for a person first, each with the body its workflow wrote rendered as the PR shows it (as untrusted text:
 * lib/admin/pr-markdown.ts), its CI status, whether auto-merge is on, and Approve and merge, Hold, Close. A refusal
 * (checks pending or failed) comes back from the Server Action in words and is also shown here before the click.
 */
export function PullList({ pulls }: { pulls: DataPull[] }) {
  if (!pulls.length) {
    return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No data pull requests are open.</p>;
  }
  return (
    <ul className="space-y-4">
      {pulls.map((pull) => {
        const flag = flagLabel(pull.flagged);
        const block = mergeBlock(pull);
        return (
          <li key={pull.number} className={`rounded-2xl border bg-card p-4 ${flag ? "border-warning ring-1 ring-warning/50" : "border-border"}`}>
            {flag && (
              <p className="mb-3 rounded-lg bg-warning/15 px-3 py-2 text-sm font-medium" role="note">
                Waits for a person. {flag}
              </p>
            )}
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 text-base font-semibold">
                <a href={pull.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                  #{pull.number} {pull.title}
                </a>
              </h3>
              <p className="text-sm text-muted-foreground">
                {pull.kind === "review" ? "Review queue change" : "Pipeline run"} · opened {dayLabel(pull.createdAt)}
                {pull.author && ` by ${pull.author}`}
              </p>
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>{CHECKS_LABELS[pull.checks]}</span>
              <span>{pull.autoMerge ? "Auto-merge is on" : "Auto-merge is off"}</span>
              {pull.draft && <span>Draft</span>}
            </p>

            {pull.body.trim() && (
              <details className="mt-3 rounded-xl border border-border" open={Boolean(flag)}>
                <summary className="min-h-10 cursor-pointer px-3 py-2 text-sm font-semibold">What this run reports</summary>
                <div className="spec-prose border-t border-border px-3 py-3 text-sm" dangerouslySetInnerHTML={{ __html: renderPullBody(pull.body) }} />
              </details>
            )}

            <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-3">
              <div>
                {block ? (
                  <>
                    <button type="button" disabled className="inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground opacity-60">
                      Approve and merge
                    </button>
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">{block}</p>
                  </>
                ) : (
                  <OpsActionForm action={mergeAction} fields={{ pull: String(pull.number) }} label="Approve and merge" pendingLabel="Merging…" />
                )}
              </div>
              {pull.autoMerge && <OpsActionForm action={holdAction} fields={{ pull: String(pull.number) }} label="Hold" pendingLabel="Holding…" tone="neutral" />}
              {pull.checks === "none" && <OpsActionForm action={rerunCiAction} fields={{ branch: pull.branch }} label="Re-run CI" pendingLabel="Starting…" tone="neutral" />}
              <OpsActionForm action={closeAction} fields={{ pull: String(pull.number) }} label="Close" pendingLabel="Closing…" tone="danger" confirm="Close this pull request?" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
