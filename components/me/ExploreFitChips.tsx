"use client";

import { useEffect, useState } from "react";
import { useExploreParams } from "@/components/explore/useExploreParams";
import { useMe } from "@/components/account/useMe";
import { SignInPrompt } from "@/components/account/SignInPrompt";

interface FitResponse {
  signedIn: boolean;
  hasScores: boolean;
  hasPreferences: boolean;
  ids: { scores?: string[]; prefs?: string[] };
}

/**
 * Explore's "Fits my scores" / "Fits my preferences" chips (specs/product/student-profile.md "Display"). `fit=`
 * is a normal URL param like Explore's other filters, but it's resolved here, client-side, from
 * /api/me/explore-fit: Explore's page is public and must stay static (tests/accounts.test.mts), so it can't read
 * the signed-in student's profile itself.
 *
 * KNOWN LIMITATION (documented in specs/product/student-profile.md): because the match is computed against the
 * whole dataset rather than through Explore's own filter pipeline, this hides non-matching rows already on the
 * page (by data-unit-id) instead of changing which page of results the server returns. The visible count and
 * "N colleges" totals above the table describe the filters BEFORE fit is applied.
 */
export function ExploreFitChips() {
  const { searchParams, update } = useExploreParams();
  const me = useMe();
  const fitParam = searchParams.get("fit") ?? "";
  const active = new Set(fitParam.split(",").filter(Boolean));
  const [fit, setFit] = useState<FitResponse | null>(null);

  const signedIn = me?.signedIn ?? false;
  const wantsFit = active.size > 0;

  // Fetches the signed-in student's matching ids whenever the chip selection (or sign-in state) changes.
  useEffect(() => {
    if (!wantsFit || !signedIn) return;
    let cancelled = false;
    fetch("/api/me/explore-fit", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<FitResponse>) : null))
      .then((data) => {
        if (!cancelled && data) setFit(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fitParam, signedIn, wantsFit]);

  // Which ids to keep, derived from the fetched response and the current chip selection (not stored as its own
  // state — just a computation, so it can never drift out of sync with `fit` or `active`).
  const keep = (() => {
    if (!wantsFit || !signedIn || !fit) return null;
    const sets = [...active].map((k) => fit.ids[k as "scores" | "prefs"]).filter((s): s is string[] => !!s);
    return sets.length === 0 ? null : sets.reduce((a, b) => a.filter((id) => b.includes(id)));
  })();
  const shown = wantsFit && signedIn && fit ? keep?.length ?? null : null;

  // The one DOM side effect: hide table/grid/list rows not in `keep` (see the component doc comment for why this
  // happens client-side, after the server-rendered list is already on the page).
  useEffect(() => {
    applyToDom(keep);
    return () => applyToDom(null);
  }, [keep]);

  function toggle(key: "scores" | "prefs") {
    const next = new Set(active);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update({ fit: next.size ? [...next].join(",") : null });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active={active.has("scores")} onClick={() => toggle("scores")}>
        Fits my scores
      </Chip>
      <Chip active={active.has("prefs")} onClick={() => toggle("prefs")}>
        Fits my preferences
      </Chip>
      {wantsFit && !signedIn && <SignInPrompt reason="use fit filters" next="/explore" variant="inline" />}
      {wantsFit && signedIn && fit && !fit.hasScores && active.has("scores") && (
        <p className="text-xs text-muted-foreground">No SAT or ACT score saved — add one on your profile.</p>
      )}
      {wantsFit && signedIn && fit && !fit.hasPreferences && active.has("prefs") && (
        <p className="text-xs text-muted-foreground">No preferences saved yet — add some on your profile.</p>
      )}
      {wantsFit && signedIn && shown !== null && (
        <p className="text-xs text-muted-foreground">
          Showing {shown} that fit (out of the filters above; colleges without a reported range or preference aren&apos;t shown either way).
        </p>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-sm font-semibold"
          : "rounded-full border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-muted"
      }
    >
      {children}
    </button>
  );
}

/** Hides every [data-unit-id] element not in `ids` (null = show everything); see the component doc comment. */
function applyToDom(ids: string[] | null) {
  const keep = ids ? new Set(ids) : null;
  document.querySelectorAll<HTMLElement>("[data-unit-id]").forEach((el) => {
    el.style.display = !keep || keep.has(el.dataset.unitId ?? "") ? "" : "none";
  });
}
