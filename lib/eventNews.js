// Finds the latest news story about each curated City Event (IITF, Aero India…),
// using the same Google News search as the Stocks tab. Served separately from
// /api/events so slow lookups never delay the event list.

const { fetchRelatedNews } = require("./fetchStockDetail");
const { matchesCompany } = require("./companyMatch");
const { CURATED_PATH, readJson } = require("./cityEvents");
const { todayIst } = require("./dates");
const cities = require("./cities");

const NEWS_TTL_MS = 3 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000; // retry sooner after a failed lookup
const MAX_AGE_DAYS = 30; // older than this isn't news about the upcoming edition
const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATES = 15; // look through several, since newsAlso/newsExclude weed some out

const cache = new Map(); // event id -> { story | null, ts, ttl }

const isRecent = (story) =>
  Boolean(story && story.publishedAt && Date.now() - new Date(story.publishedAt).getTime() <= MAX_AGE_DAYS * DAY_MS);

// Other names a city goes by in headlines.
const CITY_NAMES = {
  delhi: ["Delhi", "Noida", "Gurugram", "Gurgaon"],
  bengaluru: ["Bengaluru", "Bangalore"],
  kochi: ["Kochi", "Cochin"],
  chennai: ["Chennai", "Chepauk"],
  ahmedabad: ["Ahmedabad", "Gandhinagar", "Motera"],
};
const NOT_NEWS = /^(licensable|stock) (picture|photo|image)|^(photos?|pictures?|pics|gallery|in pics|in pictures|watch|video)\s*:/i;

// Whether a headline that names the event is really about this edition of it.
// A headline naming the series is not enough: "India vs West Indies" matches
// every match of the tour, and "IMTEX" matches last year's show.
function storyFitsEvent(event, title) {
  if (NOT_NEWS.test(title)) return false;
  if (event.newsAlso && !matchesCompany(title, event.newsAlso)) return false;
  if ((event.newsExclude || []).some((re) => new RegExp(re, "i").test(title))) return false;

  // A year in the headline must be one the event runs in.
  const eventYears = new Set([event.start.slice(0, 4), event.end.slice(0, 4)]);
  const years = title.match(/\b20\d\d\b/g) || [];
  if (years.length && !years.some((y) => eventYears.has(y))) return false;

  // Sports fixtures move from city to city, so the headline must name this one.
  if (event.category === "sports") {
    const names = event.cities.flatMap((id) => CITY_NAMES[id] || [(cities.find((c) => c.id === id) || {}).name]).filter(Boolean);
    if (!matchesCompany(title, names)) return false;
  }
  return true;
}

async function lookup(event) {
  const cached = cache.get(event.id);
  if (cached && Date.now() - cached.ts < cached.ttl) return isRecent(cached.story) ? cached.story : null;

  let story = null;
  let ttl = NEWS_TTL_MS;
  try {
    // The first keyword is the search; a headline must contain one of them to count,
    // plus one of `newsAlso` if given, and none of the `newsExclude` patterns.
    const items = await fetchRelatedNews(`"${event.newsKeywords[0]}"`, event.newsKeywords, CANDIDATES);
    const newest = items.find((n) => storyFitsEvent(event, n.title)); // items are newest-first
    if (isRecent(newest)) story = newest;
  } catch (err) {
    console.warn(`[events] news lookup failed for ${event.name}: ${err.message}`);
    ttl = MISS_TTL_MS;
  }
  cache.set(event.id, { story, ts: Date.now(), ttl });
  return story;
}

// Returns { [eventId]: { title, publisher, link, publishedAt } } for upcoming
// or ongoing curated events that have a recent matching story.
async function getEventNews() {
  const today = todayIst();
  const events = readJson(CURATED_PATH).events.filter((e) => e.end >= today && e.newsKeywords);
  const found = await Promise.all(events.map(async (e) => [e.id, await lookup(e)]));
  return Object.fromEntries(found.filter(([, story]) => story));
}

module.exports = { getEventNews, storyFitsEvent };
