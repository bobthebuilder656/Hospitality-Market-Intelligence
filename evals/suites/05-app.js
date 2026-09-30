// The app itself, driven in a real (headless) browser: every tab, filter, popup,
// calculator and scheduled article, at desktop and phone sizes, plus what
// happens when a feed sends hostile text or the server is unreachable.

const fs = require("fs");
const path = require("path");
const { expect, expectEqual, expectNone } = require("../lib/harness");
const { sleep } = require("../lib/browser");

const { ROOT, read } = require("../lib/files");

const lib = (name) => require(path.join(ROOT, "lib", name));
const J = JSON.stringify;

const TABS = ["dashboard", "news", "stocks", "events", "resources"];
const DATA_READY = "typeof currentNewsData !== 'undefined' && currentNewsData && currentStocksData && eventsData && resData && airData";

module.exports = {
  id: "app",
  title: "5. The app in a browser (every tab, filter, popup and article; desktop and phone)",
  about: "A real browser opens the tool and uses it the way a person would.",
  needs: ["server", "browser", "network"],

  async run(t, ctx) {
    const b = await ctx.getBrowser();
    if (!b) {
      t.skip("All browser checks", "no Chrome or Edge found on this machine (set CHROME_PATH)");
      return;
    }
    const base = ctx.baseUrl;
    const fresh = async (width = 1280, height = 900) => {
      await b.setViewport(width, height);
      await b.open(`${base}/`, 800);
      await b.waitFor(DATA_READY, 90000);
      await sleep(500);
    };
    const ownFailures = () => b.failedRequests.filter((r) => r.includes(base) || r.startsWith("failed"));

    // ---- loading ---------------------------------------------------------------------

    b.clearErrors();
    await t.check("The app opens and loads all its data", async () => {
      await fresh();
      return "news, stocks, events, resources and air traffic loaded";
    });

    await t.check("No script errors or failed requests while opening every tab", async () => {
      for (const tab of TABS) await b.clickTab(tab, 500);
      await b.clickTab("dashboard", 200);
      expectNone([...b.errors.map((e) => `script error: ${e}`), ...ownFailures().map((r) => `request failed: ${r}`)]);
    });

    // ---- dashboard -------------------------------------------------------------------

    await t.check("Dashboard (no preferences): four cards, top 3 distinct headlines, sector averages and prompts", async () => {
      const d = await b.run(`
        const cards = [...document.querySelectorAll('#dashboard .dash-card')];
        const heads = [...cards[0].querySelectorAll('a.dash-row')].map((a) => ({ title: a.querySelector('.dash-row-title').textContent.trim(), href: a.href, target: a.target, rel: a.rel }));
        return {
          titles: cards.map((c) => c.querySelector('.dash-card-head .dash-label').textContent.trim()),
          heads,
          newsCount: currentNewsData.items.length,
          sectors: document.querySelectorAll('#dashboard [data-dash-sector]').length,
          nudges: document.querySelectorAll('#dashboard .dash-nudge').length,
          date: document.querySelector('.dash-date').textContent.trim(),
          dates: cards[2].querySelectorAll('.dash-row-dated').length,
          stillLoading: document.querySelector('#dashboard').textContent.includes('Loading'),
          same: heads.some((h, i) => heads.slice(i + 1).some((o) => dashSameStory(h.title, o.title))),
        };`);
      expectEqual(d.titles, ["Top headlines", "Market snapshot", "City snapshot: All India", "Resources"], "cards");
      expectEqual(d.heads.length, Math.min(3, d.newsCount), "headlines shown");
      expect(!d.same, "the same story appears twice in the top headlines");
      expect(d.heads.every((h) => /^https?:/.test(h.href) && h.target === "_blank" && /noopener/.test(h.rel)), "a headline link is unsafe or does not open in a new tab");
      expectEqual(d.sectors, 3, "sector averages");
      expectEqual(d.nudges, 2, "prompts to choose a city and build a watchlist");
      expectEqual(d.dates, 3, "rows in the city snapshot (2 dates + 1 big event)");
      expect(!d.stillLoading, "part of the dashboard is still showing 'Loading'");
      const now = new Date(Date.now() + 5.5 * 3600000);
      const expected = `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getUTCDay()]}, ${now.getUTCDate()} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][now.getUTCMonth()]} ${now.getUTCFullYear()}`;
      expectEqual(d.date, expected, "date heading (India's date)");
    });

    await t.check("Dashboard headlines follow the ranking rule: Indian hotel stories first, then newest", async () => {
      const d = await b.run(`
        const shown = [...document.querySelectorAll('#dashboard .dash-card')][0].querySelectorAll('a.dash-row');
        const items = currentNewsData.items;
        const first = items.find((i) => i.title === shown[0].querySelector('.dash-row-title').textContent.trim());
        return { firstRegion: first && first.region, indiaExists: items.some((i) => i.region === 'India') };`);
      expect(!d.indiaExists || d.firstRegion === "India", "an international story leads although Indian stories are available");
    });

    await t.check("Dashboard 'next big event' matches the City Events tab", async () => {
      const d = await b.run(`
        const rows = [...document.querySelectorAll('#dashboard .dash-card')][2].querySelectorAll('.dash-row-dated .dash-row-title');
        const summary = [...document.querySelectorAll('#events-summary .summary-title')].map((e) => e.textContent.trim());
        return { big: rows[rows.length - 1].textContent.trim(), summaryBig: summary[1] };`);
      expectEqual(d.big, d.summaryBig, "big event on the dashboard vs City Events");
    });

    await t.check("Dashboard personalises to a chosen city and watchlist, and remembers them after a reload", async () => {
      await b.run(`
        const s = document.querySelector('.dash-city-select'); s.value = 'goa'; s.dispatchEvent(new Event('change', { bubbles: true }));
        for (const id of ['indian-hotels', 'itc-hotels', 'lemon-tree', 'eih']) toggleWatchlist(id);`);
      await fresh();
      await b.waitFor("eventsWeather.goa !== undefined", 20000);
      await sleep(300);
      const d = await b.run(`
        const cards = [...document.querySelectorAll('#dashboard .dash-card')];
        return {
          cityTitle: cards[2].querySelector('.dash-label').textContent.trim(),
          lead: (cards[2].querySelector('.dash-lead') || {}).textContent || '',
          watchRows: cards[1].querySelectorAll('.dash-sub ~ [data-dash-stock]').length,
          movers: cards[1].querySelectorAll('[data-dash-stock]').length,
          more: (cards[1].querySelector('.dash-more-inline') || {}).textContent || '',
          sectors: document.querySelectorAll('#dashboard [data-dash-sector]').length,
          nudges: document.querySelectorAll('#dashboard .dash-nudge').length,
          goaOnly: [...cards[2].querySelectorAll('.dash-row-dated .dash-row-title')].map((e) => e.textContent.trim()),
          goaEvents: eventsData.events.filter((e) => e.cities.includes('goa')).map((e) => e.name),
        };`);
      expectEqual(d.cityTitle, "City snapshot: Goa", "city card title");
      // The forecast service sometimes has nothing for a city; the line then shows air traffic alone.
      const hasForecast = await b.run(`return Boolean(eventsWeather.goa);`);
      expect(/Air passengers/.test(d.lead) && (!hasForecast || /°/.test(d.lead)), `city line should show weather and air traffic, shows "${d.lead.trim()}"`);
      expectEqual(d.watchRows, 3, "watchlist rows (capped at 3)");
      expect(/\+1 more/.test(d.more), "no '+1 more' link for the fourth watchlist stock");
      expectEqual([d.sectors, d.nudges], [0, 0], "generic sector line and prompts when personalised");
      expectNone(d.goaOnly.filter((n) => !d.goaEvents.includes(n)).map((n) => `"${n}" is not a Goa event`));
    });

    await t.check("Every dashboard row leads to the right place", async () => {
      const steps = [
        ["a stock row opens its popup", `document.querySelector('#dashboard [data-dash-stock]').click(); await new Promise((r) => setTimeout(r, 300)); const open = !document.getElementById('stock-modal').classList.contains('hidden'); closeStockDetail(); return open;`, true],
        ["an event row opens City Events on the chosen city", `document.querySelector('#dashboard [data-dash-events]').click(); return document.querySelector('.tab.active').dataset.tab + ':' + eventsState.city + ':' + document.getElementById('events-city-select').value;`, "events:goa:goa"],
        ["term of the day opens the glossary", `document.querySelector('.tab[data-tab=dashboard]').click(); document.querySelector('#dashboard [data-dash-res=glossary]').click(); return document.querySelector('.tab.active').dataset.tab + ':' + resState.view + ':' + Boolean(document.querySelector('.res-term-name'));`, "resources:glossary:true"],
        ["the article title opens the article", `document.querySelector('.tab[data-tab=dashboard]').click(); document.querySelector('#dashboard [data-dash-res=brief]').click(); return document.querySelector('.tab.active').dataset.tab + ':' + resState.view + ':' + (document.querySelector('.read-title').textContent === resData.brief.title);`, "resources:brief:true"],
        ["'All news' opens the News tab", `document.querySelector('.tab[data-tab=dashboard]').click(); document.querySelector('#dashboard [data-dash-tab=news]').click(); return document.querySelector('.tab.active').dataset.tab;`, "news"],
      ];
      const wrong = [];
      for (const [what, body, want] of steps) {
        const got = await b.run(body);
        if (J(got) !== J(want)) wrong.push(`${what}: got ${J(got)}`);
      }
      // Sector links only show without a watchlist.
      await b.run(`localStorage.clear();`);
      await fresh();
      const sector = await b.run(`document.querySelector('#dashboard [data-dash-sector=restaurant]').click(); return document.querySelector('.tab.active').dataset.tab + ':' + currentStockCategory + ':' + document.getElementById('stock-category-select').value + ':' + [...document.querySelectorAll('#stocks-list .stock-card')].every((c) => currentStocksData.quotes.find((q) => q.id === c.dataset.stockId).category === 'restaurant');`);
      if (sector !== "stocks:restaurant:restaurant:true") wrong.push(`a sector average opens Stock Prices filtered to that sector: got ${sector}`);
      expectNone(wrong);
    });

    // ---- news ------------------------------------------------------------------------

    await t.check("News tab: one card per story, and the Region filter shows only that region", async () => {
      await fresh();
      await b.clickTab("news");
      const d = await b.run(`
        const count = () => document.querySelectorAll('#news-list .news-card').length;
        const pick = (v) => { const s = document.getElementById('news-region-select'); s.value = v; s.dispatchEvent(new Event('change')); };
        const out = { all: count(), total: currentNewsData.items.length };
        pick('India'); out.india = [...document.querySelectorAll('#news-list .region-badge')].map((e) => e.textContent.trim()); out.label = document.getElementById('news-count').textContent;
        pick('Global'); out.global = [...document.querySelectorAll('#news-list .region-badge')].map((e) => e.textContent.trim());
        pick('all'); out.back = count();
        out.links = [...document.querySelectorAll('#news-list .news-card')].every((a) => /^https?:/.test(a.href) && a.target === '_blank' && /noopener/.test(a.rel));
        out.updated = document.getElementById('updated-at').textContent;
        return out;`);
      expectEqual(d.all, d.total, "cards shown");
      expect(d.india.length > 0 && d.india.every((r) => r === "India"), "India filter shows other regions");
      expect(d.global.every((r) => r !== "India"), "International filter shows Indian stories");
      expectEqual(d.india.length + d.global.length, d.total, "India + international");
      expect(d.label.startsWith(`${d.india.length} of ${d.total}`), `count label reads "${d.label}"`);
      expectEqual(d.back, d.total, "cards after returning to all regions");
      expect(d.links, "a story link is unsafe or does not open in a new tab");
      expect(/updated \d{1,2} \w+/.test(d.updated), `"updated" time reads "${d.updated}"`);
    });

    // ---- stocks ----------------------------------------------------------------------

    await t.check("Stock Prices: every company shown; sorting and category filter are correct", async () => {
      await b.clickTab("stocks");
      const d = await b.run(`
        const ids = () => [...document.querySelectorAll('#stocks-list .stock-card[data-stock-id]')].map((c) => c.dataset.stockId);
        const q = (id) => currentStocksData.quotes.find((x) => x.id === id);
        const pick = (sel, v) => { const s = document.getElementById(sel); s.value = v; s.dispatchEvent(new Event('change')); };
        const out = { total: currentStocksData.quotes.filter((x) => !x.error).length };
        pick('stock-category-select', 'all'); pick('stock-sort-select', 'gainers'); out.gainers = ids().map((id) => q(id).changePercent);
        pick('stock-sort-select', 'losers'); out.losers = ids().map((id) => q(id).changePercent);
        pick('stock-sort-select', 'az'); out.az = ids().map((id) => q(id).name);
        out.cats = {};
        for (const c of ['hotel', 'restaurant', 'ota']) { pick('stock-category-select', c); out.cats[c] = [ids().length, ids().every((id) => q(id).category === c), currentStocksData.quotes.filter((x) => x.category === c && !x.error).length]; }
        pick('stock-category-select', 'all'); pick('stock-sort-select', 'gainers');
        out.pulse = document.getElementById('stocks-pulse').textContent;
        const ok = currentStocksData.quotes.filter((x) => !x.error);
        out.up = ok.filter((x) => x.change > 0).length; out.down = ok.filter((x) => x.change < 0).length;
        out.doubleSign = [...document.querySelectorAll('.stock-change')].some((e) => /[▲▼]\\s*-/.test(e.textContent));
        return out;`);
      expectEqual(d.gainers.length, d.total, "cards shown");
      expect(d.gainers.every((v, i) => !i || v <= d.gainers[i - 1]), "Top gainers is not sorted from biggest rise down");
      expect(d.losers.every((v, i) => !i || v >= d.losers[i - 1]), "Top losers is not sorted from biggest fall up");
      expectEqual(d.az, [...d.az].sort((a, c) => a.localeCompare(c)), "A–Z order");
      expectNone(Object.entries(d.cats).filter(([, [n, all, want]]) => !all || n !== want).map(([c, [n, , want]]) => `${c} filter shows ${n} cards, expected ${want}`));
      expect(d.pulse.includes(`${d.up} up`) && d.pulse.includes(`${d.down} down`), `summary bar does not match the data (${d.up} up, ${d.down} down): "${d.pulse.slice(0, 80)}"`);
      expect(!d.doubleSign, "a fall is shown with both an arrow and a minus sign");
    });

    await t.check("Stock Prices: watchlist stars work and stop at six", async () => {
      const d = await b.run(`
        localStorage.removeItem('hospitalityIntel.watchlist'); watchlist = []; renderStocks(currentStocksData);
        const ids = currentStocksData.quotes.filter((x) => !x.error).slice(0, 7).map((x) => x.id);
        for (const id of ids) document.querySelector('#stocks-list .star-btn[data-star-id="' + id + '"]').click();
        const out = { pinned: document.querySelectorAll('#stocks-watchlist .stock-card').length, saved: JSON.parse(localStorage.getItem('hospitalityIntel.watchlist')).length, msg: document.getElementById('stocks-msg').textContent };
        document.querySelector('#stocks-watchlist .star-btn').click();
        out.afterRemove = document.querySelectorAll('#stocks-watchlist .stock-card').length;
        localStorage.removeItem('hospitalityIntel.watchlist'); watchlist = []; renderStocks(currentStocksData);
        return out;`);
      expectEqual([d.pinned, d.saved], [6, 6], "stocks pinned and saved after starring seven");
      expect(/full/i.test(d.msg), `no "watchlist is full" message (shows "${d.msg}")`);
      expectEqual(d.afterRemove, 5, "stocks pinned after un-starring one");
    });

    // Price history comes from an outside service that sometimes refuses requests.
    // When it has nothing to give, the chart cannot be judged, so that part is
    // reported as skipped; everything the app itself controls is still checked.
    let historyDown = false;
    await t.check("Stock popup: opens with its price and chart, switches range, closes with Escape", async () => {
      await b.run(`document.querySelector('#stocks-list .stock-card[data-stock-id="indian-hotels"]').click();`);
      await b.waitFor("document.querySelector('#modal-body .modal-title')", 30000);
      const d = await b.run(`
        const api = await (await fetch('/api/stocks/indian-hotels/detail?range=10d')).json();
        const out = { history: api.history.length, title: document.querySelector('.modal-title').textContent, chart: Boolean(document.querySelector('#stock-chart-svg polyline')), price: document.querySelector('.modal-price').textContent, ranges: document.querySelectorAll('#range-toggle .range-btn').length, body: document.getElementById('modal-body').textContent };
        document.querySelector('#range-toggle [data-range="3m"]').click();
        return out;`);
      await b.waitFor("document.querySelector('#range-toggle .range-btn.active') && document.querySelector('#range-toggle .range-btn.active').dataset.range === '3m'", 30000);
      const closed = await b.run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return document.getElementById('stock-modal').classList.contains('hidden');`);
      historyDown = d.history === 0;
      expect(/Indian Hotels/.test(d.title), `popup title is "${d.title}"`);
      if (historyDown) expect(/No price history available/.test(d.body), "with no price history, the popup should say so");
      else expect(d.chart, "no price chart in the popup");
      expect(/₹[\d,]+\.\d\d/.test(d.price), `price reads "${d.price}"`);
      expectEqual(d.ranges, 4, "range buttons");
      expect(closed, "Escape did not close the popup");
      return historyDown ? "the price-history service gave no data, so the chart itself was not checked" : "";
    });

    await t.check("Stock comparison: at most three stocks can be picked", async () => {
      await b.run(`document.getElementById('compare-btn').click(); for (const id of ['indian-hotels', 'eih', 'lemon-tree', 'chalet']) document.querySelector('#stocks-list .stock-card[data-stock-id="' + id + '"]').click();`);
      const picked = await b.run(`return { n: compareIds.length, msg: document.getElementById('stocks-msg').textContent, bar: document.getElementById('compare-bar').textContent };`);
      expectEqual(picked.n, 3, "stocks selected after clicking four (limit is three)");
      expect(/up to 3/i.test(picked.msg), "no message when a fourth stock is picked");
      expect(/Comparing/.test(picked.bar), "the compare bar does not list the chosen stocks");
    });

    {
      await b.run(`document.getElementById('compare-go').click();`);
      await b.waitFor("document.querySelector('#compare-chart-svg') || /Failed to load/.test(document.getElementById('modal-body').textContent)", 40000).catch(() => {});
      const d = await b.run(`
        const out = { lines: document.querySelectorAll('#compare-chart-svg polyline').length, legend: document.querySelectorAll('.compare-legend li').length, failed: /Failed to load/.test(document.getElementById('modal-body').textContent), apiStatus: (await fetch('/api/stocks/compare?ids=' + compareIds.join(','))).status };
        closeStockDetail(); setCompareMode(false);
        return out;`);
      const name = "Stock comparison: the chosen stocks appear on one chart with a legend";
      if (d.failed && d.apiStatus >= 500) t.skip(name, "the price-history service gave no data just now; the app showed its 'failed to load' message");
      else await t.check(name, () => expectEqual([d.lines, d.legend], [3, 3], "lines and legend entries"));
    }

    // ---- city events -----------------------------------------------------------------

    await t.check("City Events: City, Period and Event type filters show exactly the matching events", async () => {
      await b.clickTab("events");
      const d = await b.run(`
        const pick = (sel, v) => { const s = document.getElementById(sel); s.value = v; s.dispatchEvent(new Event('change')); };
        const names = () => [...document.querySelectorAll('#events-list .event-card .event-name')].map((e) => e.firstChild.textContent.trim());
        const expected = (f) => eventsData.events.filter(f).map((e) => e.name);
        const same = (a, c) => JSON.stringify([...a].sort()) === JSON.stringify([...c].sort());
        const out = [];
        pick('events-city-select', 'all'); pick('events-type-select', 'all'); pick('events-range-select', 'all');
        if (!same(names(), expected(() => true))) out.push('with no filters, ' + names().length + ' cards for ' + eventsData.events.length + ' events');
        for (const city of ['delhi', 'goa', 'kolkata']) { pick('events-city-select', city); if (!same(names(), expected((e) => e.cities.includes(city)))) out.push('city ' + city + ' shows the wrong events'); }
        pick('events-city-select', 'all');
        for (const type of ['festive', 'business', 'sports', 'culture']) { pick('events-type-select', type); if (!same(names(), expected((e) => EV_TYPES[e.category] === type))) out.push('type ' + type + ' shows the wrong events'); }
        pick('events-type-select', 'all');
        for (const days of [30, 60, 90]) { pick('events-range-select', String(days)); const last = evAddDays(eventsData.today, days); if (!same(names(), expected((e) => e.start <= last))) out.push('next ' + days + ' days shows the wrong events'); }
        pick('events-range-select', 'all');
        const label = document.getElementById('events-count').textContent;
        if (!label.startsWith(eventsData.events.length + ' events')) out.push('count label reads "' + label + '"');
        return out;`);
      expectNone(d);
    });

    await t.check("City Events: choosing a city shows its weather, season and air traffic", async () => {
      await b.run(`const s = document.getElementById('events-city-select'); s.value = 'jaipur'; s.dispatchEvent(new Event('change'));`);
      await b.waitFor("eventsWeather.jaipur !== undefined", 20000);
      await sleep(300);
      const d = await b.run(`return { forecast: Boolean(eventsWeather.jaipur), note: (document.querySelector('#events-cityinfo .weather-note') || {}).textContent || '', days: document.querySelectorAll('#events-cityinfo .weather-day').length, season: (document.querySelector('.season-line') || {}).textContent || '', air: (document.querySelector('#events-cityinfo .air-line') || {}).textContent || '', points: document.querySelectorAll('#events-cityinfo .air-points li').length };`);
      await b.run(`const s = document.getElementById('events-city-select'); s.value = 'all'; s.dispatchEvent(new Event('change'));`);
      // The forecast comes from an outside service; when it has nothing, the card must say so.
      if (d.forecast) expectEqual(d.days, 7, "forecast days");
      else expect(/unavailable/i.test(d.note), "with no forecast, the weather card should say it is unavailable");
      expect(/Jaipur now/.test(d.season), "no season line");
      expect(/lakh/.test(d.air) && d.points >= 3, "air traffic card is missing its figure or its briefing points");
    });

    await t.check("City Events calendar: correct month grid, navigation, and a day's events on click", async () => {
      const d = await b.run(`
        document.querySelector('#events-view-controls [data-view=calendar]').click();
        const key = eventsState.month;
        const daysInMonth = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();
        const out = { days: document.querySelectorAll('#events-calendar .cal-day:not(.outside)').length, daysInMonth, today: document.querySelectorAll('#events-calendar .cal-day.today').length, prevDisabled: document.querySelector('.cal-nav').disabled, rangeHidden: getComputedStyle(document.getElementById('events-range-select').closest('.filter')).display === 'none' };
        const busy = eventsData.events.find((e) => e.start.slice(0, 7) === key && e.start >= eventsData.today) || eventsData.events[0];
        if (busy.start.slice(0, 7) !== key) document.querySelector('.cal-nav[data-month="' + busy.start.slice(0, 7) + '"]').click();
        document.querySelector('#events-calendar .cal-day[data-day="' + busy.start + '"]').click();
        out.detail = [...document.querySelectorAll('.cal-detail .event-name')].map((e) => e.firstChild.textContent.trim()).includes(busy.name);
        document.querySelectorAll('.cal-nav')[1].click();
        out.next = eventsState.month;
        out.expectedNext = evShiftMonth(busy.start.slice(0, 7), 1);
        document.querySelector('#events-view-controls [data-view=list]').click();
        eventsState.month = key; eventsState.day = null;
        return out;`);
      expectEqual(d.days, d.daysInMonth, "day cells in the month");
      expectEqual(d.today, 1, "cells marked as today");
      expect(d.prevDisabled, "can go back to a month before today");
      expect(d.rangeHidden, "the Period filter should be hidden in calendar view");
      expect(d.detail, "clicking a day did not show its events");
      expectEqual(d.next, d.expectedNext, "month after clicking next");
    });

    // ---- resources -------------------------------------------------------------------

    await t.check("Resources: home, search, glossary and the article all open", async () => {
      await b.clickTab("resources");
      const d = await b.run(`
        const out = { cards: document.querySelectorAll('.res-card').length, previews: document.querySelectorAll('.res-preview').length };
        // As a reader would: open the article from its preview, then press Back.
        document.querySelector('.res-preview[data-view=brief]').click();
        out.title = document.querySelector('.read-title').textContent; out.expectedTitle = resData.brief.title; out.sources = document.querySelectorAll('.read-sources li').length; out.expectedSources = resData.brief.sources.length;
        document.querySelector('.res-back').click();
        for (let i = 0; i < 30 && !document.querySelector('.res-cards'); i++) await new Promise((r) => setTimeout(r, 100));
        out.home = Boolean(document.querySelector('.res-cards'));
        out.backState = 'view=' + resState.view + ', history state=' + JSON.stringify(history.state) + ', entries=' + history.length;
        if (!out.home) openView('home');
        const s = document.getElementById('res-search'); s.value = 'revpar'; s.dispatchEvent(new Event('input', { bubbles: true }));
        out.hits = document.querySelectorAll('.search-hit').length;
        s.value = 'zzzz'; s.dispatchEvent(new Event('input', { bubbles: true }));
        out.empty = (document.querySelector('.search-empty') || {}).textContent || '';
        openView('glossary-all'); out.terms = document.querySelectorAll('.gloss-item').length; out.expectedTerms = resData.glossary.length;
        openView('glossary'); out.term = document.querySelector('.res-term-name').textContent; out.reports = document.querySelectorAll('.report-row').length;
        const istDay = Math.floor((Date.now() + 5.5 * 3600000) / 86400000); out.expectedTerm = resData.glossary[istDay % resData.glossary.length].term;
        openView('home');
        return out;`);
      expectEqual([d.cards, d.previews], [4, 3], "section cards and previews on the Resources home");
      expect(d.hits >= 1, "searching 'revpar' finds nothing");
      expect(/No matches/.test(d.empty), "no 'no matches' message for a nonsense search");
      expectEqual(d.terms, d.expectedTerms, "terms in the full glossary");
      expectEqual(d.term, d.expectedTerm, "term of the day");
      expect(d.reports >= 5, "reports list is missing");
      expectEqual(d.title, d.expectedTitle, "article title");
      expectEqual(d.sources, d.expectedSources, "sources listed under the article");
      expect(d.home, `the Back button did not return to the Resources home (${d.backState})`);
    });

    await t.check("Calculators give the right answers (occupancy, GST, group quote)", async () => {
      const d = await b.run(`
        const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
        const results = () => Object.fromEntries([...document.querySelectorAll('#calc-output .calc-result')].map((r) => [r.querySelector('span').textContent, r.querySelector('b').textContent]));
        const out = {};
        openView('tools', { calc: 'occupancy' });
        set('c-avail', 120); set('c-sold', 96); set('c-rev', 840000); out.occ = results();
        set('c-sold', 130); out.over = document.getElementById('calc-output').textContent;
        document.querySelector('[data-calc=gst]').click();
        out.gst = {};
        for (const rate of [5000, 7500, 7501, 12000]) { set('c-rate', rate); set('c-rooms', 2); set('c-nights', 3); out.gst[rate] = results(); }
        out.slabs = resData.gst.roomSlabs;
        document.querySelector('[data-calc=group]').click();
        set('c-grooms', 20); set('c-gnights', 3); set('c-grate', 7000); set('c-pax', 2); set('c-meal', 1500); set('c-comm', 10);
        out.group = results(); out.food = resData.gst.food;
        set('c-grooms', ''); out.blank = document.getElementById('calc-output').textContent;
        openView('home');
        return out;`);
      const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
      expectEqual([d.occ["Occupancy"], d.occ["ADR (average rate)"], d.occ["RevPAR"]], ["80%", "₹8,750", "₹7,000"], "occupancy calculator (96 of 120 rooms, ₹8,40,000)");
      expect(/can't be more/.test(d.over), "no warning when rooms sold exceed rooms available");
      const wrong = [];
      for (const rate of [5000, 7500, 7501, 12000]) {
        const slab = d.slabs.find((s) => s.upTo === null || rate <= s.upTo);
        const baseAmount = rate * 2 * 3;
        const want = { "GST rate": `${slab.rate}%`, "Room charges": inr(baseAmount), GST: inr((baseAmount * slab.rate) / 100), "Total to pay": inr(baseAmount * (1 + slab.rate / 100)) };
        for (const [k, v] of Object.entries(want)) if (d.gst[rate][k] !== v) wrong.push(`GST at ₹${rate}: ${k} shows ${d.gst[rate][k]}, expected ${v}`);
      }
      const roomRate = d.slabs.find((s) => s.upTo === null || 7000 <= s.upTo).rate;
      const rooms = 20 * 3 * 7000;
      const meals = 20 * 3 * 2 * 1500;
      const total = rooms * (1 + roomRate / 100) + meals * (1 + d.food.standard / 100);
      const wantGroup = { "Total quote to the client": inr(total), "Per room-night, all in": inr(total / 60), "Net to hotel, before tax": inr(rooms + meals - rooms * 0.1) };
      for (const [k, v] of Object.entries(wantGroup)) if (d.group[k] !== v) wrong.push(`group quote: ${k} shows ${d.group[k]}, expected ${v}`);
      if (!d.group[`Agent commission (10% of rooms)`] || d.group[`Agent commission (10% of rooms)`] !== inr(rooms * 0.1)) wrong.push("group quote: commission line is wrong or missing");
      if (!/Fill in all the fields/.test(d.blank)) wrong.push("no prompt when a field is left empty");
      expectNone(wrong);
    });

    if (ctx.remote) {
      t.skip("Every scheduled article and case study renders correctly", "needs preview mode, which is locked on a live site");
    } else {
      await t.check("Every scheduled article and case study renders correctly, with its picture", async () => {
        const dates = [...new Set([...read("briefs.json").articles, ...read("case-studies.json").cases].map((x) => x.publishDate))].sort();
        const problems = await b.run(`
          const out = [];
          const seen = new Set();
          for (const date of ${J(dates)}) {
            const r = await (await fetch('/api/resources?preview=' + date)).json();
            for (const [item, kind, next] of [[r.brief, 'brief', r.nextBriefDate], [r.caseStudy, 'case', r.nextCaseDate]]) {
              if (!item || seen.has(item.id)) continue;
              seen.add(item.id);
              const box = document.createElement('div');
              try { box.innerHTML = longRead(item, kind, next); } catch (err) { out.push(item.id + ': crashed while rendering (' + err.message + ')'); continue; }
              const text = box.textContent;
              if (box.querySelector('.read-title').textContent !== item.title) out.push(item.id + ': title is wrong');
              for (const bad of ['undefined', 'NaN', '[object Object]', 'Invalid Date']) if (text.includes(bad)) out.push(item.id + ': the page shows "' + bad + '"');
              if (/\\*\\*\\S|\\S\\*\\*(?!\\w)|\\]\\(http/.test(text.replace(/\\w\\*+\\w/g, ''))) out.push(item.id + ': formatting marks are showing as text');
              if (box.querySelectorAll('.read-body h3').length < 2) out.push(item.id + ': fewer than 2 section headings');
              if (box.querySelectorAll('.read-sources li').length !== item.sources.length) out.push(item.id + ': sources list is incomplete');
              for (const a of box.querySelectorAll('a[href]')) if (!/^https?:/.test(a.getAttribute('href'))) out.push(item.id + ': a link has no web address');
              const img = box.querySelector('.read-image img');
              if (item.image) {
                if (!img) out.push(item.id + ': picture not shown');
                else { const res = await fetch(img.getAttribute('src'), { method: 'HEAD' }); if (!res.ok || !/^image\\//.test(res.headers.get('content-type') || '')) out.push(item.id + ': picture does not load (' + img.getAttribute('src') + ')'); }
              }
              const link = box.querySelector('[data-open-tab]');
              if (link && !document.querySelector('.tab[data-tab="' + link.dataset.openTab + '"]')) out.push(item.id + ': its button points to a tab that does not exist');
            }
          }
          out.push('count:' + seen.size);
          return out;`);
        const count = problems.pop().split(":")[1];
        expectNone(problems, 8);
        expectEqual(+count, read("briefs.json").articles.length + read("case-studies.json").cases.length, "pieces rendered");
        return `${count} pieces`;
      });
    }

    // ---- navigation, keyboard and wording (found by the independent review) -----------------

    await t.check("Tabs are part of the address: Back returns to the previous tab, and a reload or link reopens the same view", async () => {
      await fresh();
      await b.clickTab("stocks", 200);
      await b.clickTab("events", 200);
      const forward = await b.run(`return location.hash;`);
      await b.run(`history.back();`);
      await sleep(600);
      const back = await b.run(`return location.hash + ' ' + document.querySelector('.tab.active').dataset.tab + ' ' + document.querySelector('.tab-panel.active').id;`);
      await b.open(`${base}/#resources/glossary`, 800);
      await b.waitFor(DATA_READY, 60000);
      const deep = await b.run(`return document.querySelector('.tab.active').dataset.tab + ' ' + resState.view + ' ' + Boolean(document.querySelector('.res-term-name'));`);
      await b.open(`${base}/#nonsense`, 800);
      await b.waitFor(DATA_READY, 60000);
      const unknown = await b.run(`return document.querySelector('.tab.active').dataset.tab;`);
      expectEqual(forward, "#events", "address after opening City Events");
      expectEqual(back, "#stocks stocks stocks", "after the browser's Back button");
      expectEqual(deep, "resources glossary true", "opening a link to the glossary");
      expectEqual(unknown, "dashboard", "an address that names no tab");
    });

    await t.check("Resources: Back to Resources always returns to the Resources home, whatever was open before", async () => {
      await fresh();
      await b.clickTab("resources", 200);
      const d = await b.run(`
        openView('brief');
        document.querySelector('.tab[data-tab=resources]').click();
        openView('tools');
        document.querySelector('.res-back').click();
        await new Promise((r) => setTimeout(r, 300));
        const first = resState.view + ':' + Boolean(document.querySelector('.res-cards'));
        openView('glossary'); openView('glossary-all');
        document.querySelector('.res-back').click();
        await new Promise((r) => setTimeout(r, 300));
        return [first, resState.view];`);
      expectEqual(d, ["home:true", "glossary"], "view after each Back button");
    });

    await t.check("The stock popup works with a keyboard and a screen reader", async () => {
      await b.clickTab("stocks", 300);
      const d = await b.run(`
        const card = document.querySelector('#stocks-list .stock-card[data-stock-id]');
        card.focus();
        const before = window.scrollY;
        card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 400));
        const modal = document.getElementById('stock-modal');
        const dialog = modal.querySelector('[role=dialog]');
        const out = { open: !modal.classList.contains('hidden'), dialog: Boolean(dialog && dialog.getAttribute('aria-modal') === 'true' && dialog.getAttribute('aria-label')), focusInside: modal.contains(document.activeElement), scrolled: window.scrollY - before };
        // Tab from the last control must stay inside the popup.
        const focusable = [...modal.querySelectorAll('button, a[href]')].filter((el) => el.offsetParent !== null);
        focusable[focusable.length - 1].focus();
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        out.trapped = modal.contains(document.activeElement);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        out.closed = modal.classList.contains('hidden');
        out.focusLeft = !modal.contains(document.activeElement);
        out.current = [...document.querySelectorAll('.tab')].filter((t) => t.getAttribute('aria-current') === 'page').map((t) => t.dataset.tab).join();
        return out;`);
      expectNone([
        !d.open ? "Space on a stock card does not open the popup" : null,
        !d.dialog ? "the popup is not announced as a dialog (role, aria-modal, label)" : null,
        !d.focusInside ? "focus stays behind the popup when it opens" : null,
        !d.trapped ? "Tab leaves the open popup" : null,
        !d.closed ? "Escape does not close the popup" : null,
        !d.focusLeft ? "focus is left inside the closed popup" : null,
        d.current !== "stocks" ? `the open tab is not marked for screen readers (aria-current on "${d.current}")` : null,
      ].filter(Boolean));
    });

    await t.check("Air-traffic trend sentences agree with the monthly figures", async () => {
      const d = await b.run(`return [airTrend([5, 3, -1, 2, 4, 1, -3.4, -2.6]), airTrend([-2, -4, -1, 5.3, 25.6, 5.4, -3, -6]), airTrend([1, 2, 3]), airTrend([-1, -2]), airTrend([2, -1, 0])];`);
      const want = [/^Lower than a year earlier for the last 2 months; higher in 5 of 8 months/, /^Lower than a year earlier for the last 2 months; higher in 3 of 8 months/, /every month.*sustained growth/, /every month.*sustained decline/, /^Level with a year earlier in the latest month; higher in 1 of 3 months/];
      expectNone(d.map((s, i) => (want[i].test(s) ? null : `case ${i + 1} reads "${s}"`)).filter(Boolean));
    });

    await t.check("Wording is consistent and honest: region names, last-close labels, part-day long weekends", async () => {
      await b.clickTab("news", 200);
      const d = await b.run(`
        const out = { badges: [...new Set([...document.querySelectorAll('#news-list .region-badge')].map((e) => e.textContent.trim()))] };
        document.querySelector('.tab[data-tab=stocks]').click();
        out.category = [...document.querySelectorAll('#stock-category-select option')].map((o) => o.textContent.trim());
        out.pulse = document.getElementById('stocks-pulse').textContent;
        out.abroad = currentStocksData.quotes.filter((q) => !q.error && q.currency !== 'INR').map((q) => shortName(q.name));
        const bridged = eventsData.events.filter((e) => e.longWeekend && e.longWeekend.bridgeDay).map((e) => e.name);
        document.querySelector('.tab[data-tab=events]').click();
        out.bridgeTags = [...document.querySelectorAll('#events-list .event-card')].filter((c) => bridged.includes(c.querySelector('.event-name').firstChild.textContent.trim())).map((c) => (c.querySelector('.event-tag') || {}).textContent || '');
        out.national = [...document.querySelectorAll('#events-list .event-note')].map((n) => n.textContent).filter((t) => /National holiday/.test(t)).length;
        out.nationalNames = eventsData.events.filter((e) => /National holiday/.test(e.note)).map((e) => e.name);
        return out;`);
      expectNone([
        d.badges.some((x) => !["India", "International"].includes(x)) ? `news badges read ${J(d.badges)}; the filter says "International"` : null,
        !d.category.includes("Online travel") ? `category filter reads ${J(d.category)}; the summary says "Online travel"` : null,
        d.abroad.length && !d.abroad.every((n) => d.pulse.includes(n)) ? "the summary does not say that the US-listed stock's figure is from a different session" : null,
        d.bridgeTags.some((x) => x.trim() === "Long weekend") ? "a break that needs a day of leave is tagged plainly 'Long weekend'" : null,
        ...d.nationalNames.filter((n) => !/Republic Day|Independence Day|Gandhi Jayanti/.test(n)).map((n) => `${n} is called a national holiday; only three holidays are national`),
      ].filter(Boolean));
    });

    // ---- hostile input ---------------------------------------------------------------

    await t.check("Hostile text in a news feed is shown as plain text, never run as code", async () => {
      await b.clickTab("news");
      const d = await b.run(`
        delete window.__xss;
        const evil = '<img src=x onerror="window.__xss=1">';
        const real = currentNewsData;
        renderNews({ generatedAt: new Date().toISOString(), items: [{ title: evil + 'Headline', link: 'javascript:window.__xss=2', source: evil, region: 'India', pubDate: new Date().toISOString(), snippet: evil + '<script>window.__xss=3<\\/script> summary' }] });
        await new Promise((r) => setTimeout(r, 400));
        const card = document.querySelector('#news-list .news-card');
        const out = { imgs: document.querySelectorAll('#news-list img, #news-list script').length, href: card ? card.getAttribute('href') : '', shown: card ? card.textContent.includes('<img') : false, dashImgs: document.querySelectorAll('#dashboard .dash-row img').length };
        if (card) card.click();
        await new Promise((r) => setTimeout(r, 200));
        out.xss = window.__xss;
        currentNewsData = real; renderNews(real);
        return out;`);
      expectNone([
        d.imgs ? "HTML from a headline or summary was inserted into the page as live elements" : null,
        d.xss !== undefined ? `injected code ran (marker ${d.xss})` : null,
        /^\s*javascript:/i.test(d.href || "") ? "a story link using javascript: was kept as a clickable link" : null,
        d.dashImgs ? "HTML from a headline was inserted into the dashboard" : null,
      ].filter(Boolean));
    });

    await t.check("Hostile text in stock and event headlines is shown as plain text, never run as code", async () => {
      const d = await b.run(`
        delete window.__xss;
        const evil = '<img src=x onerror="window.__xss=1">';
        const out = {};
        renderStockDetail({ id: 'eih', symbol: 'EIHOTEL.NS', name: 'EIH Ltd. (Oberoi)', range: '10d', history: [], relatedNews: [{ title: evil + 'Headline', publisher: evil, link: 'javascript:window.__xss=2', publishedAt: new Date().toISOString() }] });
        out.modalImgs = document.querySelectorAll('#modal-body img').length;
        out.modalHref = [...document.querySelectorAll('#modal-body .headline-list a')].map((a) => a.getAttribute('href'));
        const realHeadlines = currentHeadlines;
        currentHeadlines = { eih: { title: evil + 'Headline', publisher: evil, link: 'javascript:window.__xss=3', publishedAt: new Date().toISOString() } };
        renderStocks(currentStocksData);
        out.cardImgs = document.querySelectorAll('#stocks .stock-news img').length;
        out.cardHref = [...document.querySelectorAll('#stocks .stock-news')].map((a) => a.getAttribute('href'));
        currentHeadlines = realHeadlines; renderStocks(currentStocksData);
        const realEventNews = eventsNews;
        const first = eventsData.events.find((e) => !e.id.startsWith('hol-'));
        eventsNews = { [first.id]: { title: evil + 'Headline', publisher: evil, link: 'javascript:window.__xss=4', publishedAt: new Date().toISOString() } };
        renderEvents();
        out.eventImgs = document.querySelectorAll('#events-list .event-news img').length;
        out.eventHref = [...document.querySelectorAll('#events-list .event-news')].map((a) => a.getAttribute('href'));
        eventsNews = realEventNews; renderEvents();
        await new Promise((r) => setTimeout(r, 300));
        out.xss = window.__xss;
        return out;`);
      const js = (list) => list.some((h) => /^\s*javascript:/i.test(h || ""));
      expectNone([
        d.modalImgs ? "stock popup: HTML from a headline became live elements" : null,
        js(d.modalHref) ? "stock popup: a javascript: link was kept" : null,
        d.cardImgs ? "stock card: HTML from a headline became live elements" : null,
        js(d.cardHref) ? "stock card: a javascript: link was kept" : null,
        d.eventImgs ? "event card: HTML from a headline became live elements" : null,
        js(d.eventHref) ? "event card: a javascript: link was kept" : null,
        d.xss !== undefined ? `injected code ran (marker ${d.xss})` : null,
      ].filter(Boolean));
    });

    // ---- browser copy of server rules ------------------------------------------------

    await t.check("The browser's company tagging gives the same answers as the server's", async () => {
      const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases", "company-tags.json"), "utf-8")).cases;
      const { tagHeadline } = require("./01-rules");
      const browser = await b.run(`const m = stockMatchers(); return ${J(cases.map((c) => c.text))}.map((text) => { const hit = currentStocksData.quotes.map((q) => m.find((x) => x.q.id === q.id)).filter(Boolean).find((x) => matcherHits(x, text)); return hit ? hit.q.id : null; });`);
      expectNone(cases.map((c, i) => [c.text, browser[i], tagHeadline(c.text)]).filter(([, a, s]) => a !== s).map(([text, a, s]) => `"${text}": browser says ${a || "nothing"}, server says ${s || "nothing"}`));
      return `${cases.length} headlines`;
    });

    await t.check("The browser's same-story rule gives the same answers as the server's", async () => {
      const { sameStory } = lib("sameStory");
      const titles = ["Taj Opens Hessischer Hof in Frankfurt", "Taj celebrates the opening of Taj Hessischer Hof Frankfurt", "Marriott opens new hotel in Jaipur", "Hilton opens new hotel in Jaipur", "CPP Investments to invest Rs 3,000 crore in Prestige Hospitality Ventures for 27% stake", "CPP Investments picks up 27% stake in Prestige Hospitality Ventures for Rs 3,000 crore", "Hotel news", "Hotel news", "Goa"];
      const pairs = titles.flatMap((a, i) => titles.slice(i + 1).map((c) => [a, c]));
      const browser = await b.run(`return ${J(pairs)}.map(([a, c]) => dashSameStory(a, c));`);
      expectNone(pairs.filter(([a, c], i) => browser[i] !== sameStory(a, c)).map(([a, c]) => `"${a}" / "${c}"`));
    });

    // ---- sizes -----------------------------------------------------------------------

    await t.check("No screen scrolls sideways at desktop, laptop, tablet or phone widths", async () => {
      const out = [];
      for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [360, 740]]) {
        await fresh(w, h);
        for (const tab of TABS) {
          await b.clickTab(tab, 250);
          const over = await b.run(`return document.documentElement.scrollWidth - document.documentElement.clientWidth;`);
          if (over > 1) out.push(`${tab} at ${w}px wide overflows by ${over}px`);
        }
        const views = await b.run(`
          const bad = [];
          document.querySelector('.tab[data-tab=resources]').click();
          for (const v of ['tools', 'glossary', 'glossary-all', 'brief', 'case']) { openView(v); const over = document.documentElement.scrollWidth - document.documentElement.clientWidth; if (over > 1) bad.push('Resources ' + v + ' overflows by ' + over + 'px'); }
          openView('home');
          document.querySelector('.tab[data-tab=events]').click();
          document.querySelector('#events-view-controls [data-view=calendar]').click();
          const over = document.documentElement.scrollWidth - document.documentElement.clientWidth; if (over > 1) bad.push('calendar overflows by ' + over + 'px');
          document.querySelector('#events-view-controls [data-view=list]').click();
          return bad;`);
        out.push(...views.map((v) => `${v} at ${w}px wide`));
      }
      expectNone(out, 8);
    });

    await t.check("Phone layout: tabs sit in a bar at the bottom, and controls are big enough to tap", async () => {
      await fresh(390, 844);
      await b.clickTab("stocks", 300);
      const d = await b.run(`
        const nav = document.querySelector('.tabs').getBoundingClientRect();
        const small = [];
        for (const el of document.querySelectorAll('.tab, #stocks .filter select, #stocks-refresh-btn, #compare-btn, #stocks-list .star-btn')) { const r = el.getBoundingClientRect(); if (r.width && (r.height < 28 || r.width < 28)) small.push((el.id || el.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
        const tabs = [...document.querySelectorAll('.tab')].map((el) => el.getBoundingClientRect().height);
        return { position: getComputedStyle(document.querySelector('.tabs')).position, bottom: Math.round(window.innerHeight - nav.bottom), icons: [...document.querySelectorAll('.tab-icon')].every((i) => getComputedStyle(i).display !== 'none'), minTab: Math.min(...tabs), small: [...new Set(small)], bodyPad: parseFloat(getComputedStyle(document.body).paddingBottom), navHeight: nav.height, selectFont: parseFloat(getComputedStyle(document.querySelector('#stocks .filter select')).fontSize) };`);
      expectEqual([d.position, d.bottom], ["fixed", 0], "tab bar position");
      expect(d.icons, "tab icons are hidden on the phone layout");
      expect(d.minTab >= 40, `tabs are only ${Math.round(d.minTab)}px tall`);
      expectNone(d.small.map((s) => `too small to tap: ${s}`));
      expect(d.bodyPad >= d.navHeight - 2, "the bottom tab bar covers the end of the page");
      expect(d.selectFont >= 16, `dropdown text is ${d.selectFont}px (under 16px makes iPhones zoom in)`);
    });

    await t.check("Desktop layout: header stays in view, and no more than two cards sit side by side", async () => {
      await fresh(1440, 900);
      const d = await b.run(`
        const perRow = (sel) => { const tops = [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().top)); const counts = {}; tops.forEach((t) => (counts[t] = (counts[t] || 0) + 1)); return Math.max(0, ...Object.values(counts)); };
        const out = { header: getComputedStyle(document.querySelector('.topbar')).position, dash: perRow('#dashboard .dash-card') };
        document.querySelector('.tab[data-tab=news]').click(); out.news = perRow('#news-list .news-card');
        document.querySelector('.tab[data-tab=stocks]').click(); out.stocks = perRow('#stocks-list .stock-card');
        document.querySelector('.tab[data-tab=events]').click(); out.events = perRow('#events-list .event-card');
        document.querySelector('.tab[data-tab=resources]').click(); out.res = perRow('.res-card');
        out.width = document.querySelector('main').getBoundingClientRect().width;
        return out;`);
      expectEqual(d.header, "sticky", "header position");
      expectNone(Object.entries({ Dashboard: d.dash, News: d.news, "Stock Prices": d.stocks, "City Events": d.events, Resources: d.res }).filter(([, n]) => n > 2).map(([tab, n]) => `${tab} shows ${n} cards in a row`));
      expect(d.width <= 1100, `content is ${Math.round(d.width)}px wide`);
    });

    // ---- accessibility ---------------------------------------------------------------

    await t.check("Every button, dropdown and picture has a name a screen reader can announce", async () => {
      await fresh(1280, 900);
      const out = [];
      for (const tab of TABS) {
        await b.clickTab(tab, 250);
        out.push(...(await b.run(`
          const bad = [];
          const panel = document.querySelector('.tab-panel.active');
          for (const el of [...document.querySelectorAll('header button'), ...panel.querySelectorAll('button')]) if (!(el.textContent.trim() || el.getAttribute('aria-label') || el.title)) bad.push('${tab}: a button has no name (' + el.className + ')');
          for (const el of panel.querySelectorAll('select, input')) if (!(el.closest('label') || el.getAttribute('aria-label') || (el.id && document.querySelector('label[for="' + el.id + '"]')))) bad.push('${tab}: ' + (el.id || el.tagName) + ' has no label');
          for (const el of panel.querySelectorAll('img')) if (!el.hasAttribute('alt')) bad.push('${tab}: a picture has no alt attribute');
          return [...new Set(bad)];`)));
      }
      const h1 = await b.run(`return document.querySelectorAll('h1').length;`);
      if (h1 !== 1) out.push(`the page has ${h1} main headings (h1); it should have one`);
      expectNone(out);
    });

    // ---- when the server is unreachable ---------------------------------------------------

    await t.check("If the server goes down, returning visitors still see the last saved news and prices", async () => {
      await fresh(1280, 900);
      await b.blockUrls(["*/api/*"]);
      try {
        await b.open(`${base}/`, 3500);
        const d = await b.run(`
          document.querySelector('.tab[data-tab=news]').click();
          const out = { news: document.querySelectorAll('#news-list .news-card').length, banner: Boolean(document.querySelector('#news-list .offline-banner')) };
          document.querySelector('.tab[data-tab=stocks]').click();
          out.stocks = document.querySelectorAll('#stocks-list .stock-card').length; out.stockBanner = Boolean(document.querySelector('#stocks-list .offline-banner'));
          document.querySelector('.tab[data-tab=dashboard]').click();
          out.dashHeads = [...document.querySelectorAll('#dashboard .dash-card')][0].querySelectorAll('a.dash-row').length;
          return out;`);
        expect(d.news > 0 && d.banner, `News tab shows ${d.news} saved stories${d.banner ? "" : " and no 'showing saved data' notice"}`);
        expect(d.stocks > 0 && d.stockBanner, `Stock Prices shows ${d.stocks} saved prices${d.stockBanner ? "" : " and no 'showing saved data' notice"}`);
        expect(d.dashHeads > 0, "the dashboard shows no headlines from the saved news");
      } finally {
        await b.blockUrls([]);
      }
    });

    await t.check("If the server is down on a first visit, every tab says so instead of showing 'Loading' forever", async () => {
      await b.run(`localStorage.clear();`);
      await b.blockUrls(["*/api/*"]);
      try {
        await b.open(`${base}/`, 4000);
        const d = await b.run(`
          const text = (id) => document.getElementById(id).textContent.replace(/\\s+/g, ' ').trim();
          const out = { dashboard: text('dashboard') };
          for (const tab of ['news', 'stocks', 'events', 'resources']) { document.querySelector('.tab[data-tab=' + tab + ']').click(); await new Promise((r) => setTimeout(r, 1200)); out[tab] = text(tab === 'news' ? 'news-list' : tab === 'stocks' ? 'stocks-list' : tab === 'events' ? 'events-list' : 'res-content'); }
          return out;`);
        const stuck = Object.entries(d).filter(([, text]) => /Loading/.test(text)).map(([tab]) => `${tab} still says "Loading…"`);
        const silent = Object.entries(d).filter(([tab, text]) => tab !== "dashboard" && !/Failed|Couldn't|unavailable|Try again/i.test(text)).map(([tab, text]) => `${tab} gives no error message ("${text.slice(0, 40)}")`);
        expectNone([...stuck, ...silent]);
      } finally {
        await b.blockUrls([]);
        b.clearErrors();
      }
    });
  },
};
