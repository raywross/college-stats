/**
 * Cards by kind (specs/planner/next-steps/build-plan.md review note 8): a task kind's own card, else MoveCard (the
 * default). Each rule unit adds its card file and one line here, e.g. `ed_decide: EdDecideCard,`.
 * Plan v3: a kind whose move opens a guide needs no card of its own; MoveCard's one button is the guide's
 * (`visit_ed` and `show_interest` render MoveCard, the Show interest guide's "Show me how").
 */
import type { ComponentType } from "react";
import type { TaskKind } from "@/lib/planner/types";
import NextYearCard from "@/components/planner/NextYearCard";
import { EdDecideCard } from "./EdDecideCard";
import type { MoveCardProps } from "./types";
import { StoryCard } from "./StoryCard";
import { SubmitCard } from "./SubmitCard";
import { ConfirmCard } from "./ConfirmCard";
import { DecisionCard } from "./DecisionCard";
import { Ed2Card } from "./Ed2Card";
import { DecideCard } from "./DecideCard";
import { OutcomeShareCard } from "./OutcomeShareCard";

export const MOVE_CARDS: Partial<Record<TaskKind, ComponentType<MoveCardProps>>> = {
  story: StoryCard,
  ed_decide: EdDecideCard,
  ed2_decide: EdDecideCard,
  // The course-choice playbook entries only (its key ends in "choose_courses"); every other `playbook` task falls
  // back to MoveCard from inside NextYearCard itself (next steps U1b, build-plan.md "As built by U1" 6).
  playbook: NextYearCard,
  // U5 Applying (specs/planner/next-steps/applying.md): `apply` is the Submit move (the college generator's dated,
  // fee-bearing row); `submit` duplicates it once this card exists and is registered to the same component so it
  // renders nothing and stays out of the Now list (SubmitCard.tsx's note).
  apply: SubmitCard,
  submit: SubmitCard,
  confirm_complete: ConfirmCard,
  decision_expected: DecisionCard,
  ed2_conditional: Ed2Card,
  decide_by: DecideCard,
  deposit: DecideCard,
  outcome_share: OutcomeShareCard,
};
