import { num } from "@/lib/format";

/**
 * "Out of 100 applicants…" pictogram. Enrolled ⊂ admitted ⊂ applicants,
 * so the ordinal steps of one hue carry the funnel.
 */
export function Waffle({
  applicants,
  admitted,
  enrolled,
  color = "var(--d-admissions)",
}: {
  applicants: number;
  admitted: number;
  enrolled: number;
  color?: string;
}) {
  const per100Admit = (admitted / applicants) * 100;
  const per100Enroll = (enrolled / applicants) * 100;
  const admitCells = Math.max(1, Math.round(per100Admit));
  const enrollCells = Math.min(admitCells, Math.max(1, Math.round(per100Enroll)));

  return (
    <figure className="space-y-4">
      <div
        className="grid aspect-square w-full max-w-[280px] grid-cols-10 gap-1 sm:gap-1.5"
        role="img"
        aria-label={`Out of 100 applicants, about ${admitCells} are admitted and ${enrollCells} enroll.`}
      >
        {Array.from({ length: 100 }).map((_, i) => {
          const kind = i < enrollCells ? "enrolled" : i < admitCells ? "admitted" : "rest";
          return (
            <span
              key={i}
              className="animate-pop-in rounded-[3px] sm:rounded-[4px]"
              style={{
                animationDelay: `${Math.min(i, 40) * 12}ms`,
                backgroundColor:
                  kind === "enrolled"
                    ? color
                    : kind === "admitted"
                      ? `color-mix(in oklch, ${color} 45%, transparent)`
                      : "var(--muted)",
              }}
            />
          );
        })}
      </div>
      <figcaption className="grid gap-1.5 text-xs">
        <Legend swatch={color} label="Admitted & enrolled" value={`${enrollCells} of 100 · ${num(enrolled)} students`} />
        <Legend
          swatch={`color-mix(in oklch, ${color} 45%, transparent)`}
          label="Admitted, went elsewhere"
          value={`${admitCells - enrollCells} of 100 · ${num(admitted - enrolled)}`}
        />
        <Legend swatch="var(--muted)" label="Not admitted" value={`${100 - admitCells} of 100 · ${num(applicants - admitted)}`} />
      </figcaption>
    </figure>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-3 shrink-0 rounded-[3px] ring-1 ring-foreground/10" style={{ backgroundColor: swatch }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{value}</span>
    </div>
  );
}
