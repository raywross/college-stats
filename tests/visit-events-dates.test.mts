/**
 * Visit-event dates (lib/visit-events/dates.ts; specs/product/visit-events.md "How Slate publishes"): the standard
 * search's year-less dates placed by the year rule, the event page's full date line with its zone, zone names to IANA
 * zones, local times to instants, and the day · time line the pages print.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatEventWhen, localIsoIn, parseEventPageWhen, parseSearchWhen, toInstant, zoneFor, zoneForState } from "../lib/visit-events/dates.ts";

const OCT_13 = new Date("2026-10-13T16:00:00Z");

test("parseSearchWhen: a timed row in October is this year", () => {
  assert.deepEqual(parseSearchWhen("Wednesday, October 21 at 9:00 AM", OCT_13), { iso: "2026-10-21T09:00:00", allDay: false });
  assert.deepEqual(parseSearchWhen("Tuesday, October 13 at 6:30 PM", OCT_13), { iso: "2026-10-13T18:30:00", allDay: false });
  assert.deepEqual(parseSearchWhen("Thursday, November 12 at 12:00 PM", OCT_13), { iso: "2026-11-12T12:00:00", allDay: false });
  assert.deepEqual(parseSearchWhen("Friday, December 11 at 12:15 AM", OCT_13), { iso: "2026-12-11T00:15:00", allDay: false });
});

test("parseSearchWhen: an all-day row has no time", () => {
  assert.deepEqual(parseSearchWhen("Wednesday, October 14", OCT_13), { iso: "2026-10-14T00:00:00", allDay: true });
});

test("parseSearchWhen: January–September dates are next year when run in the fall", () => {
  assert.equal(parseSearchWhen("Monday, January 4 at 10:00 AM", OCT_13)?.iso, "2027-01-04T10:00:00");
  assert.equal(parseSearchWhen("Thursday, September 30 at 10:00 AM", OCT_13)?.iso, "2027-09-30T10:00:00");
  assert.equal(parseSearchWhen("Thursday, December 31 at 10:00 AM", OCT_13)?.iso, "2026-12-31T10:00:00");
});

test("parseSearchWhen: across the December→January boundary", () => {
  const dec20 = new Date("2026-12-20T15:00:00Z");
  assert.equal(parseSearchWhen("Monday, December 21 at 9:00 AM", dec20)?.iso, "2026-12-21T09:00:00");
  assert.equal(parseSearchWhen("Tuesday, January 5 at 9:00 AM", dec20)?.iso, "2027-01-05T09:00:00");
  assert.equal(parseSearchWhen("Saturday, October 2 at 9:00 AM", dec20)?.iso, "2027-10-02T09:00:00");
});

test("parseSearchWhen: a run on 2 January puts every date in the new year, the rest of the cycle included", () => {
  const jan2 = new Date("2027-01-02T12:00:00Z");
  assert.equal(parseSearchWhen("Monday, January 4 at 9:00 AM", jan2)?.iso, "2027-01-04T09:00:00");
  assert.equal(parseSearchWhen("Saturday, January 2 at 9:00 AM", jan2)?.iso, "2027-01-02T09:00:00");
  assert.equal(parseSearchWhen("Thursday, September 30 at 9:00 AM", jan2)?.iso, "2027-09-30T09:00:00");
  assert.equal(parseSearchWhen("Thursday, October 21 at 9:00 AM", jan2)?.iso, "2027-10-21T09:00:00");
  // Yesterday's event (a late listing) keeps yesterday's year, as its weekday confirms.
  assert.equal(parseSearchWhen("Friday, January 1", jan2)?.iso, "2027-01-01T00:00:00");
  assert.equal(parseSearchWhen("Thursday, December 31 at 7:00 PM", jan2)?.iso, "2026-12-31T19:00:00");
});

test("parseSearchWhen: the weekday corrects a year the rule got wrong; nonsense is null", () => {
  // Wednesday, October 7 is 2026 (a week before the run), so the weekday wins over "next October".
  assert.equal(parseSearchWhen("Wednesday, October 7 at 9:00 AM", OCT_13)?.iso, "2026-10-07T09:00:00");
  assert.equal(parseSearchWhen("Gainesville, FL", OCT_13), null);
  assert.equal(parseSearchWhen("", OCT_13), null);
});

test("parseEventPageWhen: a timed event with its end, zone, and offset", () => {
  assert.deepEqual(parseEventPageWhen("Wednesday, October 28, 2026 at 6:30 PM until 7:30 PM Eastern Daylight Time UTC -04:00"), {
    start: "2026-10-28T18:30:00",
    end: "2026-10-28T19:30:00",
    zone: "America/New_York",
    offset: "-04:00",
    allDay: false,
  });
  const ut = parseEventPageWhen("Monday, November 2, 2026 at 8:00 AM until 5:00 PM Central Standard Time UTC -06:00");
  assert.equal(ut?.zone, "America/Chicago");
  assert.equal(ut?.end, "2026-11-02T17:00:00");
});

test("parseEventPageWhen: all day, multi-day, an unknown zone keeps the offset, Arizona", () => {
  assert.deepEqual(parseEventPageWhen("Wednesday, October 14, 2026"), { start: "2026-10-14T00:00:00", end: null, zone: null, offset: null, allDay: true });
  const twoDays = parseEventPageWhen("Friday, March 5, 2027 at 6:00 PM until Saturday, March 6, 2027 at 1:00 PM Pacific Standard Time UTC -08:00");
  assert.equal(twoDays?.end, "2027-03-06T13:00:00");
  assert.equal(twoDays?.zone, "America/Los_Angeles");
  const odd = parseEventPageWhen("Monday, October 19, 2026 at 9:00 AM until 10:00 AM Greenwich Mean Time UTC +00:00");
  assert.equal(odd?.zone, null);
  assert.equal(odd?.offset, "+00:00");
  assert.equal(parseEventPageWhen("Monday, October 19, 2026 at 9:00 AM Mountain Standard Time UTC -07:00")?.zone, "America/Phoenix");
  assert.equal(parseEventPageWhen("Monday, December 14, 2026 at 9:00 AM Mountain Standard Time UTC -07:00")?.zone, "America/Denver");
  assert.equal(parseEventPageWhen("Registration"), null);
});

test("zoneFor: the six US zone families, standard and daylight; unknown is null", () => {
  const cases: [string, string][] = [
    ["Eastern Daylight Time", "America/New_York"],
    ["Eastern Standard Time", "America/New_York"],
    ["Central Daylight Time", "America/Chicago"],
    ["Central Standard Time", "America/Chicago"],
    ["Mountain Daylight Time", "America/Denver"],
    ["Mountain Standard Time", "America/Denver"],
    ["Pacific Daylight Time", "America/Los_Angeles"],
    ["Pacific Standard Time", "America/Los_Angeles"],
    ["Alaska Daylight Time", "America/Anchorage"],
    ["Alaskan Standard Time", "America/Anchorage"],
    ["Hawaii-Aleutian Standard Time", "Pacific/Honolulu"],
    ["Hawaiian Standard Time", "Pacific/Honolulu"],
  ];
  for (const [name, zone] of cases) assert.equal(zoneFor(name), zone, name);
  assert.equal(zoneFor("Greenwich Mean Time"), null);
  assert.equal(zoneFor(""), null);
  assert.equal(zoneFor(null), null);
});

test("toInstant: by offset as printed, and by zone across daylight saving", () => {
  assert.equal(toInstant("2026-10-28T18:30:00", "-04:00"), "2026-10-28T22:30:00.000Z");
  assert.equal(toInstant("2026-10-28T18:30:00", "America/New_York"), "2026-10-28T22:30:00.000Z");
  // After the change on 1 November 2026, New York is UTC-5.
  assert.equal(toInstant("2026-11-12T18:30:00", "America/New_York"), "2026-11-12T23:30:00.000Z");
  assert.equal(toInstant("2026-10-21T09:00:00", "America/Chicago"), "2026-10-21T14:00:00.000Z");
  assert.equal(toInstant("2026-10-21T09:00:00", "America/Phoenix"), "2026-10-21T16:00:00.000Z");
  assert.equal(localIsoIn("2026-11-12T23:30:00.000Z", "America/New_York"), "2026-11-12T18:30:00");
  assert.throws(() => toInstant("October 21", "America/New_York"));
});

test("zoneForState: a guess for unread rows, Eastern by default", () => {
  assert.equal(zoneForState("TX"), "America/Chicago");
  assert.equal(zoneForState("CA"), "America/Los_Angeles");
  assert.equal(zoneForState("FL"), "America/New_York");
  assert.equal(zoneForState(null), "America/New_York");
});

test("formatEventWhen: the event's zone, 12-hour time, all day", () => {
  assert.equal(formatEventWhen({ starts_at: "2026-10-19T15:40:00Z", timezone: "America/New_York", all_day: false }), "Mon 19 Oct · 11:40 am");
  assert.equal(formatEventWhen({ starts_at: "2026-10-19T15:40:00Z", timezone: "America/Chicago", all_day: false }), "Mon 19 Oct · 10:40 am");
  assert.equal(formatEventWhen({ starts_at: "2026-10-28T22:30:00Z", timezone: "America/New_York", all_day: false }), "Wed 28 Oct · 6:30 pm");
  assert.equal(formatEventWhen({ starts_at: "2026-10-21T16:00:00Z", timezone: "America/New_York", all_day: false }), "Wed 21 Oct · 12:00 pm");
  assert.equal(formatEventWhen({ starts_at: "2026-10-14T04:00:00Z", timezone: "America/New_York", all_day: true }), "Wed 14 Oct · all day");
  // No zone yet: the state's usual zone.
  assert.equal(formatEventWhen({ starts_at: "2026-10-21T14:00:00Z", timezone: null, all_day: false, state: "TX" }), "Wed 21 Oct · 9:00 am");
});
