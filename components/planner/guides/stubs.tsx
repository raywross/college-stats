/**
 * Placeholder guide bodies (specs/planner/v3/build-plan.md "The guide page"): one per slug, so every guide page
 * renders before its owner builds it. Each owner replaces its slug's entry in lib/planner/guides-server.ts with the
 * real component and then deletes its stub here. Server components.
 */
import { GUIDES, type GuideSlug } from "@/lib/planner/guides";

function Stub({ slug }: { slug: GuideSlug }) {
  return (
    <section className="rounded-3xl bg-card p-5 ring-1 ring-border sm:p-6" aria-label={GUIDES[slug].title}>
      <h2 className="font-display text-lg font-bold">{GUIDES[slug].title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">This guide is being built.</p>
    </section>
  );
}

export function InterestGuideStub() {
  return <Stub slug="interest" />;
}
export function TestGuideStub() {
  return <Stub slug="test" />;
}
export function StoryGuideStub() {
  return <Stub slug="story" />;
}
export function EdGuideStub() {
  return <Stub slug="ed" />;
}
