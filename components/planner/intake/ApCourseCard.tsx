"use client";

import { X } from "lucide-react";
import {
  apName,
  courseSummary,
  INTAKE_EXAMS,
  termOptions,
  type IntakeCourse,
  type IntakeCourseStatus,
  type IntakeExam,
} from "@/lib/planner/intake";
import { cn } from "@/lib/utils";

const EXAM_LABEL: Record<IntakeExam, string> = { "5": "5", "4": "4", "3": "3", "2": "2", "1": "1", pending: "Not back yet" };

/**
 * One AP course card (intake.md "AP courses"): collapsed shows "AP {name}" and a summary pill; open shows the
 * "Took it / Taking or planned" choice, then the exam-score chips or the "When?" term chips. Picking a value
 * collapses it again (the parent decides open-ness from `forceOpen`).
 */
export function ApCourseCard({
  course,
  classYear,
  today,
  open,
  examsHidden,
  onToggleOpen,
  onChange,
  onRemove,
}: {
  course: IntakeCourse;
  classYear: number;
  today: string;
  open: boolean;
  examsHidden: boolean;
  onToggleOpen: () => void;
  onChange: (next: IntakeCourse) => void;
  onRemove: () => void;
}) {
  const summary = courseSummary(course, today, { examsHidden });
  const terms = termOptions(classYear, today);

  const pickStatus = (status: IntakeCourseStatus) => {
    if (status === "took") onChange({ ...course, status: "took", term: null });
    else onChange({ ...course, status: "plan", exam: null });
  };

  return (
    <div className={cn("rounded-2xl border bg-card p-3.5 sm:p-4", open && "border-primary")}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleOpen}
          className="min-h-11 min-w-0 flex-1 rounded-xl py-1 text-left font-semibold"
        >
          <span className="truncate">AP {apName(course.key)}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleOpen}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold",
              summary.incomplete ? "bg-pop text-pop-foreground" : "bg-muted text-foreground",
            )}
          >
            {summary.text}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove AP ${apName(course.key)}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Status">
            <button
              type="button"
              role="radio"
              aria-checked={course.status === "took"}
              onClick={() => pickStatus("took")}
              className={cn(
                "min-h-9 rounded-full border px-3.5 text-sm font-semibold",
                course.status === "took" ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              Took it
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={course.status === "plan"}
              onClick={() => pickStatus("plan")}
              className={cn(
                "min-h-9 rounded-full border px-3.5 text-sm font-semibold",
                course.status === "plan" ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              Taking / planned
            </button>
          </div>

          {course.status === "took" && !examsHidden && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Your exam score</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Exam score">
                {INTAKE_EXAMS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    role="radio"
                    aria-checked={course.exam === e}
                    onClick={() => onChange({ ...course, exam: e })}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-sm font-semibold",
                      course.exam === e ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {EXAM_LABEL[e]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {course.status === "took" && examsHidden && <p className="text-sm text-muted-foreground">Score hidden.</p>}

          {course.status === "plan" && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">When?</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="When">
                {terms.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={course.term === t.value}
                    onClick={() => onChange({ ...course, term: t.value })}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-sm font-semibold",
                      course.term === t.value ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
