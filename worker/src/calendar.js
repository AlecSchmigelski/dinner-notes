// Reads a published iCloud (or any .ics) calendar and picks out restaurant
// reservations. No dependencies: the subset of iCalendar that calendar apps
// actually publish is small enough to parse by hand.

const PLATFORMS = /\b(resy|opentable|exploretock|sevenrooms)\b|tock\.com/i;
const KEYWORDS = /\b(dinner|reservation)\b/i;

export async function fetchCalendar(url) {
  const res = await fetch(url.replace(/^webcal:/i, "https:"), { headers: { accept: "text/calendar" } });
  if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`);
  return res.text();
}

// ---------- parsing ----------

function unescapeText(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

// Lines longer than 75 octets are folded onto continuation lines that start
// with a space or tab.
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(";");
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

// Offset of `timeZone` from UTC at a given instant, in ms.
function tzOffset(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ms;
}

function zonedToUtc(fields, timeZone) {
  const guess = Date.UTC(...fields);
  let utc = guess - tzOffset(guess, timeZone);
  utc = guess - tzOffset(utc, timeZone); // second pass settles DST edges
  return utc;
}

// Returns { ms, allDay } or null.
function parseDate(prop, defaultTz) {
  const v = prop.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date || prop.params.VALUE === "DATE") {
    const [, y, m, d] = date || /^(\d{4})(\d{2})(\d{2})/.exec(v) || [];
    return y ? { ms: Date.UTC(+y, +m - 1, +d), allDay: true } : null;
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  const fields = [+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +dt[6]];
  if (dt[7] === "Z") return { ms: Date.UTC(...fields), allDay: false };
  for (const tz of [prop.params.TZID, defaultTz]) {
    if (!tz) continue;
    try {
      return { ms: zonedToUtc(fields, tz), allDay: false };
    } catch {
      // Not an IANA name (Outlook writes "Eastern Standard Time"); try the next.
    }
  }
  return { ms: Date.UTC(...fields), allDay: false };
}

function parseDuration(v) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, w = 0, d = 0, h = 0, min = 0, s = 0] = m.map((x) => Number(x || 0));
  return ((((+w * 7 + +d) * 24 + +h) * 60 + +min) * 60 + +s) * 1000;
}

export function parseEvents(text, defaultTz = "America/New_York") {
  const lines = unfold(text);
  const calTz = lines.find((l) => l.startsWith("X-WR-TIMEZONE:"))?.slice(14).trim() || defaultTz;
  const events = [];
  let cur = null;
  let depth = 0; // skip VALARM and other nested blocks inside VEVENT
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { props: {} };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; }
    if (line.startsWith("END:") && depth > 0) { depth--; continue; }
    if (line === "END:VEVENT") {
      const p = cur.props;
      const start = p.DTSTART && parseDate(p.DTSTART, calTz);
      if (start) {
        let end = p.DTEND && parseDate(p.DTEND, calTz);
        if (!end && p.DURATION) {
          const dur = parseDuration(p.DURATION.value);
          if (dur != null) end = { ms: start.ms + dur, allDay: start.allDay };
        }
        events.push({
          uid: p.UID?.value || "",
          summary: unescapeText(p.SUMMARY?.value || "").trim(),
          location: unescapeText(p.LOCATION?.value || "").trim(),
          description: unescapeText(p.DESCRIPTION?.value || "").trim(),
          url: (p.URL?.value || "").trim(),
          status: (p.STATUS?.value || "").trim().toUpperCase(),
          recurring: Boolean(p.RRULE),
          allDay: start.allDay,
          start: start.ms,
          end: end ? end.ms : start.ms + 2 * 3600e3,
        });
      }
      cur = null;
      continue;
    }
    if (depth > 0) continue;
    const prop = parseLine(line);
    if (prop && !(prop.name in cur.props)) cur.props[prop.name] = prop;
  }
  return events;
}

// ---------- detection ----------

function cleanName(s) {
  return s
    .replace(/\s*[-–—|:]\s*(resy|opentable|tock|sevenrooms)\b.*$/i, "")
    .replace(/\s*\((resy|opentable|tock|sevenrooms)[^)]*\)/i, "")
    .replace(/\s+(via|on|through)\s+(resy|opentable|tock|sevenrooms)\b.*$/i, "")
    .replace(/\s+(with|w\/)\s+.*$/i, "")
    .replace(/,?\s+(for|party of|table for)\s+\d+\b.*$/i, "")
    .replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm)\b.*$/i, "")
    .replace(/^["'“]|["'”]$/g, "")
    .trim();
}

// "Reservation at Lilia", "Dinner @ Lilia w/ Sam", "Lilia (Resy)",
// "Dinner - Lilia", "OpenTable: Carbone for 2". Returns "" when unsure.
export function restaurantName(event) {
  const s = event.summary;
  const at = /(?:\bat|@)\s+(.+)$/i.exec(s);
  if (at) return cleanName(at[1]);
  const after = /^(?:dinner|reservation|resy|opentable|tock|sevenrooms)\b\s*(?:reservation)?\s*[-–—:|]\s*(.+)$/i.exec(s);
  if (after) return cleanName(after[1]);
  const named = cleanName(s.replace(/^(?:your\s+)?(?:resy|opentable|tock|sevenrooms)\s+(?:reservation)?\s*/i, ""));
  if (named && !KEYWORDS.test(named) && !/^dinner\b/i.test(named)) return named;
  // "Dinner" with the restaurant only in the location: use the venue line,
  // unless it is just a street address.
  const venue = event.location.split(/\n|,/)[0].trim();
  if (venue && !/^\d/.test(venue)) return cleanName(venue);
  return "";
}

export function isReservation(event) {
  if (event.allDay || event.status === "CANCELLED") return false;
  const hay = [event.summary, event.location, event.description, event.url].join(" ");
  return PLATFORMS.test(hay) || KEYWORDS.test(event.summary);
}

// The dinners worth asking about: reservations with a nameable restaurant.
export function findDinners(events) {
  const out = [];
  for (const e of events) {
    if (!isReservation(e)) continue;
    const restaurant = restaurantName(e);
    if (!restaurant) continue;
    out.push({
      id: `cal-${e.uid || e.summary}-${e.start}`.replace(/[^\w.-]+/g, "_").slice(0, 120),
      restaurant,
      neighborhood: "",
      datetime: new Date(e.start).toISOString(),
      end: new Date(e.end).toISOString(),
    });
  }
  return out;
}
