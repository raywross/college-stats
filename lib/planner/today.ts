/**
 * "Pretend today" (specs/planner/v3/pretend-today.md): the pure part of the planner's date override, shared by the
 * server reader (today-server.ts), the admin page, and the tests. The planner takes `today` as an input everywhere
 * (seasons, the grid's dates, the generators, the tabs, the calendar), so one overridden value walks a plan through
 * its cycle in a sitting. Never honored in production: a real student's deadlines can't be shifted by a setting.
 */

export const TODAY_SETTING = "planner.today";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that is a real calendar day (no 2027-02-30), else null. */
export function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Whether this deployment honors the setting: anywhere but production (`VERCEL_ENV`), so dev and previews only. */
export function overrideAllowed(env: string | undefined = typeof process !== "undefined" ? process.env.VERCEL_ENV : undefined): boolean {
  return env !== "production";
}

/** The override a stored setting value means: the day, or null when it's unset, malformed, or this is production. */
export function parseTodaySetting(value: unknown, env?: string): string | null {
  if (!overrideAllowed(env)) return null;
  return isoDay(value);
}

/** The banner's sentence, for the day given ("Quad is pretending today is Monday, March 15, 2027."). */
export function pretendTodayLine(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const words = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
  return `Quad is pretending today is ${words}.`;
}
