// City Events tab: holidays, long weekends, big events and wedding dates in
// the 10 cities, as a list or a month calendar. The data is assembled
// server-side in lib/cityEvents.js; this file only filters and renders.

const EV_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EV_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EV_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Festivals usually carry their own icon (🪔 Diwali, 🎄 Christmas…); this is the fallback.
const EV_ICONS = { holiday: "🗓️", festival: "🎊", expo: "🏢", conference: "🎤", sports: "🏏", culture: "🎭" };
const eventIcon = (e) => e.icon || EV_ICONS[e.category] || "📌";

// Each category is coloured by its type, on cards and in the calendar.
const EV_TYPES = {
  holiday: "festive",
  festival: "festive",
  expo: "business",
  conference: "business",
  sports: "sports",
  culture: "culture",
};
const EV_TYPE_LABELS = { festive: "Holidays & festivals", business: "Business events", sports: "Sports", culture: "Culture" };

let eventsData = null;
let eventsNews = {};
let eventsLoading = false;
let eventsFailed = false; // the last load failed
const eventsWeather = {}; // city id -> forecast, or null if unavailable
const weatherRequested = new Set();
let weatherFile = null; // the forecasts for every city, once loaded
// range: days ahead shown in the list ("all" = everything loaded); type: an EV_TYPES value or "all".
const eventsState = { city: "all", view: "list", month: null, day: null, range: "all", type: "all" };

// ---- dates -------------------------------------------------------------------

