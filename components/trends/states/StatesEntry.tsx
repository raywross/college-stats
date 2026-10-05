import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTrendFile } from "@/lib/data";
import { StateTileMap, type TileRange } from "@/components/charts/StateTileMap";

const CHANGE_RANGES: TileRange[] = [
  { lo: -Infinity, hi: -0.1, label: "Shrank 10%+", bg: "var(--div-1)", ink: "text-white dark:text-background" },
  { lo: -0.1, hi: -0.02, label: "Shrank some", bg: "var(--div-2)", ink: "text-foreground" },
  { lo: -0.02, hi: 0.02, label: "Little change", bg: "var(--div-3)", ink: "text-foreground" },
  { lo: 0.02, hi: 0.1, label: "Grew some", bg: "var(--div-4)", ink: "text-foreground" },
  { lo: 0.1, hi: Infinity, label: "Grew 10%+", bg: "var(--div-5)", ink: "text-white dark:text-background" },
];

/** The "By state" section of /trends (specs/national-trends.md#where-it-appears): the tile map, linking to its index. */
export async function StatesEntry() {
  const file = await getTrendFile("states");
  if (!file) return null;
  const values = Object.fromEntries(file.states.map((s) => [s.postal, s.map.undergradChange]));
  return (
    <section aria-labelledby="states">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="states" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          By state
        </h2>
        <Link href="/trends/states" className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
          Every state <ArrowRight className="size-4" />
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        How each state&apos;s colleges changed: size, applications, cost, and where their students come from. Colored here by the median college&apos;s
        undergraduate change over 10 years.
      </p>
      <div className="mt-5">
        <StateTileMap
          values={values}
          ranges={CHANGE_RANGES}
          legendLabel="Median college's undergraduate change, 10 years"
          format={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`}
          href={(state) => `/trends/states/${state.toLowerCase()}`}
        />
      </div>
    </section>
  );
}
