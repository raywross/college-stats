"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { CoreSubjects } from "@/components/profile/CoreSubjects";
import { CourseRow, selectCls } from "@/components/profile/CourseRow";
import { SourceTip } from "@/components/ui/info-tip";
import { apCourses, catalogCourse, ibCourses } from "@/lib/chances/catalog";
import { gradeNow, groupByYear, isStemMajor, newCourse, SUBJECT_LABELS } from "@/lib/chances/courses";
import { noteText } from "@/lib/chances/notes";
import { pickerOffering } from "@/lib/chances/rigor-store";
import type { OfferingView } from "@/lib/chances/rigor-view";
import type { CourseEntry, CourseKind, CourseSubject } from "@/lib/chances/types";
import { COURSES_MAX, courseRigorCountOf, reconcileCourseCount, type CoreAtTopLevel } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

export interface CoursePickerValue {
  courses: CourseEntry[];
  coreAtTopLevel: CoreAtTopLevel;
  apExamsPrivate: boolean;
}

const TYPED_SUBJECTS: CourseSubject[] = ["english", "math", "science", "history", "language", "cs", "arts", "other"];
const STEM_SUBJECTS: CourseSubject[] = ["math", "science"];

function Chip({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "inline-flex min-h-10 items-center rounded-full border px-3 py-1.5 text-left text-sm leading-tight transition-colors disabled:opacity-50",
        on ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The course picker (specs/chances/rigor-in-context.md "Entering them"). Chips from the student's school's AP list (or
 * the whole catalog with search), then one line per course: year, status, and grades, with the AP exam score behind a
 * disclosure. A student can enter counts only ("I've taken 5 APs") and name them later. The core-subject question is
 * pre-checked from the list, and a student whose first intended major is math- or science-heavy can add their other
 * math and science courses. Controlled: the parent holds the value and saves it (the /me form posts it, the plan's
 * sheet and the signed-out plan call their own save).
 */
export function CoursePicker({
  value,
  onChange,
  highSchoolId,
  gradYear,
  majors,
  showExams,
  canSetPrivacy,
  disabled,
}: {
  value: CoursePickerValue;
  onChange: (next: CoursePickerValue) => void;
  highSchoolId: string | null;
  gradYear: number | null;
  majors: readonly string[];
  /** Whether this viewer may see and enter AP exam scores (false for a guardian while they are private). */
  showExams: boolean;
  /** Whether this viewer may change the privacy switch (the student). */
  canSetPrivacy: boolean;
  disabled?: boolean;
}) {
  const { courses } = value;
  const grade = useMemo(() => gradeNow(gradYear, new Date().toISOString().slice(0, 10)), [gradYear]);
  const [query, setQuery] = useState("");
  const [showAllAp, setShowAllAp] = useState(false);
  const [fetched, setFetched] = useState<{ id: string; view: OfferingView | null } | null>(null);
  const [typed, setTyped] = useState<{ kind: "dual" | "honors"; name: string; subject: CourseSubject }>({ kind: "dual", name: "", subject: "math" });
  const [countText, setCountText] = useState<string | null>(null);

  useEffect(() => {
    if (!highSchoolId) return;
    let cancelled = false;
    pickerOffering(highSchoolId)
      .then((view) => {
        if (!cancelled) setFetched({ id: highSchoolId, view });
      })
      .catch(() => {
        if (!cancelled) setFetched({ id: highSchoolId, view: null });
      });
    return () => {
      cancelled = true;
    };
  }, [highSchoolId]);
  const offering = highSchoolId && fetched?.id === highSchoolId ? fetched.view : null;

  const set = (next: Partial<CoursePickerValue>) => onChange({ ...value, ...next });
  const setCourses = (next: CourseEntry[]) => set({ courses: next });
  const full = courses.length >= COURSES_MAX;
  const keys = useMemo(() => new Set(courses.map((c) => c.key).filter((k): k is string => k !== null)), [courses]);

  const toggleCatalog = (key: string, kind: CourseKind) => {
    if (keys.has(key)) setCourses(courses.filter((c) => c.key !== key));
    else if (!full) setCourses([...courses, newCourse({ kind, key, grade })]);
  };

  const schoolAp = offering?.apKeys ? offering.apKeys.map((k) => catalogCourse(k)).filter((c): c is NonNullable<typeof c> => c !== null) : null;
  const q = query.trim().toLowerCase();
  const matches = (name: string) => q === "" || name.toLowerCase().includes(q);
  const apChips = (schoolAp && !showAllAp ? schoolAp : [...apCourses()]).filter((c) => matches(c.name));
  const ibChips = ibCourses().filter((c) => matches(c.name));

  const mainRows = courses.filter((c) => c.kind !== "regular");
  const regularRows = courses.filter((c) => c.kind === "regular");
  const stem = isStemMajor(majors);

  const replace = (next: CourseEntry) => setCourses(courses.map((c) => (c.id === next.id ? next : c)));
  const remove = (id: string) => setCourses(courses.filter((c) => c.id !== id));

  const addTyped = () => {
    const name = typed.name.trim();
    if (!name || full) return;
    setCourses([...courses, newCourse({ kind: typed.kind, name: name.slice(0, 60), subject: typed.subject, grade, year: grade && grade >= 9 ? (grade as CourseEntry["year"]) : 11 })]);
    setTyped({ ...typed, name: "" });
  };
  const addRegular = (subject: CourseSubject) => {
    if (full) return;
    setCourses([...courses, newCourse({ kind: "regular", name: "", subject, grade, year: grade && grade >= 9 ? (grade as CourseEntry["year"]) : 11 })]);
  };

  const advancedCount = courseRigorCountOf(courses);
  const applyCount = (text: string) => {
    setCountText(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= COURSES_MAX) setCourses(reconcileCourseCount(courses, n));
  };

  const prompt = offering?.apKeys && schoolAp ? noteText({ key: "offering.pick_prompt", values: { count: schoolAp.length } }) : null;

  return (
    <div
      className="space-y-5"
      // Inside the /me form, Enter in a field here must not save the whole profile.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
    >
      <section aria-label="Pick your courses" className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Pick your AP, IB, dual-enrollment, and honors courses</h3>
          {prompt ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
              {prompt}
              {offering?.cite && <SourceTip cited={offering.cite} />}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {highSchoolId && offering ? `${offering.lines[0]} ` : ""}
              Tap the ones you&apos;ve taken, are taking, or plan to take.{highSchoolId ? "" : " Pick your high school to start from its list."}
            </p>
          )}
        </div>

        <label className="flex h-10 items-center gap-2 rounded-full border bg-background px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses"
            aria-label="Search courses"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {apChips.map((c) => (
            <Chip key={c.key} on={keys.has(c.key)} disabled={disabled || (full && !keys.has(c.key))} onClick={() => toggleCatalog(c.key, "ap")}>
              {c.name}
            </Chip>
          ))}
          {apChips.length === 0 && <p className="text-sm text-muted-foreground">No AP course matches &ldquo;{query}&rdquo;.</p>}
        </div>
        {schoolAp && (
          <button type="button" onClick={() => setShowAllAp((v) => !v)} className="text-xs font-semibold text-primary hover:underline">
            {showAllAp ? "Show only my school's list" : "Not on the list? Show every AP course"}
          </button>
        )}

        <details className="rounded-2xl border bg-card px-3 py-2" open={q !== "" && ibChips.length > 0 && apChips.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold">IB, dual enrollment, and honors</summary>
          <div className="mt-3 space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">IB courses</p>
              <div className="flex flex-wrap gap-2">
                {ibChips.map((c) => (
                  <Chip key={c.key} on={keys.has(c.key)} disabled={disabled || (full && !keys.has(c.key))} onClick={() => toggleCatalog(c.key, c.level === "hl" ? "ib_hl" : "ib_sl")}>
                    {c.name}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Add a dual-enrollment or honors course</p>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr_9rem_auto]">
                <select aria-label="Kind of course" value={typed.kind} onChange={(e) => setTyped({ ...typed, kind: e.target.value as "dual" | "honors" })} className={selectCls}>
                  <option value="dual">Dual enrollment</option>
                  <option value="honors">Honors</option>
                </select>
                <input
                  aria-label="Course name"
                  value={typed.name}
                  maxLength={60}
                  onChange={(e) => setTyped({ ...typed, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTyped();
                    }
                  }}
                  placeholder="Course name"
                  className={selectCls}
                />
                <select aria-label="Subject" value={typed.subject} onChange={(e) => setTyped({ ...typed, subject: e.target.value as CourseSubject })} className={selectCls}>
                  {TYPED_SUBJECTS.map((s) => (
                    <option key={s} value={s}>
                      {SUBJECT_LABELS[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addTyped}
                  disabled={disabled || full || typed.name.trim() === ""}
                  className="inline-flex h-10 items-center justify-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Plus className="size-4" aria-hidden /> Add
                </button>
              </div>
            </div>
          </div>
        </details>
      </section>

      <section aria-label="Your courses" className="space-y-3">
        <h3 className="text-sm font-semibold">Your courses{mainRows.length > 0 ? ` (${mainRows.length})` : ""}</h3>
        {mainRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-3 text-sm text-muted-foreground">Nothing yet. Tap a course above, or just tell us how many below.</p>
        ) : (
          groupByYear(mainRows).map((g) => (
            <div key={g.year}>
              <p className="mb-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">{g.year}th grade</p>
              <ul className="space-y-2">
                {g.rows.map((c) => (
                  <li key={c.id}>
                    <CourseRow course={c} onChange={replace} onRemove={() => remove(c.id)} showExams={showExams} takenKeys={keys} disabled={disabled} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span>Or just the count: AP, IB, and dual-enrollment courses taken or planned</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={COURSES_MAX}
            value={countText ?? String(advancedCount)}
            disabled={disabled}
            onChange={(e) => applyCount(e.target.value)}
            onBlur={() => setCountText(null)}
            aria-label="How many AP, IB, and dual-enrollment courses"
            className={`${selectCls} w-20`}
          />
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">Unnamed courses count the same; you can name them later.</p>
      </section>

      {stem && (
        <details className="rounded-2xl border bg-card px-3 py-2" open={regularRows.length > 0}>
          <summary className="cursor-pointer text-sm font-semibold">Add your other math and science courses</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            For your intended major, colleges look at your math and science grades. Add the regular and honors-level courses too, about six to eight rows.
          </p>
          <ul className="mt-3 space-y-2">
            {regularRows.map((c) => (
              <li key={c.id} className="space-y-1">
                <CourseRow course={c} onChange={replace} onRemove={() => remove(c.id)} showExams={false} takenKeys={keys} disabled={disabled} />
                <label className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                  Subject
                  <select aria-label="Subject" value={c.subject} disabled={disabled} onChange={(e) => replace({ ...c, subject: e.target.value as CourseSubject })} className={`${selectCls} w-32`}>
                    {STEM_SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {SUBJECT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {STEM_SUBJECTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addRegular(s)}
                disabled={disabled || full}
                className="inline-flex h-10 items-center gap-1 rounded-full border px-3.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden /> Add a {SUBJECT_LABELS[s].toLowerCase()} course
              </button>
            ))}
          </div>
        </details>
      )}

      <CoreSubjects courses={courses} value={value.coreAtTopLevel} onChange={(coreAtTopLevel) => set({ coreAtTopLevel })} disabled={disabled} />

      {canSetPrivacy && courses.some((c) => c.kind === "ap") && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.apExamsPrivate}
            disabled={disabled}
            onChange={(e) => set({ apExamsPrivate: e.target.checked })}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Keep my AP exam scores private
            <span className="block text-xs text-muted-foreground">Your parents see your courses and grades either way; they see exam scores only if you uncheck this.</span>
          </span>
        </label>
      )}
    </div>
  );
}

/**
 * The picker inside a form that posts to a Server Action (the /me profile form): holds the value itself and carries it
 * as hidden fields (`courses`, `coreAtTopLevel`, `apExamsPrivate`) that app/me/actions.ts reads.
 */
export function CoursePickerField({
  initial,
  highSchoolId,
  gradYear,
  majors,
  showExams,
  canSetPrivacy,
  disabled,
}: {
  initial: CoursePickerValue;
  highSchoolId: string | null;
  gradYear: number | null;
  majors: readonly string[];
  showExams: boolean;
  canSetPrivacy: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <input type="hidden" name="courses" value={JSON.stringify(value.courses)} />
      <input type="hidden" name="coreAtTopLevel" value={JSON.stringify(value.coreAtTopLevel)} />
      <input type="hidden" name="apExamsPrivate" value={value.apExamsPrivate ? "true" : "false"} />
      <CoursePicker value={value} onChange={setValue} highSchoolId={highSchoolId} gradYear={gradYear} majors={majors} showExams={showExams} canSetPrivacy={canSetPrivacy} disabled={disabled} />
    </>
  );
}