const evDate = (d) => new Date(`${d}T00:00:00Z`);
const evFmt = (d) => `${evDate(d).getUTCDate()} ${EV_MONTHS[evDate(d).getUTCMonth()]}`;
const evDow = (d) => EV_DOW[evDate(d).getUTCDay()];
const evAddDays = (d, n) => new Date(evDate(d).getTime() + n * 86400000).toISOString().slice(0, 10);
const evDaysBetween = (a, b) => Math.round((evDate(b) - evDate(a)) / 86400000);
const evMonthKey = (d) => d.slice(0, 7);
const evMonthName = (key) => `${EV_MONTHS_LONG[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
function evShiftMonth(key, n) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
function evRange(start, end) {
  if (start === end) return evFmt(start);
  if (evMonthKey(start) === evMonthKey(end)) return `${evDate(start).getUTCDate()}–${evFmt(end)}`;
  return `${evFmt(start)} – ${evFmt(end)}`;
}

// "on now", "today", "tomorrow", "in 5 days", "in 3 weeks", "in 2 months"
function countdown(start, end = start) {
  const today = eventsData.today;
  if (start < today && end >= today) return "on now";
  const days = evDaysBetween(today, start);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

// ---- data helpers ---------------------------------------------------------------

const cityById = (id) => eventsData.cities.find((c) => c.id === id);
const cityName = (id) => (cityById(id) || {}).name || id;

// Events for the chosen city and type. The time range is applied by the list only.
function visibleEvents() {
  const { city, type } = eventsState;
  return eventsData.events.filter(
    (e) => (city === "all" || e.cities.includes(city)) && (type === "all" || EV_TYPES[e.category] === type)
  );
}

// Last day the list shows.
function rangeEnd() {
  return eventsState.range === "all" ? eventsData.horizonEnd : evAddDays(eventsData.today, eventsState.range);
}

function citiesLabel(e) {
  if (e.cities.length === eventsData.cities.length) return "All cities";
  return e.cities.map(cityName).join(", ");
}

// ---- summary cards ---------------------------------------------------------------

function summaryCard(icon, label, title, lines) {
  return `
    <div class="summary-card">
      <div class="summary-label">${icon} ${label}</div>
      <div class="summary-title">${title}</div>
      ${lines.map((l) => `<div class="summary-sub">${l}</div>`).join("")}
    </div>`;
}

function renderSummary() {
  const today = eventsData.today;
  const cards = [];

  // Long weekends are national, so this card is the same for every city.
  const lw = eventsData.events.find((e) => e.longWeekend && e.longWeekend.end >= today);
  cards.push(
    lw
      ? summaryCard("🏖️", "Next long weekend", escapeHtml(lw.name), [
          `${evRange(lw.longWeekend.start, lw.longWeekend.end)} · ${lw.longWeekend.length} days`,
          `<b>${countdown(lw.longWeekend.start, lw.longWeekend.end)}</b>${lw.longWeekend.bridgeDay ? ` · with ${evDow(lw.longWeekend.bridgeDay)} off` : ""}`,
        ])
      : summaryCard("🏖️", "Next long weekend", "None in the next 6 months", [])
  );

  // The next business, sports or culture event, or a festival specific to a
  // few cities (Durga Puja, Pongal). National holidays have their own card.
  const allCities = eventsData.cities.length;
  const big = visibleEvents().find(
    (e) => e.end >= today && e.category !== "holiday" && (e.category !== "festival" || e.cities.length < allCities)
  );
  cards.push(
    big
      ? summaryCard("🎯", "Next big event", escapeHtml(big.name), [
          `${evRange(big.start, big.end)} · ${escapeHtml(citiesLabel(big))}`,
          `<b>${countdown(big.start, big.end)}</b>`,
        ])
      : summaryCard("🎯", "Next big event", "Nothing on the calendar yet", [])
  );

  document.getElementById("events-summary").innerHTML = cards.join("");
}

// ---- season and weather (single city only) ---------------------------------------

function currentSeason(city) {
  const month = evDate(eventsData.today).getUTCMonth() + 1;
  const inSeason = (s) => (s.from <= s.to ? month >= s.from && month <= s.to : month >= s.from || month <= s.to);
  return city.seasons.find(inSeason);
}

// Air passengers for one city: last month, change on last year, and the monthly trend.
function airLine(cityId) {
  if (!airData || !airLatest().cities[cityId]) return "";
  const v = airLatest().cities[cityId];
  const airports = v.airports.length > 1 ? ` · ${v.airports.length} airports combined` : "";
  return `
    <div class="air-line">
      <span class="air-label">✈️ Air passengers, ${airMonthName(airLatest().month)}:</span>
      <b>${airLakh(v.passengers)}</b>
      ${airChange(v.change)} <span class="air-vs">vs ${airMonthName(airLatest().month).replace(/\d{4}$/, (y) => y - 1)}</span>
      ${airSparkline(cityId)}
      <span class="air-src">${airSourceLink("AAI")}${airports}</span>
    </div>`;
}

const AIR_CAVEAT = "Counts all airport users (visitors, residents and transit passengers), so it shows travel volume, not hotel bookings. Read it alongside your own booking pace.";

// Single city: its own air traffic card, kept apart from the weather card.
function airCityCard(city) {
  if (!airData || !airLatest().cities[city.id]) return "";
  const meaning = airCityMeaning(city.id);
  return `
    <div class="cityinfo-card">
      <div class="cityinfo-title">✈️ Air traffic</div>
      ${airLine(city.id)}
      ${meaning.length ? `<div class="air-meaning"><div class="air-label">What this means</div>${airPoints(meaning)}</div>` : ""}
      <div class="air-src">${AIR_CAVEAT}</div>
    </div>`;
}

// "All cities": a short summary of last month's air traffic across the 15 cities.
function airSummaryBox() {
  if (!airData) return "";
  return `
    <div class="air-summary">
      <div class="air-label">✈️ Air travel to our cities, ${airMonthName(airLatest().month, true)}</div>
      <p>${airSummary(cityName).map(escapeHtml).join(" ")}</p>
      <div class="air-meaning"><div class="air-label">What this means</div>${airPoints(airOverallMeaning(cityName))}</div>
      <div class="air-src">Source: ${airSourceLink()} · ${AIR_CAVEAT}</div>
    </div>`;
}

function renderCityInfo() {
  const el = document.getElementById("events-cityinfo");
  const city = cityById(eventsState.city);
  el.classList.toggle("split", !!city);
  if (!city) {
    const summary = airSummaryBox();
    el.hidden = !summary;
    el.innerHTML = summary;
    return;
  }
  el.hidden = false;

  const season = currentSeason(city);
  const nextSeason = city.seasons[(city.seasons.indexOf(season) + 1) % city.seasons.length];
  const seasonLine = `
    <div class="season-line">
      <b>${escapeHtml(city.name)} now:</b> ${escapeHtml(season.label)}
      <span class="season-next">· from ${EV_MONTHS[nextSeason.from - 1]}: ${escapeHtml(nextSeason.label)}</span>
    </div>`;

  const w = eventsWeather[city.id];
  let weather;
  if (w === undefined) {
    weather = `<p class="weather-note">Loading forecast…</p>`;
    if (!weatherRequested.has(city.id)) loadWeather(city.id);
  } else if (!w) {
    weather = `<p class="weather-note">Forecast unavailable right now.</p>`;
  } else {
    const days = w.days
      .map(
        (d) => `
        <div class="weather-day${w.heavyRainDays.includes(d.date) ? " wet" : ""}" title="${escapeHtml(d.label)} · ${d.min}–${d.max}°C · ${d.rainMm} mm rain">
          <span class="weather-dow">${d.date === eventsData.today ? "Today" : evDow(d.date)}</span>
          <span class="weather-icon">${d.icon}</span>
          <span class="weather-temp">${d.max}°</span>
        </div>`
      )
      .join("");
    const warnings = [
      w.heavyRainDays.length ? `🌧️ Heavy rain expected ${w.heavyRainDays.map((d) => evDow(d)).join(", ")}` : "",
      w.veryHotDays.length ? `🌡️ Very hot (40°C+) ${w.veryHotDays.map((d) => evDow(d)).join(", ")}` : "",
    ].filter(Boolean);
    weather = `
      <div class="weather-strip">${days}</div>
      ${warnings.map((t) => `<div class="weather-warning">⚠ ${t}</div>`).join("")}`;
  }

  el.innerHTML = `
    ${airCityCard(city)}
    <div class="cityinfo-card">
      <div class="cityinfo-title">🌦️ Season and weather</div>
      ${seasonLine}${weather}
    </div>`;
}

async function loadWeather(cityId) {
  weatherRequested.add(cityId);
  try {
    // All 15 forecasts are in one file, built with the rest of the site.
    if (!weatherFile) weatherFile = getData("weather.json").catch((err) => {
      weatherFile = null;
      throw err;
    });
    eventsWeather[cityId] = (await weatherFile).cities[cityId] || null;
  } catch {
    eventsWeather[cityId] = null;
  }
  if (eventsState.city === cityId) renderCityInfo();
  updateDashboard();
}

// ---- event card ---------------------------------------------------------------

function longWeekendLine(e) {
  const w = e.longWeekend;
  if (!w) return "";
  const text = w.bridgeDay
    ? `${w.length}-day break (${evRange(w.start, w.end)}) if you take ${evDow(w.bridgeDay)} ${evFmt(w.bridgeDay)} off`
    : `${w.length}-day weekend: ${evRange(w.start, w.end)}`;
  return `<div class="event-extra">🏖️ ${text}</div>`;
}

function newsLine(e) {
  const story = eventsNews[e.id];
  if (!story) return "";
  const meta = [story.publisher, timeAgo(story.publishedAt)].filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <a class="event-news" href="${safeUrl(story.link)}" target="_blank" rel="noopener noreferrer">
      <span class="event-news-label">📰 In the news</span>
      <span class="event-news-title">${escapeHtml(story.title)}</span>
      <span class="event-news-meta">${meta}</span>
    </a>`;
}

