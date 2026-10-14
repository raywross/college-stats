/**
 * Cards by kind (specs/planner/next-steps/build-plan.md review note 8): a task kind's own card, else MoveCard (the
 * default). Each rule unit adds its card file and one line here, e.g. `ed_decide: EdDecideCard,`.
 */
import type { ComponentType } from "react";
import type { TaskKind } from "@/lib/planner/types";
import { EdDecideCard } from "./EdDecideCard";
import type { MoveCardProps } from "./types";
import { StoryCard } from "./StoryCard";

export const MOVE_CARDS: Partial<Record<TaskKind, ComponentType<MoveCardProps>>> = {
  story: StoryCard,
  ed_decide: EdDecideCard,
  ed2_decide: EdDecideCard,
};
