/**
 * Five-field cron expressions (specs/product/admin-jobs.md "Schedules"): the form Vercel Cron (vercel.json) and GitHub
 * Actions (`on.schedule`) both take, read in UTC, which is the zone both run in. `*`, lists (`1,15`), ranges (`1-5`),
 * and steps (`*\/30`, `1-5/2`) in each field; weekdays 0 to 7 with 7 meaning Sunday; no names, no `L`, `W`, or `?`.
 * When both the day of the month and the weekday are restricted, a time matches when either does (Vixie cron's rule,
 * which GitHub follows). Pure, no dates from the clock: `nextRun` takes `from`.
 */

export interface CronSchedule {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  /** 1 to 31. */
  daysOfMonth: ReadonlySet<number>;
  /** 1 to 12. */
  months: ReadonlySet<number>;
  /** 0 (Sunday) to 6. */
  daysOfWeek: ReadonlySet<number>;
  /** Whether each day field was written as `*` (the either-or rule applies only when both are restricted). */
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

const FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

function parseField(raw: string, min: number, max: number, field: string): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron: can't read "${part}" in the ${field} field`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`cron: a step must be at least 1 (${field})`);
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b === undefined ? (m[2] === undefined ? a : max) : b;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron: ${lo}${hi !== lo ? `-${hi}` : ""} is outside ${min}-${max} (${field})`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** The schedule an expression describes. Throws on anything it can't read, so a typo in a table fails a test. */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron: "${expression}" needs five fields`);
  const names = ["minute", "hour", "day of month", "month", "weekday"];
  const [minutes, hours, daysOfMonth, months, dowRaw] = fields.map((f, i) => parseField(f, FIELD_RANGES[i][0], FIELD_RANGES[i][1], names[i]));
  const daysOfWeek = new Set([...dowRaw].map((d) => (d === 7 ? 0 : d)));
  return { minutes, hours, daysOfMonth, months, daysOfWeek, anyDayOfMonth: fields[2] === "*", anyDayOfWeek: fields[4] === "*" };
}

/** Whether a UTC moment (seconds ignored) is one the schedule fires at. */
export function matches(schedule: CronSchedule, at: Date): boolean {
  if (!schedule.minutes.has(at.getUTCMinutes()) || !schedule.hours.has(at.getUTCHours()) || !schedule.months.has(at.getUTCMonth() + 1)) return false;
  const dom = schedule.daysOfMonth.has(at.getUTCDate());
  const dow = schedule.daysOfWeek.has(at.getUTCDay());
  if (schedule.anyDayOfMonth && schedule.anyDayOfWeek) return true;
  if (schedule.anyDayOfMonth) return dow;
  if (schedule.anyDayOfWeek) return dom;
  return dom || dow;
}

/** How far ahead `nextRun` looks: a monthly job on the 31st skips months, but nothing valid is further than this. */
const SEARCH_MINUTES = 366 * 24 * 60 * 5;

/**
 * The first firing strictly after `from` (so a job that fires now shows the one after). Minute by minute, skipping
 * whole hours and days the schedule can't match; null only for a schedule that never fires (Feb 30).
 */
export function nextRun(schedule: CronSchedule, from: Date): Date | null {
  const t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), from.getUTCHours(), from.getUTCMinutes() + 1));
  for (let i = 0; i < SEARCH_MINUTES; ) {
    if (!schedule.months.has(t.getUTCMonth() + 1)) {
      // Jump to the first of the next month.
      const skip = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1));
      i += Math.round((skip.getTime() - t.getTime()) / 60_000);
      t.setTime(skip.getTime());
      continue;
    }
    const dayOk = schedule.anyDayOfMonth && schedule.anyDayOfWeek ? true : schedule.anyDayOfMonth ? schedule.daysOfWeek.has(t.getUTCDay()) : schedule.anyDayOfWeek ? schedule.daysOfMonth.has(t.getUTCDate()) : schedule.daysOfMonth.has(t.getUTCDate()) || schedule.daysOfWeek.has(t.getUTCDay());
    if (!dayOk) {
      const skip = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1));
      i += Math.round((skip.getTime() - t.getTime()) / 60_000);
      t.setTime(skip.getTime());
      continue;
    }
    if (!schedule.hours.has(t.getUTCHours())) {
      const skip = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours() + 1));
      i += Math.round((skip.getTime() - t.getTime()) / 60_000);
      t.setTime(skip.getTime());
      continue;
    }
    if (schedule.minutes.has(t.getUTCMinutes())) return new Date(t.getTime());
    t.setTime(t.getTime() + 60_000);
    i++;
  }
  return null;
}

/** The next `count` firings after `from`, in order. */
export function nextRuns(schedule: CronSchedule, from: Date, count: number): Date[] {
  const out: Date[] = [];
  let at = from;
  while (out.length < count) {
    const next = nextRun(schedule, at);
    if (!next) break;
    out.push(next);
    at = next;
  }
  return out;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function clock(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} UTC`;
}

/** A sorted set's values as a run ("1-5") when they are consecutive, else null. */
function consecutive(values: number[]): [number, number] | null {
  if (values.length < 2) return null;
  for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1] + 1) return null;
  return [values[0], values[values.length - 1]];
}

/**
 * The schedule in words: "Every day at 13:00 UTC", "Sundays at 23:00 UTC", "Monday to Saturday at 23:00 UTC", "The
 * 1st of every month at 13:00 UTC", "Every 30 minutes". An expression this can't put into words comes back as written.
 */
export function describeCron(expression: string): string {
  let s: CronSchedule;
  try {
    s = parseCron(expression);
  } catch {
    return expression;
  }
  if (s.months.size !== 12) return expression;
  const minutes = [...s.minutes].sort((a, b) => a - b);
  const hours = [...s.hours].sort((a, b) => a - b);
  const everyDay = s.anyDayOfMonth && s.anyDayOfWeek;

  // Every N minutes, all day, every day.
  if (everyDay && hours.length === 24 && minutes.length > 1) {
    const step = minutes[1] - minutes[0];
    if (minutes.every((m, i) => m === minutes[0] + i * step) && minutes[0] === 0 && 60 % step === 0) return step === 1 ? "Every minute" : `Every ${step} minutes`;
    return expression;
  }
  if (minutes.length !== 1 || hours.length !== 1) return expression;
  const time = clock(hours[0], minutes[0]);

  if (everyDay) return `Every day at ${time}`;
  if (s.anyDayOfMonth) {
    const days = [...s.daysOfWeek].sort((a, b) => a - b);
    if (days.length === 1) return `${WEEKDAYS[days[0]]}s at ${time}`;
    const run = consecutive(days);
    if (run) return `${WEEKDAYS[run[0]]} to ${WEEKDAYS[run[1]]} at ${time}`;
    return `${days.map((d) => WEEKDAYS[d] + "s").join(", ")} at ${time}`;
  }
  if (s.anyDayOfWeek) {
    const days = [...s.daysOfMonth].sort((a, b) => a - b);
    if (days.length === 1) return `The ${ordinal(days[0])} of every month at ${time}`;
    return `The ${days.map(ordinal).join(", ")} of every month at ${time}`;
  }
  return expression;
}