// The event's own picture, or a coloured tile with its icon. A picture that
// fails to load falls back to the tile.
function eventThumb(e) {
  const icon = eventIcon(e);
  const tile = `<span class="thumb-tile">${icon}</span>`;
  if (!e.image) return `<div class="event-thumb no-image">${tile}</div>`;
  return `
    <div class="event-thumb">
      ${tile}
      <img src="${escapeHtml(e.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    </div>`;
}

function eventCard(e) {
  const d = evDate(e.start);
  const days = evDaysBetween(e.start, e.end) + 1;
  const type = EV_TYPES[e.category] || "festive";
  const tags = [
    // A break that needs a day of leave is not a long weekend in its own right.
    e.longWeekend ? `<span class="event-tag">${e.longWeekend.bridgeDay ? "Long weekend with 1 day's leave" : "Long weekend"}</span>` : "",
    e.tentative ? `<span class="event-tag muted" title="Depends on the moon sighting">Date may shift</span>` : "",
  ].join("");
  // The date part is hidden on phones, where the one-line date at the top already shows it.
  const whenRest = [days > 1 ? `${days} days` : "", e.venue ? escapeHtml(e.venue) : ""].filter(Boolean).join(" · ");
  const when = `<span class="when-date">${evRange(e.start, e.end)}${whenRest ? " · " : ""}</span>${whenRest}`;
  const source = e.source
    ? `<a href="${safeUrl(e.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.sourceName)}</a>`
    : escapeHtml(e.sourceName);

  // On phones the date block is replaced by this one-line date, to give the text the full width.
  const mobileTop = `
        <div class="event-mobile-top">
          <span class="event-mdate">${EV_DOW[d.getUTCDay()]}, ${evRange(e.start, e.end)}</span>
          <span class="event-countdown">${countdown(e.start, e.end)}</span>
        </div>`;

  return `
    <article class="event-card type-${type}">
      <div class="event-date">
        <span class="event-day">${d.getUTCDate()}</span>
        <span class="event-month">${EV_MONTHS[d.getUTCMonth()]}</span>
        <span class="event-dow">${EV_DOW[d.getUTCDay()]}</span>
      </div>
      <div class="event-body">
        ${mobileTop}
        <div class="event-top">
          <h3 class="event-name">${escapeHtml(e.name)} ${tags}</h3>
          <span class="event-countdown">${countdown(e.start, e.end)}</span>
        </div>
        <div class="event-when${whenRest ? "" : " date-only"}">${when}</div>
        <div class="event-cities">📍 ${escapeHtml(citiesLabel(e))}</div>
        <p class="event-note">${escapeHtml(e.note)}</p>
        ${longWeekendLine(e)}
        ${newsLine(e)}
        <div class="event-source">Source: ${source}</div>
      </div>
      ${eventThumb(e)}
    </article>`;
}

