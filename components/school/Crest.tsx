import { crestGradient, monogram } from "@/lib/brand";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-6 rounded-md text-[9px]",
  sm: "size-9 rounded-lg text-[11px]",
  md: "size-12 rounded-xl text-sm",
  lg: "size-16 rounded-2xl text-lg",
  xl: "size-20 sm:size-24 rounded-3xl text-xl sm:text-2xl",
} as const;

/** Generated monogram badge standing in for a school logo. */
export function Crest({
  id,
  name,
  size = "md",
  className,
}: {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const mono = monogram({ unit_id: id, name });
  const long = mono.length >= 4;
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden font-display font-extrabold tracking-tight text-white shadow-sm ring-1 ring-black/5 select-none",
        SIZES[size],
        className
      )}
      style={{ backgroundImage: crestGradient(id) }}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
      <span className={cn("relative drop-shadow-sm", long && "text-[0.8em]")}>{mono}</span>
    </span>
  );
}
