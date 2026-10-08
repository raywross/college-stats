/**
 * Every federal / private high school adapter. Directories run before enrichment (merge.mts orders them). Units
 * replace their adapter's own file; this list doesn't change.
 */
import type { HighSchoolAdapter } from "./types.mts";
import * as ccd from "./ccd.mts";
import * as pss from "./pss.mts";
import * as edfacts from "./edfacts.mts";
import * as crdc from "./crdc.mts";

export const ADAPTERS: readonly HighSchoolAdapter[] = [ccd, pss, edfacts, crdc];
