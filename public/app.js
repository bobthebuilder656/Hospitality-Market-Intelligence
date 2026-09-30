const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

// The address carries the open tab ("#stocks"), so a reload stays on it, a link
// can point at it, and the browser's Back button steps through the tabs visited
// instead of leaving the site.
function tabFromAddress() {
  const id = location.hash.slice(1).split("/")[0];
  return [...tabs].some((t) => t.dataset.tab === id) ? id : "dashboard";
}

function showTab(id) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === id;
    t.classList.toggle("active", on);
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  panels.forEach((p) => p.classList.toggle("active", p.id === id));
  if (["dashboard", "stocks", "news"].includes(id) && (!stocksLoaded || stocksDataIsOld())) loadStocks();
  if (id === "news" && newsFailed) loadNews(); // a first load that failed is retried when the tab is opened
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    if (location.hash !== `#${tab.dataset.tab}`) history.pushState(null, "", `#${tab.dataset.tab}`);
    showTab(tab.dataset.tab);
  });
});

// Browser Back / Forward: close any popup and show the tab in the address.
window.addEventListener("popstate", () => {
  closeStockDetail();
  showTab(tabFromAddress());
});

// On a desktop each filter is a titled dropdown; on phones it stays a row of buttons.
// The buttons hold the logic, so choosing in the dropdown clicks the matching button,
// and a button click (from a phone or the Dashboard) updates the dropdown.
function linkFilterSelect(selectId, controlsId, key) {
  const select = document.getElementById(selectId);
  const controls = document.getElementById(controlsId);
  select.addEventListener("change", () => controls.querySelector(`[data-${key}="${select.value}"]`).click());
  controls.addEventListener("click", (e) => {
    const btn = e.target.closest(`[data-${key}]`);
    if (btn) select.value = btn.dataset[key];
  });
}
linkFilterSelect("news-region-select", "news-region-controls", "region");
linkFilterSelect("stock-category-select", "stock-category-controls", "category");
linkFilterSelect("stock-sort-select", "sort-controls", "sort");

// "30 Sept, 2:40 pm"
const UPDATED_FORMAT = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true };

// The Dashboard tab summarises the other tabs, so each one calls this when its
// data changes. dashboard.js loads last; until then there is nothing to update.
function updateDashboard() {
  if (typeof renderDashboard === "function") renderDashboard();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Headlines and links come from outside feeds, so every one is escaped before it
// goes into the page, and a link is only made clickable if it is a web address
// (never "javascript:…").
function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || "")) ? escapeHtml(url) : "#";
}

// A picture that fails to load: a company icon is hidden (its space is kept so the
// row stays aligned); an event picture is removed so the coloured tile behind it
// shows. Done here, not with onerror="" in the HTML, because the page's security
// policy forbids inline scripts.
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.classList.contains("stock-logo")) img.style.visibility = "hidden";
    else if (img.closest(".event-thumb")) img.remove();
  },
  true
);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timeAgo(isoDate) {
  if (!isoDate) return "";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// More precise than timeAgo() (adds minutes) — used for the offline banner,
// where "45 mins ago" is the whole point.
function minutesAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Safety net for when the local server isn't running: every successful load
// is saved here, so a failed fetch can fall back to the last known-good data
// instead of a dead error screen.
function makeOfflineCache(key) {
  return {
    save(data) {
      try {
        localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
      } catch (err) {
        /* localStorage unavailable (private browsing, etc.) — safe to ignore */
      }
    },
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    },
  };
}

function offlineBanner(savedAt) {
  return `<div class="offline-banner">⚠ Server unreachable — showing saved data from ${minutesAgo(savedAt)}. Retrying in the background…</div>`;
}

let currentNewsData = null;
let newsOfflineSavedAt = null; // set while the news list is showing saved (offline) data
let newsFailed = false; // the first load failed and there was nothing saved to show
let currentNewsRegion = "all";
const newsCache = makeOfflineCache("hospitalityIntel.news");
let newsRetryTimer = null;

document.querySelectorAll("#news-region-controls .sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#news-region-controls .sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentNewsRegion = btn.dataset.region;
    if (currentNewsData) renderNews(currentNewsData);
  });
});

// offlineSavedAt: pass a time to show the "saved data" notice, null to clear it,
// or leave it out to keep the notice as it is (e.g. when only the stock chips changed).
function renderNews(data, offlineSavedAt = newsOfflineSavedAt) {
  newsOfflineSavedAt = offlineSavedAt || null;
  const list = document.getElementById("news-list");
  const count = document.getElementById("news-count");
  const updated = document.getElementById("updated-at");

  const items = currentNewsRegion === "all" ? data.items : data.items.filter((i) => i.region === currentNewsRegion);

  updateDashboard();
  count.textContent = `${items.length} of ${data.items.length} stories shown`;
  updated.textContent = ` · updated ${new Date(data.generatedAt).toLocaleString("en-IN", UPDATED_FORMAT)}`;

  const banner = offlineSavedAt ? offlineBanner(offlineSavedAt) : "";

  if (!items.length) {
    list.innerHTML = banner + '<p class="error">No news available for this filter right now.</p>';
    return;
  }

  const matchers = stockMatchers();

  list.innerHTML =
    banner +
    items
      .map((item) => {
        const badgeClass = item.region === "India" ? "india" : "global";
        return `
        <a class="news-card" href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">
          <div class="news-body">
            <div class="news-meta">
              <span class="region-badge ${badgeClass}">${item.region === "India" ? "India" : "International"}</span>
              <span class="news-source">${escapeHtml(item.source)}</span>
              <span>·</span>
              <span class="news-time">${timeAgo(item.pubDate)}</span>
              ${stockChipHtml(item, matchers)}
            </div>
            <p class="news-title">${escapeHtml(item.title)}</p>
            ${item.snippet ? `<p class="news-snippet">${escapeHtml(item.snippet)}</p>` : ""}
          </div>
        </a>
      `;
      })
      .join("");
}

