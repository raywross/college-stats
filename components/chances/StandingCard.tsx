"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { MajorLines, type MajorCites } from "@/components/chances/MajorLines";
import { StandingBadge } from "@/components/chances/StandingBadge";
import { useStanding, type LikeYou } from "@/components/chances/useStanding";
import { WhatWentIn } from "@/components/chances/WhatWentIn";
import { useLocalProfile } from "@/components/me/useLocalProfile";
import { InfoTip } from "@/components/ui/info-tip";
import { track } from "@/lib/analytics";
import { loginHref } from "@/lib/accounts";
import { majorReviewFor } from "@/lib/chances/major-review";
import { isMajorFamily } from "@/lib/majors";
import { noteText } from "@/lib/chances/notes";
import { panelParts } from "@/lib/chances/what-went-in";
import type { EstimateResult } from "@/lib/chances/types";
import type { AnyCited } from "@/lib/lineage";
import { stateName } from "@/lib/states";

export interface StandingCardProps {
  unitId: string;
  /** The college's short name, for sentences. */
  college: string;
  /** Citations for every field an estimate can cite (lib/chances/fact-cites.ts), resolved on the server. */
  cites: Record<string, AnyCited>;
  majorCites: MajorCites;
  /** Families of majors the college admits by (its schools or majors), with their names. */
  families: { family: string; name: string }[];
  /** The college has a statement of how it treats the major (lib/chances/major-admission.ts). */
  hasStatement: boolean;
}

const CAVEATS = ["estimate.caveat.holistic", "estimate.caveat.enrolled", "estimate.caveat.hooked", "estimate.caveat.afford"] as const;

/** "Of 63 students on Quad with numbers like yours who applied to Purdue from Indiana in the last three seasons, 47 were admitted." */
function likeYouSentence(l: LikeYou, college: string, state: string | null): string {
  return noteText({
    key: "estimate.like_you",
    values: { n: l.n, admitted: l.admitted, college, from: l.residency && state ? ` from ${stateName(state)}` : "" },
  });
}

/** Reports that an estimate was shown, once per college per view: the group, the label, the model version, never the inputs. */
function useReportShown(result: EstimateResult | null) {
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!result || reported.current === result.unitId) return;
    reported.current = result.unitId;
    track("estimate_shown", { group: result.group ?? "none", label: result.label ?? "none", model_version: result.modelVersion });
  }, [result]);
}

/**
 * "Where you stand" on the admissions page (specs/product/chances-and-fit.md "Display", specs/chances/estimate.md "On the
 * profile"): for a student with numbers, Quad's estimate as a group chip with its label and the two stage lines, "What
 * went into this estimate", the "students like you" count once there is one, and the caveats every estimate carries.
 * The numbers come from the signed-in profile, else the one kept in the browser; the college page is static, so the
 * estimate is asked of POST /api/estimate after mount. The existing score checker and GPA checker stay where they are.
 */
