const fs = require("fs");
const path = require("path");
const cities = require("./cities");
const festivalRules = require("./festivalRules");
const { getHolidays } = require("./fetchHolidays");
const { findLongWeekends } = require("./longWeekends");
const { addDays, todayIst } = require("./dates");

const CURATED_PATH = path.join(__dirname, "..", "data", "events-curated.json");
const WEDDINGS_PATH = path.join(__dirname, "..", "data", "wedding-dates.json");
const HORIZON_DAYS = 180;

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

function holidayEvents(holidays) {
  const rules = new Map(festivalRules.map((r) => [r.match, r]));
  const events = [];
  for (const h of holidays) {
    const rule = rules.get(h.name);
    if (!rule && !h.public) continue;
    const [before, after] = (rule && rule.span) || [0, 0];
    events.push({
      id: `hol-${h.date}-${h.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: rule ? rule.name : h.name,
      category: rule ? rule.category : "holiday",
      icon: rule ? rule.icon : undefined,
      start: addDays(h.date, before),
      end: addDays(h.date, after),
      holidayDate: h.date,
      cities: rule ? rule.cities : festivalRules.ALL_CITIES,
      // India has only three national holidays; the rest of the gazetted list is
      // observed state by state, so the wording must not promise that offices shut everywhere.
      note: rule ? rule.note : "Gazetted public holiday. Observance varies by state, so check your state's holiday list.",
      tentative: h.tentative,
      source: "https://calendar.google.com/calendar/embed?src=en.indian%23holiday%40group.v.calendar.google.com",
      sourceName: "Google Calendar: Holidays in India",
    });
  }
  return events;
}

// Tags each holiday that creates a long weekend. With a bridge day, the
// weekend is the break you get by taking that one working day off.
function tagLongWeekends(events, holidays, from, to) {
  for (const w of findLongWeekends(holidays, from, to)) {
    const event = events.find((e) => w.holidayDates.includes(e.holidayDate));
    if (!event) continue;
    const natural = w.length >= 3;
    event.longWeekend = natural
      ? { start: w.start, end: w.end, length: w.length, bridgeDay: null }
      : { start: w.bridge.start, end: w.bridge.end, length: w.bridge.length, bridgeDay: w.bridge.day };
  }
  return events;
}

function curatedEvents() {
  return readJson(CURATED_PATH).events.map(({ newsKeywords, ...e }) => ({
    ...e,
    sourceName: new URL(e.source).hostname.replace(/^www\./, ""),
  }));
}

async function getCityEvents({ now = new Date(), forceRefresh = false } = {}) {
  const today = todayIst(now);
  const horizonEnd = addDays(today, HORIZON_DAYS);
  const { holidays, fetchedAt } = await getHolidays({ forceRefresh });
  const weddings = readJson(WEDDINGS_PATH);

  const events = [...tagLongWeekends(holidayEvents(holidays), holidays, today, horizonEnd), ...curatedEvents()]
    .filter((e) => e.end >= today && e.start <= horizonEnd)
    .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));

  return {
    today,
    horizonEnd,
    holidaysFetchedAt: fetchedAt,
    cities,
    events,
    weddingDates: weddings.dates.filter((d) => d >= today && d <= horizonEnd),
    weddingSources: weddings.sources,
  };
}

module.exports = { getCityEvents, CURATED_PATH, readJson };
