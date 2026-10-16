"use client";

/**
 * Step 8, Major (specs/planner/record/majors.md): type a word, see matching families and the eight common ones as
 * chips, pick up to three. Mirrors the AP step's search-plus-chips shape.
 */
import { useState } from "react";
import { Headline } from "@/components/planner/intake/Headline";
import { MajorChips } from "@/components/planner/intake/MajorChips";
import { WhyFold } from "@/components/ui/why-fold";
import { track } from "@/lib/analytics";
import type { IntakeDraft } from "@/lib/planner/intake";
import { searchMajors } from "@/lib/majors-search";
import { RECORD_STEPS } from "@/lib/planner/record";
import { MAX_INTENDED_MAJORS } from "@/lib/student-profile";
import { cn } from "@/lib/utils";

export function MajorStep({ draft, setDraft }: { draft: IntakeDraft; setDraft: (next: IntakeDraft) => void }) {
  const [query, setQuery] = useState("");
  const atCap = draft.majors.length >= MAX_INTENDED_MAJORS;
  const hasQuery = query.trim() !== "";
  const chips = searchMajors(query, draft.majors, hasQuery ? 6 : 8);

  const add = (family: IntakeDraft["majors"][number]) => {
    if (atCap || draft.majors.includes(family)) return;
    const next = [...draft.majors, family];
    setDraft({ ...draft, majors: next });
    track("record_major_picked", { count: next.length });
    setQuery("");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Headline lead="What might you" pop="study?" />
          <WhyFold compact title="Why we ask" screen="record_tour" section="major">
            {RECORD_STEPS[8].why}
          </WhyFold>
        </div>
        <p className="text-sm text-muted-foreground">{RECORD_STEPS[8].line}</p>
      </div>

      {draft.majors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Picked</p>
          <MajorChips majors={draft.majors} onChange={(next) => setDraft({ ...draft, majors: next })} />
        </div>
      )}

      {atCap ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">Three is the most; remove one to add another.</p>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a major or a subject…"
              className="h-12 w-full rounded-full border px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <p className="text-xs font-semibold text-muted-foreground">{hasQuery ? "Matches" : "Common"}</p>
          {hasQuery && chips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No major matches &quot;{query.trim()}&quot;</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {chips.map((m) => (
                <button
                  key={m.family}
                  type="button"
                  onClick={() => add(m.family)}
                  className={cn("min-h-10 rounded-full border border-dashed px-3.5 text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground")}
                >
                  + {m.name}
                  {m.via && <span className="text-muted-foreground"> · {m.via}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MajorStep;
