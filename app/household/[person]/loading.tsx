/**
 * The instant state for /household/[person] and the pages under it (specs/product/household-hub.md): painted the
 * moment a person's chip is tapped, inside the hub's frame (app/household/layout.tsx stays on screen), until the
 * person's page streams in. A skeleton of the person area and a list: the name line with its badges and the "⋯"
 * button (components/account/PersonHeader.tsx), the List | Plan | Numbers pills (full width with 44px pills on phones), the
 * list's title and list switcher, and four college rows (components/lists/ListBoard.tsx). Same wrappers and spacing
 * as the real page, so nothing shifts when it arrives. It reads no cookies, headers, or session: it is the cheap
 * part that has to render before any request data is known.
 */
const block = "animate-pulse bg-muted";

export default function PersonLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Loading this person's page">
      {/* PersonHeader: name line + badges, the "⋯" button, then List | Plan | Numbers */}
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
        <div className="flex h-[50px] w-full rounded-full border bg-card p-0.5 sm:inline-flex sm:h-[42px] sm:w-[16.5rem]">
          <div className="flex-1 rounded-full bg-muted" />
          <div className="flex-1" />
          <div className="flex-1" />
        </div>
      </div>

      {/* ListPage (embedded): title row, list switcher, then the board */}
      <div className="space-y-6" aria-hidden>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={`${block} h-9 w-40 rounded-xl`} />
          <div className={`${block} size-9 rounded-full`} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`${block} h-8 w-24 rounded-full`} />
          <div className={`${block} h-8 w-20 rounded-full`} />
        </div>
        <div className="space-y-5">
          <div className={`${block} h-5 w-56 max-w-full rounded-full`} />
          <section>
            <div className={`${block} mb-2 h-7 w-32 rounded-full`} />
            <ul className="divide-y rounded-2xl border bg-card">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="p-3 sm:px-4">
                  <div className="flex items-start gap-3">
                    <div className={`${block} size-9 shrink-0 rounded-lg`} />
                    <div className="min-w-0 flex-1">
                      <div className={`${block} h-5 w-48 max-w-full rounded-full`} />
                      <div className={`${block} mt-2 h-3.5 w-36 max-w-full rounded-full`} />
                    </div>
                    <div className={`${block} h-9 w-16 shrink-0 rounded-full`} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