function weddingLine(dates) {
  if (!dates.length) return "";
  const days = dates.map((d) => evDate(d).getUTCDate()).join(", ");
  return `<div class="wedding-line">💍 Wedding dates: ${days} ${EV_MONTHS[evDate(dates[0]).getUTCMonth()]}</div>`;
}

// ---- list view ------------------------------------------------------------------

function renderList() {
  const today = eventsData.today;
  const last = rangeEnd();
  const weekEnd = evAddDays(today, 7) < last ? evAddDays(today, 7) : last;
  const events = visibleEvents().filter((e) => e.start <= last);
  // Wedding dates are a kind of festive date: hidden when filtering to other types.
  const showWeddings = eventsState.type === "all" || eventsState.type === "festive";
  const weddingDates = showWeddings ? eventsData.weddingDates.filter((d) => d <= last) : [];
  let html = "";

  const ongoing = events.filter((e) => e.start < today);
  if (ongoing.length) html += `<h2 class="event-group">Happening now</h2>${ongoing.map(eventCard).join("")}`;

  const thisWeek = events.filter((e) => e.start >= today && e.start <= weekEnd);
  const weekWeddings = weddingDates.filter((d) => d <= weekEnd);
  html += `<h2 class="event-group">Next 7 days</h2>`;
  if (weekWeddings.length) html += `<div class="wedding-line">💍 Wedding dates: ${weekWeddings.map(evFmt).join(", ")}</div>`;
  html += thisWeek.length ? thisWeek.map(eventCard).join("") : `<p class="week-empty">Nothing on the calendar in the next 7 days.</p>`;

  // Then every month, skipping months with nothing in them.
  for (let key = evMonthKey(today); key <= evMonthKey(last); key = evShiftMonth(key, 1)) {
    const inMonth = events.filter((e) => e.start > weekEnd && evMonthKey(e.start) === key);
    const weddings = weddingDates.filter((d) => d > weekEnd && evMonthKey(d) === key);
    if (!inMonth.length && !weddings.length) continue;
    html += `<h2 class="event-group">${evMonthName(key)}</h2>${weddingLine(weddings)}${inMonth.map(eventCard).join("")}`;
  }

  if (!events.length && !weddingDates.length) html = `<p class="placeholder">Nothing matches these filters.</p>`;
  document.getElementById("events-list").innerHTML = html;
}