export function StandingCard({ unitId, college, cites, majorCites, families, hasStatement }: StandingCardProps) {
  const s = useStanding(unitId, { likeYou: true });
  useReportShown(s.status === "ready" ? s.result : null);

  if (s.status === "loading") return <div className="h-24 animate-pulse rounded-2xl bg-muted/50" aria-hidden />;

  if (s.status === "ready") {
    const { result, yours, student, likeYou } = s;
    const parts = panelParts(result);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StandingBadge result={result} className="h-8 text-sm" />
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            {noteText({ key: "estimate.label", values: {} })} <InfoTip term="quads-estimate" />
          </span>
        </div>
        {parts.label && <p className="text-sm font-medium">{noteText(parts.label)}</p>}
        {parts.stages.length > 0 && (
          <ul className="space-y-1 text-sm">
            {parts.stages.map((n, i) => (
              <li key={`${n.key}-${i}`}>{noteText(n)}</li>
            ))}
          </ul>
        )}
        {likeYou && <p className="text-sm text-muted-foreground">{likeYouSentence(likeYou, college, student.state)}</p>}
        <WhatWentIn result={result} yours={yours} college={college} cite={(p) => cites[p]} promptHref="/me" className="rounded-2xl bg-muted/40 p-3 sm:p-4" />
        <ul className="space-y-1 text-xs text-muted-foreground">
          {CAVEATS.map((k) => (
            <li key={k}>
              {noteText({ key: k, values: {} })}
              {k === "estimate.caveat.afford" && (
                <>
                  {" "}
                  <Link href={`/schools/${unitId}/cost`} className="font-semibold text-primary hover:underline">
                    See the cost
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
        {!s.signedIn && <SaveYourScores unitId={unitId} />}
        {!s.signedIn && <SignedOutMajor unitId={unitId} college={college} families={families} hasStatement={hasStatement} majorCites={majorCites} />}
      </div>
    );
  }

  if (s.status === "failed") return <p className="text-sm text-muted-foreground">{noteText({ key: "estimate.unavailable", values: {} })}</p>;

  // No numbers yet.
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {noteText({ key: "estimate.add_numbers", values: {} })}{" "}
        {s.signedIn ? (
          <Link href="/me" className="font-semibold text-primary hover:underline">
            Add your numbers
          </Link>
        ) : (
          <span>Use the score checker below, or add them on your profile.</span>
        )}
      </p>
      {!s.signedIn && <SaveYourScores unitId={unitId} />}
      {!s.signedIn && <SignedOutMajor unitId={unitId} college={college} families={families} hasStatement={hasStatement} majorCites={majorCites} />}
    </div>
  );
}

function SaveYourScores({ unitId }: { unitId: string }) {
  return (
    <p className="text-sm">
      <Link href={loginHref(`/schools/${unitId}/admissions#standing`)} className="font-semibold text-primary hover:underline">
        {noteText({ key: "estimate.save_prompt", values: {} })}
      </Link>
    </p>
  );
}

/**
 * The signed-out major picker (major-and-grades.md "Where it shows"): pick an intended major, as the score checker lets
 * a visitor type a score, and see how this college reads it. The pick is kept with the profile in the browser, so the
 * estimate and the college's course requirements use it too.
 */
function SignedOutMajor({ unitId, college, families, hasStatement, majorCites }: Pick<StandingCardProps, "unitId" | "college" | "families" | "hasStatement" | "majorCites">) {
  const { data, save } = useLocalProfile();
  if (families.length === 0 && !hasStatement) return null;
  const pick = (family: string) => save({ ...data, plans: { ...data.plans, intendedMajors: isMajorFamily(family) ? [family] : [] } });
  const chosen = data.plans.intendedMajors[0] ?? "";
  // A college that only says how it treats majors in general has no family to pick; its line shows as it stands.
  const askFamily = families.length === 0 ? "52" : chosen;
  const reading = askFamily
    ? majorReviewFor({ majors: [askFamily], courses: data.academics.courses, satMath: data.tests.satMath, actMath: data.tests.actMath }, { unit_id: unitId, name: college })
    : null;
  return (
    <div className="space-y-2 border-t pt-4">
      {families.length > 0 && (
        <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-auto sm:max-w-sm">
          <span className="font-medium">{noteText({ key: "major.pick_label", values: {} })}</span>
          <select value={chosen} onChange={(e) => pick(e.target.value)} className="w-full min-w-0 rounded-xl border bg-card px-3 py-2 text-sm">
            <option value="">Choose a major…</option>
            {families.map((f) => (
              <option key={f.family} value={f.family}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {reading === null ? (
        <p className="text-sm text-muted-foreground">{noteText({ key: "major.pick_prompt", values: {} })}</p>
      ) : reading.notes.length > 0 ? (
        <MajorLines reading={reading} majorCites={majorCites} />
      ) : (
        <p className="text-sm text-muted-foreground">{noteText({ key: "major.no_statement", values: { college } })}</p>
      )}
    </div>
  );
}
