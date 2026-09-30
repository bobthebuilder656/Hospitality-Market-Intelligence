const express = require("express");
const path = require("path");
const { getNews, refreshNews, readCache: readNewsCache } = require("./lib/fetchNews");
const { getStocks, refreshStocks, readCache: readStocksCache } = require("./lib/fetchStocks");
const { getStockDetail } = require("./lib/fetchStockDetail");
const { getStockHeadlines } = require("./lib/stockLinks");
const { getComparison } = require("./lib/fetchStockCompare");
const stockSymbols = require("./lib/stockSymbols");
const { getCityEvents } = require("./lib/cityEvents");
const { refreshHolidays } = require("./lib/fetchHolidays");
const { getEventNews } = require("./lib/eventNews");
const { getWeather } = require("./lib/fetchWeather");
const { runMonthlyCheckIfDue } = require("./lib/monthlyCheck");
const { getResources } = require("./lib/resources");
const { getAirTraffic, refreshAirTraffic } = require("./lib/airTraffic");
const { msUntilIstHour } = require("./lib/dates");
const { CONTENT_DIR } = require("./lib/paths");
const { securityHeaders, rateLimit, previewAllowed } = require("./lib/security");

const app = express();
const PORT = process.env.PORT || 3000;
const DAILY_REFRESH_HOUR = 11; // India time, wherever the server is hosted
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
// Preview mode shows unpublished articles. It needs ?key= to match the
// PREVIEW_KEY setting, except on the developer's own machine (see lib/security.js).
const PREVIEW_KEY = process.env.PREVIEW_KEY || "";

app.disable("x-powered-by");
// The host's proxy sits in front of the server; this makes req.ip the visitor's address.
if (IS_PRODUCTION) app.set("trust proxy", 1);

app.use(securityHeaders(IS_PRODUCTION));

app.use(express.static(path.join(__dirname, "public")));
// Pictures for articles and case studies come from the private content folder.
app.use("/images", express.static(path.join(CONTENT_DIR, "images")));

// Request limits per visitor. The page itself makes about a dozen requests per
// visit, so these only bite on abuse. The tighter ones protect the outside
// services (Yahoo, Google News, the feeds) that each such request calls.
const MINUTE = 60 * 1000;
app.use("/api", rateLimit({ windowMs: MINUTE, max: 600, isProduction: IS_PRODUCTION }));
app.use("/api", rateLimit({ windowMs: MINUTE, max: 30, isProduction: IS_PRODUCTION, only: (req) => /^\/stocks\/(compare|[^/]+\/detail)/.test(req.path) }));
app.use("/api", rateLimit({ windowMs: MINUTE, max: 6, isProduction: IS_PRODUCTION, only: (req) => req.query.refresh === "1" }));

