/**
 * The instant state for /explore: painted the moment Explore is tapped, until the filtered results stream in
 * (the page is a dynamic render that reads the URL's filters). It is the page's own shell with placeholders where
 * the data goes, using the same wrappers and spacing as app/explore/page.tsx so nothing shifts: the heading, the
 * three summary tiles, the filter rail (large screens), the toolbar row (search, filters, sort, view), the match
 * count, and the results (rows in one column on phones, six cards in two or three columns from `sm`). Only fixed
 * text and shapes; it reads no cookies, headers, or session.
 */
const block = "animate-pulse bg-muted";

export default function ExploreLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-5 pb-12 sm:px-6 sm:pt-10" role="status" aria-busy="true" aria-label="Loading colleges">
      <header className="mb-4 flex flex-col gap-3 sm:mb-8 sm:gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-2 hidden text-xs font-bold tracking-[0.18em] text-primary uppercase sm:block">Explore</p>
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">
            Find your <span className="highlight">fit</span>
          </h1>
          <p className="mt-2 hidden max-w-xl text-muted-foreground sm:block">
            Filter by selectivity, scores, and size, then switch between cards, a sortable table, charts, or a map.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border bg-card px-3 py-2 sm:px-4 sm:py-2.5">
              <div className="flex h-4 items-center">
                <div className={`${block} h-2.5 w-12 rounded-full sm:w-16`} />
              </div>
              <div className="flex h-7 items-center sm:h-8">
                <div className={`${block} h-5 w-10 rounded-full sm:h-6 sm:w-14`} />
              </div>
            </div>
          ))}
        </div>
      </header>

      <div className="flex gap-8" aria-hidden>
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="space-y-5 rounded-3xl border bg-card p-5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-2.5">
                <div className={`${block} h-4 w-28 rounded-full`} />
                <div className={`${block} h-8 w-full rounded-xl`} />
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-3 sm:space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
            <div className={`${block} h-10 min-w-0 rounded-full sm:flex-1`} />
            <div className={`${block} h-10 w-28 shrink-0 rounded-full lg:hidden`} />
            <div className={`${block} h-10 min-w-0 rounded-full sm:w-52`} />
            <div className={`${block} h-10 w-24 shrink-0 rounded-full`} />
          </div>

          <div className={`${block} h-5 w-44 max-w-full rounded-full`} />

          <ul className="space-y-2 sm:hidden">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="flex h-[74px] items-center gap-3 rounded-2xl border bg-card p-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className={`${block} h-4 w-4/5 rounded-full`} />
                  <div className={`${block} h-3 w-1/2 rounded-full`} />
                </div>
                <div className={`${block} h-8 w-14 shrink-0 rounded-xl`} />
              </li>
            ))}
          </ul>
          <div className="hidden gap-4 sm:grid sm:grid-cols-2 2xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex h-[26rem] flex-col rounded-3xl border bg-card p-5">
                <div className="flex items-start gap-3">
                  <div className={`${block} size-12 shrink-0 rounded-xl`} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className={`${block} h-5 w-3/4 rounded-full`} />
                    <div className={`${block} h-3 w-1/2 rounded-full`} />
                  </div>
                </div>
                <div className={`${block} mt-5 h-10 w-24 rounded-xl`} />
                <div className="mt-5 space-y-3">
                  {[0, 1, 2, 3].map((j) => (
                    <div key={j} className={`${block} h-2 w-full rounded-full`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