// ---- calendar view ----------------------------------------------------------------

function eventsOn(day, events) {
  return events.filter((e) => e.start <= day && e.end >= day);
}

function renderCalendar() {
  const today = eventsData.today;
  const first = evMonthKey(today);
  const last = evMonthKey(eventsData.horizonEnd);
  const key = eventsState.month;
  const events = visibleEvents();
  const showWeddings = eventsState.type === "all" || eventsState.type === "festive";
  const weddings = new Set(showWeddings ? eventsData.weddingDates : []);

  // Grid starts on the Monday on or before the 1st, ends on the Sunday on or after the last day.
  const monthStart = `${key}-01`;
  const monthEnd = evAddDays(`${evShiftMonth(key, 1)}-01`, -1);
  const gridStart = evAddDays(monthStart, -((evDate(monthStart).getUTCDay() + 6) % 7));
  const gridEnd = evAddDays(monthEnd, (7 - evDate(monthEnd).getUTCDay()) % 7);

  let cells = "";
  for (let d = gridStart; d <= gridEnd; d = evAddDays(d, 1)) {
    if (evMonthKey(d) !== key) {
      cells += `<div class="cal-day outside"></div>`;
      continue;
    }
    const dayEvents = eventsOn(d, events);
    const classes = ["cal-day", d < today ? "past" : "", d === today ? "today" : "", d === eventsState.day ? "selected" : ""]
      .filter(Boolean)
      .join(" ");
    const chips = dayEvents
      .slice(0, 2)
      .map((e) => `<span class="cal-chip type-${EV_TYPES[e.category] || "festive"}" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span>`)
      .join("");
    const more = dayEvents.length > 2 ? `<span class="cal-more">+${dayEvents.length - 2} more</span>` : "";
    const dots = dayEvents
      .slice(0, 3)
      .map((e) => `<i class="cal-dot type-${EV_TYPES[e.category] || "festive"}"></i>`)
      .join("");
    cells += `
      <button class="${classes}" data-day="${d}">
        <span class="cal-num">${evDate(d).getUTCDate()}${weddings.has(d) ? ` <span class="cal-ring" title="Wedding date">💍</span>` : ""}</span>
        ${chips}${more}
        ${dots ? `<span class="cal-dots">${dots}</span>` : ""}
      </button>`;
  }

  const legend = Object.entries(EV_TYPE_LABELS)
    .map(([type, label]) => `<span><i class="cal-dot type-${type}"></i>${label}</span>`)
    .join("");

  // The selected day's details, below the grid.
  let detail = `<p class="cal-hint">Tap a day to see its events.</p>`;
  if (eventsState.day && evMonthKey(eventsState.day) === key) {
    const day = eventsState.day;
    const dayEvents = eventsOn(day, events);
    detail = `
      <h2 class="event-group">${evDow(day)} ${evFmt(day)}</h2>
      ${weddings.has(day) ? `<div class="wedding-line">💍 Wedding date</div>` : ""}
      ${dayEvents.map(eventCard).join("") || (weddings.has(day) ? "" : `<p class="cal-hint">Nothing on this day.</p>`)}`;
  }

  document.getElementById("events-calendar").innerHTML = `
    <div class="cal-header">
      <button class="cal-nav" data-month="${evShiftMonth(key, -1)}" ${key <= first ? "disabled" : ""} aria-label="Previous month">‹</button>
      <h2 class="cal-title">${evMonthName(key)}</h2>
      <button class="cal-nav" data-month="${evShiftMonth(key, 1)}" ${key >= last ? "disabled" : ""} aria-label="Next month">›</button>
    </div>
    <div class="cal-grid">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("")}
      ${cells}
    </div>
    <div class="cal-legend">${legend}<span>💍 Wedding date</span></div>
    <div class="cal-detail">${detail}</div>`;
}