app.get("/api/news", async (req, res) => {
  try {
    // Only what the page shows; the feed diagnostics stay on the server (see /api/health).
    const { generatedAt, sources, items } = await getNews({ forceRefresh: req.query.refresh === "1" });
    res.json({ generatedAt, sources, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load news" });
  }
});

app.get("/api/stocks", async (req, res) => {
  try {
    const stocks = await getStocks({ forceRefresh: req.query.refresh === "1" });
    res.json(stocks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load stocks" });
  }
});

// Latest headline for each stock — shown on its card. Separate from /api/stocks
// so the slower news lookups never delay prices.
app.get("/api/stocks/headlines", async (req, res) => {
  try {
    const stocks = await getStocks();
    res.json({ headlines: await getStockHeadlines(stocks.quotes) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load stock headlines" });
  }
});

const VALID_COMPARE_RANGES = ["1m", "3m", "1y"];
const COMPARE_MIN = 2;
const COMPARE_MAX = 3;

app.get("/api/stocks/compare", async (req, res) => {
  // Sorted, so "a,b" and "b,a" are one saved comparison, not two trips to the price service.
  const ids = [...new Set(String(req.query.ids || "").split(",").filter(Boolean))].sort();
  if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX) {
    return res.status(400).json({ error: `Pick ${COMPARE_MIN}-${COMPARE_MAX} stocks to compare` });
  }
  const entries = ids.map((id) => stockSymbols.find((s) => s.id === id));
  if (entries.some((e) => !e)) return res.status(404).json({ error: "Unknown ticker" });
  const range = VALID_COMPARE_RANGES.includes(req.query.range) ? req.query.range : "3m";
  try {
    res.json(await getComparison(entries, range));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load comparison" });
  }
});

const VALID_DETAIL_RANGES = ["10d", "1m", "3m", "1y"];

app.get("/api/stocks/:id/detail", async (req, res) => {
  const entry = stockSymbols.find((s) => s.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Unknown ticker" });
  const range = VALID_DETAIL_RANGES.includes(req.query.range) ? req.query.range : "10d";
  try {
    const detail = await getStockDetail(entry, range);
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load stock detail" });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    res.json(await getCityEvents());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load city events" });
  }
});

// Latest news story for each curated event. Separate from /api/events so the
// slower news lookups never delay the event list.
app.get("/api/events/news", async (req, res) => {
  try {
    res.json({ news: await getEventNews() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load event news" });
  }
});

// Everything the Resources tab shows: glossary, reports, articles, case studies, market indicators.
app.get("/api/resources", (req, res) => {
  try {
    // ?preview=1 shows the next unpublished article/case study; ?preview=YYYY-MM-DD shows
    // what will be live on that date. For reviewing drafts only.
    const allowed = previewAllowed(req, { previewKey: PREVIEW_KEY, isProduction: IS_PRODUCTION });
    const p = allowed ? String(req.query.preview || "") : "";
    res.json(getResources({ preview: p === "1" ? true : /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : false }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load resources" });
  }
});

// Monthly air passengers per city (AAI), for City Events and the Resources Tools page.
app.get("/api/air-traffic", (req, res) => {
  try {
    res.json(getAirTraffic());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load air traffic" });
  }
});

// 7-day forecast for one city, shown when a city is picked on the City Events tab.
app.get("/api/events/weather/:city", async (req, res) => {
  const weather = await getWeather(req.params.city);
  if (!weather) return res.status(404).json({ error: "No forecast for this city" });
  res.json(weather);
});

// For hosts and uptime monitors: is the server up, and how old is its data?
// "ok" turns false when news is over 36 hours old or no prices are saved. The
// reply is always 200 while the server is running: a host that saw an error
// status here would refuse to start a new deployment just because a feed was down.
app.get("/api/health", (req, res) => {
  const hoursOld = (iso) => (iso ? Math.round(((Date.now() - new Date(iso).getTime()) / 3600000) * 10) / 10 : null);
  let news = null;
  let stocks = null;
  try {
    news = readNewsCache();
    stocks = readStocksCache();
  } catch (err) {
    console.error(err);
  }
  const newsInfo = { stories: news ? news.items.length : 0, hoursOld: hoursOld(news && news.generatedAt) };
  const stocksInfo = { prices: stocks ? stocks.quotes.filter((q) => !q.error).length : 0, hoursOld: hoursOld(stocks && stocks.generatedAt) };
  const ok = newsInfo.stories > 0 && newsInfo.hoursOld !== null && newsInfo.hoursOld < 36 && stocksInfo.prices > 0;
  // How the news feeds did at the last refresh.
  const health = (news && news.feedHealth) || [];
  const feeds = { responded: health.filter((h) => h.ok).length, total: health.length, failing: health.filter((h) => !h.ok).map((h) => h.name) };
  res.json({ ok, news: newsInfo, stocks: stocksInfo, feeds });
});

// Anything else under /api is an address that does not exist.
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

async function runDailyRefresh() {
  try {
    await refreshNews();
    console.log("[cron] daily news refresh complete");
  } catch (err) {
    console.error("[cron] daily news refresh failed:", err.message);
  }
  try {
    await refreshStocks();
    console.log("[cron] daily stock refresh complete");
  } catch (err) {
    console.error("[cron] daily stock refresh failed:", err.message);
  }
  try {
    await refreshHolidays();
    console.log("[cron] daily holiday refresh complete");
  } catch (err) {
    console.error("[cron] daily holiday refresh failed:", err.message);
  }
  // Picks up a new month of airport data once AAI publishes it (usually 3-4 weeks after month end).
  try {
    await refreshAirTraffic();
  } catch (err) {
    console.error("[cron] air traffic refresh failed:", err.message);
  }
  // Only does anything when the last City Events check is over a month old.
  await runMonthlyCheckIfDue();
}

// Keeps news.json, stocks.json and holidays.json current even if nobody visits the site:
// refreshes once now (if stale), then every day at DAILY_REFRESH_HOUR IST.
function scheduleDailyRefresh() {
  const delay = msUntilIstHour(DAILY_REFRESH_HOUR);
  console.log(`[cron] next daily refresh (news + stocks + holidays) in ${Math.round(delay / 60000)} min`);
  setTimeout(() => {
    runDailyRefresh();
    setInterval(runDailyRefresh, ONE_DAY_MS);
  }, delay);
}

app.listen(PORT, () => {
  console.log(`Hospitality Intel running at http://localhost:${PORT}`);
  // Warm/refresh the caches on boot if stale. A failure here must not stop the server.
  getNews().catch((err) => console.error("[boot] news refresh failed:", err.message));
  getStocks().catch((err) => console.error("[boot] stock refresh failed:", err.message));
  scheduleDailyRefresh();
});
