"use client";

import { useState } from "react";
import { useExploreParams } from "@/components/explore/useExploreParams";
import { useMe } from "@/components/account/useMe";
import { SignInPrompt } from "@/components/account/SignInPrompt";
import { myOwnProfile, myScores } from "@/lib/student-profile-store";
import { hasAnyMappedPreference, preferencesToExploreParams, scoreParams, unmappedPreferencesNote } from "@/lib/explore-fit";

/**
 * Explore's "Fits my scores" / "Fits my preferences" actions (specs/product/student-profile.md "Display"). Both
 * are plain navigations: they read the signed-in student's saved numbers once (a Server Action call from the
 * browser, same as `useMe()`'s `/api/me` fetch) and push a normal Explore URL, so the server-side filter pipeline
 * (`lib/dataset.ts`, from `lib/params.ts`) does the actual filtering, counting, and pagination — no client-side
 * row-hiding, no separate fetch that bypasses Explore's own filters.
 *
 * - "Fits my scores" sets `mySAT`/`myACT` (plain numbers the student chose to apply); `lib/dataset.ts` keeps only
 *   `fitsScoreRange(…) === "in"` (the college's middle 50% contains the score, or it's test-blind — "out" and
 *   "unknown" both drop out, same as every other range filter here).
 * - "Fits my preferences" maps the profile's preferences onto Explore's EXISTING filters (`sizes`, `setting`,
 *   `states`, `types`, `maxCost`) and applies them once; the student sees the normal filter chips afterward and can
 *   adjust them like any other Explore filter. `statesOrRegions` entries that aren't a USPS state code (a region
 *   name, or "Outside the U.S.") have no matching Explore filter and are listed in a note instead of silently
 *   dropped.
 */
export function ExploreFitChips() {
  const { searchParams, update } = useExploreParams();
  const me = useMe();
  const signedIn = me?.signedIn ?? false;

  const scoresActive = Boolean(searchParams.get("mySAT") || searchParams.get("myACT"));
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<"scores" | "prefs" | null>(null);

  async function toggleScores() {
    setNote(null);
    if (scoresActive) {
      update({ mySAT: null, myACT: null });
      return;
    }
    if (!signedIn) {
      setNote("sign-in");
      return;
    }
    setPending("scores");
    try {
      const s = await myScores();
      if (s.satTotal === null && s.actComposite === null) {
        setNote("No SAT or ACT score saved — add one on your profile.");
        return;
      }
      update(scoreParams({ sat: s.satTotal, act: s.actComposite }));
    } finally {
      setPending(null);
    }
  }

  async function applyPreferences() {
    setNote(null);
    if (!signedIn) {
      setNote("sign-in");
      return;
    }
    setPending("prefs");
    try {
      const profile = await myOwnProfile();
      const p = profile?.preferences;
      if (!p) {
        setNote("No preferences saved yet — add some on your profile.");
        return;
      }
      const mapping = preferencesToExploreParams(p);
      if (!hasAnyMappedPreference(mapping)) {
        setNote("No preferences saved yet — add some on your profile.");
        return;
      }
      update(mapping.params);
      setNote(unmappedPreferencesNote(mapping.unmapped));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip active={scoresActive} disabled={pending === "scores"} onClick={toggleScores}>
        Fits my scores
      </Chip>
      <Chip active={false} disabled={pending === "prefs"} onClick={applyPreferences}>
        Fits my preferences
      </Chip>
      {scoresActive && <p className="text-xs text-muted-foreground">Colleges that don&apos;t report scores aren&apos;t shown either way.</p>}
      {note === "sign-in" ? (
        <SignInPrompt reason="use fit filters" next="/explore" variant="inline" />
      ) : (
        note && <p className="text-xs text-muted-foreground">{note}</p>
      )}
    </div>
  );
}

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
          : "rounded-full border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60"
      }
    >
      {children}
    </button>
  );
}
