// Finds the latest headline about each listed company, so the Stocks tab can
// show it under the price. This only pairs a public headline
// with a public price move — it never claims one caused the other.

const { fetchRelatedNews } = require("./fetchStockDetail");
const stockSymbols = require("./stockSymbols");
const { isStockChatter } = require("./stockChatter");

const HEADLINE_TTL_MS = 30 * 60 * 1000;
const MISS_TTL_MS = 5 * 60 * 1000; // retry sooner after a failed lookup
const MAX_HEADLINE_AGE_DAYS = 10; // older than this isn't "latest news": show none rather than a stale one
const DAY_MS = 24 * 60 * 60 * 1000;

function isWithinMaxAge(headline) {
  return Boolean(headline && headline.publishedAt && Date.now() - new Date(headline.publishedAt).getTime() <= MAX_HEADLINE_AGE_DAYS * DAY_MS);
}

const CANDIDATES_PER_STOCK = 10; // look through several, since many hits are stock-blog pieces

const cache = new Map(); // stock id -> { headline | null, ts, ttl }

async function lookupHeadline(entry) {
  const cached = cache.get(entry.id);
  // A cached headline keeps ageing, so re-check the limit on every read.
  if (cached && Date.now() - cached.ts < cached.ttl) return isWithinMaxAge(cached.headline) ? cached.headline : null;

  let headline = null;
  let ttl = HEADLINE_TTL_MS;
  try {
    const items = await fetchRelatedNews(entry.searchTerm || entry.name, entry.matchKeywords, CANDIDATES_PER_STOCK, entry.excludePatterns, entry.exactCaseKeywords);
    const newest = items.find((n) => !isStockChatter(n.title)); // items are newest-first
    if (isWithinMaxAge(newest)) headline = newest;
  } catch (err) {
    console.warn(`[stocks] headline lookup failed for ${entry.name}: ${err.message}`);
    ttl = MISS_TTL_MS;
  }
  cache.set(entry.id, { headline, ts: Date.now(), ttl });
  return headline;
}

// Returns { [stockId]: { title, publisher, link, publishedAt } } for every stock
// that has a recent matching headline.
async function getStockHeadlines(quotes) {
  const entries = quotes.filter((q) => !q.error).map((q) => stockSymbols.find((s) => s.id === q.id)).filter(Boolean);
  const found = await Promise.all(entries.map(async (entry) => [entry.id, await lookupHeadline(entry)]));
  return Object.fromEntries(found.filter(([, headline]) => headline));
}

module.exports = { getStockHeadlines };
