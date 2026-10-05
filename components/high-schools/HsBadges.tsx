import type { HighSchool } from "@/lib/high-school-types";
import type { TermKey } from "@/lib/glossary";
import { hsTypeBadges } from "@/lib/high-school-ui";
import { Term } from "@/components/ui/info-tip";

const BADGE_TERM: Record<"charter" | "magnet" | "title_i" | "virtual", TermKey> = {
  charter: "charter-school",
  magnet: "magnet-school",
  title_i: "title-i",
  virtual: "virtual-school",
};

/** Charter / magnet / Title I / virtual status chips (specs/product/high-school-data.md "Display", header). */
export function HsBadges({ status, className }: { status: HighSchool["status"]; className?: string }) {
  const badges = hsTypeBadges(status);
  if (!badges.length) return null;
  return (
    <div className={className}>
      {badges.map((b) => (
        <Term key={b.key} term={BADGE_TERM[b.key]} className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold no-underline decoration-transparent">
          {b.label}
        </Term>
      ))}
    </div>
  );
}
