import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DOMAINS } from "@/lib/metrics";
import { adjacentCompareTopics, compareHref, type CompareTopic, type CompareTopicKey } from "@/lib/compare-topics";

function TopicLink({ ids, topic, dir }: { ids: readonly string[]; topic: CompareTopic; dir: "prev" | "next" }) {
  const color = topic.domain ? DOMAINS[topic.domain].color : "var(--primary)";
  return (
    <Link
      href={compareHref(ids, topic.key)}
      className={`group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 ${dir === "next" ? "justify-end text-right" : ""}`}
    >
      {dir === "prev" && <ArrowLeft className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />}
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-muted-foreground">{dir === "prev" ? "Previous" : "Next"}</span>
        <span className="flex items-center gap-1.5 font-display font-bold group-hover:text-primary">
          {dir === "prev" && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
          <span className="truncate">{topic.label}</span>
          {dir === "next" && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
        </span>
      </span>
      {dir === "next" && <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
    </Link>
  );
}

/** Previous / next topic links at the bottom of a compare topic page, among all seven; "Back to Overview" first. */
export function CompareTopicNav({ ids, current }: { ids: readonly string[]; current: CompareTopicKey }) {
  const { prev, next } = adjacentCompareTopics(current);
  return (
    <nav aria-label="Other topics" className="mt-10 flex flex-col gap-3 sm:mt-14 sm:flex-row">
      {prev ? (
        <TopicLink ids={ids} topic={prev} dir="prev" />
      ) : (
        <Link href={compareHref(ids)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
          <ArrowLeft className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
          <span>
            <span className="block text-[11px] font-semibold text-muted-foreground">Back to</span>
            <span className="font-display font-bold group-hover:text-primary">Overview</span>
          </span>
        </Link>
      )}
      {next && <TopicLink ids={ids} topic={next} dir="next" />}
    </nav>
  );
}
