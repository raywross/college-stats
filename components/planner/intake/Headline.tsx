/**
 * An intake step's headline: Bricolage 800, one word (the last one, or `pop` when the highlight isn't the tail) on a
 * `bg-pop` highlight (specs/planner/redesign/intake.md; the design's "Start with your **grades**").
 */
export function Headline({ lead, pop }: { lead: string; pop: string }) {
  return (
    <h1 className="font-display text-[28px] leading-[1.05] font-extrabold tracking-[-0.025em] text-balance sm:text-3xl lg:text-5xl">
      {lead ? `${lead} ` : ""}
      <span className="rounded-md bg-pop px-1.5 py-0.5 text-pop-foreground lg:rounded-lg lg:px-2">{pop}</span>
    </h1>
  );
}
