import type { Topic } from "./types.ts";

/** How each field topic is named for readers (the Data page's groupings and the Developers page's field registry). */
export const TOPIC_LABELS: Record<Topic, string> = {
  institution: "Name, location & type",
  admissions: "Admissions & test scores",
  enrollment: "Enrollment",
  demographics: "Student background",
  cost: "Net price & cost",
  prices: "Sticker prices",
  outcomes: "Earnings, graduation & debt",
  aid: "Financial aid",
  campus: "Housing & campus life",
  academics: "Academics",
};
