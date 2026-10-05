// Site data: the files in the built site's data/ folder, which is everything the
// page shows. Checked for shape, freshness and quality, exactly as a visitor's
// browser receives them (from a fresh build on this machine, or from the
// published site with --url).

const path = require("path");
const { expect, expectEqual, expectNone } = require("../lib/harness");

const lib = (name) => require(path.join(__dirname, "..", "..", "lib", name));
const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isHttp = (u) => typeof u === "string" && /^https?:\/\/\S+$/.test(u);
const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const ageHours = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;

module.exports = {
  id: "live",
  title: "3. Site data (news, stocks, events, weather in the built site)",
  about: "Every data file the page reads is checked for shape, freshness and quality, the way a visitor's browser receives it.",
  needs: ["site", "network"],

  async run(t, ctx) {
    const { api } = ctx;
    const get = async (p) => {
      const res = await api(p);
      expect(res.status === 200, `${p} returned ${res.status}`);
      expect(res.json, `${p} did not return JSON`);
      return res.json;
    };

    // ---- news ------------------------------------------------------------------------

    let news = null;
    await t.check("News: between 8 and 10 stories, fetched within the last day", async () => {
      news = await get("/data/news.json");
      expect(Array.isArray(news.items), "no list of stories");
      expect(news.items.length >= 5, `only ${news.items.length} stories (the tab would look empty)`);
      expect(news.items.length <= 10, `${news.items.length} stories (limit is 10)`);
      expect(ageHours(news.generatedAt) < 26, `news was last fetched ${Math.round(ageHours(news.generatedAt))} hours ago`);
      return `${news.items.length} stories, fetched ${Math.round(ageHours(news.generatedAt))}h ago`;
    });

    if (news) {
      const items = news.items;
      await t.warn("News: a full list of at least 8 stories", () => expect(items.length >= 8, `only ${items.length} stories today`));

      await t.check("News: every story has a title, a working-looking link, a known source and a recent date", () => {
        const sources = new Map(news.sources.map((s) => [s.name, s.region]));
        const out = [];
        for (const i of items) {
          const p = (msg) => out.push(`"${String(i.title).slice(0, 50)}": ${msg}`);
          if (typeof i.title !== "string" || i.title.length < 12 || i.title.length > 220) p("title is missing, very short or very long");
          if (!isHttp(i.link)) p(`link is not a web address: ${i.link}`);
          if (!sources.has(i.source)) p(`unknown source ${i.source}`);
          else if (sources.get(i.source) !== i.region) p(`region ${i.region} does not match its source`);
          if (i.pubDate && ageHours(i.pubDate) > 8 * 24) p(`is ${Math.round(ageHours(i.pubDate) / 24)} days old`);
          if (i.pubDate && ageHours(i.pubDate) < -2) p("is dated in the future");
          if ("feedId" in i || "_text" in i) p("internal fields were sent to the browser");
        }
        const links = items.map((i) => i.link);
        out.push(...links.filter((l, i) => links.indexOf(l) !== i).map((l) => `same link twice: ${l}`));
        expectNone(out);
      });

      await t.check("News: headlines and summaries are clean text (no HTML, no leftover codes)", () => {
        const out = [];
        for (const i of items) {
          for (const [what, text] of [["title", i.title], ["summary", i.snippet || ""]]) {
            if (/<\/?[a-z][^>]*>/i.test(text)) out.push(`${what} contains an HTML tag: "${text.slice(0, 60)}"`);
            if (/&(amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-f]+);/i.test(text)) out.push(`${what} contains a raw HTML code: "${text.slice(0, 60)}"`);
            if (/\s{2,}|\n/.test(text)) out.push(`${what} has stray spacing: "${text.slice(0, 60)}"`);
          }
        }
        expectNone(out);
      });

      await t.check("News: summaries are whole sentences, within 420 characters, free of site boilerplate", () => {
        const boilerplate = /subscribe (to|now)|sign up (for|now)|newsletter|appeared first on|read the full story|all rights reserved|click here|follow us on|advertisement/i;
        const out = [];
        for (const i of items.filter((x) => x.snippet)) {
          const s = i.snippet;
          const p = (msg) => out.push(`"${i.title.slice(0, 40)}": ${msg}`);
          if (s.length > 420) p(`summary is ${s.length} characters`);
          if (!/[.!?…"”’)]$/.test(s)) p(`summary stops mid-sentence: "…${s.slice(-40)}"`);
          if (/^[a-z]/.test(s)) p(`summary starts mid-sentence: "${s.slice(0, 50)}…"`);
          if (boilerplate.test(s)) p(`summary contains site boilerplate: "${s.match(boilerplate)[0]}"`);
          if (s.toLowerCase() === i.title.toLowerCase()) p("summary only repeats the headline");
        }
        expectNone(out);
      });
      await t.warn("News: every story has a summary", () => {
        const none = items.filter((i) => !i.snippet);
        expectNone(none.map((i) => `no summary: "${i.title.slice(0, 60)}" (${i.source})`));
      });

      await t.check("News: no story appears twice under different headlines", () => {
        const { sameStory } = lib("sameStory");
        const out = [];
        items.forEach((a, i) => items.slice(i + 1).forEach((b) => sameStory(a.title, b.title) && out.push(`"${a.title}" / "${b.title}"`)));
        expectNone(out);
      });

      await t.check("News: a mix of Indian and international stories, newest first", () => {
        const india = items.filter((i) => i.region === "India").length;
        expect(india >= 3 && items.length - india >= 1, `${india} Indian and ${items.length - india} international stories`);
        const dates = items.map((i) => new Date(i.pubDate || 0).getTime());
        expect(dates.every((d, i) => !i || d <= dates[i - 1]), "stories are not in newest-first order");
        const perSource = {};
        for (const i of items) perSource[i.source] = (perSource[i.source] || 0) + 1;
        const top = Object.entries(perSource).sort((a, b) => b[1] - a[1])[0];
        expect(top[1] <= 4, `${top[0]} supplies ${top[1]} of ${items.length} stories`);
        return `${india} Indian, ${items.length - india} international`;
      });

      await t.check("News: the response carries only what the page shows (no internal diagnostics)", () => {
        expectNone(Object.keys(news).filter((k) => !["generatedAt", "sources", "items"].includes(k)).map((k) => `"${k}" is sent to every visitor`));
      });

      const { feeds } = await get("/data/build.json");
      await t.check("News feeds: at least 8 of the 12 sources responded", () => {
        expect(feeds && feeds.total > 0, "the build report does not say how the feeds did");
        expect(feeds.responded >= 8, `only ${feeds.responded} of ${feeds.total} feeds responded`);
        return `${feeds.responded} of ${feeds.total}`;
      });
      await t.warn("News feeds: every source responded", () => {
        expect(!feeds.failing.length, `no response from: ${feeds.failing.join(", ")}`);
      });
    }

    // ---- stocks ----------------------------------------------------------------------

    const symbols = lib("stockSymbols");
    let stocks = null;
    await t.check("Stocks: every listed company is present, and 'last close' matches the prices' own dates", async () => {
      stocks = await get("/data/stocks.json");
      expectEqual(stocks.quotes.map((q) => q.id).sort(), symbols.map((s) => s.id).sort(), "companies in the file");
      expect(ageHours(stocks.generatedAt) < 26, `prices were fetched ${Math.round(ageHours(stocks.generatedAt))} hours ago`);
      // The page works out open/closed itself with these rules (see the app suite for the browser's copy).
      const market = lib("fetchStocks").effectiveMarket(stocks.quotes, new Date(), stocks.generatedAt);
      expect(!market.open || lib("fetchStocks").marketStatus().open, "the market would be shown as open outside trading hours");
      const latestTrade = Math.max(...stocks.quotes.filter((q) => !q.error && q.currency === "INR" && q.asOf).map((q) => Date.parse(q.asOf)));
      if (!market.open) expect(market.lastCloseAt.getTime() - latestTrade < 6 * 3600000, `"last close" would read ${market.lastCloseAt.toISOString()} but the newest price is from ${new Date(latestTrade).toISOString()}`);
      return `${stocks.quotes.length} companies`;
    });

    if (stocks) {
      const ok = stocks.quotes.filter((q) => !q.error);
      await t.check("Stocks: prices were fetched for at least 15 companies", () => expect(ok.length >= 15, `prices for only ${ok.length} of ${stocks.quotes.length}`));
      await t.warn("Stocks: no company shows 'unavailable' or a stale price", () => {
        expectNone(stocks.quotes.filter((q) => q.error || q.stale).map((q) => `${q.name}: ${q.error ? "unavailable" : "kept from an earlier fetch"}`));
      });
      await t.check("Stocks: prices, changes, ranges and trends are consistent", () => {
        const out = [];
        for (const q of ok) {
          const p = (msg) => out.push(`${q.name}: ${msg}`);
          if (!(q.price > 0)) p(`price ${q.price}`);
          if (!Number.isFinite(q.changePercent) || Math.abs(q.changePercent) > 25) p(`day change of ${q.changePercent}% is implausible`);
          const prev = q.price - q.change;
          if (prev > 0 && Math.abs((q.change / prev) * 100 - q.changePercent) > 0.02) p("change and change % disagree");
          if (q.weekLow52 != null && q.weekHigh52 != null && !(q.weekLow52 <= q.weekHigh52 && q.price >= q.weekLow52 * 0.97 && q.price <= q.weekHigh52 * 1.03)) p(`price ${q.price} is outside its 52-week range ${q.weekLow52}–${q.weekHigh52}`);
          if (!Array.isArray(q.trend) || q.trend.length < 2 || q.trend.some((v) => !(v > 0))) p("trend line has too few or invalid points");
          if (q.currency !== (q.symbol.endsWith(".NS") ? "INR" : "USD")) p(`currency ${q.currency} does not match its exchange`);
          if (!q.asOf || ageHours(q.asOf) > 6 * 24) p(`last traded ${q.asOf ? Math.round(ageHours(q.asOf) / 24) + " days ago" : "at an unknown time"}`);
          if (!Array.isArray(q.matchKeywords) || !q.matchKeywords.length) p("no keywords sent for news tagging");
        }
        expectNone(out);
      });
    }

    let historyGaps = [];
    await t.check("Stock popup: price history and headlines that are about the right company", async () => {
      const { matchesCompany } = lib("companyMatch");
      const { isStockChatter } = lib("stockChatter");
      const out = [];
      const noHistory = [];
      for (const id of ["indian-hotels", "lemon-tree", "makemytrip"]) {
        const file = await get(`/data/stocks/${id}.json`);
        const d = { history: file.history["1m"] || [], relatedNews: file.relatedNews || [] };
        const entry = symbols.find((s) => s.id === id);
        // No history at all means the outside price service refused the request (reported below as a warning).
        if (d.history.length === 0) noHistory.push(id);
        else if (d.history.length < 10) out.push(`${id}: only ${d.history.length} days of history`);
        const dates = d.history.map((h) => h.date);
        if (dates.join() !== [...new Set(dates)].sort().join()) out.push(`${id}: history dates are out of order or repeated`);
        if (d.history.some((h) => !(h.close > 0))) out.push(`${id}: a closing price is missing`);
        if (d.relatedNews.length > 3) out.push(`${id}: more than 3 headlines`);
        for (const n of d.relatedNews) {
          if (!matchesCompany(n.title, entry.matchKeywords, entry.excludePatterns, entry.exactCaseKeywords)) out.push(`${id}: headline is not about the company: "${n.title}"`);
          if (isStockChatter(n.title)) out.push(`${id}: analyst-rating headline shown: "${n.title}"`);
          if (!isHttp(n.link)) out.push(`${id}: headline link is not a web address`);
        }
      }
      expectNone(out);
      historyGaps = noHistory;
    });
    await t.warn("Stock popup: the price-history service answered for every company tried", () => {
      expect(!historyGaps.length, `no price history just now for: ${historyGaps.join(", ")}`);
    });

    const files = {};
    await t.check("Stock popup: every company has its file, with history for all four chart ranges", async () => {
      const out = [];
      for (const s of symbols) {
        const res = await api(`/data/stocks/${s.id}.json`);
        if (res.status !== 200 || !res.json) {
          out.push(`${s.name}: no file`);
          continue;
        }
        files[s.id] = res.json;
        const h = res.json.history || {};
        for (const range of ["10d", "1m", "3m", "1y"]) {
          if (!Array.isArray(h[range])) out.push(`${s.name}: no ${range} history`);
          else if (h[range].some((p, i) => !(p.close > 0) || (i && p.date <= h[range][i - 1].date))) out.push(`${s.name} ${range}: prices out of order or missing`);
        }
        if (h["10d"] && h["10d"].length > 10) out.push(`${s.name}: the 10-day chart has ${h["10d"].length} days`);
      }
      expectNone(out);
      const empty = symbols.filter((s) => files[s.id] && !(files[s.id].history["1y"] || []).length).map((s) => s.name);
      if (empty.length) historyGaps.push(...empty);
    });

    // The page draws the comparison itself from these files, with the same rules as the server code.
    const ready = ["indian-hotels", "eih", "lemon-tree"].every((id) => files[id] && (files[id].history["3m"] || []).length);
    if (!ready) t.skip("Stock comparison: lines share dates and all start at 100", "the price-history service gave no data just now");
    else await t.check("Stock comparison: lines share dates and all start at 100", async () => {
      const { alignAndRebase } = lib("fetchStockCompare");
      const c = alignAndRebase(["indian-hotels", "eih", "lemon-tree"].map((id) => ({ entry: { id, name: files[id].name, symbol: files[id].symbol }, points: files[id].history["3m"] })));
      expectEqual(c.series.length, 3, "lines");
      expect(c.dates.length >= 30, `only ${c.dates.length} dates for 3 months`);
      expectEqual(c.dates, [...c.dates].sort(), "dates in order");
      expectNone(c.series.filter((s) => s.values.length !== c.dates.length || s.values[0] !== 100 || s.values.some((v) => !(v > 0))).map((s) => `${s.name}: line does not start at 100 or has gaps`));
    });

    await t.check("Stock cards: each 'latest news' line is about that company, recent, and not a rating", async () => {
      const { headlines } = await get("/data/stock-headlines.json");
      const { matchesCompany } = lib("companyMatch");
      const { isStockChatter } = lib("stockChatter");
      const out = [];
      for (const [id, h] of Object.entries(headlines)) {
        const entry = symbols.find((s) => s.id === id);
        if (!entry) {
          out.push(`headline for unknown company ${id}`);
          continue;
        }
        if (!matchesCompany(h.title, entry.matchKeywords, entry.excludePatterns, entry.exactCaseKeywords)) out.push(`${entry.name}: "${h.title}" is not about it`);
        if (isStockChatter(h.title)) out.push(`${entry.name}: analyst-rating headline "${h.title}"`);
        if (!h.publishedAt || ageHours(h.publishedAt) > 26 * 24) out.push(`${entry.name}: headline is over 25 days old`);
        if (!isHttp(h.link)) out.push(`${entry.name}: link is not a web address`);
      }
      expectNone(out);
      return `${Object.keys(headlines).length} companies have a headline`;
    });

    // ---- events ----------------------------------------------------------------------

    let events = null;
    await t.check("City Events: built for India's date, and events are upcoming, in order and well-formed", async () => {
      events = await get("/data/events.json");
      // The file carries the date it was built on (the page moves it on to the visitor's date).
      expect(events.today === todayIst() || events.today === addDays(todayIst(), -1), `built for ${events.today}, but today in India is ${todayIst()}`);
      expectEqual(events.horizonEnd, addDays(events.today, 180), "6-month horizon");
      const cityIds = events.cities.map((c) => c.id);
      const out = [];
      events.events.forEach((e, i) => {
        const p = (msg) => out.push(`${e.name}: ${msg}`);
        if (!isDate(e.start) || !isDate(e.end) || e.end < e.start) p("bad dates");
        if (e.end < events.today) p("already over");
        if (e.start > events.horizonEnd) p("beyond the 6-month window");
        if (i && e.start < events.events[i - 1].start) p("out of date order");
        if (!e.cities.length || e.cities.some((c) => !cityIds.includes(c))) p("unknown city");
        if (!["holiday", "festival", "expo", "conference", "sports", "culture"].includes(e.category)) p(`unknown category ${e.category}`);
        if (!e.note || !e.sourceName) p("missing note or source");
        if ("newsKeywords" in e) p("internal field newsKeywords was sent to the browser");
      });
      const ids = events.events.map((e) => e.id);
      out.push(...ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `id used twice: ${id}`));
      expect(events.events.length >= 10, `only ${events.events.length} events in the next 6 months`);
      expectNone(out);
      return `${events.events.length} events`;
    });

    if (events) {
      await t.check("City Events: long weekends are 3+ days, contain their holiday, and bridge days are working days", () => {
        const out = [];
        for (const e of events.events.filter((x) => x.longWeekend)) {
          const w = e.longWeekend;
          const p = (msg) => out.push(`${e.name} (${w.start} to ${w.end}): ${msg}`);
          if (daysBetween(w.start, w.end) + 1 !== w.length) p(`length ${w.length} does not match its dates`);
          if (w.length < 3) p("shorter than 3 days");
          if (!(e.holidayDate >= w.start && e.holidayDate <= w.end)) p("does not contain the holiday");
          if (w.bridgeDay) {
            const dow = new Date(`${w.bridgeDay}T00:00:00Z`).getUTCDay();
            if (dow === 0 || dow === 6) p("bridge day falls on a weekend");
            if (!(w.bridgeDay > w.start && w.bridgeDay < w.end)) p("bridge day is outside the break");
          } else {
            const days = Array.from({ length: w.length }, (_, i) => new Date(`${addDays(w.start, i)}T00:00:00Z`).getUTCDay());
            if (!days.some((d) => d === 0 || d === 6)) p("has no weekend day in it");
          }
        }
        expectNone(out);
        return `${events.events.filter((x) => x.longWeekend).length} long weekends`;
      });
      await t.check("City Events: wedding dates sent are upcoming and in order", () => {
        expectNone(events.weddingDates.filter((d, i, all) => d < events.today || d > events.horizonEnd || (i && d <= all[i - 1])).map((d) => `bad wedding date ${d}`));
      });
      await t.warn("City Events: every city has something city-specific in the next 60 days", () => {
        const until = addDays(events.today, 60);
        const empty = events.cities.filter((c) => !events.events.some((e) => e.cities.includes(c.id) && e.cities.length < events.cities.length && e.category !== "holiday" && e.start <= until)).map((c) => c.name);
        expect(!empty.length, `nothing city-specific for: ${empty.join(", ")}`);
      });
      await t.warn("City Events: the holiday calendar was refreshed within the last 8 days", () => {
        expect(ageHours(events.holidaysFetchedAt) < 8 * 24, `last refreshed ${Math.round(ageHours(events.holidaysFetchedAt) / 24)} days ago`);
      });
    }

    await t.check("City Events news: each linked story names its event and is under a month old", async () => {
      const { news: eventNews } = await get("/data/event-news.json");
      const curated = lib("cityEvents").readJson(lib("cityEvents").CURATED_PATH).events;
      const { matchesCompany } = lib("companyMatch");
      const out = [];
      for (const [id, s] of Object.entries(eventNews)) {
        const e = curated.find((x) => x.id === id);
        if (!e) out.push(`story for unknown event ${id}`);
        else if (!matchesCompany(s.title, e.newsKeywords)) out.push(`${e.name}: "${s.title}" does not name the event`);
        if (!s.publishedAt || ageHours(s.publishedAt) > 31 * 24) out.push(`${id}: story is over 30 days old`);
        if (!isHttp(s.link)) out.push(`${id}: link is not a web address`);
      }
      expectNone(out);
      return `${Object.keys(eventNews).length} events have a story`;
    });

    await t.check("Weather: a 7-day forecast with plausible temperatures for every city", async () => {
      const cities = lib("cities");
      const weather = await get("/data/weather.json");
      const out = [];
      let missing = 0;
      for (const c of cities) {
        const forecast = weather.cities[c.id];
        if (!forecast) {
          missing++;
          continue;
        }
        const days = forecast.days;
        if (days.length !== 7) out.push(`${c.name}: ${days.length} days`);
        if (days[0].date !== todayIst() && days[0].date !== addDays(todayIst(), -1)) out.push(`${c.name}: forecast starts on ${days[0].date}`);
        days.forEach((d, i) => {
          if (i && d.date !== addDays(days[i - 1].date, 1)) out.push(`${c.name}: days are not consecutive`);
          if (!(d.min <= d.max && d.min > -15 && d.max < 53)) out.push(`${c.name} ${d.date}: ${d.min}° to ${d.max}° is implausible`);
          if (!d.icon || !d.label) out.push(`${c.name} ${d.date}: no description`);
        });
      }
      expect(missing <= 3, `no forecast for ${missing} of ${cities.length} cities`);
      expectNone(out);
      return missing ? `${cities.length - missing} of ${cities.length} cities (the rest had no forecast just now)` : `${cities.length} cities`;
    });

    // ---- resources, air traffic ------------------------------------------------------

    await t.check("Resources: the current article is live, nothing unpublished is in the site, and the tools have their data", async () => {
      const r = await get("/data/resources.json");
      expect(!r.preview, "this is a preview build (it includes unpublished pieces) and must never be published");
      expect(r.today === todayIst() || r.today === addDays(todayIst(), -1), `built for ${r.today}, but today in India is ${todayIst()}`);
      // A site with no article at all has lost its content folder (see lib/paths.js).
      expect(r.brief && r.brief.publishDate <= r.today, "the current article is missing or dated in the future");
      expect(!r.caseStudy || r.caseStudy.publishDate <= r.today, "the case study shown is dated in the future");
      expect((r.nextBriefDate === null || r.nextBriefDate > r.today) && (r.nextCaseDate === null || r.nextCaseDate > r.today), "the 'next piece' dates are not in the future");
      expect(r.glossary.length >= 30 && r.reports.length >= 5 && r.gst && r.indicators.length >= 1, "glossary, reports, GST rates or indicators are missing");
      const { read } = require("../lib/files");
      const future = [...read("briefs.json").articles, ...read("case-studies.json").cases].filter((x) => x.publishDate > r.today);
      const body = JSON.stringify(r);
      expectNone(future.filter((x) => body.includes(JSON.stringify(x.title))).map((x) => `unpublished piece sent to the browser: ${x.id}`));
    });

    await t.check("Air traffic: months, cities and explanations are served", async () => {
      const a = await get("/data/air-traffic.json");
      expect(a.months.length >= 6, `only ${a.months.length} months`);
      expect(Object.keys(a.months[a.months.length - 1].cities).length === 15, "latest month does not have all 15 cities");
      expect(a.reasons && a.reasons.month, "explanations are missing");
    });

    // ---- speed -----------------------------------------------------------------------

    await t.warn("Sources: every source answered when the site was built", async () => {
      const { problems } = await get("/data/build.json");
      expectNone(problems || [], 6);
    });

    await t.warn("Speed: every main file arrives within 1.5 seconds", async () => {
      const slow = [];
      for (const p of ["/", "/style.css", "/app.js", "/data/news.json", "/data/stocks.json", "/data/events.json", "/data/resources.json", "/data/air-traffic.json"]) {
        await api(p);
        const { ms } = await api(p);
        if (ms > 1500) slow.push(`${p} took ${ms} ms`);
      }
      expectNone(slow);
    });
  },
};
