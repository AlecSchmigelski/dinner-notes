import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvents, findDinners, restaurantName } from "../src/calendar.js";

const ics = (events) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-TIMEZONE:America/New_York", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (lines) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const FIXTURE = ics([
  ev(["UID:resy-1", "SUMMARY:Reservation at Lilia", "DTSTART;TZID=America/New_York:20261009T193000", "DTEND;TZID=America/New_York:20261009T213000", "DESCRIPTION:Booked on Resy. resy.com/cities/ny/lilia"]),
  ev(["UID:ot-1", "SUMMARY:Carbone for 2", "DTSTART:20261008T000000Z", "DURATION:PT2H", "LOCATION:Carbone\\, 181 Thompson St", "URL:https://www.opentable.com/r/carbone"]),
  ev(["UID:manual-1", "SUMMARY:Dinner @ Via Carota w/ Sam", "DTSTART:20261006T200000", "DTEND:20261006T220000"]),
  ev(["UID:manual-2", "SUMMARY:Dinner", "LOCATION:Don Angie\\n103 Greenwich Ave", "DTSTART;TZID=America/New_York:20261003T190000", "DTEND;TZID=America/New_York:20261003T210000"]),
  ev(["UID:tock-1", "SUMMARY:Atomix - Tock", "DTSTART;TZID=America/New_York:20261001T180000", "DTEND;TZID=America/New_York:20261001T200000", "URL:https://www.exploretock.com/atomix"]),
  // Each of these must be ignored.
  ev(["UID:nameless", "SUMMARY:Dinner", "LOCATION:123 Main St", "DTSTART:20261002T230000Z", "DTEND:20261003T010000Z"]),
  ev(["UID:cancelled", "SUMMARY:Reservation at Rezdôra", "STATUS:CANCELLED", "DTSTART:20261002T230000Z", "DTEND:20261003T010000Z"]),
  ev(["UID:allday", "SUMMARY:Dinner party at Mom's", "DTSTART;VALUE=DATE:20261004", "DTEND;VALUE=DATE:20261005"]),
  ev(["UID:stock", "SUMMARY:Stock review at office", "DTSTART:20261002T140000Z", "DTEND:20261002T150000Z"]),
  ev(["UID:class", "SUMMARY:Elementary Spanish I", "DTSTART;TZID=America/New_York:20261002T130000", "DTEND;TZID=America/New_York:20261002T135000"]),
  // A folded line and a nested alarm.
  ev(["UID:folded", "SUMMARY:Reservation at Le Bernar", " din", "DTSTART:20260930T230000Z", "DTEND:20261001T010000Z", "BEGIN:VALARM", "TRIGGER:-PT1H", "DESCRIPTION:Reminder", "END:VALARM"]),
]);

test("finds reservations and names the restaurant", () => {
  const dinners = findDinners(parseEvents(FIXTURE));
  assert.deepEqual(
    dinners.map((d) => d.restaurant),
    ["Lilia", "Carbone", "Via Carota", "Don Angie", "Atomix", "Le Bernardin"],
  );
});

test("converts zoned, UTC and floating times to UTC", () => {
  const byName = Object.fromEntries(findDinners(parseEvents(FIXTURE)).map((d) => [d.restaurant, d]));
  assert.equal(byName.Lilia.datetime, "2026-10-09T23:30:00.000Z"); // 7:30 PM EDT
  assert.equal(byName.Lilia.end, "2026-10-10T01:30:00.000Z");
  assert.equal(byName.Carbone.end, "2026-10-08T02:00:00.000Z"); // DURATION
  assert.equal(byName["Via Carota"].datetime, "2026-10-07T00:00:00.000Z"); // floating → calendar zone
});

test("handles winter time", () => {
  const [e] = parseEvents(ics([ev(["UID:w", "SUMMARY:Dinner at Lilia", "DTSTART;TZID=America/New_York:20261215T190000", "DTEND;TZID=America/New_York:20261215T210000"])]));
  assert.equal(new Date(e.start).toISOString(), "2026-12-16T00:00:00.000Z"); // 7 PM EST
});

test("falls back when TZID is not an IANA name", () => {
  const [e] = parseEvents(ics([ev(["UID:o", "SUMMARY:Dinner at Lilia", "DTSTART;TZID=Eastern Standard Time:20261009T193000"])]));
  assert.equal(new Date(e.start).toISOString(), "2026-10-09T23:30:00.000Z");
});

test("name cleanup", () => {
  const name = (summary, location = "") => restaurantName({ summary, location });
  assert.equal(name("Lilia (Resy)"), "Lilia");
  assert.equal(name("OpenTable: Carbone for 2"), "Carbone");
  assert.equal(name("Dinner - Misi"), "Misi");
  assert.equal(name("Your Resy reservation at Lilia, party of 4"), "Lilia");
  assert.equal(name("Dinner at 4 Charles Prime Rib 8:30pm"), "4 Charles Prime Rib");
  assert.equal(name("Dinner with Sam", "Lilia, 567 Union Ave"), "Lilia");
});
