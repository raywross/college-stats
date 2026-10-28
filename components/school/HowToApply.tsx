import { Block } from "@/components/profile/Panel";
import { MetricLabel } from "@/components/ui/info-tip";
import { coalitionSentence } from "@/lib/coalition";
import type { FieldPath } from "@/lib/fields";
import type { Cited } from "@/lib/lineage";
import type { School } from "@/lib/types";

/**
 * "How to apply" (specs/data-expansion/coalition-app.md "Display"): for a college that takes the Coalition application
 * but isn't a Common App member, so it has no "What it takes to apply" card to carry the line. Renders nothing
 * otherwise (the card says it for members).
 */
export function HowToApply({ school, cite, id }: { school: School; cite: (path: FieldPath, school?: School) => Cited; id?: string }) {
  if (school.apply?.deadlines) return null;
  const sentence = coalitionSentence(school);
  if (!sentence) return null;
  return (
    <Block id={id} title="How to apply">
      <p className="text-sm">
        <MetricLabel term="coalition-application" cited={cite("coalition.via_scoir", school)}>
          {sentence}
        </MetricLabel>
      </p>
    </Block>
  );
}