function stopNewsRetry() {
  if (newsRetryTimer) {
    clearInterval(newsRetryTimer);
    newsRetryTimer = null;
  }
}

function scheduleNewsRetry() {
  if (newsRetryTimer) return;
  newsRetryTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/news");
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      stopNewsRetry();
      currentNewsData = data;
      newsCache.save(data);
      renderNews(data, null);
    } catch (err) {
      /* still down — keep retrying */
    }
  }, 20000);
}

async function loadNews(forceRefresh = false) {
  const list = document.getElementById("news-list");
  const btn = document.getElementById("refresh-btn");
  btn.disabled = true;

  const cached = newsCache.load();
  if (!currentNewsData) {
    list.innerHTML = '<p class="loading">Loading news…</p>';
  }

  try {
    const res = await fetch(`/api/news${forceRefresh ? "?refresh=1" : ""}`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    stopNewsRetry();
    currentNewsData = data;
    newsFailed = false;
    newsCache.save(data);
    renderNews(data, null);
  } catch (err) {
    if (cached) {
      currentNewsData = cached.data;
      renderNews(cached.data, cached.savedAt);
      scheduleNewsRetry();
    } else if (!currentNewsData) {
      list.innerHTML = '<p class="error">Failed to load news. Check your connection and press Refresh.</p>';
      newsFailed = true;
      updateDashboard();
    }
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("refresh-btn").addEventListener("click", () => loadNews(true));

loadNews();

const CURRENCY_SYMBOLS = { USD: "$", INR: "₹", EUR: "€", GBP: "£" };
let stocksLoaded = false;
let stocksFailed = false; // the first load failed and there was nothing saved to show

function formatPrice(value, currency) {
  if (value == null || Number.isNaN(value)) return "—";
  const symbol = CURRENCY_SYMBOLS[currency] || "";
  return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

let currentStocksData = null;
let currentSort = "gainers"; // shows growing stocks first, losing ones last, by default

function sortQuotes(quotes, applyCategory = true) {
  const filtered = !applyCategory || currentStockCategory === "all" ? quotes : quotes.filter((q) => q.category === currentStockCategory);
  const ok = filtered.filter((q) => !q.error);
  const failed = filtered.filter((q) => q.error);
  const sorted = [...ok];
  if (currentSort === "gainers") sorted.sort((a, b) => b.changePercent - a.changePercent);
  else if (currentSort === "losers") sorted.sort((a, b) => a.changePercent - b.changePercent);
  else if (currentSort === "az") sorted.sort((a, b) => a.name.localeCompare(b.name));
  return [...sorted, ...failed];
}

let currentStockCategory = "all";

document.querySelectorAll("#sort-controls .sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#sort-controls .sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSort = btn.dataset.sort;
    if (currentStocksData) renderStocks(currentStocksData);
  });
});

document.querySelectorAll("#stock-category-controls .sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#stock-category-controls .sort-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentStockCategory = btn.dataset.category;
    if (currentStocksData) renderStocks(currentStocksData);
  });
});

// Whole numbers for large prices, two decimals for small ones (₹5.76 must not read as ₹6).
function formatRangeLabel(value, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || "";
  return `${symbol}${value < 100 ? value.toFixed(2) : Math.round(value)}`;
}

function buildRangeBar(price, low, high, currency) {
  if (low == null || high == null || high <= low) return "";
  const pct = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return `
    <div class="range-bar-wrap" title="52-week range">
      <span class="range-bar-label">${formatRangeLabel(low, currency)}</span>
      <div class="range-bar-track"><div class="range-bar-marker" style="left:${pct.toFixed(1)}%"></div></div>
      <span class="range-bar-label">${formatRangeLabel(high, currency)}</span>
    </div>
  `;
}

