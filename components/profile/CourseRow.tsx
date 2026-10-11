"use client";

import { X } from "lucide-react";
import { apCourses } from "@/lib/chances/catalog";
import { courseName, KIND_LABELS, STATUS_LABELS } from "@/lib/chances/courses";
import type { CourseEntry, CourseStatus, Mark } from "@/lib/chances/types";
import { MARKS, isPlaceholderCourse } from "@/lib/student-profile";

export const selectCls =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

const YEARS: CourseEntry["year"][] = [9, 10, 11, 12];
const EXAMS: NonNullable<CourseEntry["exam"]>[] = [1, 2, 3, 4, 5];

function MarkSelect({ label, value, onChange, disabled }: { label: string; value: Mark | null; onChange: (m: Mark | null) => void; disabled?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <select aria-label={label} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as Mark))} className={selectCls}>
        <option value="">Not yet</option>
        {MARKS.map((m) => (
          <option key={m} value={m}>
            {m === "P" ? "Pass" : m}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * One line per course (rigor-in-context.md "Entering them"): the name, year, status, and the grades — semester 1 and
 * 2 for a year in progress, a final grade for a finished course — with the optional AP exam score behind a
 * disclosure. A planned course has no grades. An unnamed row from the counts-only entry offers a way to name it.
 */
export function CourseRow({
  course,
  onChange,
  onRemove,
  showExams,
  takenKeys,
  disabled,
}: {
  course: CourseEntry;
  onChange: (next: CourseEntry) => void;
  onRemove: () => void;
  /** Whether this viewer may see and enter AP exam scores. */
  showExams: boolean;
  /** Catalog keys already on the list, so naming an unnamed row can't duplicate one. */
  takenKeys: ReadonlySet<string>;
  disabled?: boolean;
}) {
  const planned = course.status === "planned";
  const set = (patch: Partial<CourseEntry>) => onChange({ ...course, ...patch });
  const setGrade = (k: keyof CourseEntry["grades"], m: Mark | null) => set({ grades: { ...course.grades, [k]: m } });
  const placeholder = isPlaceholderCourse(course);
  const showExam = showExams && course.kind === "ap" && !planned && !placeholder;
  const name = courseName(course);

  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {placeholder ? (
            <label className="block">
              <span className="sr-only">Which AP course is this?</span>
              <select
                value=""
                disabled={disabled}
                onChange={(e) => {
                  const key = e.target.value;
                  if (key) onChange({ ...course, key, subject: apCourses().find((c) => c.key === key)?.subject ?? "other" });
                }}
                className={`${selectCls} font-semibold`}
              >
                <option value="">AP course (name it)</option>
                {apCourses().map((c) => (
                  <option key={c.key} value={c.key} disabled={takenKeys.has(c.key)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : course.kind === "regular" || course.kind === "dual" || course.kind === "honors" ? (
            <input
              aria-label="Course name"
              value={course.name ?? ""}
              maxLength={60}
              disabled={disabled}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Course name"
              className={`${selectCls} font-semibold`}
            />
          ) : (
            <p className="text-sm font-semibold break-words">{name}</p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{KIND_LABELS[course.kind]}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${name}`}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-60"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Grade level</span>
          <select aria-label="Year" value={course.year} disabled={disabled} onChange={(e) => set({ year: Number(e.target.value) as CourseEntry["year"] })} className={selectCls}>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}th
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Status</span>
          <select
            aria-label="Status"
            value={course.status}
            disabled={disabled}
            onChange={(e) => {
              const status = e.target.value as CourseStatus;
              set(status === "planned" ? { status, grades: { ...course.grades, final: null }, exam: null } : { status });
            }}
            className={selectCls}
          >
            {(Object.keys(STATUS_LABELS) as CourseStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {!planned && (
          <>
            <MarkSelect label="Semester 1" value={course.grades.s1} disabled={disabled} onChange={(m) => setGrade("s1", m)} />
            <MarkSelect label="Semester 2" value={course.grades.s2} disabled={disabled} onChange={(m) => setGrade("s2", m)} />
            <MarkSelect label="Final" value={course.grades.final} disabled={disabled} onChange={(m) => setGrade("final", m)} />
          </>
        )}
      </div>

      {showExam && (
        <details className="mt-2 text-sm" open={course.exam !== null}>
          <summary className="cursor-pointer text-xs font-semibold text-primary">Add AP exam score (optional)</summary>
          <label className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Exam score</span>
            <select
              aria-label="AP exam score"
              value={course.exam ?? ""}
              disabled={disabled}
              onChange={(e) => set({ exam: e.target.value === "" ? null : (Number(e.target.value) as CourseEntry["exam"]) })}
              className={`${selectCls} w-28`}
            >
              <option value="">No score</option>
              {EXAMS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
    </div>
  );
}
