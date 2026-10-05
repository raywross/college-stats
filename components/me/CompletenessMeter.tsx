import { Check } from "lucide-react";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { completeness, completenessScore, type StudentProfileData } from "@/lib/student-profile";

/** "/me"'s completeness meter (student-profile.md): what each tool on the site needs, and what's still missing. */
export function CompletenessMeter({ data }: { data: StudentProfileData }) {
  const items = completeness(data);
  const score = completenessScore(data);
  return (
    <div className="rounded-3xl border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold">How complete is this?</h2>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">{Math.round(score * 100)}%</span>
      </div>
      <Progress value={score * 100} className="mt-3">
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
      <ul className="mt-4 space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.tool} className="flex items-start gap-2">
            <span
              className={
                item.met
                  ? "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-pop/30 text-foreground"
                  : "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-dashed text-transparent"
              }
            >
              {item.met && <Check className="size-3" />}
            </span>
            <span className={item.met ? "text-muted-foreground" : ""}>
              <b className="font-semibold text-foreground">{item.tool}</b>
              {!item.met && <> — {item.need}</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
