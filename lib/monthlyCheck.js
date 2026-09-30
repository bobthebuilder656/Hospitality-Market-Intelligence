// Monthly check for the City Events and Resources tabs. It never changes what the
// page shows: everything it finds goes into data/event-review.json, and nothing is
// added to the data files until it has been checked against a source.
//
// City Events:
//   1. brokenLinks  - curated events whose source link or picture no longer loads
//   2. waiting      - news that might announce dates for events in events-watchlist.json
//   3. newEvents    - news in each city about expos, summits, festivals and concerts
//                     that aren't on the page yet
//   4. warnings     - cities with nothing coming up, or wedding dates running out
// Resources tab:
//   5. resourceLinks  - report, article and case-study links that no longer load
//   6. marketReleases - news of new DGCA air traffic, tourist arrival or hotel GST
//                       figures, so the market pulse and GST calculator can be updated
//
// Run by hand with `npm run check-events`; the server also runs it once a month.

const fs = require("fs");
const path = require("path");
const cities = require("./cities");
const { fetchRelatedNews } = require("./fetchStockDetail");
const { getCityEvents, CURATED_PATH, readJson } = require("./cityEvents");
const { addDays, todayIst } = require("./dates");

const { DATA_DIR, CONTENT_DIR } = require("./paths");
const WATCHLIST_PATH = path.join(DATA_DIR, "events-watchlist.json");
const REVIEW_PATH = path.join(DATA_DIR, "event-review.json");

const RESOURCE_FILES = ["resources-library.json", "market-indicators.json", "dashboard-indicators.json", "briefs.json", "case-studies.json"];
// Searches for the releases behind the market pulse and the GST calculator.
const MARKET_SEARCHES = [
  { id: "domestic-air", name: "Domestic air passengers (DGCA)", search: "DGCA domestic air passenger traffic", keywords: ["air passenger", "air traffic"] },
  { id: "foreign-arrivals", name: "Foreign tourist arrivals", search: "India foreign tourist arrivals Ministry of Tourism", keywords: ["foreign tourist arrivals", "FTAs"] },
  { id: "india-hotels", name: "India hotel performance", search: "India hotel occupancy ADR RevPAR report", keywords: ["occupancy", "RevPAR"] },
  { id: "gst-rooms", name: "GST on hotel rooms", search: "GST hotel room tariff rate change", keywords: ["GST"] },
];

const RUN_EVERY_DAYS = 30;
const NEWS_MAX_AGE_DAYS = 45;
const COVERAGE_DAYS = 60; // warn when a city has no events this far ahead
const WEDDING_WARN_DAYS = 90; // warn when the wedding dates list ends within this
const MAX_NEW_PER_CITY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// Other names a city goes by in headlines.
const CITY_ALIASES = {
  delhi: ["Delhi", "New Delhi", "Noida", "Greater Noida", "Gurugram", "Gurgaon"],
  bengaluru: ["Bengaluru", "Bangalore"],
  kochi: ["Kochi", "Cochin"],
  chennai: ["Chennai", "Madras"],
  ahmedabad: ["Ahmedabad", "Gandhinagar"],
};
const EVENT_WORDS = /\b(expo|exhibition|trade fair|fair|summit|conclave|conference|festival|fest|concert|tour|marathon|mahotsav|carnival|biennale|show)\b/i;
const DATE_HINT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(2026|2027)\b|\bdates?\b|\bschedule\b|\bto be held\b/i;

const isRecent = (item) => item.publishedAt && Date.now() - new Date(item.publishedAt).getTime() <= NEWS_MAX_AGE_DAYS * DAY_MS;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text, words) => words.some((w) => new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(text));
const story = ({ title, publisher, link, publishedAt }) => ({ title, publisher, link, publishedAt });

async function checkUrl(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) });
    await res.arrayBuffer();
    return res.status;
  } catch (err) {
    return err.name === "TimeoutError" ? "timeout" : "unreachable";
  }
}

async function findBrokenLinks(events) {
  const broken = [];
  for (const e of events) {
    for (const [kind, url] of [["source", e.source], ["image", e.image]]) {
      if (!url) continue;
      const status = await checkUrl(url);
      if (typeof status === "number" && status < 400) continue;
      // 401/403 usually means the site blocks automated checks, not that the page is gone.
      const note = status === 401 || status === 403 ? "site blocks automatic checks; open it by hand" : "link looks broken";
      broken.push({ event: e.id, name: e.name, kind, url, status, note });
    }
  }
  return broken;
}

async function checkWatchlist(watchlist) {
  const results = [];
  for (const w of watchlist) {
    let found = [];
    try {
      const items = await fetchRelatedNews(w.search, w.keywords, 10);
      found = items.filter((n) => isRecent(n) && DATE_HINT.test(n.title)).slice(0, 3).map(story);
    } catch (err) {
      console.warn(`[check] watchlist search failed for ${w.name}: ${err.message}`);
    }
    if (found.length) results.push({ id: w.id, name: w.name, cities: w.cities, news: found });
  }
  return results;
}

