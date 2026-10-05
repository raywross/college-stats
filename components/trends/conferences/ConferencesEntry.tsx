import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTrendFile } from "@/lib/data";
import { Term } from "@/components/ui/info-tip";
import { PowerFour } from "./PowerFour";

/** The "By athletic conference" section of /trends: the Power 4 strip and a link to every conference. Nothing without the file. */
export async function ConferencesEntry() {
  const file = await getTrendFile("conferences");
  if (!file) return null;
  return (
    <section aria-labelledby="conferences">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h2 id="conferences" className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
          By athletic conference
        </h2>
        <Link href="/trends/conferences" className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
          All {file.conferences.length} conferences <ArrowRight className="size-4" />
        </Link>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        How each <Term term="athletic-conference">conference</Term>&apos;s member colleges compare and changed, and who joined or left. The Power 4, median
        member, on one scale:
      </p>
      <div className="mt-5">
        <PowerFour file={file} />
      </div>
    </section>
  );
}
