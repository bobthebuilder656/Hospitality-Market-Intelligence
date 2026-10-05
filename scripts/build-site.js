// Builds the whole tool as plain files for GitHub Pages: the page itself (public/)
// plus a data/ folder holding everything the page shows, fetched fresh now.
//
// GitHub Actions runs this every 30–60 minutes (.github/workflows/site.yml), checks
// the result with the evals, and only then publishes it. Visitors never wait for
// anything to be fetched: they read files that are already there.
//
//   node scripts/build-site.js                       build into site/
//   node scripts/build-site.js --preview=2026-10-09  include articles due by that date (for checking drafts on this machine only)
//   node scripts/build-site.js --previous-url=https://…/   fall back to the live site's data when a source fails
//
// If a source fails (a news feed, Yahoo, the weather service), its data from the
// previous build is used instead, so one bad fetch never empties part of the page.

const fs = require("fs");
const path = require("path");
const { ROOT, CONTENT_DIR } = require("../lib/paths");
const { refreshNews } = require("../lib/fetchNews");
const { refreshStocks } = require("../lib/fetchStocks");
const { fetchHistory, fetchRelatedNews, pickHeadlines } = require("../lib/fetchStockDetail");
const { getStockHeadlines } = require("../lib/stockLinks");
const stockSymbols = require("../lib/stockSymbols");
const { getCityEvents } = require("../lib/cityEvents");
const { getEventNews } = require("../lib/eventNews");
const { getWeather } = require("../lib/fetchWeather");
const { getResources } = require("../lib/resources");
const { getAirTraffic, refreshAirTraffic } = require("../lib/airTraffic");
const cities = require("../lib/cities");

const RANGES = { "1m": "1m", "3m": "3m", "1y": "1y" }; // 10 days is the end of the 1-month history
const CONCURRENCY = 4;

async function inBatches(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) results.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  return results;
}