async function findNewEvents(knownKeywords) {
  const results = [];
  for (const city of cities) {
    const names = CITY_ALIASES[city.id] || [city.name];
    const queries = [
      `"${city.name}" (expo OR exhibition OR summit OR "trade fair")`,
      `"${city.name}" (festival OR concert OR marathon) dates`,
    ];
    const seen = new Set();
    const found = [];
    for (const q of queries) {
      try {
        for (const n of await fetchRelatedNews(q, null, 40)) {
          if (seen.has(n.link) || !isRecent(n)) continue;
          seen.add(n.link);
          if (!mentions(n.title, names) || !EVENT_WORDS.test(n.title) || !DATE_HINT.test(n.title)) continue;
          if (mentions(n.title, knownKeywords)) continue; // already on the page or on the watchlist
          found.push(story(n));
        }
      } catch (err) {
        console.warn(`[check] news search failed for ${city.name}: ${err.message}`);
      }
    }
    if (found.length) results.push({ city: city.id, name: city.name, news: found.slice(0, MAX_NEW_PER_CITY) });
  }
  return results;
}

// Every link in the Resources tab's data files.
function resourceUrls() {
  const urls = new Map();
  const walk = (node, where) => {
    if (Array.isArray(node)) node.forEach((n) => walk(n, where));
    else if (node && typeof node === "object") {
      if (typeof node.url === "string") urls.set(node.url, node.name || where);
      Object.values(node).forEach((v) => walk(v, where));
    }
  };
  for (const file of RESOURCE_FILES) {
    // Articles and case studies are in the private content folder; the rest is in data/.
    const p = [path.join(CONTENT_DIR, file), path.join(DATA_DIR, file)].find((f) => fs.existsSync(f));
    if (p) walk(readJson(p), file);
  }
  return [...urls].map(([url, name]) => ({ url, name }));
}

async function findBrokenResourceLinks() {
  const broken = [];
  for (const { url, name } of resourceUrls()) {
    const status = await checkUrl(url);
    if (typeof status === "number" && status < 400) continue;
    const note = status === 401 || status === 403 ? "site blocks automatic checks; open it by hand" : "link looks broken";
    broken.push({ name, url, status, note });
  }
  return broken;
}

async function checkMarketReleases() {
  const results = [];
  for (const m of MARKET_SEARCHES) {
    try {
      const items = await fetchRelatedNews(m.search, m.keywords, 10);
      const found = items.filter(isRecent).slice(0, 3).map(story);
      if (found.length) results.push({ id: m.id, name: m.name, news: found });
    } catch (err) {
      console.warn(`[check] market search failed for ${m.name}: ${err.message}`);
    }
  }
  return results;
}

function coverageWarnings(data) {
  const warnings = [];
  const until = addDays(data.today, COVERAGE_DAYS);
  for (const city of cities) {
    // Plain national holidays don't count as "something happening" in a city.
    const upcoming = data.events.filter(
      (e) => e.cities.includes(city.id) && e.category !== "holiday" && e.start <= until && e.end >= data.today
    );
    const specific = upcoming.filter((e) => e.cities.length < cities.length);
    if (!specific.length) {
      warnings.push(`${city.name}: no city-specific events in the next ${COVERAGE_DAYS} days.`);
    }
  }
  // Airport data months that failed their checks wait here for a person to look at.
  const airPath = path.join(DATA_DIR, "air-traffic.json");
  if (fs.existsSync(airPath)) {
    for (const held of readJson(airPath).held || []) {
      warnings.push(`Airport data for ${held.month} is held back: ${held.problems.join("; ")}`);
    }
  }
  const { dates } = readJson(path.join(DATA_DIR, "wedding-dates.json"));
  const lastWedding = dates[dates.length - 1];
  if (!lastWedding || lastWedding <= addDays(data.today, WEDDING_WARN_DAYS)) {
    warnings.push(`Wedding dates run out on ${lastWedding || "(none listed)"}: add the next season's dates.`);
  }
  return warnings;
}

async function runMonthlyCheck() {
  console.log("[check] monthly City Events check started");
  const curated = readJson(CURATED_PATH).events;
  const watchlist = readJson(WATCHLIST_PATH).events;
  const today = todayIst();

  const knownKeywords = [
    ...curated.flatMap((e) => e.newsKeywords || []),
    ...watchlist.flatMap((w) => w.keywords),
  ];

  const review = {
    checkedAt: new Date().toISOString(),
    howToUse: "Ask Claude to 'review the new events'. Each candidate is checked against an official source before it's added to events-curated.json.",
    brokenLinks: await findBrokenLinks(curated.filter((e) => e.end >= today)),
    waiting: await checkWatchlist(watchlist),
    newEvents: await findNewEvents(knownKeywords),
    warnings: coverageWarnings(await getCityEvents()),
    resourceLinks: await findBrokenResourceLinks(),
    marketReleases: await checkMarketReleases(),
  };
  fs.writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n");
  console.log(
    `[check] done: ${review.brokenLinks.length} link issues, ${review.waiting.length} waiting events with news, ` +
      `${review.newEvents.reduce((n, c) => n + c.news.length, 0)} possible new events, ${review.warnings.length} warnings, ` +
        `${review.resourceLinks.length} resource link issues, ${review.marketReleases.length} market topics with news`
  );
  return review;
}

// Runs the check if it has never run or the last run is over a month old.
async function runMonthlyCheckIfDue() {
  try {
    const last = fs.existsSync(REVIEW_PATH) ? readJson(REVIEW_PATH).checkedAt : null;
    if (last && Date.now() - new Date(last).getTime() < RUN_EVERY_DAYS * DAY_MS) return null;
    return await runMonthlyCheck();
  } catch (err) {
    console.error("[check] monthly check failed:", err.message);
    return null;
  }
}

module.exports = { runMonthlyCheck, runMonthlyCheckIfDue };

if (require.main === module) runMonthlyCheck();
