const fs = require("fs");
const path = require("path");

// Google's public "Holidays in India" calendar. Free, no key. Each entry's
// DESCRIPTION starts with "Public holiday" (gazetted, offices shut) or
// "Observance" (festival, usually a working day), and tentative lunar dates
// (Eid, Muharram…) carry "Date is tentative and may change."
const ICS_URL =
  "https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics";
const CACHE_PATH = path.join(__dirname, "..", "data", "holidays.json");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // holiday dates rarely change

// Minimal ICS reader: unfold continuation lines, then read the few fields we need.
function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  return unfolded
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => {
      const field = (key) => {
        const m = block.match(new RegExp(`^${key}[^:\\n]*:(.*)$`, "m"));
        return m ? m[1].trim() : "";
      };
      const ymd = (v) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
      const description = field("DESCRIPTION").replace(/\\n/g, "\n").replace(/\\,/g, ",");
      return {
        date: ymd(field("DTSTART")),
        name: field("SUMMARY").replace(/\\,/g, ","),
        public: description.startsWith("Public holiday"),
        tentative: description.includes("tentative"),
      };
    })
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && h.name)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
}

async function refreshHolidays() {
  const res = await fetch(ICS_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`holiday calendar returned ${res.status}`);
  const holidays = parseIcs(await res.text());
  if (holidays.length === 0) throw new Error("holiday calendar was empty");
  const payload = { fetchedAt: new Date().toISOString(), source: ICS_URL, holidays };
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  console.log(`[holidays] wrote ${holidays.length} holidays to ${CACHE_PATH}`);
  return payload;
}

// Serves the cache while it's fresh; if a refresh fails, falls back to the
// old cache rather than leaving the tab empty.
async function getHolidays({ forceRefresh = false } = {}) {
  const cached = readCache();
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < MAX_AGE_MS;
  if (fresh && !forceRefresh) return cached;
  try {
    return await refreshHolidays();
  } catch (err) {
    console.error("[holidays] refresh failed:", err.message);
    if (cached) return cached;
    throw err;
  }
}

module.exports = { getHolidays, refreshHolidays, parseIcs };
