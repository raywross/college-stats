import Link from "next/link";
import { HelpTip } from "@/components/admin/HelpTip";
import { Panel } from "@/components/admin/Panel";

/**
 * What the console paints before its data arrives (specs/product/admin-speed.md "Wave 1" fix 5). The Inbox's three
 * panels stream under their own <Suspense> (app/admin/page.tsx); each fallback here is that panel's frame (the same
 * title, help icon, and aside the real panel has) with a few muted lines where its rows go, so the frame doesn't move
 * when the content lands. `ConsolePageSkeleton` is app/admin/loading.tsx: a page header and three panel frames, shown
 * the moment any console link is followed. Nothing here reads data, cookies, or the session.
 */

const block = "animate-pulse rounded-full bg-muted";

/** A row's shape: a chip and a title, a sentence under it, and a 44 px button on the right (stacked on a phone). */
function RowLines({ rows }: { rows: number }) {
  return (
    <ul className="divide-y divide-border" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className={`${block} h-5 w-20 shrink-0`} />
              <div className={`${block} h-5 w-64 max-w-full`} />
            </div>
            <div className={`${block} h-4 w-96 max-w-full`} />
          </div>
          <div className={`${block} h-11 w-24 shrink-0`} />
        </li>
      ))}
    </ul>
  );
}

/** "Needs you" while its sources are read. */
export function NeedsYouSkeleton() {
  return (
    <Panel title="Needs you" id="needs-you" help="needs-you">
      <div role="status" aria-busy="true" aria-label="Loading what needs you">
        <RowLines rows={3} />
      </div>
    </Panel>
  );
}

/** "The Steward did" while its runs are read: the "Every run" link is there at once. */
export function StewardDidSkeleton() {
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
      <ul className="divide-y divide-border" role="status" aria-busy="true" aria-label="Loading the Steward's runs">
        {[0, 1].map((i) => (
          <li key={i} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0" aria-hidden>
            <div className={`${block} h-5 w-48 max-w-full`} />
            <div className={`${block} h-5 w-80 max-w-full`} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** "How things are": the heading, and six tile frames, two across on a phone and three from `lg`. */
export function HowThingsAreSkeleton() {
  return (
    <section aria-labelledby="how-things-are-title">
      <h2 id="how-things-are-title" className="mb-3 inline-flex items-center gap-1.5 font-display text-lg font-bold tracking-tight">
        How things are
        <HelpTip help="how-things-are" />
      </h2>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3" role="status" aria-busy="true" aria-label="Loading how things are">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <TileFrame key={i} />
        ))}
      </ul>
    </section>
  );
}

/** One tile's frame: the label line, the big value, the note (the heights of text-xs, text-2xl/3xl, text-xs). */
function TileFrame() {
  return (
    <li className="rounded-2xl border bg-card p-4" aria-hidden>
      <div className="flex h-5 items-center">
        <div className={`${block} h-3 w-24 max-w-full`} />
      </div>
      <div className="mt-1 flex h-8 items-center sm:h-9">
        <div className={`${block} h-6 w-20 max-w-full sm:h-7`} />
      </div>
      <div className="mt-0.5 flex h-4 items-center">
        <div className={`${block} h-3 w-28 max-w-full`} />
      </div>
    </li>
  );
}

/** A panel's frame without its title (app/admin/loading.tsx doesn't know which page is coming). */
function PanelFrame({ rows }: { rows: number }) {
  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5" aria-hidden>
      <div className="flex h-7 items-center">
        <div className={`${block} h-5 w-40 max-w-full`} />
      </div>
      <div className="mt-3 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <div className={`${block} h-5 w-72 max-w-full`} />
            <div className={`${block} h-4 w-96 max-w-full`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Any console page while it loads: the header (a title, a subtitle line) and three panel frames. */
export function ConsolePageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading">
      <div className="mb-5 space-y-2" aria-hidden>
        <div className="flex h-8 items-center sm:h-9">
          <div className={`${block} h-7 w-44 max-w-full sm:h-8`} />
        </div>
        <div className={`${block} h-4 w-96 max-w-full`} />
      </div>
      <div className="space-y-6">
        <PanelFrame rows={3} />
        <PanelFrame rows={2} />
        <PanelFrame rows={2} />
      </div>
    </div>
  );
}
