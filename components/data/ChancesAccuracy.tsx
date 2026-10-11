/**
 * The Data page's "How well Quad's estimate did" (specs/chances/calibration.md "The accuracy summary"): per group and
 * admit-rate band, how many students shared outcomes and the share admitted with a 90% range; how students' own group
 * changes did beside the estimate; and who shares. Results only, never the method. Reads the summary view built from
 * `chances_summary` (lib/chances/summary.ts → summaryView); with nothing published, "not enough outcomes yet".
 * Server component; stacks to one column on phones.
 */
import type { ReactNode } from "react";
import { Term } from "@/components/ui/info-tip";
import { RATE_BANDS, type CellStats, type SummaryView } from "@/lib/chances/calibration";
import type { Group } from "@/lib/chances/snapshot";
import { num } from "@/lib/format";
import { dateLabel } from "@/lib/releases";

const GROUP_LABEL: Record<Group, string> = { reach: "Reach", target: "Target", likely: "Likely" };
const GROUP_ORDER: Group[] = ["reach", "target", "likely"];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const NOT_ENOUGH = "Not enough outcomes yet";

function CellLine({ label, cell }: { label: string; cell: CellStats }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t py-2 first:border-t-0">
      <span className="text-sm font-semibold">{label}</span>
      {cell.share !== null && cell.interval ? (
        <span className="text-sm">
          <b className="font-semibold">{pct(cell.share)} admitted</b>{" "}
          <span className="text-muted-foreground">
            ({pct(cell.interval.low)}–{pct(cell.interval.high)}) · {num(cell.n)} outcomes
          </span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">
          {NOT_ENOUGH}
          {cell.n > 0 && ` (${num(cell.n)} so far)`}
        </span>
      )}
    </div>
  );
}

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-3xl border bg-card p-5 sm:p-6">
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {children}
    </div>
  );
}

/** `season`: the season in progress (shown in the empty state as the first one to be summarized). */
export function ChancesAccuracy({ view, seasonInProgress }: { view: SummaryView | null; seasonInProgress: number }) {
  return (
    <>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        <Term term="quads-estimate">Quad&apos;s estimate</Term> puts each college on a student&apos;s list in a group: Reach,
        Target, or Likely. Students who choose to share their results tell us what happened, and after each admissions
        season we publish how the groups held up: for each group and each band of the college&apos;s overall admit rate,
        how many outcomes were shared and the share admitted, with a 90% range. A group with too few outcomes says so
        rather than guess.
      </p>
      {!view ? (
        <Card title={NOT_ENOUGH}>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The first summary comes after the season for the class entering in fall {seasonInProgress}, once students
            who applied share their results. Sharing is a choice each student makes in their plan, and it can be turned
            off any time.
          </p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The class entering in fall {view.season}: <b className="text-foreground">{num(view.total)}</b> shared{" "}
            {view.total === 1 ? "outcome" : "outcomes"}. Estimate version{view.modelVersions.length === 1 ? "" : "s"}{" "}
            {view.modelVersions.join(", ")}.{view.nextSummaryOn && ` Next summary ${dateLabel(view.nextSummaryOn)}.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {view.bands.map((b) => (
              <Card key={b.band} title={<>Admit rate {b.label.toLowerCase()}</>}>
                <div className="mt-2">
                  {GROUP_ORDER.map((g) => (
                    <CellLine key={g} label={GROUP_LABEL[g]} cell={b.cells[g]} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="When students changed the group">
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Students can move a college to a different group on their list. Where they did, the share admitted by the
                group they chose, beside the estimate&apos;s groups across every band.
              </p>
              <div className="mt-2">
                {GROUP_ORDER.map((g) => (
                  <div key={g} className="border-t py-2 first:border-t-0">
                    <p className="text-sm font-semibold">{GROUP_LABEL[g]}</p>
                    <p className="text-sm text-muted-foreground">
                      Student&apos;s choice: {view.student[g].share !== null ? `${pct(view.student[g].share!)} admitted of ${num(view.student[g].n)}` : NOT_ENOUGH.toLowerCase()} · Estimate:{" "}
                      {view.estimate[g].share !== null ? `${pct(view.estimate[g].share!)} admitted of ${num(view.estimate[g].n)}` : NOT_ENOUGH.toLowerCase()}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Who shares">
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Students who plan with Quad and share outcomes aren&apos;t all applicants: they lean toward selective lists
                and engaged families. Read the groups with this mix in mind.
              </p>
              {view.mix && view.mix.n > 0 ? (
                <dl className="mt-3 space-y-2 text-sm">
                  <div>
                    <dt className="font-semibold">By the college&apos;s admit rate</dt>
                    <dd className="text-muted-foreground">
                      {RATE_BANDS.filter((b) => view.mix!.bands[b.key])
                        .map((b) => `${b.label}: ${pct(view.mix!.bands[b.key]!)}`)
                        .join(" · ")}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">By state</dt>
                    <dd className="text-muted-foreground">{view.mix.states.map((s) => `${s.state}: ${pct(s.share)}`).join(" · ")}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Applied without a test score</dt>
                    <dd className="text-muted-foreground">{pct(view.mix.testOptional)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{NOT_ENOUGH}.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
