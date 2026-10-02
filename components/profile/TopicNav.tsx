import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { DOMAINS } from "@/lib/metrics";
import { adjacentTopics, overviewHref, topicHref, type ProfileTopic, type TopicKey } from "@/lib/profile-topics";

function TopicLink({ unitId, topic, dir }: { unitId: string; topic: ProfileTopic; dir: "prev" | "next" }) {
  const color = topic.domain ? DOMAINS[topic.domain].color : "var(--primary)";
  return (
    <Link
      href={topicHref(unitId, topic.key)}
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

/** Previous / next topic links at the bottom of a topic page, among the topics the college has. */
export function TopicNav({ unitId, current, available }: { unitId: string; current: TopicKey; available: readonly TopicKey[] }) {
  const { prev, next } = adjacentTopics(current, available);
  return (
    <nav aria-label="Other topics" className="mt-10 flex flex-col gap-3 sm:mt-14 sm:flex-row">
      {prev ? (
        <TopicLink unitId={unitId} topic={prev} dir="prev" />
      ) : (
        <Link href={overviewHref(unitId)} className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40">
          <ArrowLeft className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
          <span>
            <span className="block text-[11px] font-semibold text-muted-foreground">Back to</span>
            <span className="font-display font-bold group-hover:text-primary">Overview</span>
          </span>
        </Link>
      )}
      {next && <TopicLink unitId={unitId} topic={next} dir="next" />}
    </nav>
  );
}
