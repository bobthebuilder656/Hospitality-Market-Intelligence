// Dashboard tab (the landing page): a four-card summary of the other tabs.
// It fetches nothing itself except the saved city; every card reads the data the
// other tabs already hold (currentNewsData, currentStocksData, eventsData, resData)
// and each tab calls updateDashboard() when its data changes.
//
// Two states, card by card: with a saved city the City snapshot shows that city,
// and with a watchlist the Market snapshot shows those stocks. Without them the
// cards show the all-India view and a prompt to choose.

const DASH_CITY_KEY = "hospitalityIntel.city";
const DASH_HEADLINES = 3;
const DASH_DATES = 2;
const DASH_WATCHLIST_ROWS = 3;
const DASH_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DASH_CATEGORIES = { holiday: "Public holiday", festival: "Festival", expo: "Expo", conference: "Conference", sports: "Sports", culture: "Culture" };
// A headline counts as a hotel story if its title uses one of these words or names a listed hotel company.
const DASH_HOTEL_WORDS = /\b(hotels?|resorts?|hospitality|occupancy|revpar|room rates?|rooms|keys)\b/i;

const dashPanel = document.getElementById("dashboard");

function loadDashCity() {
  try {
    return localStorage.getItem(DASH_CITY_KEY) || "";
  } catch (err) {
    return "";
  }
}

function saveDashCity(id) {
  try {
    if (id) localStorage.setItem(DASH_CITY_KEY, id);
    else localStorage.removeItem(DASH_CITY_KEY);
  } catch (err) {
    /* localStorage unavailable (private browsing, etc.) — the choice still works for this visit */
  }
}

let dashCity = loadDashCity();

// The saved city, once the city list has loaded (null = all India).
const dashCityEntry = () => (eventsData && dashCity ? cityById(dashCity) || null : null);

function dashCard(label, moreTab, moreLabel, body) {
  // "City events →" opens the tab on the dashboard's city, like the event rows do.
  const target = moreTab === "events" ? "data-dash-events" : `data-dash-tab="${moreTab}"`;
  return `
    <section class="dash-card">
      <div class="dash-card-head">
        <h3 class="dash-label">${label}</h3>
        <button class="dash-more" ${target}>${moreLabel} →</button>
      </div>
      ${body}
    </section>`;
}

// A card whose data has not arrived: still loading, or the load failed.
const dashLoading = (what, failed) =>
  failed ? `<p class="dash-empty">Could not load ${what}. Check your connection and reload the page.</p>` : `<p class="dash-empty">Loading ${what}…</p>`;

