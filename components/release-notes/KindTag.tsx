import { RELEASE_KINDS, type ReleaseKind } from "@/lib/release-notes";
import { cn } from "@/lib/utils";

/** A release note's kind: a colored dot and its label. The label carries the meaning; the dot only helps scanning. */
export function KindTag({ kind, className }: { kind: ReleaseKind; className?: string }) {
  const { label, dot } = RELEASE_KINDS[kind];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
