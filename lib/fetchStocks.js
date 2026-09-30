const fs = require("fs");
const path = require("path");
const symbols = require("./stockSymbols");

const CACHE_PATH = path.join(__dirname, "..", "data", "stocks.json");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HospitalityIntelBot/1.0";

const TREND_POINTS = 7; // short trend shown as a mini sparkline on each card

// NSE trades Mon–Fri, 9:15–15:30 IST. India has no daylight saving, so a fixed
// +5:30 offset is exact and doesn't depend on the server machine's timezone.
// (NSE holidays aren't modelled — the page detects them from stale trade times.)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MARKET_OPEN_MINUTE = 9 * 60 + 15;
const MARKET_CLOSE_MINUTE = 15 * 60 + 30;
const CLOSE_SETTLE_MINUTES = 15; // closing prices finalise a little after 15:30
const OPEN_REFRESH_MINUTES = 10; // how fresh prices are kept while trading
const MIN_FORCE_REFRESH_SECONDS = 30; // the Refresh button can't hammer Yahoo
const UPSTREAM_TIMEOUT_MS = 15000; // a hanging price service must not leave the page loading forever
const NO_TRADES_MS = 45 * 60 * 1000; // no trade for this long during trading hours means an exchange holiday

function marketStatus(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0 = Sunday
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;
  const open = isWeekday && minutes >= MARKET_OPEN_MINUTE && minutes < MARKET_CLOSE_MINUTE;

  // The most recent 15:30 close: today's if it has passed, else the previous weekday's.
  let daysBack = 0;
  if (!(isWeekday && minutes >= MARKET_CLOSE_MINUTE)) {
    daysBack = 1;
    let d = (day + 6) % 7;
    while (d === 0 || d === 6) {
      daysBack++;
      d = (d + 6) % 7;
    }
  }
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - daysBack * 24 * 60 * 60 * 1000;
  const lastCloseAt = new Date(istMidnight + MARKET_CLOSE_MINUTE * 60 * 1000 - IST_OFFSET_MS);
  return { open, lastCloseAt };
}

