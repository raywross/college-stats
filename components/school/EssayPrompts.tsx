import { Block } from "@/components/profile/Panel";
import { MetricLabel } from "@/components/ui/info-tip";
import { essayCardLine } from "@/lib/essays/summary";
import type { FieldPath } from "@/lib/fields";
import type { Cited } from "@/lib/lineage";
import type { EssayPrompt, PlatformPromptsFile, School, SchoolEssays } from "@/lib/types";
import platformPromptsFile from "@/data/reference/platform-prompts.json" with { type: "json" };

const PLATFORM_PROMPTS = platformPromptsFile as PlatformPromptsFile;

/** A prompt's kind, worded for a reader; the glossary term that explains it, when it has one. */
const KIND_LABEL: Record<EssayPrompt["kind"], { label: string; term?: "short-answer" | "why-us-essay" }> = {
  essay: { label: "Essay" },
  short_answer: { label: "Short answer", term: "short-answer" },
  why_us: { label: "Why us", term: "why-us-essay" },
  program: { label: "Program-specific" },
  activity: { label: "Activity" },
  optional: { label: "Optional" },
  other: { label: "Other" },
};

/** "Up to 400 words" / "250–450 words" / "Up to 2,000 characters". */
function limitText(limit: EssayPrompt["limit"]): string | null {
  if (!limit) return null;
  return limit.min ? `${limit.min}–${limit.max} ${limit.kind}` : `Up to ${limit.max} ${limit.kind}`;
}

/** Who a prompt applies to, when it isn't everyone. */
function appliesToText(appliesTo: EssayPrompt["applies_to"]): string | null {
  if (appliesTo === "all") return null;
  if (appliesTo === "transfer") return "Transfer applicants";
  if (appliesTo === "international") return "International applicants";
  return `${appliesTo.program} applicants`;
}

function PromptRow({ prompt, cited, choose }: { prompt: EssayPrompt; cited: Cited; choose?: SchoolEssays["choose"] }) {
  const kind = KIND_LABEL[prompt.kind];
  const limit = limitText(prompt.limit);
  const applies = appliesToText(prompt.applies_to);
  // Under "choose 4 of 8", no prompt is required or optional on its own; the fold's heading says how many to pick.
  const requirement = choose ? null : prompt.required ? "Required" : "Optional";
  const meta = [kind.label, limit, requirement, applies].filter(Boolean).join(" · ");
  return (
    <li className="space-y-1">
      <MetricLabel term={kind.term} cited={cited} className="items-start text-sm font-medium">
        {prompt.text}
      </MetricLabel>
      <p className="text-xs text-muted-foreground">{meta}</p>
    </li>
  );
}

/**
 * Every essay and short-answer prompt a college's own page publishes (specs/product/essays/prompts.md "Display"):
 * one line on "What it takes to apply" (`essayCardLine`), opening a fold that lists each prompt with its limit and
 * requirement, each cited to the college's page, the platform's own prompts (Common App's, the Coalition's) linked
 * above when this college takes them, and a closing line that the application may ask more than these. Embedded
 * (no wrapper) inside `WhatItTakes`; `standalone` wraps it in its own `Block` for a college with prompts but no
 * Common App card (next to `HowToApply`).
 */
export function EssayPrompts({
  school,
  cite,
  id,
  standalone,
}: {
  school: School;
  cite: (path: FieldPath, school?: School) => Cited;
  id?: string;
  standalone?: boolean;
}) {
  const essays = school.essays;
  if (!essays || essays.status === "refers_to_form") return null;
  const line = essayCardLine(essays);
  if (!line) return null;
  const cited = cite("essays.prompts", school);

  const takesCommonApp = !!school.apply;
  const takesCoalition = !!school.coalition;
  const prompts = essays.status === "published" ? essays.prompts : [];

  const content = (
    <>
      <p className="text-sm">
        <MetricLabel term="supplemental-essay" cited={cite("essays.status", school)}>
          {line}
        </MetricLabel>
      </p>
      {prompts.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden">
            Show the prompts
          </summary>
          <div className="mt-2 space-y-3">
            {(takesCommonApp || takesCoalition) && (
              <p className="text-xs text-muted-foreground">
                {takesCommonApp && (
                  <a href={PLATFORM_PROMPTS.common_app.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground hover:underline">
                    The Common App&apos;s own essay prompts
                  </a>
                )}
                {takesCommonApp && takesCoalition && " · "}
                {takesCoalition && (
                  <a href={PLATFORM_PROMPTS.coalition.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-foreground hover:underline">
                    The Coalition&apos;s own essay prompts
                  </a>
                )}
              </p>
            )}
            {essays.choose && (
              <p className="text-xs text-muted-foreground">
                <MetricLabel cited={cite("essays.choose", school)}>
                  {`Answer ${essays.choose.n} of these ${essays.choose.of}.`}
                </MetricLabel>
              </p>
            )}
            <ul className="space-y-3">
              {prompts.map((p) => (
                <PromptRow key={p.id} prompt={p} cited={cited} choose={essays.choose} />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">The application may ask a few short questions beyond these.</p>
          </div>
        </details>
      )}
    </>
  );

  return standalone ? (
    <Block id={id} title="Essays">
      {content}
    </Block>
  ) : (
    <div id={id}>{content}</div>
  );
}
