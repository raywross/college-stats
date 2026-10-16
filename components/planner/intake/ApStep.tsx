"use client";

import { useState } from "react";
import { ApCourseCard } from "@/components/planner/intake/ApCourseCard";
import { Headline } from "@/components/planner/intake/Headline";
import { WhyFold } from "@/components/ui/why-fold";
import { courseCount, courseSummary, newIntakeCourse, searchAp, type IntakeDraft } from "@/lib/planner/intake";
import { RECORD_STEPS } from "@/lib/planner/record";
import { cn } from "@/lib/utils";

/** Step 2 (intake.md "AP courses"): the course list, each asking one thing, plus search for adding more. */
export function ApStep({
  draft,
  setDraft,
  today,
}: {
  draft: IntakeDraft;
  setDraft: (next: IntakeDraft) => void;
  today: string;
}) {
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const classYear = draft.classYear ?? Number(today.slice(0, 4));

  const isOpen = (id: string, course: IntakeDraft["courses"][number]) =>
    course.year === null || courseSummary(course, classYear, today).incomplete || openIds.has(id);

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateCourse = (id: string, next: IntakeDraft["courses"][number]) => {
    setDraft({ ...draft, courses: draft.courses.map((c) => (c.id === id ? next : c)) });
    // A completed pick collapses the card unless the student explicitly reopened it.
    if (!courseSummary(next, classYear, today).incomplete) {
      setOpenIds((prev) => {
        if (!prev.has(id)) return prev;
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
    }
  };

  const removeCourse = (id: string) => setDraft({ ...draft, courses: draft.courses.filter((c) => c.id !== id) });

  const exclude = draft.courses.map((c) => c.key);
  const matches = searchAp(query, exclude);
  const count = courseCount(draft.courses, classYear, today);

  const addCourse = (key: string) => {
    const course = newIntakeCourse(key);
    setDraft({ ...draft, courses: [...draft.courses, course] });
    setOpenIds((prev) => new Set(prev).add(course.id));
    setQuery("");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Headline lead="Your" pop="AP" tail="courses" />
          <WhyFold compact title="Why we ask" screen="record_tour" section="courses">
            {RECORD_STEPS[2].why}
          </WhyFold>
        </div>
        <p className="text-sm text-muted-foreground">{RECORD_STEPS[2].line}</p>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8">
        <div className="space-y-3">
          {draft.courses.length > 0 && <p className="text-sm font-semibold text-muted-foreground">Your courses · {count}</p>}
          {draft.courses.map((c) => (
            <ApCourseCard
              key={c.id}
              course={c}
              classYear={classYear}
              rawClassYear={draft.classYear}
              today={today}
              open={isOpen(c.id, c)}
              onToggleOpen={() => toggleOpen(c.id)}
              onChange={(next) => updateCourse(c.id, next)}
              onRemove={() => removeCourse(c.id)}
            />
          ))}

          <div className="lg:hidden">
            <SearchBox query={query} setQuery={setQuery} matches={matches} onAdd={addCourse} />
          </div>
        </div>

        <div className="hidden rounded-3xl border bg-card p-4 lg:block">
          <SearchBox query={query} setQuery={setQuery} matches={matches} onAdd={addCourse} />
        </div>
      </div>
    </div>
  );
}

function SearchBox({
  query,
  setQuery,
  matches,
  onAdd,
}: {
  query: string;
  setQuery: (q: string) => void;
  matches: { key: string; name: string }[];
  onAdd: (key: string) => void;
}) {
  const hasQuery = query.trim() !== "";
  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Add a course — try "lit", "bio", or "apush"'
          className="h-12 w-full rounded-full border pl-9 pr-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground">+</span>
      </div>
      <p className="text-xs font-semibold text-muted-foreground">{hasQuery ? "Matches" : "Popular"}</p>
      {hasQuery && matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AP course matches &quot;{query.trim()}&quot;</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {matches.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onAdd(m.key)}
              className={cn("min-h-9 rounded-full border border-dashed px-3.5 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground")}
            >
              + {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
