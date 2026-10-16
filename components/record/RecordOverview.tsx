import Link from "next/link";
import { ImportLocalProfile } from "@/components/me/ImportLocalProfile";
import { RecordOverviewOpened } from "@/components/record/RecordOverviewOpened";
import { RecordReading } from "@/components/record/RecordReading";
import { RecordRow } from "@/components/record/RecordRow";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import type { PlanLoad } from "@/lib/planner/load";
import { guideHref } from "@/lib/planner/guides";
import { RECORD_STEPS, recordHref, recordNeeded, recordProgress, recordTitle } from "@/lib/planner/record";
import type { ProfileAccess } from "@/lib/student-profile-store";

/** A step's rail label, by step (RECORD_STEPS, lib/planner/record.ts). */
const RAIL_BY_STEP = new Map(RECORD_STEPS.map((s) => [s.step, s.rail]));

/**
 * The record overview (specs/planner/record/steps.md "The overview"): replaces the Numbers page's profile form and
 * completeness meter. The header ("{First}'s record" / "Your record"), a Fill it in button on a first-run record,
 * "How complete is this" with the bar and one row per step, and nothing else — no form, no plan card, no course or
 * test links (those are moves, shown on Now). Server-rendered (the rows are static with links); the telemetry mount
 * is the one small client island (RecordOverviewOpened).
 */
export function RecordOverview({ profile, plan, back = "record" }: { profile: ProfileAccess; plan: PlanLoad; /** Where a step's save returns: the household record page, or the record inline on the plan (RecordInline). */ back?: "record" | "inline" }) {
  const person = profile.relation === "self" ? null : profile.student.id;
  const firstName = profile.relation === "guardian" ? (profile.student.display_name?.trim().split(/\s+/)[0] ?? null) : null;
  const title = recordTitle(firstName);
  const needed = recordNeeded({ profile: profile.data, student: profile.student });
  const { done, total, rows } = recordProgress(profile.data, { relation: profile.relation });
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <RecordOverviewOpened viewer={profile.relation === "guardian" ? "guardian" : "student"} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Everything a college reads about you, in one place.</p>
        </div>
        {needed && profile.canEdit && (
          <Link
            href={recordHref({ person, step: 0, back })}
            className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground sm:h-10"
          >
            Fill it in
          </Link>
        )}
      </div>

      {profile.relation === "self" && <ImportLocalProfile studentId={profile.student.id} canEdit={profile.canEdit} />}

      <div className="rounded-3xl border bg-card p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold">How complete is this</h3>
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">
            {done} of {total}
          </span>
        </div>
        <Progress value={pct} className="mt-3">
          <ProgressTrack>
            <ProgressIndicator />
          </ProgressTrack>
        </Progress>
        <ul className="mt-4 divide-y">
          {rows.map((row) => {
            // Your story and Recommenders link their guide, not the tour step (steps.md: "the guide is the
            // better editor"); their state reads "Written" / "Not yet", "{n} teachers, {m} asked" either way.
            if (row.section === "story") {
              return (
                <RecordRow
                  key={row.section}
                  name="Your story"
                  done={row.done}
                  text={row.summary ?? "Not yet"}
                  href={guideHref("story", { person, from: "profile" })}
                  action="Open your story"
                />
              );
            }
            if (row.section === "recommenders") {
              return (
                <RecordRow
                  key={row.section}
                  name="Recommenders"
                  done={row.done}
                  text={row.summary ?? "Not yet"}
                  href={guideHref("recommenders", { person, from: "profile" })}
                  action="Pick your recommenders"
                />
              );
            }
            return (
              <RecordRow
                key={row.section}
                name={RAIL_BY_STEP.get(row.step) ?? row.section}
                done={row.done}
                text={row.done ? row.summary ?? "" : row.unlock}
                href={profile.canEdit ? recordHref({ person, step: row.step, back }) : null}
                action={row.done ? "Edit" : "Add"}
              />
            );
          })}
        </ul>
        <RecordReading
          person={person}
          canEdit={profile.canEdit}
          profileData={profile.data}
          estimates={plan.kind === "ready" ? plan.ctx.estimates : {}}
          items={plan.kind === "ready" ? plan.ctx.items : []}
        />
      </div>
    </div>
  );
}
