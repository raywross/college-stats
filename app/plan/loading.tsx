/**
 * The instant state for /plan (specs/planner/redesign/page.md): a skeleton of the header card and Next up side by
 * side, the tab row, and a few list rows, painted the moment the link is tapped, until the real page (which reads
 * the session) streams in. Reads no cookies, headers, or session: it is the cheap part that has to render before
 * any request data is known.
 */
const block = "animate-pulse bg-muted";

export default function PlanLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading your plan">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]" aria-hidden>
        <div className="rounded-3xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <div className={`${block} size-10 shrink-0 rounded-full`} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className={`${block} h-6 w-32 rounded-full`} />
              <div className={`${block} h-4 w-48 max-w-full rounded-full`} />
            </div>
          </div>
          <div className={`${block} mt-4 h-11 w-full max-w-72 rounded-2xl`} />
        </div>
        <div className="flex min-w-60 flex-col justify-center gap-2 rounded-3xl bg-muted p-5 sm:min-w-60">
          <div className="h-3 w-16 rounded-full bg-background/40" />
          <div className="h-5 w-40 rounded-full bg-background/40" />
          <div className="h-4 w-32 rounded-full bg-background/40" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${block} h-11 w-28 rounded-full`} />
        ))}
      </div>
      <ul className="space-y-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={`${block} h-16 w-full rounded-2xl`} />
        ))}
      </ul>
    </div>
  );
}
