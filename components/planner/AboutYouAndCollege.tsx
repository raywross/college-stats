/**
 * Plan v3 (specs/planner/v3/connections.md "The row"; build-plan.md U2b "What's removed"): the row's Connections
 * chips (legacy, sibling, recruiting) moved into the intake's Connections step and `student_profiles.data.connections`
 * (U2a); the row's now-deleted capture panel is what used to hold them. `AddToListForHooks` below, the college
 * profile's own standing-card line, is unrelated to the row and stays.
 */

/** The profile's standing card, which has no list row (inputs-beyond-academics.md "Legacy"): shown when neither is set. */
export function AddToListForHooks({ college, href }: { college: string; href: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      <a href={href} className="font-semibold text-primary hover:underline">
        Add {college} to your list
      </a>{" "}
      to mark a legacy or recruiting connection.
    </p>
  );
}
