/**
 * Which college a citation object came from, so a ⓘ can ship a reference instead of the whole citation (round 5, U3;
 * specs/data-lineage.md "Citations on the plan", "On the public pages"). The dataset's `citeField(path, school)`
 * (lib/dataset.ts) marks every citation it returns for one of its own colleges with a resolver: the reference
 * `GET /api/cite` answers with this same citation (`citeRefWhereSame`), or the citation itself when a reference wouldn't
 * give it back (a GPA field, a hidden or unregistered path) or when the object no longer equals a fresh `citeField`
 * (changed after it was made). `asCiteRef` asks that resolver; anything unmarked (a copy, a spread with a new label, a
 * high school's citation, a citation without a college, an admin's live edit, or anything on the client, where no
 * citation is ever marked) passes through whole.
 *
 * No runtime imports: components/ui/info-tip.tsx's wrappers call `asCiteRef`, and that module is in the client bundle
 * too, where the map stays empty.
 */
import type { CiteLike } from "./lineage";

type Resolver = (cited: object) => object;

const origins = new WeakMap<object, Resolver>();

/** Records how to reference `cited` (lib/dataset.ts `citeField`); the resolver decides at the boundary, not here. */
export function markCiteOrigin(cited: object, resolve: Resolver): void {
  origins.set(cited, resolve);
}

/** Whether `cited` was marked by the dataset (and so may become a reference). */
export function hasCiteOrigin(cited: unknown): boolean {
  return typeof cited === "object" && cited !== null && origins.has(cited);
}

/**
 * The citation as a reference the ⓘ fetches on open, where `GET /api/cite` would answer it unchanged; otherwise the
 * citation as given. For a server component handing a citation to a client one.
 */
export function asCiteRef(cited: CiteLike): CiteLike;
export function asCiteRef(cited: CiteLike | undefined): CiteLike | undefined;
export function asCiteRef(cited: CiteLike | null): CiteLike | null;
export function asCiteRef(cited: CiteLike | null | undefined): CiteLike | null | undefined {
  if (typeof cited !== "object" || cited === null) return cited;
  const resolve = origins.get(cited);
  return resolve ? (resolve(cited) as CiteLike) : cited;
}
