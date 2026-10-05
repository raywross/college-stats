/**
 * Every state report card adapter, by lower-case USPS code. Units replace their state's file; this list doesn't change.
 * Add a state: a new file here, its `state-{xx}` key in HsSourceKey (lib/high-school-types.ts) and HS_SOURCE_VINTAGE
 * (lib/hs-fields.ts), and one entry below.
 */
import type { StateAdapter } from "../types.mts";
import { adapter as ca } from "./ca.mts";
import { adapter as tx } from "./tx.mts";
import { adapter as ny } from "./ny.mts";
import { adapter as fl } from "./fl.mts";
import { adapter as il } from "./il.mts";
import { adapter as sc } from "./sc.mts";
import { adapter as ct } from "./ct.mts";

export const STATE_ADAPTERS: Readonly<Record<string, StateAdapter>> = { ca, tx, ny, fl, il, sc, ct };
