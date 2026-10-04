import Image from "next/image";
import { crestGradient, monogram, type CrestBrand } from "@/lib/brand";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-6 rounded-md text-[9px]",
  sm: "size-9 rounded-lg text-[11px]",
  md: "size-12 rounded-xl text-sm",
  lg: "size-16 rounded-2xl text-lg",
  xl: "size-20 sm:size-24 rounded-3xl text-xl sm:text-2xl",
} as const;

/** The stored mark's size (public/brand/{unit_id}.webp, scripts/lib/brand-icons.mts). */
const MARK_PX = 192;

/**
 * A school's crest (specs/school-identity/brand.md, Display), decoration never data. Three looks at the same sizes:
 *   - its mark (the college's own site icon) on a white tile with 10% padding, which stays white in dark mode (a mark
 *     drawn for a light tile often has no dark variant), ringed at 15% there so it reads on indigo;
 *   - its monogram on a gradient in its colors, the text in `brand.text` (4.5:1 on the accent, checked at sync time);
 *   - otherwise the generated monogram tile.
 * The mark is a plain 192 px WebP: next/image with `unoptimized`, since next.config sets no image loader and the file is
 * already the largest size any tile shows (96 px at 2x), so the optimizer would only add per-size transformations.
 */
export function Crest({
  id,
  name,
  size = "md",
  className,
  brand,
}: {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  /** The college's colors and mark (`crestBrand` in lib/brand.ts); without it, the generated tile. */
  brand?: CrestBrand;
}) {
  const base = "relative inline-flex shrink-0 items-center justify-center overflow-hidden shadow-sm ring-1 select-none";
  if (brand?.logo) {
    return (
      <span aria-hidden data-crest="mark" className={cn(base, "bg-white ring-black/5 dark:ring-white/15", SIZES[size], className)}>
        <Image src={brand.logo} alt="" width={MARK_PX} height={MARK_PX} unoptimized draggable={false} className="size-[80%] object-contain" />
      </span>
    );
  }
  const mono = monogram({ unit_id: id, name });
  const long = mono.length >= 4;
  const colors = brand?.gradient;
  const dark = !!colors && brand?.text === "black";
  return (
    <span
      aria-hidden
      data-crest={colors ? "colors" : "generated"}
      className={cn(
        base,
        "font-display font-extrabold tracking-tight ring-black/5",
        dark ? "text-black" : "text-white",
        SIZES[size],
        className
      )}
      style={{ backgroundImage: colors ? `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)` : crestGradient(id) }}
    >
      {/* The generated tile's sheen; fainter on a college's colors, so they stay its colors. */}
      <span
        className={cn(
          "absolute inset-0",
          colors
            ? "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.18),transparent_55%)]"
            : "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]"
        )}
      />
      <span className={cn("relative", !dark && "drop-shadow-sm", long && "text-[0.8em]")}>{mono}</span>
    </span>
  );
}