async function fetchQuote(entry) {
  try {
    // range=1mo (not 1d) so we get both the current price *and* enough recent
    // closes to draw a mini trend sparkline on the card, in one request.
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${entry.symbol}?interval=1d&range=1mo`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    const json = await res.json();
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result) throw new Error((json.chart && json.chart.error && json.chart.error.description) || "no data");

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const closes = ((result.indicators.quote[0] || {}).close || []).filter((c) => c != null);

    // meta.chartPreviousClose is unreliable for thinly-traded stocks (seen
    // returning a stale value weeks old, producing a bogus ~30% "day change").
    // The second-to-last daily close from the same response is the actual
    // previous trading day's close and far more trustworthy.
    const derivedPrevClose = closes.length >= 2 ? closes[closes.length - 2] : null;
    const prevClose = derivedPrevClose ?? meta.chartPreviousClose ?? meta.previousClose;
    const change = price - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;

    const trend = closes.slice(-TREND_POINTS);

    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      symbol: entry.symbol,
      domain: entry.domain,
      exchange: meta.fullExchangeName || null,
      currency: meta.currency || null,
      price,
      change,
      changePercent,
      trend,
      weekLow52: meta.fiftyTwoWeekLow ?? null,
      weekHigh52: meta.fiftyTwoWeekHigh ?? null,
      asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    };
  } catch (err) {
    console.warn(`[stocks] failed to fetch ${entry.symbol}: ${err.message}`);
    return { id: entry.id, name: entry.name, category: entry.category, symbol: entry.symbol, domain: entry.domain, error: true };
  }
}

async function doRefreshStocks() {
  const fetched = await Promise.all(symbols.map(fetchQuote));

  // Refreshing every few minutes means a transient Yahoo hiccup on one ticker
  // is now likely; keep that ticker's last good quote (flagged stale) instead
  // of replacing a real price with "unavailable".
  const previous = readCache();
  const lastGood = new Map(((previous && previous.quotes) || []).filter((q) => !q.error).map((q) => [q.id, q]));
  const quotes = fetched.map((q) => (q.error && lastGood.has(q.id) ? { ...lastGood.get(q.id), stale: true } : q));
  const keptStale = quotes.filter((q) => q.stale).length;
  if (keptStale) console.warn(`[stocks] ${keptStale} ticker(s) failed to refresh — kept last known price`);

  const payload = { generatedAt: new Date().toISOString(), quotes };

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  console.log(`[stocks] wrote ${quotes.length} quotes to ${CACHE_PATH}`);
  return payload;
}

// Concurrent callers (several tabs, the cron, a Refresh click) share one fetch.
let refreshInFlight = null;
function refreshStocks() {
  if (!refreshInFlight) {
    refreshInFlight = doRefreshStocks().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
}

// While NSE is trading (and for a short settle window after the close) prices
// are kept fresh to OPEN_REFRESH_MINUTES. Once closed, a single refresh after
// the closing prices settle stays valid through the evening, overnight and
// weekend, until the next open.
function isStale(payload, now = new Date()) {
  if (!payload) return true;
  // A ticker added to stockSymbols.js after the cache was written must not wait
  // for the next scheduled refresh to show up.
  const cached = new Set((payload.quotes || []).map((q) => q.id));
  if (symbols.some((s) => !cached.has(s.id))) return true;
  const generatedAt = new Date(payload.generatedAt).getTime();
  const ageMs = now.getTime() - generatedAt;
  const { open, lastCloseAt } = marketStatus(now);
  const settledAt = lastCloseAt.getTime() + CLOSE_SETTLE_MINUTES * 60 * 1000;

  if (open || now.getTime() < settledAt) return ageMs > OPEN_REFRESH_MINUTES * 60 * 1000;
  return generatedAt < settledAt;
}

// The market flag is computed per request (never cached), since a cache file
// written during trading is served after the close too.
// Also adds each stock's matchKeywords (from config, so old caches get them
// too) — the News tab uses them to tag stories that mention a listed company.
// marketStatus() follows the timetable, which knows nothing of exchange holidays
// (Gandhi Jayanti, Dussehra, Diwali…). This corrects it from the prices
// themselves: every quote carries the time of its last trade.
//  - Trading hours, prices just fetched, yet no NSE trade for 45 minutes: the
//    exchange is shut today.
//  - When closed, "last close" is the close of the day the prices actually
//    belong to, which on a holiday is the previous trading day.
function effectiveMarket(quotes, now = new Date(), generatedAt = now) {
  const { open, lastCloseAt } = marketStatus(now);
  const trades = quotes.filter((q) => !q.error && q.asOf && q.currency === "INR").map((q) => new Date(q.asOf).getTime());
  if (!trades.length) return { open, lastCloseAt, holiday: false };

  const latest = Math.max(...trades);
  const pricesFresh = now.getTime() - new Date(generatedAt).getTime() < NO_TRADES_MS;
  const holidayToday = open && pricesFresh && now.getTime() - latest > NO_TRADES_MS;
  if (open && !holidayToday) return { open: true, lastCloseAt, holiday: false };

  const ist = new Date(latest + IST_OFFSET_MS);
  const closeOfLatest = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) + MARKET_CLOSE_MINUTE * 60 * 1000 - IST_OFFSET_MS);
  const earlier = closeOfLatest.getTime() < lastCloseAt.getTime();
  return { open: false, lastCloseAt: earlier ? closeOfLatest : lastCloseAt, holiday: holidayToday };
}

function withMarket(payload) {
  const { open, lastCloseAt, holiday } = effectiveMarket(payload.quotes, new Date(), payload.generatedAt);
  const configById = new Map(symbols.map((s) => [s.id, s]));
  const quotes = payload.quotes.map((q) => {
    const config = configById.get(q.id) || {};
    return { ...q, matchKeywords: config.matchKeywords || [], exactCaseKeywords: config.exactCaseKeywords || [], excludePatterns: config.excludePatterns || [] };
  });
  return { ...payload, quotes, market: { open, holiday, lastCloseAt: lastCloseAt.toISOString() } };
}

async function getStocks({ forceRefresh = false } = {}) {
  const cached = readCache();
  const justRefreshed = cached && Date.now() - new Date(cached.generatedAt).getTime() < MIN_FORCE_REFRESH_SECONDS * 1000;
  if (cached && ((forceRefresh && justRefreshed) || (!forceRefresh && !isStale(cached)))) return withMarket(cached);
  return withMarket(await refreshStocks());
}

module.exports = { refreshStocks, getStocks, readCache, isStale, marketStatus, effectiveMarket };

if (require.main === module) {
  refreshStocks().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
