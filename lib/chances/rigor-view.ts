/**
 * What the browser gets of the rigor reading (specs/chances/rigor-in-context.md): the reading's label, its sentences
 * already written from the note catalog, the counts the sentences used, and the school's offering as lines. The server
 * computes it (rigor.ts, rigor-server.ts) and passes it down; no rule or threshold is in it, and none of the client
 * code that renders it imports the rules (tests/chances-rigor.test.mts). Pure and client-safe.
 */
import type { AnyCited } from "../lineage.ts";
import { noteText } from "./notes.ts";
import type { EstimateNote, RigorReading, SchoolOffering } from "./types.ts";

export interface RigorCounts {
  ap: number;
  ib: number;
  dual: number;
  honors: number;
  /** AP, IB, and dual-enrollment rows, any status. */
  advanced: number;
  /** Of those, how many are only planned. */
  planned: number;
  /** Different AP courses the school offers; null when unknown. */
  offered: number | null;
}

/** The student's high school and what it offers, as the picker, the Courses section, and the high school page show it. */
export interface OfferingView {
  hsId: string;
  hsName: string;
  apCount: number | null;
  /** Catalog keys of the AP courses when a list is known; null for a count only. */
  apKeys: string[] | null;
  ib: boolean | null;
  dual: boolean | null;
  source: SchoolOffering["source"];
  /** "Your school's profile lists 14 AP courses." and "IB and dual enrollment are offered too." */
  lines: string[];
  /** The citation for the offering (HS_FIELDS), when it has one; null for pooled and student marks. */
  cite: AnyCited | null;
}

export interface RigorView {
  reading: RigorReading;
  /** The lead sentence first, then grades and exams when given. */
  sentences: string[];
  counts: RigorCounts;
  offering: OfferingView | null;
}

/** The notes as sentences, in order; a key the catalog doesn't have is dropped. */
export function sentencesFrom(notes: readonly EstimateNote[]): string[] {
  return notes.map(noteText).filter((t) => t !== "");
}

const note = (key: string, values: EstimateNote["values"] = {}): EstimateNote => ({ key, values });

/** The offering in sentences: the AP line by source, then the other kinds of advanced course the school has. */
export function offeringLines(o: SchoolOffering): string[] {
  const lines: EstimateNote[] = [];
  if (o.source === "profile") lines.push(note("offering.profile", { count: o.apCount ?? 0 }));
  else if (o.source === "pooled") lines.push(note("offering.pooled"));
  else if (o.source === "student") lines.push(note("offering.student"));
  else if (o.source === "crdc") lines.push(o.apCount === 0 ? note("offering.none") : note("offering.crdc", { count: o.apCount ?? 0 }));
  else lines.push(note("offering.unknown"));
  const also = [o.ib === true && "IB", o.dual === true && "dual enrollment"].filter((x): x is string => !!x);
  if (also.length) lines.push(note("offering.also", { list: also.join(" and "), count: also.length }));
  return sentencesFrom(lines);
}