// Color reflects today's move (isUp), not the shape of the trend line itself —
// a stock can be trending down over a week but still up today, and the color
// should always answer "is it up today," consistently with the price badge.
function buildMiniSparkline(trend, isUp) {
  if (!trend || trend.length < 2) return "";
  const w = 72, h = 30, pad = 3;
  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const range = max - min || 1;
  const pts = trend.map((c, i) => {
    const x = pad + (i / (trend.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (c - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const stroke = isUp ? "#1b8a4a" : "#d1403a";
  return `<svg viewBox="0 0 ${w} ${h}" class="mini-sparkline"><polyline points="${pts.join(" ")}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

// ---------- watchlist ----------

const WATCHLIST_KEY = "hospitalityIntel.watchlist";
const WATCHLIST_MAX = 6;

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string").slice(0, WATCHLIST_MAX) : [];
  } catch (err) {
    return [];
  }
}

function saveWatchlist(ids) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(ids));
  } catch (err) {
    /* localStorage unavailable (private browsing, etc.) — the list still works for this visit */
  }
}

let watchlist = loadWatchlist();
let watchlistMsgTimer = null;

function showStocksMessage(text) {
  const el = document.getElementById("stocks-msg");
  el.textContent = text;
  clearTimeout(watchlistMsgTimer);
  watchlistMsgTimer = setTimeout(() => {
    el.textContent = "";
  }, 4000);
}

function toggleWatchlist(id) {
  if (watchlist.includes(id)) {
    watchlist = watchlist.filter((w) => w !== id);
  } else if (watchlist.length >= WATCHLIST_MAX) {
    showStocksMessage(`Your watchlist is full (${WATCHLIST_MAX} stocks). Remove one to add another.`);
    return;
  } else {
    watchlist = [...watchlist, id];
  }
  saveWatchlist(watchlist);
  if (currentStocksData) renderStocks(currentStocksData);
}

// ---------- sector pulse + market status ----------

// "Indian Hotels Co. (Taj)" -> "Indian Hotels Co." — the brand suffix is too long for a summary line.
function shortName(name) {
  return name.replace(/\s*\(.*\)\s*$/, "");
}

function signedPercent(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function moveClass(value) {
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

function buildPulse(quotes, market) {
  const ok = quotes.filter((q) => !q.error);
  if (!ok.length) return "";

  // "Today" is only true while the market is open; after the close, say which close this is.
  const title =
    market && !market.open
      ? `Hospitality stocks · last close, ${new Date(market.lastCloseAt).toLocaleDateString("en-IN", MARKET_DAY_FORMAT)}`
      : "Hospitality stocks today";

  const up = ok.filter((q) => q.change > 0).length;
  const down = ok.filter((q) => q.change < 0).length;
  const flat = ok.length - up - down;

  const groupAverage = (category) => {
    const group = ok.filter((q) => q.category === category);
    return group.length ? group.reduce((sum, q) => sum + q.changePercent, 0) / group.length : null;
  };
  const groups = [
    ["Hotel chains", groupAverage("hotel")],
    ["Restaurant brands", groupAverage("restaurant")],
    ["Online travel", groupAverage("ota")],
  ]
    .filter(([, avg]) => avg != null)
    .map(([label, avg]) => `<span>${label} <b class="${moveClass(avg)}">${signedPercent(avg)}</b></span>`)
    .join('<span class="pulse-sep">·</span>');

  const byChange = [...ok].sort((a, b) => b.changePercent - a.changePercent);
  const gainer = byChange[0];
  const loser = byChange[byChange.length - 1];
  const movers = [
    gainer.changePercent > 0 ? `<span>Top gainer <b>${shortName(gainer.name)}</b> <b class="up">${signedPercent(gainer.changePercent)}</b></span>` : "",
    loser.changePercent < 0 ? `<span>Top loser <b>${shortName(loser.name)}</b> <b class="down">${signedPercent(loser.changePercent)}</b></span>` : "",
  ]
    .filter(Boolean)
    .join('<span class="pulse-sep">·</span>');

  return `
    <p class="pulse-title">${title}</p>
    <p class="pulse-counts"><b class="up">${up} up</b><span class="pulse-sep">·</span><b class="down">${down} down</b><span class="pulse-sep">·</span><b class="flat">${flat} flat</b></p>
    <p class="pulse-line">${groups} <span class="pulse-note">(average change)</span></p>
    ${movers ? `<p class="pulse-line">${movers}</p>` : ""}
    ${otherSessionNote(ok)}
  `;
}

// Stocks listed abroad (MakeMyTrip, on NASDAQ) close at a different time from
// NSE, so their figure is from their own last session. Say so, since they are
// counted in the totals above.
function otherSessionNote(quotes) {
  const abroad = quotes.filter((q) => q.currency && q.currency !== "INR");
  if (!abroad.length) return "";
  return `<p class="pulse-note">${abroad.map((q) => escapeHtml(shortName(q.name))).join(", ")} ${abroad.length === 1 ? "trades" : "trade"} in the US; ${abroad.length === 1 ? "its" : "their"} price and change are from the last US session.</p>`;
}

const MARKET_TIME_FORMAT = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" };
const MARKET_DAY_FORMAT = { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" };
const NO_RECENT_TRADE_MS = 45 * 60 * 1000;

// Whether the market is open comes from the server. NSE holidays aren't modelled
// there, so during trading hours we also check that something has actually
// traded recently — if not, say so instead of claiming live prices.
function formatMarketStatus(data) {
  const updated = new Date(data.generatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  const unavailable = data.quotes.filter((q) => q.error).length;
  const tail = `updated ${updated}${unavailable ? ` · ${unavailable} unavailable` : ""}`;

  if (!data.market) return `Prices ${tail}`;

  if (data.market.open) {
    const traded = data.quotes.filter((q) => !q.error && q.asOf).map((q) => new Date(q.asOf).getTime());
    const latestTrade = traded.length ? Math.max(...traded) : null;
    if (latestTrade && Date.now() - latestTrade > NO_RECENT_TRADE_MS) {
      const when = new Date(latestTrade).toLocaleString("en-IN", MARKET_TIME_FORMAT);
      return `<span class="market-dot closed"></span>Trading hours, but no recent trades (market holiday?) · showing prices from ${when}`;
    }
    return `<span class="market-dot open"></span>Market open · ${tail}`;
  }

  const closeDay = new Date(data.market.lastCloseAt).toLocaleDateString("en-IN", MARKET_DAY_FORMAT);
  if (data.market.holiday) return `<span class="market-dot closed"></span>Market closed today (exchange holiday) · prices as of close on ${closeDay} · ${tail}`;
  return `<span class="market-dot closed"></span>Market closed · prices as of close on ${closeDay} · ${tail}`;
}

// ---------- cards ----------

function buildStockCard(q) {
  const picked = compareMode && compareIds.includes(q.id);
  const logo = q.domain
    ? `<img class="stock-logo" src="https://www.google.com/s2/favicons?domain=${q.domain}&sz=64" alt="" />`
    : "";
  if (q.error) {
    return `
      <div class="stock-card stock-card-error">
        <div class="stock-card-top">
          ${logo}
          <div class="stock-info">
            <p class="stock-name">${q.name}</p>
            <p class="stock-symbol">${q.symbol}</p>
          </div>
          <span class="stock-error">unavailable</span>
        </div>
      </div>
    `;
  }
  const direction = q.change > 0 ? "up" : q.change < 0 ? "down" : "flat";
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";
  const starred = watchlist.includes(q.id);
  const starLabel = `${starred ? "Remove" : "Add"} ${shortName(q.name)} ${starred ? "from" : "to"} watchlist`;
  return `
    <div class="stock-card${picked ? " compare-selected" : ""}" data-stock-id="${q.id}" role="button" tabindex="0"${compareMode ? ` aria-pressed="${picked}"` : ""}>
      <div class="stock-card-top">
        <span class="compare-check" aria-hidden="true">${picked ? "✓" : ""}</span>
        <button type="button" class="star-btn${starred ? " starred" : ""}" data-star-id="${q.id}" aria-pressed="${starred}" aria-label="${starLabel}" title="${starLabel}">${starred ? "★" : "☆"}</button>
        ${logo}
        <div class="stock-info">
          <p class="stock-name">${q.name}</p>
          <p class="stock-symbol">${q.symbol}</p>
        </div>
        <div class="stock-spark">${buildMiniSparkline(q.trend, q.change >= 0)}</div>
        <div class="stock-right">
          <p class="stock-price">${formatPrice(q.price, q.currency)}</p>
          <p class="stock-change ${direction}">${arrow} ${Math.abs(q.changePercent).toFixed(2)}%</p>
        </div>
      </div>
      ${buildRangeBar(q.price, q.weekLow52, q.weekHigh52, q.currency)}
      ${stockNewsHtml(q)}
    </div>
  `;
}

function buildWatchlistSection(quotes) {
  const starred = sortQuotes(quotes, false).filter((q) => !q.error && watchlist.includes(q.id));
  if (!starred.length) {
    return '<p class="watchlist-hint">☆ Tap the star on any stock to add it to your watchlist (up to 6). Starred stocks stay pinned here.</p>';
  }
  return `
    <section class="watchlist">
      <h3 class="watchlist-title">★ Your watchlist <span class="watchlist-count">${starred.length}/${WATCHLIST_MAX}</span></h3>
      <div class="stocks-list">${starred.map(buildStockCard).join("")}</div>
    </section>
  `;
}

const stocksCache = makeOfflineCache("hospitalityIntel.stocks");
let stocksRetryTimer = null;

function renderStocks(data, offlineSavedAt) {
  const list = document.getElementById("stocks-list");
  stocksOfflineSavedAt = offlineSavedAt || null;
  updateDashboard();

  const shown = sortQuotes(data.quotes);

  document.getElementById("stocks-count").innerHTML = formatMarketStatus(data);
  // The pulse describes the whole sector, so it ignores the category filter below.
  document.getElementById("stocks-pulse").innerHTML = buildPulse(data.quotes, data.market);
  document.getElementById("stocks-watchlist").innerHTML = buildWatchlistSection(data.quotes);

  const banner = offlineSavedAt ? offlineBanner(offlineSavedAt) : "";
  const allHeading = watchlist.length ? '<h3 class="watchlist-title">All stocks</h3>' : "";

  if (!shown.length) {
    list.innerHTML = banner + '<p class="error">No stocks match this filter.</p>';
  } else {
    list.innerHTML = banner + allHeading + shown.map(buildStockCard).join("");
  }

  renderCompareBar();

  document.querySelectorAll("#stocks .stock-card[data-stock-id]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("a.stock-news")) return; // the headline link opens the article, not the card
      activateStockCard(card.dataset.stockId);
    });
    card.addEventListener("keydown", (e) => {
      // Ignore keys pressed on the star button — those belong to the star, not the card.
      if (e.target !== card) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); // Space would otherwise also scroll the page
        activateStockCard(card.dataset.stockId);
      }
    });
  });
  document.querySelectorAll("#stocks .star-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // starring must not open the detail modal
      toggleWatchlist(btn.dataset.starId);
    });
  });
}

function stopStocksRetry() {
  if (stocksRetryTimer) {
    clearInterval(stocksRetryTimer);
    stocksRetryTimer = null;
  }
}

function scheduleStocksRetry() {
  if (stocksRetryTimer) return;
  stocksRetryTimer = setInterval(async () => {
    try {
      const res = await fetch("/api/stocks");
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      stopStocksRetry();
      currentStocksData = data;
      stocksCache.save(data);
      renderStocks(data);
    } catch (err) {
      /* still down — keep retrying */
    }
  }, 20000);
}

async function loadStocks(forceRefresh = false) {
  const list = document.getElementById("stocks-list");
  const btn = document.getElementById("stocks-refresh-btn");
  btn.disabled = true;

  const cached = stocksCache.load();
  if (!currentStocksData) {
    list.innerHTML = '<p class="loading">Loading stock prices…</p>';
  }

  try {
    const res = await fetch(`/api/stocks${forceRefresh ? "?refresh=1" : ""}`);
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    stopStocksRetry();
    currentStocksData = data;
    stocksFailed = false;
    stocksCache.save(data);
    renderStocks(data);
    stocksLoaded = true;
    refreshStockLinks();
  } catch (err) {
    if (cached) {
      currentStocksData = cached.data;
      renderStocks(cached.data, cached.savedAt);
      stocksLoaded = true;
      refreshStockLinks();
      scheduleStocksRetry();
    } else if (!currentStocksData) {
      list.innerHTML = '<p class="error">Failed to load stock prices. Check your connection and press Refresh.</p>';
      stocksFailed = true;
      updateDashboard();
    }
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("stocks-refresh-btn").addEventListener("click", () => loadStocks(true));

// Keep prices current while the Stocks tab is being looked at. The server only
// re-fetches from Yahoo when its own cache is stale (every ~10 min while NSE is
// trading, once after the close), so polling every 5 min here is cheap.
const STOCKS_POLL_MS = 5 * 60 * 1000;

// The News tab shows stock chips and the Dashboard a market snapshot, so they need reasonably fresh prices too.
function stocksTabIsActive() {
  return ["dashboard", "stocks", "news"].some((id) => document.getElementById(id).classList.contains("active"));
}

function stocksDataIsOld() {
  return !currentStocksData || Date.now() - new Date(currentStocksData.generatedAt).getTime() > STOCKS_POLL_MS;
}

setInterval(() => {
  if (!document.hidden && stocksLoaded && stocksTabIsActive()) loadStocks();
}, STOCKS_POLL_MS);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && stocksLoaded && stocksTabIsActive() && stocksDataIsOld()) loadStocks();
});

function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${parseInt(d, 10)}/${parseInt(m, 10)}`;
}

const CHART_W = 340;
const CHART_H = 190;
const CHART_LEFT = 46;
const CHART_RIGHT = 10;
const CHART_TOP = 14;
const CHART_BOTTOM = 30;

function chartGeometry(history) {
  const chartW = CHART_W - CHART_LEFT - CHART_RIGHT;
  const chartH = CHART_H - CHART_TOP - CHART_BOTTOM;
  const closes = history.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const xAt = (i) => CHART_LEFT + (i / (history.length - 1 || 1)) * chartW;
  const yAt = (close) => CHART_TOP + (1 - (close - min) / range) * chartH;
  return { chartW, chartH, min, max, range, xAt, yAt };
}

// A price label for the chart's left axis, with enough decimals that the five
// grid lines read differently: a ₹6 stock moving 20 paise needs "5.93", not "6".
function axisLabel(value, range) {
  return value.toFixed(range < 2 ? 2 : range < 20 ? 1 : 0);
}

const RANGE_LABELS = { "10d": "Last 10 trading days", "1m": "Last month", "3m": "Last 3 months", "1y": "Last year" };

// isUp reflects today's move (from the quote), not this chart's own start-vs-end
// trend — the line color should always match "is it up today," the same
// signal shown everywhere else (card badge, mini sparkline).
function buildChart(history, rangeKey, isUp) {
  if (!history.length) return { html: "" };
  const { chartW, chartH, min, max, range, xAt, yAt } = chartGeometry(history);

  const points = history.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.close).toFixed(1)}`);
  const stroke = isUp ? "#1b8a4a" : "#d1403a";

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = CHART_TOP + f * chartH;
      const value = max - f * range;
      return `
        <line x1="${CHART_LEFT}" y1="${y.toFixed(1)}" x2="${CHART_W - CHART_RIGHT}" y2="${y.toFixed(1)}" stroke="#f0e6c8" stroke-width="1" />
        <text x="${CHART_LEFT - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="chart-axis-label">${axisLabel(value, range)}</text>
      `;
    })
    .join("");

  // Thin out x-axis labels on longer ranges so they don't overlap.
  const labelStep = Math.max(1, Math.ceil(history.length / 8));
  const xLabels = history
    .map((p, i) =>
      i % labelStep === 0 || i === history.length - 1
        ? `<text x="${xAt(i).toFixed(1)}" y="${CHART_H - 10}" text-anchor="middle" class="chart-axis-label">${shortDate(p.date)}</text>`
        : ""
    )
    .join("");

  const areaPoints = `${CHART_LEFT},${CHART_TOP + chartH} ${points.join(" ")} ${CHART_W - CHART_RIGHT},${CHART_TOP + chartH}`;

  const svg = `
    <svg viewBox="0 0 ${CHART_W} ${CHART_H}" class="stock-chart" id="stock-chart-svg">
      ${gridLines}
      <polygon points="${areaPoints}" fill="${stroke}" opacity="0.08" />
      <polyline points="${points.join(" ")}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${xLabels}
      <line id="crosshair-line" x1="0" y1="${CHART_TOP}" x2="0" y2="${CHART_TOP + chartH}" stroke="#8a8368" stroke-width="1" stroke-dasharray="3,3" visibility="hidden" />
      <circle id="crosshair-dot" r="4" fill="${stroke}" stroke="#fff" stroke-width="1.5" visibility="hidden" />
      <rect id="chart-hover-target" x="0" y="0" width="${CHART_W}" height="${CHART_H}" fill="transparent" />
    </svg>
    <div class="chart-tooltip" id="chart-tooltip" hidden></div>
  `;

  return {
    html: `
      <p class="chart-period-label">${RANGE_LABELS[rangeKey] || "Price history"}</p>
      <div class="chart-svg-wrap">${svg}</div>
    `,
  };
}

// Mimics Google Finance's hover behavior: a crosshair + tooltip follow the
// pointer and snap to the nearest day's close price.
function attachChartHover(wrapEl, history, currency) {
  const svgEl = wrapEl.querySelector("#stock-chart-svg");
  const hoverTarget = wrapEl.querySelector("#chart-hover-target");
  const crossLine = wrapEl.querySelector("#crosshair-line");
  const crossDot = wrapEl.querySelector("#crosshair-dot");
  const tooltip = wrapEl.querySelector("#chart-tooltip");
  if (!svgEl || !hoverTarget) return;

  const { xAt, yAt } = chartGeometry(history);

  function update(clientX) {
    const rect = svgEl.getBoundingClientRect();
    const svgX = (clientX - rect.left) * (CHART_W / rect.width);

    let nearest = 0;
    let best = Infinity;
    history.forEach((p, i) => {
      const d = Math.abs(xAt(i) - svgX);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });

    const p = history[nearest];
    const x = xAt(nearest);
    const y = yAt(p.close);

    crossLine.setAttribute("x1", x);
    crossLine.setAttribute("x2", x);
    crossLine.setAttribute("visibility", "visible");
    crossDot.setAttribute("cx", x);
    crossDot.setAttribute("cy", y);
    crossDot.setAttribute("visibility", "visible");

    const scaleX = rect.width / CHART_W;
    const scaleY = rect.height / CHART_H;
    tooltip.hidden = false;
    tooltip.textContent = `${p.date} · ${CURRENCY_SYMBOLS[currency] || ""}${p.close.toFixed(2)}`;
    const tooltipWidth = tooltip.offsetWidth || 90;
    const left = Math.min(Math.max(x * scaleX - tooltipWidth / 2, 0), rect.width - tooltipWidth);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(y * scaleY - 34, 0)}px`;
  }

  function hide() {
    crossLine.setAttribute("visibility", "hidden");
    crossDot.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  }

  hoverTarget.addEventListener("mousemove", (e) => update(e.clientX));
  hoverTarget.addEventListener("mouseleave", hide);
  hoverTarget.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches[0]) {
        update(e.touches[0].clientX);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  hoverTarget.addEventListener("touchend", hide);
}

function citationLine(n) {
  return `${escapeHtml(n.publisher || "Unknown source")}${n.publishedAt ? " · " + new Date(n.publishedAt).toLocaleString("en-IN", UPDATED_FORMAT) : ""}`;
}

const DETAIL_RANGES = [
  { key: "10d", label: "10D" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "1y", label: "1Y" },
];

let currentDetailId = null;
let currentDetailRange = "10d";

function renderStockDetail(data) {
  const body = document.getElementById("modal-body");
  const quote = currentStocksData ? currentStocksData.quotes.find((q) => q.id === data.id) : null;
  const isUp = quote ? quote.change >= 0 : true;
  const direction = quote ? moveClass(quote.change) : "flat";
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";
  // "today" is only true while that stock's exchange is trading.
  const market = currentStocksData && currentStocksData.market;
  const when = quote && quote.currency === "INR" && market && market.open ? "today" : "at the last close";

  const priceHeader = quote
    ? `
      <div class="modal-price-block">
        <p class="modal-price">${formatPrice(quote.price, quote.currency)}</p>
        <p class="stock-change ${direction}">${arrow} ${Math.abs(quote.changePercent).toFixed(2)}% ${when}</p>
      </div>
    `
    : "";

  const chart = data.history.length
    ? buildChart(data.history, data.range, isUp).html
    : '<p class="error">No price history available.</p>';

  const rangeButtons = DETAIL_RANGES.map(
    (r) => `<button class="range-btn ${r.key === data.range ? "active" : ""}" data-range="${r.key}">${r.label}</button>`
  ).join("");

  const relatedNews = data.relatedNews.length
    ? `
      <p class="modal-section-label">Brand headlines</p>
      <ul class="headline-list">
        ${data.relatedNews
          .map(
            (n) => `
          <li>
            <a href="${safeUrl(n.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.title)}</a>
            <span class="headline-meta">Source: ${citationLine(n)}</span>
          </li>`
          )
          .join("")}
      </ul>
    `
    : '<p class="modal-section-label">No related headlines found right now.</p>';

  body.innerHTML = `
    <h2 class="modal-title">${escapeHtml(data.name)}</h2>
    <p class="modal-symbol">${escapeHtml(data.symbol)}</p>
    ${priceHeader}
    <div class="range-toggle" id="range-toggle">${rangeButtons}</div>
    <div class="chart-wrap" id="chart-wrap">${chart}</div>
    ${relatedNews}
  `;

  if (data.history.length) {
    attachChartHover(document.getElementById("chart-wrap"), data.history, quote ? quote.currency : null);
  }

  document.querySelectorAll("#range-toggle .range-btn").forEach((btn) => {
    btn.addEventListener("click", () => openStockDetail(currentDetailId, btn.dataset.range));
  });
}

async function openStockDetail(id, range = "10d") {
  const modal = document.getElementById("stock-modal");
  const body = document.getElementById("modal-body");
  currentDetailId = id;
  currentDetailRange = range;
  showModal();
  body.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch(`/api/stocks/${id}/detail?range=${range}`);
    if (!res.ok) throw new Error("request failed");
    const data = await res.json();
    renderStockDetail(data);
  } catch (err) {
    body.innerHTML = '<p class="error">Failed to load stock detail.</p>';
  }
}

// The popup behaves as a dialog for keyboard and screen-reader users: focus moves
// into it when it opens, Tab stays inside it, and closing it returns focus to
// whatever opened it.
let modalOpener = null;

function showModal() {
  const modal = document.getElementById("stock-modal");
  if (modal.classList.contains("hidden")) modalOpener = document.activeElement;
  modal.classList.remove("hidden");
  document.getElementById("modal-close").focus();
}

function closeStockDetail() {
  const modal = document.getElementById("stock-modal");
  if (modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
}

document.getElementById("stock-modal").addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusable = [...e.currentTarget.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.getElementById("modal-close").addEventListener("click", closeStockDetail);
document.getElementById("stock-modal").addEventListener("click", (e) => {
  if (e.target.id === "stock-modal") closeStockDetail();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeStockDetail();
});

// ---------- news <-> stocks ----------

// A headline is only ever shown *next to* a price move. Nothing here claims one
// caused the other — the wording stays "Latest news", never "why it moved".

let currentHeadlines = {}; // stock id -> { title, publisher, link, publishedAt }
let stocksOfflineSavedAt = null; // set while the stock list is showing saved (offline) data
let headlinesLoading = false;

async function loadHeadlines() {
  if (headlinesLoading) return;
  headlinesLoading = true;
  try {
    const res = await fetch("/api/stocks/headlines");
    if (!res.ok) throw new Error("bad response");
    const { headlines } = await res.json();
    if (JSON.stringify(headlines) !== JSON.stringify(currentHeadlines)) {
      currentHeadlines = headlines;
      if (currentStocksData) renderStocks(currentStocksData, stocksOfflineSavedAt);
    }
  } catch (err) {
    /* headlines are an extra — without them the cards simply show none */
  } finally {
    headlinesLoading = false;
  }
}

function stockNewsHtml(q) {
  const headline = currentHeadlines[q.id];
  if (!headline) return "";
  const meta = [headline.publisher, timeAgo(headline.publishedAt)].filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <a class="stock-news" href="${safeUrl(headline.link)}" target="_blank" rel="noopener noreferrer">
      <span class="stock-news-label">Latest news</span>
      <span class="stock-news-title">${escapeHtml(headline.title)}</span>
      ${meta ? `<span class="stock-news-meta">${meta}</span>` : ""}
    </a>
  `;
}

// The News tab tags a story with the listed company it mentions and that
// company's latest move. Matching is whole-word on the company's keywords, after
// removing look-alike phrases ("Taj Mahal" the monument is not "Taj" the hotel
// brand). Same logic as lib/companyMatch.js on the server; keep the two in step.
function stockMatchers() {
  if (!currentStocksData) return [];
  return currentStocksData.quotes
    .filter((q) => !q.error && q.matchKeywords && q.matchKeywords.length)
    .map((q) => ({
      q,
      re: new RegExp(`\\b(?:${q.matchKeywords.map(escapeRegExp).join("|")})\\b`, "i"),
      // Keywords that only count with their capitals: "Indian Hotels" the company, not "Indian hotels".
      exactRe: (q.exactCaseKeywords || []).length ? new RegExp(`\\b(?:${q.exactCaseKeywords.map(escapeRegExp).join("|")})\\b`) : null,
      excludes: (q.excludePatterns || []).map((source) => new RegExp(source, "gi")),
    }));
}

function matcherHits(matcher, text) {
  const cleaned = matcher.excludes.reduce((t, ex) => t.replace(ex, " "), text);
  return matcher.re.test(cleaned) || Boolean(matcher.exactRe && matcher.exactRe.test(cleaned));
}

function stockChipHtml(item, matchers) {
  const match =
    matchers.find((m) => matcherHits(m, item.title)) || matchers.find((m) => item.snippet && matcherHits(m, item.snippet));
  if (!match) return "";
  const { q } = match;
  const direction = moveClass(q.change);
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";
  const when = currentStocksData.market && currentStocksData.market.open ? "latest price" : "last close";
  const tip = `${q.name}: ${signedPercent(q.changePercent)} at ${when}. Shown for context — this story may not be why it moved.`;
  return `<span class="stock-chip ${direction}" title="${escapeHtml(tip)}">${escapeHtml(shortName(q.name))} ${arrow} ${Math.abs(q.changePercent).toFixed(2)}%</span>`;
}

// ---------- stock list tools: compare ----------

const COMPARE_MAX = 3;
const COMPARE_COLORS = ["#2563eb", "#ea580c", "#0f766e"]; // blue / orange / teal — no red or green, which mean down/up here
const COMPARE_RANGES = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "1y", label: "1Y" },
];

let compareMode = false;
let compareIds = [];

function setCompareMode(on) {
  compareMode = on;
  if (!on) compareIds = [];
  const btn = document.getElementById("compare-btn");
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", String(on));
  if (currentStocksData) renderStocks(currentStocksData, stocksOfflineSavedAt);
}

document.getElementById("compare-btn").addEventListener("click", () => setCompareMode(!compareMode));

function toggleCompareSelection(id) {
  if (compareIds.includes(id)) {
    compareIds = compareIds.filter((c) => c !== id);
  } else if (compareIds.length >= COMPARE_MAX) {
    showStocksMessage(`You can compare up to ${COMPARE_MAX} stocks. Deselect one first.`);
    return;
  } else {
    compareIds = [...compareIds, id];
  }
  if (currentStocksData) renderStocks(currentStocksData, stocksOfflineSavedAt);
}

function activateStockCard(id) {
  if (compareMode) toggleCompareSelection(id);
  else openStockDetail(id);
}

function renderCompareBar() {
  const bar = document.getElementById("compare-bar");
  bar.hidden = !compareMode;
  document.getElementById("stocks").classList.toggle("compare-mode", compareMode);
  if (!compareMode) {
    bar.innerHTML = "";
    return;
  }
  const names = compareIds
    .map((id) => currentStocksData && currentStocksData.quotes.find((q) => q.id === id))
    .filter(Boolean)
    .map((q) => `<b>${escapeHtml(shortName(q.name))}</b>`);
  const hint = names.length
    ? `Comparing ${names.join(", ")}${names.length < 2 ? " — pick at least one more" : ""}`
    : "Tap 2–3 stocks below to compare how they've performed.";
  bar.innerHTML = `
    <p class="compare-hint">${hint}</p>
    <div class="compare-actions">
      <button type="button" class="sort-btn active" id="compare-go" ${compareIds.length < 2 ? "disabled" : ""}>Show comparison</button>
      <button type="button" class="sort-btn" id="compare-clear">Clear</button>
    </div>
  `;
  document.getElementById("compare-go").addEventListener("click", () => openComparison());
  document.getElementById("compare-clear").addEventListener("click", () => {
    compareIds = [];
    if (currentStocksData) renderStocks(currentStocksData, stocksOfflineSavedAt);
  });
}

// ---------- comparison chart ----------

let currentCompareRange = "3m";

function compareGeometry(cmp) {
  const chartW = CHART_W - CHART_LEFT - CHART_RIGHT;
  const chartH = CHART_H - CHART_TOP - CHART_BOTTOM;
  const all = cmp.series.flatMap((s) => s.values).concat(100);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const range = max - min;
  const last = cmp.dates.length - 1 || 1;
  const xAt = (i) => CHART_LEFT + (i / last) * chartW;
  const yAt = (v) => CHART_TOP + (1 - (v - min) / range) * chartH;
  return { chartH, min, max, range, xAt, yAt };
}

function buildCompareChart(cmp) {
  const { chartH, min, max, range, xAt, yAt } = compareGeometry(cmp);

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = CHART_TOP + f * chartH;
      const value = max - f * range;
      return `
        <line x1="${CHART_LEFT}" y1="${y.toFixed(1)}" x2="${CHART_W - CHART_RIGHT}" y2="${y.toFixed(1)}" stroke="#f0e6c8" stroke-width="1" />
        <text x="${CHART_LEFT - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="chart-axis-label">${value.toFixed(0)}</text>
      `;
    })
    .join("");

  // Every line starts at 100, so 100 is the "no change" baseline.
  const baselineY = yAt(100).toFixed(1);
  const baseline = `<line x1="${CHART_LEFT}" y1="${baselineY}" x2="${CHART_W - CHART_RIGHT}" y2="${baselineY}" stroke="#8a8368" stroke-width="1" stroke-dasharray="4,3" />`;

  const labelStep = Math.max(1, Math.ceil(cmp.dates.length / 8));
  const xLabels = cmp.dates
    .map((d, i) =>
      i % labelStep === 0 || i === cmp.dates.length - 1
        ? `<text x="${xAt(i).toFixed(1)}" y="${CHART_H - 10}" text-anchor="middle" class="chart-axis-label">${shortDate(d)}</text>`
        : ""
    )
    .join("");

  const lines = cmp.series
    .map((s, k) => {
      const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${COMPARE_COLORS[k]}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" />`;
    })
    .join("");

  const dots = cmp.series
    .map((s, k) => `<circle class="compare-dot" data-series="${k}" r="4" fill="${COMPARE_COLORS[k]}" stroke="#fff" stroke-width="1.5" visibility="hidden" />`)
    .join("");

  return `
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" class="stock-chart" id="compare-chart-svg">
        ${gridLines}
        ${baseline}
        ${lines}
        ${xLabels}
        <line id="compare-crosshair" x1="0" y1="${CHART_TOP}" x2="0" y2="${CHART_TOP + chartH}" stroke="#8a8368" stroke-width="1" stroke-dasharray="3,3" visibility="hidden" />
        ${dots}
        <rect id="compare-hover-target" x="0" y="0" width="${CHART_W}" height="${CHART_H}" fill="transparent" />
      </svg>
      <div class="chart-tooltip compare-tooltip" id="compare-tooltip" hidden></div>
    </div>
  `;
}

function attachCompareHover(wrapEl, cmp) {
  const svgEl = wrapEl.querySelector("#compare-chart-svg");
  const target = wrapEl.querySelector("#compare-hover-target");
  const crosshair = wrapEl.querySelector("#compare-crosshair");
  const dots = wrapEl.querySelectorAll(".compare-dot");
  const tooltip = wrapEl.querySelector("#compare-tooltip");
  if (!svgEl || !target) return;

  const { xAt, yAt } = compareGeometry(cmp);

  function update(clientX) {
    const rect = svgEl.getBoundingClientRect();
    const svgX = (clientX - rect.left) * (CHART_W / rect.width);
    let nearest = 0;
    let best = Infinity;
    cmp.dates.forEach((d, i) => {
      const dist = Math.abs(xAt(i) - svgX);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    });

    const x = xAt(nearest);
    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.setAttribute("visibility", "visible");
    dots.forEach((dot) => {
      const s = cmp.series[Number(dot.dataset.series)];
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", yAt(s.values[nearest]));
      dot.setAttribute("visibility", "visible");
    });

    tooltip.hidden = false;
    tooltip.innerHTML =
      `<div class="compare-tip-date">${cmp.dates[nearest]}</div>` +
      cmp.series
        .map((s, k) => `<div><span class="legend-dot" style="background:${COMPARE_COLORS[k]}"></span>${escapeHtml(shortName(s.name))} <b>${s.values[nearest].toFixed(1)}</b></div>`)
        .join("");
    const scaleX = rect.width / CHART_W;
    const tooltipWidth = tooltip.offsetWidth || 120;
    tooltip.style.left = `${Math.min(Math.max(x * scaleX - tooltipWidth / 2, 0), rect.width - tooltipWidth)}px`;
    tooltip.style.top = "2px";
  }

  function hide() {
    crosshair.setAttribute("visibility", "hidden");
    dots.forEach((dot) => dot.setAttribute("visibility", "hidden"));
    tooltip.hidden = true;
  }

  target.addEventListener("mousemove", (e) => update(e.clientX));
  target.addEventListener("mouseleave", hide);
  target.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches[0]) {
        update(e.touches[0].clientX);
        e.preventDefault();
      }
    },
    { passive: false }
  );
  target.addEventListener("touchend", hide);
}

