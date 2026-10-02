import { getData } from "@/lib/data";
import type { Cited } from "@/lib/lineage";
import type { FieldPath } from "@/lib/fields";
import type { School } from "@/lib/types";
import { SourceChip } from "@/components/ui/info-tip";

/** "Figures marked CDS 2024-25 come from …": one line per non-default source among a section's values. */
export async function SourceExceptions({ fields, school }: { fields: readonly FieldPath[]; school: School }) {
  const { citeField } = await getData();
  const seen = new Map<string, Cited>();
  for (const f of fields) {
    const c = citeField(f, school);
    if (!c.isDefault) seen.set(`${c.key}${c.url}${c.year}`, c);
  }
  if (!seen.size) return null;
  return (
    <div className="mt-3 flex max-w-3xl flex-col gap-1.5">
      {[...seen.values()].map((c) => (
        <p key={`${c.key}${c.url}`} className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <SourceChip cited={c} />
          <span>
            Figures marked like this come from{" "}
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary">
              {c.label}
            </a>
            {c.year ? `, ${c.year}` : ""}. Everything else here is federal data.
          </span>
        </p>
      ))}
    </div>
  );
}
