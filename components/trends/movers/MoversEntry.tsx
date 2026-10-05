import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getData, getHistoryFiles, getTrendFile } from "@/lib/data";
import { moverList, type MoverListKey } from "@/lib/movers";
import type { School } from "@/lib/types";
import { Term } from "@/components/ui/info-tip";
import { MoverListCard } from "./MoverListCard";

/** The three lists /trends features (specs/national-trends.md#where-it-appears), first five of each. */
const FEATURED: readonly MoverListKey[] = ["applications-surged", "harder-to-get-into", "pay-less"];
const ROWS = 5;

/** The "Biggest movers" section of /trends: three ten-year lists and a link to all of them. Nothing without the file. */
export async function MoversEntry() {
  const [file, files, data] = await Promise.all([getTrendFile("movers"), getHistoryFiles(), getData()]);
  const lists = file?.windows.find((w) => w.years === 10)?.lists;
  if (!file || !files || !lists) return null;
  const featured = FEATURED.flatMap((key) => {
    const list = lists.find((l) => l.key === key);
    return list ? [{ def: moverList(key), list }] : [];
  });
  const ids = featured.flatMap(({ list }) => list.entries.map((e) => e.unit_id));
  const schools = new Map<string, School>(data.getSchoolsByIds(ids).map((s) => [s.unit_id, s]));
  return (
    <section aria-labelledby="movers">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="movers" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          Biggest movers
        </h2>
        <Link href="/trends/movers" className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
          All ten lists <ArrowRight className="size-4" />
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        The colleges that changed the most over ten years, among colleges big enough at the start for a change to mean something (the{" "}
        <Term term="biggest-movers">rules</Term>).
      </p>
      <div className="mt-5 grid gap-4 max-sm:gap-3 max-sm:rail lg:grid-cols-3">
        {featured.map(({ def, list }) => (
          <MoverListCard key={def.key} def={def} list={list} window={10} schools={schools} files={files} shown={ROWS} compact />
        ))}
      </div>
    </section>
  );
}