// ---- page -------------------------------------------------------------------------

function renderEvents() {
  if (!eventsData) return;
  updateDashboard();
  const cityChoices = [{ id: "all", name: "All cities" }, ...eventsData.cities];
  document.getElementById("events-city-select").innerHTML = cityChoices
    .map((c) => `<option value="${c.id}"${eventsState.city === c.id ? " selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");
  document.querySelectorAll("#events-view-controls .sort-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === eventsState.view));

  const isList = eventsState.view === "list";
  // The calendar moves month by month, so the time filter only applies to the list.
  const rangeSelect = document.getElementById("events-range-select");
  rangeSelect.value = String(eventsState.range);
  rangeSelect.hidden = !isList;
  document.getElementById("events-type-select").value = eventsState.type;
  const shown = isList ? visibleEvents().filter((e) => e.start <= rangeEnd()) : visibleEvents();
  const period = !isList || eventsState.range === "all" ? "next 6 months" : `next ${eventsState.range} days`;
  document.getElementById("events-count").textContent = `${shown.length} event${shown.length === 1 ? "" : "s"} · ${period}`;

  renderSummary();
  renderCityInfo();
  document.getElementById("events-list").hidden = !isList;
  document.getElementById("events-calendar").hidden = isList;
  if (isList) renderList();
  else renderCalendar();
}

async function loadEvents() {
  if (eventsLoading) return;
  eventsLoading = true;
  try {
    const data = await getData("events.json");
    // The file was built up to an hour ago; "today" is the visitor's today in India,
    // so countdowns are right and anything that ended since the build is dropped.
    const today = todayIst();
    if (today > data.today) {
      data.today = today;
      data.events = data.events.filter((e) => e.end >= today);
      data.weddingDates = data.weddingDates.filter((d) => d >= today);
    }
    eventsData = data;
    eventsFailed = false;
    eventsState.month = evMonthKey(eventsData.today);
    document.getElementById("events-footnote").textContent =
      "Holidays come from Google's India holiday calendar; other events are checked against the linked sources. " +
      "💍 Wedding dates are shown only when at least two panchang sources agree. Weather: Open-Meteo.";
    renderEvents();
    loadEventNews();
    loadAirTraffic().then(() => renderEvents());
  } catch (err) {
    document.getElementById("events-list").innerHTML = `<p class="error">Couldn't load city events. Try again in a moment.</p>`;
    eventsFailed = true;
    updateDashboard();
  } finally {
    eventsLoading = false;
  }
}

// The event news is a separate file, so the list can show before it arrives.
async function loadEventNews() {
  try {
    eventsNews = (await getData("event-news.json")).news || {};
    renderEvents();
  } catch {
    // No news links is fine; the events still show.
  }
}

document.getElementById("events-city-select").addEventListener("change", (e) => {
  eventsState.city = e.target.value;
  renderEvents();
});
document.getElementById("events-range-select").addEventListener("change", (e) => {
  eventsState.range = e.target.value === "all" ? "all" : +e.target.value;
  renderEvents();
});
document.getElementById("events-type-select").addEventListener("change", (e) => {
  eventsState.type = e.target.value;
  renderEvents();
});
document.getElementById("events-view-controls").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;
  eventsState.view = btn.dataset.view;
  renderEvents();
});
document.getElementById("events-calendar").addEventListener("click", (e) => {
  const nav = e.target.closest("[data-month]");
  if (nav && !nav.disabled) {
    eventsState.month = nav.dataset.month;
    eventsState.day = null;
    renderEvents();
    return;
  }
  const day = e.target.closest("[data-day]");
  if (day) {
    eventsState.day = day.dataset.day;
    renderEvents();
  }
});
document.querySelector('.tab[data-tab="events"]').addEventListener("click", () => {
  if (!eventsData) loadEvents();
});
