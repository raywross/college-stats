"use client";

import { X } from "lucide-react";
import {
  apName,
  courseSummary,
  INTAKE_EXAMS,
  yearOptions,
  yearStatus,
  type IntakeCourse,
  type IntakeExam,
} from "@/lib/planner/intake";
import { cn } from "@/lib/utils";

const EXAM_LABEL: Record<IntakeExam, string> = { "5": "5", "4": "4", "3": "3", "2": "2", "1": "1", pending: "Not back yet" };

/**
 * One AP course card (intake.md "AP courses"): collapsed shows "AP {name}" and a summary pill; open shows the four
 * "Which year?" chips (freshman through senior, with the school year once a class is picked), then the exam-score
 * chips once the picked year is over. Picking a value collapses it again (the parent decides open-ness).
 */
export function ApCourseCard({
  course,
  classYear,
  rawClassYear,
  today,
  open,
  examsHidden,
  onToggleOpen,
  onChange,
  onRemove,
}: {
  course: IntakeCourse;
  /** The class year to reckon status against (a fallback when the student hasn't set one yet, step 0). */
  classYear: number;
  /** The student's actual pick, or null: without one, the chips show grade names only (no school year). */
  rawClassYear: number | null;
  today: string;
  open: boolean;
  examsHidden: boolean;
  onToggleOpen: () => void;
  onChange: (next: IntakeCourse) => void;
  onRemove: () => void;
}) {
  const summary = courseSummary(course, classYear, today, { examsHidden });
  const years = yearOptions(rawClassYear);
  const askScore = course.year !== null && yearStatus(course.year, classYear, today) === "taken";

  const pickYear = (year: 9 | 10 | 11 | 12) => {
    // A year that no longer asks for a score drops whatever was chosen for a previous (past) year.
    const stillTaken = yearStatus(year, classYear, today) === "taken";
    onChange({ ...course, year, exam: stillTaken ? course.exam : null });
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
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Which year?</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which year">
              {years.map((y) => (
                <button
                  key={y.year}
                  type="button"
                  role="radio"
                  aria-checked={course.year === y.year}
                  onClick={() => pickYear(y.year)}
                  className={cn(
                    "flex min-h-9 flex-col items-start justify-center rounded-full border px-3.5 py-1 text-left text-sm font-semibold",
                    course.year === y.year ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {y.label}
                  {y.sub && <span className={cn("text-[11px] font-normal", course.year === y.year ? "text-background/70" : "text-muted-foreground/80")}>{y.sub}</span>}
                </button>
              ))}
            </div>
          </div>

          {askScore && !examsHidden && (
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
          {askScore && examsHidden && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Your exam score · {course.exam ? "chosen this visit" : "score saved (hidden)"}</p>
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
        </div>
      )}
    </div>
  );
}
