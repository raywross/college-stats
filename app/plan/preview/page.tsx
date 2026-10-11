import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import { crestBrand } from "@/lib/brand";
import { satTotal } from "@/lib/score-bands";
import { LIST_ROUNDS, type ListRound } from "@/lib/list-rules";
import { cycleFor, loadCycle } from "@/lib/planner/cycle";
import { standingGpaAverage, todayIso } from "@/lib/planner/context";
import { collegeGpa, gpaCites } from "@/lib/planner/gpa-model";
import { gpaCurve, gpaModel } from "@/lib/planner/gpa-model-server";
import { roundDates, type RoundsSchool } from "@/lib/planner/rounds";
import type { AnyCited } from "@/lib/lineage";
import { PlanPreview, type PreviewEntry, type PreviewKid, type PreviewSchool } from "@/components/plan-preview/PlanPreview";

export const metadata: Metadata = { title: "Plan: design preview", robots: { index: false } };

/**
 * /plan/preview: a clickable design preview of the redesigned planner (specs/planner/redesign/README.md), for the
 * owner's review on a Vercel preview. A sample family (two students, made up) over real college records from the
 * dataset, run through the real standing model (lib/planner/standing.ts) and starting rounds
 * (lib/planner/auto-rounds.ts). Nothing is read from or written to anyone's account. Not served in production.
 */

/** The sample family: the people are invented, the colleges and every number about them are the dataset's. */
const FAMILY: { id: string; name: string; gradYear: number; gpa: number; test: { kind: "sat" | "act"; score: number } | null; dream: string; list: string[] }[] = [
  {
    id: "maya",
    name: "Maya",
    gradYear: 2027,
    gpa: 3.82,
    test: { kind: "sat", score: 1390 },
    dream: "199847",
    // Wake Forest, Vassar, William & Mary, George Washington, Georgia, Rhodes, Elon, Loyola Maryland
    list: ["199847", "197133", "231624", "131469", "139959", "221351", "198516", "163046"],
  },
  {
    id: "theo",
    name: "Theo",
    gradYear: 2028,
    gpa: 3.5,
    test: { kind: "act", score: 27 },
    dream: "131520",
    // Howard, Illinois, Florida, Colorado College, Cincinnati, Earlham, Bellarmine, St. Mary's College of Maryland
    list: ["131520", "145637", "134130", "126678", "201885", "150455", "156286", "163912"],
  },
];

export default async function PlanPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  const { getSchoolById, citeField } = await getData();
  const model = await gpaModel();
  const curve = await gpaCurve();
  const today = todayIso(); // the build's day; the client moves it to the visitor's (PlanPreview)

  const kids: PreviewKid[] = FAMILY.map((k) => {
    const cycle = loadCycle(cycleFor(k.gradYear));
    const schools: PreviewSchool[] = [];
    for (const id of k.list) {
      const s = getSchoolById(id);
      if (!s) continue;
      const profile = s.reported?.admission_profile ?? null;
      const logistics = s.reported?.admissions_logistics ?? null;
      const cites: Record<string, unknown> = {};
      const roundsSchool: RoundsSchool = {
        unit_id: s.unit_id,
        name: s.name,
        profile,
        logistics,
        cycleStartYear: cycle.startYear,
        editionIsLastCycle: false,
        cites,
        admitRate: s.admissions?.acceptance_rate ?? null,
        avgCost: s.cost?.avg_paid_all ?? null,
        links: s.links ?? null,
        type: s.type ?? null,
      };
      const dates = {} as PreviewSchool["dates"];
      for (const r of LIST_ROUNDS) {
        const d = roundDates(roundsSchool, r as ListRound);
        dates[r] = {
          closing: d.closing ? { iso: d.closing.iso, cite: citeField(d.closing.field as never, s) as AnyCited } : null,
          notification: d.notification ? { iso: d.notification.iso, cite: citeField(d.notification.field as never, s) as AnyCited } : null,
        };
      }
      const sat = satTotal(s);
      const act = s.admissions?.act_composite_25_75 ?? null;
      const gpaAverage = standingGpaAverage(s);
      // The college's GPA, best source first, and the citation its sentence's ⓘ shows (specs/planner/redesign/gpa.md).
      const gpa = collegeGpa(s, model, curve);
      const gpaCite = Object.values(gpaCites(s, gpa, model, citeField, curve))[0] ?? null;
      schools.push({
        id: s.unit_id,
        name: s.name,
        brand: crestBrand(s) ?? null,
        type: s.type ?? null,
        profile,
        logistics,
        standing: { admitRate: s.admissions?.acceptance_rate ?? null, sat, act, gpaAverage, gpa, testPolicy: s.admissions?.test_policy ?? null },
        cites: {
          sat: sat ? (citeField("derived.sat_total", s) as AnyCited) : null,
          act: act ? (citeField("admissions.act_composite_25_75", s) as AnyCited) : null,
          policy: s.admissions?.test_policy ? (citeField("admissions.test_policy", s) as AnyCited) : null,
          gpa: gpaCite as AnyCited | null,
        },
        dates,
      });
    }
    return { id: k.id, name: k.name, gradYear: k.gradYear, cycleStart: cycle.startYear, gpa: k.gpa, test: k.test, dream: k.dream, schools };
  });

  // Dates for everyone (tests, aid forms, essays, the reply date) from the cycle file, across both students' cycles.
  const seen = new Set<string>();
  const entries: PreviewEntry[] = [];
  for (const k of FAMILY) {
    for (const e of loadCycle(cycleFor(k.gradYear)).entries) {
      const isTest = e.applies === "plans_tests";
      const id = isTest ? e.key : `${k.id}:${e.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({ id, kid: isTest ? null : k.id, key: e.key, label: e.label, date: e.date ?? null, window: e.window ?? null, registerBy: e.register_by ?? null, assignee: e.assignee, applies: e.applies, source: e.source });
    }
  }

  return <PlanPreview kids={kids} entries={entries} today={today} />;
}