function renderComparison(cmp) {
  const body = document.getElementById("modal-body");
  const rangeButtons = COMPARE_RANGES.map(
    (r) => `<button class="range-btn ${r.key === cmp.range ? "active" : ""}" data-range="${r.key}">${r.label}</button>`
  ).join("");
  const legend = cmp.series
    .map(
      (s, k) => `
      <li>
        <span class="legend-dot" style="background:${COMPARE_COLORS[k]}"></span>
        <span class="legend-name">${escapeHtml(s.name)}</span>
        <b class="stock-change ${moveClass(s.changePercent)}">${signedPercent(s.changePercent)}</b>
      </li>`
    )
    .join("");

  body.innerHTML = `
    <h2 class="modal-title">Compare stocks</h2>
    <p class="modal-symbol">Every line starts at 100, so you're comparing relative performance — not share price.</p>
    <div class="range-toggle" id="compare-range-toggle">${rangeButtons}</div>
    <p class="chart-period-label">${RANGE_LABELS[cmp.range] || ""} · ${cmp.dates[0]} to ${cmp.dates[cmp.dates.length - 1]}</p>
    <div class="chart-wrap" id="compare-chart-wrap">${buildCompareChart(cmp)}</div>
    <ul class="compare-legend">${legend}</ul>
    <p class="compare-note">Change over the period shown. Past performance says nothing about the future.</p>
  `;

  attachCompareHover(document.getElementById("compare-chart-wrap"), cmp);
  document.querySelectorAll("#compare-range-toggle .range-btn").forEach((btn) => {
    btn.addEventListener("click", () => openComparison(btn.dataset.range));
  });
}

async function openComparison(range = currentCompareRange) {
  if (compareIds.length < 2) return;
  const modal = document.getElementById("stock-modal");
  const body = document.getElementById("modal-body");
  currentCompareRange = range;
  showModal();
  body.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch(`/api/stocks/compare?ids=${encodeURIComponent(compareIds.join(","))}&range=${range}`);
    if (!res.ok) throw new Error("request failed");
    renderComparison(await res.json());
  } catch (err) {
    body.innerHTML = '<p class="error">Failed to load the comparison.</p>';
  }
}

// After stock prices load: fetch headlines for the big movers and re-tag the
// news cards (their ▲/▼ chips depend on the latest prices).
function refreshStockLinks() {
  loadHeadlines();
  if (currentNewsData) renderNews(currentNewsData);
}

// Stock data is needed by the News tab too (for the ▲/▼ chips), so load it at
// startup rather than waiting for a click on the Stocks tab.
loadStocks();

// Open the tab named in the address (a reload, or a link such as "…/#events").
showTab(tabFromAddress());
