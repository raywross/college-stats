import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AdminForm } from "@/components/admin/AdminForm";
import { EssayPromptsForm } from "@/components/admin/EssayPromptsForm";
import { Empty, Fields, PageHeader, Panel } from "@/components/admin/Panel";
import { requireAdmin } from "@/lib/admin/auth";
import { CONFIRM_DELETE_RECORD, fmtDate } from "@/lib/admin/console";
import { ESSAY_STATUS_LABELS, essayStatus, overrideFor } from "@/lib/admin/essays";
import { deleteEssayPrompts, saveEssayPrompts } from "@/lib/admin/essays-actions";
import { draftFromRecord, emptyDraft, formLabel } from "@/lib/admin/essays-form";
import { currentCycle } from "@/lib/planner/cycle";
import { getData } from "@/lib/data";
import type { EssayFormKind, School } from "@/lib/types";

export const metadata: Metadata = { title: "Essay questions", robots: { index: false, follow: false } };

/** The form a new read starts on: Common App for a member, the Coalition for one of its members, else the college's own. */
function defaultForm(school: School): EssayFormKind {
  if (school.apply?.common_app?.member) return "common_app";
  if (school.coalition) return "coalition";
  return "own";
}

/**
 * /admin/essays/[unit] (specs/product/essays/sources.md "The hand read"): what the reader found on the college's own
 * page (so the person knows what they're overriding), then the form for the open cycle, prefilled from the saved row of
 * `essay_prompt_overrides` when there is one, and Delete for a saved row (typed). Save is live on the advisor at once.
 * With the table unreadable the form isn't shown: a save could replace a row the page couldn't see.
 */
export default async function EssayFormPage({ params }: PageProps<"/admin/essays/[unit]">) {
  await connection();
  await requireAdmin();
  const { unit } = await params;
  if (!/^\d{6,8}$/.test(unit)) notFound();
  const school = (await getData()).getSchoolById(unit);
  if (!school) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const cycle = currentCycle(today);
  const saved = await overrideFor(unit, cycle);
  const essays = school.essays;
  const found = essayStatus(school);
  const quote = school.lineage?.essays?.quote;

  return (
    <>
      <PageHeader
        back={
          <Link href="/admin/essays" className="text-muted-foreground underline-offset-4 hover:underline">
            Essays
          </Link>
        }
        title={school.name}
        subtitle={
          <>
            Essay questions for {cycle} · unit {unit} ·{" "}
            <Link href={`/schools/${unit}`} className="underline-offset-4 hover:underline">
              Public profile
            </Link>
          </>
        }
      />
      <div className="max-w-3xl space-y-5">
        <Panel title="What the reader found" id="found">
          <Fields
            items={[
              { label: "Status", value: ESSAY_STATUS_LABELS[found] },
              ...(essays?.confidence === "confirmed" && essays.read_on
                ? [{ label: "Source", value: `From the application form, read by hand on ${fmtDate(essays.read_on)}` }]
                : essays
                  ? [
                      {
                        label: "Source",
                        value: (
                          <a href={essays.source_url} target="_blank" rel="noopener noreferrer" className="break-all underline-offset-4 hover:underline">
                            {essays.source_url}
                          </a>
                        ),
                      },
                      { label: "Read on", value: fmtDate(essays.retrieved) },
                    ]
                  : []),
              ...(essays?.status === "published" ? [{ label: "Questions", value: String(essays.prompts.length) }] : []),
            ]}
          />
          {quote && <blockquote className="mt-3 border-l-2 pl-3 text-sm break-words text-muted-foreground">&ldquo;{quote}&rdquo;</blockquote>}
          {found === "published" && (
            <p className="mt-3 text-sm font-medium">The college prints its questions on its own page, which wins over a hand read; enter one only if that page is wrong for this cycle.</p>
          )}
        </Panel>

        <Panel title="Enter the questions" id="form">
          {!saved.ok ? (
            <Empty>Saved hand reads can&apos;t be read on this deployment (the essay_prompt_overrides table, or sign-in, isn&apos;t set up), so the form isn&apos;t shown.</Empty>
          ) : (
            <div className="space-y-4">
              {saved.row && (
                <p className="text-sm text-muted-foreground">
                  Saved: {formLabel(saved.row.record.form)}, read {fmtDate(saved.row.read_on)} by {saved.row.reader}. Saving again replaces it.
                </p>
              )}
              <EssayPromptsForm
                action={saveEssayPrompts}
                unitId={unit}
                name={school.name}
                initial={saved.row ? draftFromRecord(saved.row.record) : emptyDraft({ cycle, form: defaultForm(school), today })}
                openCycle={cycle}
                today={today}
              />
            </div>
          )}
        </Panel>

        {saved.ok && saved.row && (
          <Panel title="Delete the hand read" id="delete">
            <AdminForm
              action={deleteEssayPrompts}
              hidden={{ unit, cycle }}
              trigger="Delete"
              tone="danger"
              description={<>Removes the saved questions for {cycle}. The advisor goes back to what the college&apos;s own page says.</>}
              typed={{ expected: CONFIRM_DELETE_RECORD }}
            />
          </Panel>
        )}
      </div>
    </>
  );
}
