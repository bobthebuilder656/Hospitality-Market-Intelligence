const Parser = require("rss-parser");
const { matchesCompany } = require("./companyMatch");
const { isStockChatter } = require("./stockChatter");
const { sameStory } = require("./sameStory");
const { addDays } = require("./dates");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HospitalityIntelBot/1.0";
const DETAIL_TTL_MS = 15 * 60 * 1000;
const RELATED_NEWS_LIMIT = 3;
const RELATED_NEWS_CANDIDATES = 15;
const RELATED_NEWS_MAX_AGE_DAYS = 45;
const UPSTREAM_TIMEOUT_MS = 15000; // a hanging price service must not leave the popup loading forever

const newsParser = new Parser({ timeout: 15000, headers: { "User-Agent": USER_AGENT } });
const cache = new Map(); // `${symbol}:${range}` -> { data, ts }

const RANGE_CONFIG = {
  "10d": { yahooRange: "1mo", yahooInterval: "1d", slice: 10 },
  "1m": { yahooRange: "1mo", yahooInterval: "1d", slice: null },
  "3m": { yahooRange: "3mo", yahooInterval: "1d", slice: null },
  "1y": { yahooRange: "1y", yahooInterval: "1wk", slice: null },
};

// Turns Yahoo's chart data into [{ date, close }], dated as the exchange saw it.
// Yahoo stamps each bar with the start of its period. A weekly bar starts on the
// Monday but holds that week's closing price, so it is dated to the Friday (or to
// the last day traded, for the week still in progress). Dating it by its start in
// UTC put Friday's price on the Sunday before.
function historyPoints(result, weekly) {
  const offset = (result.meta && result.meta.gmtoffset) || 0;
  const localDate = (t) => new Date((t + offset) * 1000).toISOString().slice(0, 10);
  const lastTraded = result.meta && result.meta.regularMarketTime ? localDate(result.meta.regularMarketTime) : null;
  const closes = (result.indicators.quote[0] || {}).close || [];

  const byDate = new Map(); // a date can only appear once; the later bar wins
  (result.timestamp || []).forEach((t, i) => {
    if (closes[i] == null) return;
    let date = localDate(t);
    if (weekly) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      date = addDays(date, (5 - dow + 7) % 7);
      if (lastTraded && date > lastTraded) date = lastTraded;
    }
    byDate.set(date, closes[i]);
  });
  return [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchHistory(symbol, rangeKey) {
  const cfg = RANGE_CONFIG[rangeKey] || RANGE_CONFIG["10d"];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${cfg.yahooInterval}&range=${cfg.yahooRange}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  const json = await res.json();
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error("no history data");

  const points = historyPoints(result, cfg.yahooInterval === "1wk");
  return cfg.slice ? points.slice(-cfg.slice) : points;
}

// Yahoo Finance's search API was returning the same 3 generic trending
// articles for every ticker regardless of query — completely unrelated to the
// company. Google News' RSS search is keyword-driven against real coverage,
// but its own relevance ranking still let some clearly unrelated articles
// through (a different company's stock report, an unrelated crime story) for
// smaller/ambiguous names — so we also hard-filter on matchKeywords below.
async function fetchRelatedNews(query, matchKeywords, limit = RELATED_NEWS_LIMIT, excludePatterns = [], exactCaseKeywords = []) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed = await newsParser.parseURL(url);
  const items = (feed.items || [])
    .filter((item) => /^https?:\/\//i.test(item.link || ""))
    .map((item) => {
      // Google News titles are formatted "Headline - Publisher". The publisher is
      // whatever follows the last " - " (it may itself contain a hyphen: "Mid-Day").
      const match = (item.title || "").match(/^(.+) - (.+)$/);
      return {
        title: match ? match[1].trim() : item.title,
        publisher: match ? match[2].trim() : null,
        link: item.link,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      };
    });

  // Whole-word match, so short names like "eih" or "samhi" can't match inside
  // an unrelated longer word.
  const relevant = matchKeywords && matchKeywords.length
    ? items.filter((n) => matchesCompany(n.title, matchKeywords, excludePatterns, exactCaseKeywords))
    : items;

  relevant.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return relevant.slice(0, limit);
}

// From headlines about a company (newest first): drops analyst chatter, anything
// older than RELATED_NEWS_MAX_AGE_DAYS and the same story from a second outlet.
function pickHeadlines(items, limit, now = Date.now()) {
  const picked = [];
  for (const n of items) {
    if (picked.length === limit) break;
    if (isStockChatter(n.title)) continue;
    if (!n.publishedAt || now - new Date(n.publishedAt).getTime() > RELATED_NEWS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) continue;
    if (picked.some((p) => sameStory(p.title, n.title))) continue;
    picked.push(n);
  }
  return picked;
}

async function getStockDetail(entry, rangeKey = "10d") {
  const cacheKey = `${entry.symbol}:${rangeKey}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < DETAIL_TTL_MS) return cached.data;

  const [history, relatedNews] = await Promise.all([
    fetchHistory(entry.symbol, rangeKey).catch((err) => {
      console.warn(`[stocks] history fetch failed for ${entry.symbol}: ${err.message}`);
      return [];
    }),
    // Looks through more than it shows: analyst-rating pieces, stories over six
    // weeks old and repeats of a story already listed are left out.
    fetchRelatedNews(entry.searchTerm || entry.name, entry.matchKeywords, RELATED_NEWS_CANDIDATES, entry.excludePatterns, entry.exactCaseKeywords)
      .then((items) => pickHeadlines(items, RELATED_NEWS_LIMIT))
      .catch((err) => {
        console.warn(`[stocks] related news fetch failed for ${entry.name}: ${err.message}`);
        return [];
      }),
  ]);

  const data = { id: entry.id, symbol: entry.symbol, name: entry.name, range: rangeKey, history, relatedNews };
  cache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

module.exports = { getStockDetail, fetchRelatedNews, fetchHistory, historyPoints, pickHeadlines };
