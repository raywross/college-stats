import { SourceTip } from "@/components/ui/info-tip";
import { noteText } from "@/lib/chances/notes";
import type { MajorReviewReading } from "@/lib/chances/major-review";
import type { AnyCited } from "@/lib/lineage";

/** Citations per unit and field path (lib/chances/fact-cites.ts majorUnitCites). */
export type MajorCites = Record<string, Record<string, AnyCited>>;

/**
 * How the college reads the visitor's intended major (specs/chances/major-and-grades.md "Where it shows"): the unit's
 * lines from lib/chances/major-review.ts, each sentence from the note catalog with the (i) of the unit it quotes. The
 * college-wide statement and emphasis cite the unit they came from; required courses and the score requirement cite
 * the school or major the student would apply to.
 */
export function MajorLines({ reading, majorCites, className }: { reading: MajorReviewReading; majorCites: MajorCites; className?: string }) {
  if (reading.notes.length === 0) return null;
  const unitFor = (cite: string | undefined) => (cite && /\.(required_courses|gate)$/.test(cite) ? reading.unit : (reading.source ?? reading.unit ?? reading.statement));
  return (
    <ul className={className ?? "space-y-1.5 text-sm"}>
      {reading.notes.map((n, i) => {
        const unit = unitFor(n.cite);
        const cited = unit && n.cite ? majorCites[unit.unit_id]?.[n.cite] : undefined;
        return (
          <li key={`${n.key}-${i}`}>
            {noteText(n)}
            {cited && <SourceTip cited={cited} className="ml-1 align-middle" />}
          </li>
        );
      })}
    </ul>
  );
}
