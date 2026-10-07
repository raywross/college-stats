import type { ReactNode } from "react";
import type { Metadata } from "next";
import { TOPIC_FIELDS, topicOf, type TopicKey } from "@/lib/profile-topics";
import { loadProfile, type Profile } from "@/lib/profile-data";
import { SourceNote } from "@/components/sources/SourceNote";
import { CompactHeader } from "./CompactHeader";
import { BlockViews } from "./BlockViews";
import { OnThisPage, type PageItem } from "./OnThisPage";
import { TopicNav } from "./TopicNav";

/** "{School} · {Topic label}" for a topic page's generateMetadata. */
export async function topicMetadata(id: string, key: TopicKey): Promise<Metadata> {
  const profile = await loadProfile(id);
  const topic = topicOf(key);
  return {
    title: profile ? `${profile.school.name} · ${topic.label}` : "School not found",
    description: profile ? `${topic.description} ${profile.school.name}.` : undefined,
  };
}

/**
 * A topic page's frame: the compact sticky header with the pills, the "On this page" list (side column from `lg`),
 * the content, previous/next topic links, and the page's source footnote (every value it shows, by field).
 */
export function TopicPage({
  profile,
  topic,
  items,
  children,
  sources,
  aside,
}: {
  profile: Profile;
  topic: TopicKey;
  /** The page's blocks, by id, for "On this page"; blocks that didn't render drop out on the client. */
  items: PageItem[];
  children: ReactNode;
  /** Replaces the default SourceNote (the history page cites per chart group instead). */
  sources?: ReactNode;
  /** Replaces "On this page" in the side column (the history page lists its chart groups there). */
  aside?: ReactNode;
}) {
  const { school } = profile;
  const fields = TOPIC_FIELDS[topic];
  const hasList = aside !== undefined || items.length >= 2;
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <CompactHeader profile={profile} current={topic} />
      {items.length > 0 && <BlockViews unitId={school.unit_id} topic={topic} ids={items.map((i) => i.id)} />}
      <div className={hasList ? "pt-5 sm:pt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10" : "pt-5 sm:pt-8"}>
        {aside !== undefined ? <div className="lg:order-last">{aside}</div> : hasList && <OnThisPage items={items} className="mb-5 lg:order-last lg:mb-0" />}
        <div className="min-w-0 lg:order-first">
          {children}
          {sources ?? (fields.length > 0 && <SourceNote fields={fields} school={school} className="mt-6" />)}
          <TopicNav unitId={school.unit_id} current={topic} available={profile.topics} />
        </div>
      </div>
    </div>
  );
}