async function buildSite({ outDir = path.join(ROOT, "site"), now = new Date(), preview = false, previousDir = null, previousUrl = null, log = console.log } = {}) {
  const problems = []; // sources that failed this time; their previous data was used
  const dataDir = path.join(outDir, "data");

  // The previous build's file, from a folder on this machine or from the live site.
  async function previous(rel) {
    if (previousDir) {
      const p = path.join(previousDir, rel);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    if (previousUrl) {
      try {
        const res = await fetch(new URL(rel, previousUrl.replace(/\/?$/, "/")), { signal: AbortSignal.timeout(15000) });
        if (res.ok) return await res.json();
      } catch {
        /* no previous copy available */
      }
    }
    return null;
  }

  async function withFallback(what, rel, fetchFresh, isUsable = (v) => v != null) {
    try {
      const fresh = await fetchFresh();
      if (isUsable(fresh)) return fresh;
      throw new Error("came back empty");
    } catch (err) {
      const old = await previous(rel);
      problems.push(`${what}: ${err.message}${old ? " (kept the previous copy)" : " (no previous copy)"}`);
      if (old) return old;
      throw new Error(`${what} failed and there is no previous copy to fall back on`);
    }
  }

  const write = (rel, data) => {
    const p = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data));
  };

  // ---- the page -------------------------------------------------------------------
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "public"), outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, ".nojekyll"), ""); // GitHub Pages: serve the files as they are

  // ---- news -----------------------------------------------------------------------
  log("[build] news");
  const news = await withFallback("News", "data/news.json", async () => {
    const { generatedAt, sources, items, feedHealth } = await refreshNews();
    return { generatedAt, sources, items, feedHealth };
  }, (n) => n && n.items && n.items.length > 0);
  const feedHealth = news.feedHealth || [];
  write("news.json", { generatedAt: news.generatedAt, sources: news.sources, items: news.items });

  // ---- stocks ---------------------------------------------------------------------
  log("[build] stock prices");
  const stocks = await withFallback("Stock prices", "data/stocks.json", async () => {
    const { generatedAt, quotes } = await refreshStocks();
    // The page tags news stories with the companies they name, so it needs each company's keywords.
    const config = new Map(stockSymbols.map((s) => [s.id, s]));
    return {
      generatedAt,
      quotes: quotes.map((q) => {
        const c = config.get(q.id) || {};
        return { ...q, matchKeywords: c.matchKeywords || [], exactCaseKeywords: c.exactCaseKeywords || [], excludePatterns: c.excludePatterns || [] };
      }),
    };
  }, (s) => s && s.quotes && s.quotes.some((q) => !q.error));
  write("stocks.json", stocks);

  log("[build] stock headlines");
  // No headline at all for any company means the news search failed, not that nothing was written.
  const headlines = await withFallback("Stock headlines", "data/stock-headlines.json", async () => ({ headlines: await getStockHeadlines(stocks.quotes) }), (h) => Object.keys(h.headlines).length > 0);
  write("stock-headlines.json", headlines);

  // One file per company: price history for each chart range, and its recent headlines.
  log("[build] price history for each company");
  await inBatches(stockSymbols, async (entry) => {
    const rel = `data/stocks/${entry.id}.json`;
    const old = await previous(rel);
    const history = {};
    for (const range of Object.keys(RANGES)) {
      try {
        history[range] = await fetchHistory(entry.symbol, range);
        if (!history[range].length) throw new Error("no prices");
      } catch (err) {
        history[range] = (old && old.history && old.history[range]) || [];
        problems.push(`${entry.name} ${range} history: ${err.message}${history[range].length ? " (kept the previous copy)" : ""}`);
      }
    }
    history["10d"] = history["1m"].slice(-10);
    let relatedNews;
    try {
      relatedNews = pickHeadlines(await fetchRelatedNews(entry.searchTerm || entry.name, entry.matchKeywords, 15, entry.excludePatterns, entry.exactCaseKeywords), 3);
    } catch (err) {
      relatedNews = (old && old.relatedNews) || [];
      problems.push(`${entry.name} headlines: ${err.message}`);
    }
    write(`stocks/${entry.id}.json`, { id: entry.id, symbol: entry.symbol, name: entry.name, history, relatedNews });
  });

  // ---- city events, weather, air traffic --------------------------------------------
  log("[build] city events");
  write("events.json", await withFallback("City events", "data/events.json", () => getCityEvents({ now })));
  write("event-news.json", await withFallback("Event news", "data/event-news.json", async () => ({ news: await getEventNews() }), (n) => Object.keys(n.news).length > 0));

  log("[build] weather");
  const oldWeather = (await previous("data/weather.json")) || { cities: {} };
  const weather = { cities: {} };
  for (const c of cities) {
    weather.cities[c.id] = (await getWeather(c.id)) || oldWeather.cities[c.id] || null;
    if (!weather.cities[c.id]) problems.push(`Weather for ${c.name}: no forecast`);
  }
  write("weather.json", weather);

  log("[build] air traffic");
  try {
    await refreshAirTraffic(); // only downloads a month AAI has newly published
  } catch (err) {
    problems.push(`Air traffic: ${err.message} (kept the saved months)`);
  }
  write("air-traffic.json", getAirTraffic());

  // ---- resources: only what is published by now (or by the preview date) ------------
  log("[build] resources");
  const resources = getResources({ now, preview });
  write("resources.json", resources);
  // Pictures for the pieces that are included, and no others.
  for (const item of [resources.brief, resources.caseStudy].filter(Boolean)) {
    if (!item.image || !/^images\//.test(item.image.src)) continue;
    const from = path.join(CONTENT_DIR, item.image.src);
    if (!fs.existsSync(from)) {
      problems.push(`Picture missing for ${item.id}: ${item.image.src}`);
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(outDir, item.image.src)), { recursive: true });
    fs.copyFileSync(from, path.join(outDir, item.image.src));
  }

  // ---- what happened ---------------------------------------------------------------------
  const build = {
    builtAt: now.toISOString(),
    preview: preview || false,
    feeds: { responded: feedHealth.filter((h) => h.ok).length, total: feedHealth.length, failing: feedHealth.filter((h) => !h.ok).map((h) => h.name) },
    problems,
  };
  write("build.json", build);
  log(`[build] done${problems.length ? ` with ${problems.length} source problem(s): ${problems.slice(0, 5).join("; ")}` : ""}`);
  return build;
}

module.exports = { buildSite };

if (require.main === module) {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=") || null;
  const previewArg = arg("preview");
  const outDir = path.resolve(arg("out") || path.join(ROOT, "site"));
  // A local rebuild falls back on the site already built here; copy it aside first, since the build starts by clearing the folder.
  let previousDir = null;
  if (fs.existsSync(path.join(outDir, "data"))) {
    previousDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "hi-previous-"));
    fs.cpSync(outDir, previousDir, { recursive: true });
  }
  buildSite({ outDir, preview: previewArg === "1" ? true : previewArg || false, previousDir, previousUrl: arg("previous-url") })
    .catch((err) => {
      console.error(`[build] failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => previousDir && fs.rmSync(previousDir, { recursive: true, force: true }));
}
