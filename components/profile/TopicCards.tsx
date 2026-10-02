import type { ComponentType } from "react";
import type { Profile } from "@/lib/profile-data";
import type { TopicKey } from "@/lib/profile-topics";
import { AdmissionsCard } from "./AdmissionsCard";
import { StudentsCard } from "./StudentsCard";
import { AcademicsCard } from "./AcademicsCard";
import { CostCard } from "./CostCard";
import { OutcomesCard } from "./OutcomesCard";
import { HistoryCard } from "./HistoryCard";

const CARDS: Record<TopicKey, ComponentType<{ profile: Profile }>> = {
  admissions: AdmissionsCard,
  students: StudentsCard,
  academics: AcademicsCard,
  cost: CostCard,
  outcomes: OutcomesCard,
  history: HistoryCard,
};

/**
 * The overview's topic cards (specs/profile-redesign.md#overview-page): one per topic page the college has, in
 * PROFILE_TOPICS order, two columns from `sm` and stacked on phones. Each card links to its page.
 */
export function TopicCards({ profile }: { profile: Profile }) {
  return (
    <section aria-label="Topics" className="grid gap-4 sm:grid-cols-2">
      {profile.topics.map((key) => {
        const Card = CARDS[key];
        return <Card key={key} profile={profile} />;
      })}
    </section>
  );
}
