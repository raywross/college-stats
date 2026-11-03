/**
 * The Data Steward's models and their list prices (specs/product/data-steward.md "Models and cost"). The ids live here
 * and nowhere else: the main loop (triage, verification, audits, answers) on Opus 5.5 with adaptive thinking at effort
 * `high`; a question about a document's lines on Sonnet 5; a plain "what does line N say" on Haiku 4.5.
 *
 * Prices are US dollars per million tokens, as the build brief fixes them (Opus 5.5 $5/$25, Sonnet 5 $3/$15, Haiku 4.5
 * $1/$5). Cache reads cost a tenth of input, a five-minute cache write 1.25 times input, and thinking is billed as
 * output (it is counted in `output_tokens`). If a list price is lower than this table, the budget only stops early.
 */
export const STEWARD_MODELS = {
  /** Triage, verification, audits, answers. */
  main: "claude-opus-5-5",
  /** "Read these lines and answer this question, with page and line." */
  read: "claude-sonnet-5",
  /** "What does line N say." */
  line: "claude-haiku-4-5-20251001",
} as const;

export type StewardModel = (typeof STEWARD_MODELS)[keyof typeof STEWARD_MODELS];

export interface Price {
  /** Dollars per million uncached input tokens. */
  input: number;
  /** Dollars per million output tokens (thinking included). */
  output: number;
}

export const PRICES: Readonly<Record<StewardModel, Price>> = {
  "claude-opus-5-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

/** A cache read's price as a share of input; a cache write's. */
export const CACHE_READ_SHARE = 0.1;
export const CACHE_WRITE_SHARE = 1.25;

/** The main loop's request settings (Opus 5.5: thinking can't be disabled; effort defaults to medium, so it is set). */
export const MAIN_EFFORT = "high" as const;
export const MAIN_MAX_TOKENS = 16_000;
/** The most model calls one main loop makes, whatever the budget. */
export const MAIN_MAX_ITERATIONS = 80;
/** Sub-reads answer in a few sentences of JSON. */
export const READ_MAX_TOKENS = 4_000;
export const LINE_MAX_TOKENS = 1_000;