function dashCitySelect(placeholder) {
  const cities = eventsData ? eventsData.cities : [];
  const options = cities.map((c) => `<option value="${c.id}"${c.id === dashCity ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
  return `<select class="dash-city-select" aria-label="Your city"${cities.length ? "" : " disabled"}><option value="">${placeholder}</option>${options}</select>`;
}

// ---- header ---------------------------------------------------------------------

function dashHeader() {
  const today = (eventsData && eventsData.today) || (resData && resData.today) || new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const d = evDate(today);
  const date = `${DASH_DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${EV_MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const starred = currentStocksData ? currentStocksData.quotes.filter((q) => !q.error && watchlist.includes(q.id)).length : watchlist.length;
  return `
    <div class="dash-head">
      <h2 class="dash-date">${date}</h2>
      <div class="dash-prefs">
        <label class="dash-pref"><span>City</span>${dashCitySelect("All India")}</label>
        <button class="dash-pref" data-dash-tab="stocks"><span>Watchlist</span>${starred ? `${starred} stock${starred === 1 ? "" : "s"}` : "Not set"}</button>
      </div>
    </div>`;
}

// ---- top headlines ----------------------------------------------------------------

// India hotel stories first, then other India stories, then international ones; newest first within each.
function dashTopStories() {
  const hotelCompanies = stockMatchers().filter((m) => m.q.category === "hotel");
  const rank = (item) => {
    const aboutHotels = DASH_HOTEL_WORDS.test(item.title) || hotelCompanies.some((m) => matcherHits(m, item.title));
    return (item.region === "India" ? 0 : 2) + (aboutHotels ? 0 : 1);
  };
  const ranked = currentNewsData.items
    .map((item) => ({ item, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || new Date(b.item.pubDate) - new Date(a.item.pubDate))
    .map((r) => r.item);
  // Two sources often cover the same announcement; keep only the first.
  const picked = [];
  for (const item of ranked) {
    if (picked.length === DASH_HEADLINES) break;
    if (!picked.some((p) => dashSameStory(p.title, item.title))) picked.push(item);
  }
  return picked;
}

// Whether two headlines are the same story from two outlets: every distinctive
// word of one appears in the other. Same logic as lib/sameStory.js on the
// server (explained there); keep the two in step.
const DASH_SMALL_WORDS = new Set(["the", "and", "for", "with", "its", "his", "her", "from", "into", "that", "this", "has", "have", "are", "was", "will", "new", "says", "said", "over", "after", "amid"]);

function dashStoryWords(title) {
  const words = title.toLowerCase().replace(/(\d)[,.](?=\d)/g, "$1").match(/[a-z0-9]+/g) || [];
  return new Set(
    words
      .filter((w) => (/\d/.test(w) ? true : w.length >= 3 && !DASH_SMALL_WORDS.has(w)))
      .map((w) => (/\d/.test(w) ? w : w.slice(0, 4)))
  );
}

function dashSameStory(a, b) {
  const [small, large] = [dashStoryWords(a), dashStoryWords(b)].sort((x, y) => x.size - y.size);
  if (small.size < 3) return [...small].join(" ") === [...large].join(" ") && small.size > 0;
  return [...small].every((w) => large.has(w));
}

function dashHeadlines() {
  if (!currentNewsData) return dashLoading("news", newsFailed);
  const stories = dashTopStories();
  if (!stories.length) return `<p class="dash-empty">No stories available right now.</p>`;
  return stories
    .map((item) => {
      const india = item.region === "India";
      return `
      <a class="dash-row" href="${safeUrl(item.link)}" target="_blank" rel="noopener noreferrer">
        <span class="dash-row-title">${escapeHtml(item.title)}</span>
        <span class="dash-row-meta"><span class="region-badge ${india ? "india" : "global"}">${india ? "India" : "International"}</span>${escapeHtml(item.source)} · ${timeAgo(item.pubDate)}</span>
      </a>`;
    })
    .join("");
}

// ---- market snapshot --------------------------------------------------------------

function dashStockRow(q, middle) {
  const direction = moveClass(q.change);
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";
  return `
    <button class="dash-row dash-row-split" data-dash-stock="${q.id}">
      <b>${escapeHtml(shortName(q.name))}</b>
      <span class="dash-row-side">${middle}</span>
      <span class="dash-move ${direction}">${arrow} ${Math.abs(q.changePercent).toFixed(2)}%</span>
    </button>`;
}

function dashMarket() {
  const data = currentStocksData;
  if (!data) return dashLoading("stock prices", stocksFailed);
  const ok = data.quotes.filter((q) => !q.error);
  if (!ok.length) return `<p class="dash-empty">Stock prices are unavailable right now.</p>`;

  const up = ok.filter((q) => q.change > 0).length;
  const down = ok.filter((q) => q.change < 0).length;
  const flat = ok.length - up - down;
  const share = (n) => `${((n / ok.length) * 100).toFixed(1)}%`;
  const status =
    data.market && !data.market.open
      ? `last close, ${new Date(data.market.lastCloseAt).toLocaleDateString("en-IN", MARKET_DAY_FORMAT)}`
      : "today";

  const mine = watchlist.map((id) => ok.find((q) => q.id === id)).filter(Boolean);

  // Same sector averages as the pulse bar on the Stock Prices tab.
  const sectors = [
    ["hotel", "Hotel chains"],
    ["restaurant", "Restaurant brands"],
    ["ota", "Online travel"],
  ]
    .map(([category, label]) => {
      const group = ok.filter((q) => q.category === category);
      if (!group.length) return "";
      const avg = group.reduce((sum, q) => sum + q.changePercent, 0) / group.length;
      return `<button data-dash-sector="${category}">${label} <b class="dash-move ${moveClass(avg)}">${signedPercent(avg)}</b></button>`;
    })
    .join("");

  const byChange = [...ok].sort((a, b) => b.changePercent - a.changePercent);
  const gainer = byChange[0];
  const loser = byChange[byChange.length - 1];
  const movers = [gainer.changePercent > 0 ? dashStockRow(gainer, "Top gainer") : "", loser.changePercent < 0 ? dashStockRow(loser, "Top loser") : ""].join("");

  const more = mine.length > DASH_WATCHLIST_ROWS ? `<button class="dash-more dash-more-inline" data-dash-tab="stocks">+${mine.length - DASH_WATCHLIST_ROWS} more →</button>` : "";
  const personal = mine.length
    ? `
      <div class="dash-sub"><h4 class="dash-label">Your watchlist</h4>${more}</div>
      ${mine.slice(0, DASH_WATCHLIST_ROWS).map((q) => dashStockRow(q, formatPrice(q.price, q.currency))).join("")}`
    : `
      <div class="dash-nudge"><span>Track the stocks you follow.</span><button data-dash-tab="stocks">Build a watchlist</button></div>`;

  return `
    <p class="dash-lead"><b class="dash-move up">${up} up</b> · <b class="dash-move down">${down} down</b>${flat ? ` · <b class="dash-move flat">${flat} flat</b>` : ""} <span>of ${ok.length} tracked stocks, ${status}</span></p>
    <div class="dash-breadth"><i class="up" style="width:${share(up)}"></i><i class="flat" style="width:${share(flat)}"></i><i class="down" style="width:${share(down)}"></i></div>
    ${mine.length ? "" : `<p class="dash-sectors">${sectors}<span class="dash-sectors-note">(average change)</span></p>`}
    ${movers}
    ${personal}`;
}

// ---- city snapshot ----------------------------------------------------------------

function dashEventRow(e, withCity) {
  const bits = [
    e.longWeekend
      ? e.longWeekend.bridgeDay
        ? `${e.longWeekend.length}-day break if ${evDow(e.longWeekend.bridgeDay)} ${evFmt(e.longWeekend.bridgeDay)} is taken off, ${evRange(e.longWeekend.start, e.longWeekend.end)}`
        : `Long weekend, ${evRange(e.longWeekend.start, e.longWeekend.end)}`
      : DASH_CATEGORIES[e.category] || "",
    withCity ? citiesLabel(e) : "",
    countdown(e.start, e.end),
  ].filter(Boolean);
  return `
    <button class="dash-row dash-row-dated" data-dash-events>
      <span class="dash-row-date">${evRange(e.start, e.end)}</span>
      <span>
        <span class="dash-row-title">${escapeHtml(e.name)}</span>
        <span class="dash-row-meta">${bits.map(escapeHtml).join(" · ")}</span>
      </span>
    </button>`;
}

// One line for the chosen city: today's weather and the latest air passenger change.
function dashCityLead(city) {
  const w = eventsWeather[city.id];
  if (w === undefined && !weatherRequested.has(city.id)) loadWeather(city.id);
  const day = w && (w.days.find((d) => d.date === eventsData.today) || w.days[0]);
  const weather = day ? `${day.icon} ${day.max}° / ${day.min}°` : "";
  const air = airData && airLatest().cities[city.id];
  const airBit = air ? `<span>Air passengers ${airChange(air.change)} year on year (${airMonthName(airLatest().month)})</span>` : "";
  if (!weather && !airBit) return "";
  return `<button class="dash-lead dash-lead-link" data-dash-events>${weather}${weather && airBit ? " <span>·</span> " : ""}${airBit}</button>`;
}

function dashCitySnapshot() {
  if (!eventsData) return dashLoading("city events", eventsFailed);
  const city = dashCityEntry();
  const today = eventsData.today;
  const allCities = eventsData.cities.length;
  const upcoming = eventsData.events.filter((e) => e.end >= today && (!city || e.cities.includes(city.id)));

  // Same rule as the "Next big event" card on the City Events tab: the next business,
  // sports or culture event, or a festival specific to a few cities.
  const big = upcoming.find((e) => e.category !== "holiday" && (e.category !== "festival" || e.cities.length < allCities));
  // Holidays and festivals. Without a city, only the national ones.
  const dates = upcoming
    .filter((e) => EV_TYPES[e.category] === "festive" && e !== big && (city || e.cities.length === allCities))
    .slice(0, DASH_DATES);

  return `
    ${city ? dashCityLead(city) : ""}
    <div class="dash-sub"><h4 class="dash-label">Next ${DASH_DATES} dates</h4></div>
    ${dates.length ? dates.map((e) => dashEventRow(e, false)).join("") : `<p class="dash-empty">No holidays or festivals in the next 6 months.</p>`}
    <div class="dash-sub"><h4 class="dash-label">Next big event</h4></div>
    ${big ? dashEventRow(big, !city) : `<p class="dash-empty">Nothing on the calendar yet.</p>`}
    ${city ? "" : `<div class="dash-nudge"><span>See local events, weather and air traffic.</span>${dashCitySelect("Choose your city")}</div>`}`;
}

// ---- resources --------------------------------------------------------------------

function dashRead(view, label, item, pending) {
  if (!item) return `<div class="dash-row dash-row-pending"><span class="dash-row-meta">${label}</span><span class="dash-row-title">${pending}</span></div>`;
  const when = item.publishDate === resData.today ? "New today" : resDate(item.publishDate);
  return `
    <button class="dash-row" data-dash-res="${view}">
      <span class="dash-row-meta">${label} · ${when}</span>
      <span class="dash-row-title">${escapeHtml(item.title)}</span>
    </button>`;
}

function dashResources() {
  if (!resData) return dashLoading("resources", resFailed);
  const term = todaysTerm();
  const termRow = term
    ? `
    <button class="dash-row" data-dash-res="glossary">
      <span class="dash-row-meta">💡 Term of the day</span>
      <span class="dash-row-title">${escapeHtml(term.term)}</span>
      <span class="dash-row-meta">${escapeHtml(term.short || "")}</span>
    </button>`
    : "";
  return `
    ${termRow}
    ${dashRead("brief", "📰 The Hotelier's Brief", resData.brief, resData.nextBriefDate ? `First article publishes ${resDate(resData.nextBriefDate)}` : "No article scheduled yet")}
    ${dashRead("case", "🔍 Case study", resData.caseStudy, resData.nextCaseDate ? `First case study publishes ${resDate(resData.nextCaseDate)}` : "No case study scheduled yet")}`;
}

// ---- page -------------------------------------------------------------------------

function renderDashboard() {
  const city = dashCityEntry();
  // Same notice as the News and Stock Prices tabs when the server cannot be reached.
  const savedAt = [newsOfflineSavedAt, stocksOfflineSavedAt].filter(Boolean);
  document.getElementById("dash-content").innerHTML = `
    ${dashHeader()}
    ${savedAt.length ? offlineBanner(Math.min(...savedAt)) : ""}
    <div class="dash-grid">
      ${dashCard("Top headlines", "news", "All news", dashHeadlines())}
      ${dashCard("Market snapshot", "stocks", "All stocks", dashMarket())}
      ${dashCard(`City snapshot: ${city ? escapeHtml(city.name) : "All India"}`, "events", "City events", dashCitySnapshot())}
      ${dashCard("Resources", "resources", "All resources", dashResources())}
    </div>`;
}

function dashOpenTab(id) {
  document.querySelector(`.tab[data-tab="${id}"]`).click();
  window.scrollTo({ top: 0 });
}

dashPanel.addEventListener("click", (e) => {
  const stock = e.target.closest("[data-dash-stock]");
  if (stock) return openStockDetail(stock.dataset.dashStock);

  const sector = e.target.closest("[data-dash-sector]");
  if (sector) {
    document.querySelector(`#stock-category-controls [data-category="${sector.dataset.dashSector}"]`).click();
    return dashOpenTab("stocks");
  }

  // Event rows open City Events on the dashboard's city.
  if (e.target.closest("[data-dash-events]")) {
    eventsState.city = dashCityEntry() ? dashCity : "all";
    renderEvents();
    return dashOpenTab("events");
  }

  const res = e.target.closest("[data-dash-res]");
  if (res) {
    dashOpenTab("resources");
    return openView(res.dataset.dashRes);
  }

  const tab = e.target.closest("[data-dash-tab]");
  if (tab) dashOpenTab(tab.dataset.dashTab);
});

dashPanel.addEventListener("change", (e) => {
  if (!e.target.classList.contains("dash-city-select")) return;
  dashCity = e.target.value;
  saveDashCity(dashCity);
  renderDashboard();
});

// Coming back to the tab refreshes the "3h ago" and countdown wording.
document.querySelector('.tab[data-tab="dashboard"]').addEventListener("click", renderDashboard);

// News and stocks load at startup (app.js); the dashboard also needs events and resources.
renderDashboard();
if (!eventsData) loadEvents();
if (!resData) loadResources();
