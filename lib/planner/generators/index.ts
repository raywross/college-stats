/**
 * The task generators, in the order generateTasks() runs them (lib/planner/tasks.ts): the cycle's shared dates, the
 * college's own dates, then the stages' tasks. Each module exports `generate(input) → GeneratedTask[]` and is filled
 * by its unit (cycle and college U5, rounds U3, actions U4, apply U6, offers U7). Don't edit this list; fill your
 * module. When two generators emit the same key, the first one wins.
 */
import type { Generator } from "../types.ts";
import { generate as cycle } from "./cycle.ts";
import { generate as college } from "./college.ts";
import { generate as rounds } from "./rounds.ts";
import { generate as actions } from "./actions.ts";
import { generate as apply } from "./apply.ts";
import { generate as offers } from "./offers.ts";

export const GENERATORS: readonly { name: string; generate: Generator }[] = [
  { name: "cycle", generate: cycle },
  { name: "college", generate: college },
  { name: "rounds", generate: rounds },
  { name: "actions", generate: actions },
  { name: "apply", generate: apply },
  { name: "offers", generate: offers },
];
