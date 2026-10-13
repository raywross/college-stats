/**
 * The instant state for /household/[person] and the pages under it (specs/product/household-hub.md): painted the
 * moment a person's chip is tapped, inside the hub's frame (app/household/layout.tsx stays on screen), until the
 * person's page streams in. A skeleton of the person area (components/account/PersonHeader.tsx: the name line with
 * its badges and the "⋯" button, the Plan | Numbers pills) and a generic content card, close enough for a student's
 * `OpenPlanCard`, a guardian's own list board (components/lists/ListBoard.tsx), and the Numbers form alike. Same
 * wrappers and spacing as the real page, so nothing shifts when it arrives. It reads no cookies, headers, or
 * session: it is the cheap part that has to render before any request data is known.
 */
const block = "animate-pulse bg-muted";

export default function PersonLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading this person's page">
      {/* PersonHeader: name line + badges, the "⋯" button, then Plan | Numbers */}
      <div className="space-y-4" aria-hidden>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={`${block} h-8 w-48 max-w-full rounded-full sm:h-9 sm:w-64`} />
            <div className="mt-1.5 flex items-center gap-2">
              <div className={`${block} h-5 w-20 rounded-full`} />
              <div className={`${block} h-4 w-24 rounded-full`} />
            </div>
          </div>
          <div className={`${block} size-10 shrink-0 rounded-full`} />
        </div>
        <div className="flex h-[50px] w-full rounded-full border bg-card p-0.5 sm:inline-flex sm:h-[42px] sm:w-[11rem]">
          <div className="flex-1 rounded-full bg-muted" />
          <div className="flex-1" />
        </div>
      </div>

      {/* The content card: OpenPlanCard, a guardian's list board, or the Numbers form all start with a block like this */}
      <div className="space-y-5" aria-hidden>
        <div className={`${block} h-28 w-full rounded-3xl`} />
        <div className={`${block} h-28 w-full rounded-3xl`} />
      </div>
    </div>
  );
}
