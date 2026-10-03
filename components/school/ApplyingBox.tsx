import type { School } from "@/lib/types";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import type { TermKey } from "@/lib/glossary";
import { applyingLines } from "@/lib/cds/application-logistics-display";
import { Block } from "@/components/profile/Panel";
import { MetricLabel } from "@/components/ui/info-tip";

/**
 * "Applying" (specs/data-expansion/cds-application-logistics.md): the regular round's deadline and priority date, how
 * decisions are sent, the reply-by rule, the housing deposit, and whether a gap year is allowed, from the college's
 * Common Data Set C14–C18. Each line is cited to its own block; a line whose item is blank is left out, and the block
 * renders nothing when every line is. Early rounds (C21/C22) are cds-admissions.md's.
 */
export function ApplyingBox({ school, cite, id }: { school: School; cite: (path: FieldPath, school?: School) => Cited; id?: string }) {
  const l = school.reported?.admissions_logistics;
  const lines = applyingLines(school);
  if (!l || !lines.length) return null;
  const term = (key: string): TermKey | undefined =>
    key === "priority_date"
      ? "priority-date"
      : key === "notification" && l.notification?.kind === "rolling"
        ? "rolling-notification"
        : key === "reply"
          ? "reply-by-date"
          : key === "housing_deposit"
            ? "housing-deposit"
            : key === "deferred_admission"
              ? "deferred-admission"
              : undefined;
  return (
    <Block id={id} title="Applying">
      <p className="-mt-3 mb-3 text-sm text-muted-foreground">The regular round, as the college reports it. Early rounds have their own dates.</p>
      <ul className="space-y-2 text-sm">
        {lines.map((line) => (
          <li key={line.key}>
            <MetricLabel term={term(line.key)} cited={cite(`reported.admissions_logistics.${line.key}` as FieldPath, school)}>
              {line.text}
            </MetricLabel>
          </li>
        ))}
      </ul>
    </Block>
  );
}
