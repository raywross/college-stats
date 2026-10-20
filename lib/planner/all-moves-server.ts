import "server-only";
/**
 * The all-moves preview's setting (lib/planner/all-moves.ts): `PLANNER_ALL_MOVES=1` turns it on for every plan this
 * server opens. Off when unset, so production stays on the normal Next steps tab unless someone sets it there.
 */
export function allMovesEnabled(): boolean {
  return process.env.PLANNER_ALL_MOVES === "1";
}
