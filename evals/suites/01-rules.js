// Rules: the fixed logic that decides what users see, tested on known examples.
// Needs nothing but the code (no server, browser or internet).

const fs = require("fs");
const path = require("path");
const { expect, expectEqual, expectNone } = require("../lib/harness");
const { read, hasContent, NO_CONTENT } = require("../lib/files");

const lib = (name) => require(path.join(__dirname, "..", "..", "lib", name));
const cases = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases", name), "utf-8")).cases;

const PROSE =
  "The company said the deal will close by March and add about 1,200 rooms across six cities. " +
  "Executives told reporters that demand from corporate travel and weddings has stayed strong through the year. " +
  "Analysts expect room rates to keep rising in the larger metros, while smaller markets see more new supply. " +
  "The group plans to fund the expansion from internal accruals and has no plans to raise debt.";
const SHORT = "The resort picked up the prize at a ceremony in the city on Friday evening, the company said.";
const HEADLINES = Array.from({ length: 12 }, (_, i) => `Major Hotel Group Signs New Resort Deal In City Number ${i}`).join(" ");
const BODIES = { prose: PROSE, short: SHORT, none: "", headlines: HEADLINES };
const SOURCES = {
  default: { id: "test", name: "Test feed", region: "India" },
  appointments: { id: "test", name: "Test feed", region: "India", dropAppointments: true },
  titleOnly: { id: "test", name: "Test feed", region: "India", titleOnly: true },
};

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

function newsItem(title, { body = PROSE, region = "India", feedId = "a", daysAgo = 0.5, link = "https://example.com/story" } = {}) {
  return { title, link, source: feedId, feedId, region, pubDate: iso(daysAgo), snippet: "", _text: body };
}

// Which listed company a headline is tagged with (first match wins, as in the app).
function tagHeadline(text) {
  const { matchesCompany } = lib("companyMatch");
  const hit = lib("stockSymbols").find((s) => matchesCompany(text, s.matchKeywords, s.excludePatterns, s.exactCaseKeywords));
  return hit ? hit.id : null;
}

module.exports = {
  id: "rules",
  title: "1. Rules (news filters, summaries, tagging, dates, markets)",
  about: "The fixed logic behind the tool, run against examples with known right answers.",
  needs: [],
  tagHeadline,

  async run(t) {
    const { splitSentences, extractiveSummary } = lib("summarize");
    const news = lib("fetchNews");

    // ---- news filters --------------------------------------------------------------

    await t.check("News filter keeps real stories and drops junk (labelled examples)", () => {
      const all = cases("news-filter.json");
      const wrong = [];
      for (const c of all) {
        const body = c.body === undefined ? PROSE : BODIES[c.body] !== undefined ? BODIES[c.body] : c.body;
        const item = { title: c.title, link: c.link || "https://example.com/story", pubDate: c.ageDays === null ? null : iso(c.ageDays === undefined ? 0.5 : c.ageDays), _text: body };
        const reason = news.dropReason(item, SOURCES[c.source || "default"]);
        const got = reason ? "drop" : "keep";
        if (got !== c.expect) wrong.push(`"${c.title}" should be ${c.expect === "keep" ? "kept" : "dropped"} (${c.why})${reason ? `, but was dropped as: ${reason}` : ""}`);
      }
      expectNone(wrong, 10);
      return `${all.length} examples`;
    });

    await t.check("Feed text is cleaned: tags removed, entities decoded, syndication footers cut", () => {
      expectEqual(news.stripHtml("<p>Hotels isn&apos;t &amp; won&#8217;t&nbsp;be <b>cheap</b></p>"), "Hotels isn't & won’t be cheap", "cleaned text");
      expectEqual(news.stripHtml("A real sentence. The post A story appeared first on Some Site."), "A real sentence.", "footer removal");
      expectEqual(news.stripHtml(null), "", "empty input");
    });

    await t.check("The daily selection holds at most 10 stories, newest first, with no feed flooding it", () => {
      // 12 feeds × 4 clearly different stories each.
      const brands = ["Marriott", "Hilton", "Hyatt", "Accor", "Radisson", "Wyndham", "Oberoi", "Leela", "Lemon Tree", "Sarovar", "Fortune", "Club Mahindra"];
      const stories = ["signs resort in Jaipur", "sells tower at Goa airport", "reports quarterly profit growth", "launches loyalty scheme for weddings"];
      const items = [];
      brands.forEach((brand, f) => {
        const region = f < 6 ? "India" : "Global";
        stories.forEach((story, i) => items.push(newsItem(`${brand} ${story}`, { feedId: `feed${f}`, region, daysAgo: 0.1 * (i + 1) + f * 0.01 })));
      });
      const picked = news.pickDaily(items);
      expectEqual(picked.length, 10, "stories picked");
      expectEqual(picked.filter((p) => p.region === "India").length, 6, "India stories (60% target)");
      const perFeed = {};
      for (const p of picked) perFeed[p.source] = (perFeed[p.source] || 0) + 1;
      expect(Math.max(...Object.values(perFeed)) <= 2, `one feed supplied ${Math.max(...Object.values(perFeed))} stories (limit 2)`);
      const dates = picked.map((p) => p.pubDate);
      expectEqual(dates, [...dates].sort().reverse(), "newest-first order");
      expect(picked.every((p) => !("feedId" in p)), "internal field feedId leaked into the output");
    });

    await t.check("A very active outlet gets at most 2 stories while other outlets have news", () => {
      const busy = ["opens resort in Jaipur", "sells tower at Goa airport", "reports quarterly profit growth", "launches loyalty scheme for weddings", "appoints regional revenue chief", "buys boutique chain in Kerala", "renovates flagship Mumbai property", "partners with airline on packages"];
      const items = busy.map((s, i) => newsItem(`Marriott ${s}`, { feedId: "busy", region: "India", daysAgo: 0.01 * (i + 1) }));
      ["Hilton", "Hyatt", "Accor"].forEach((brand, f) => ["signs lease in Pune", "adds rooms in Kochi", "wins contract in Indore"].forEach((s, i) => items.push(newsItem(`${brand} ${s}`, { feedId: `quiet${f}`, region: "India", daysAgo: 1 + f * 0.1 + i * 0.01 }))));
      ["Skift", "Dive"].forEach((brand, f) => ["covers airline merger talks", "tracks cruise demand surge", "reviews booking platform fees"].forEach((s, i) => items.push(newsItem(`${brand} ${s}`, { feedId: `global${f}`, region: "Global", daysAgo: 1 + f * 0.1 + i * 0.01 }))));
      const picked = news.pickDaily(items);
      const fromBusy = picked.filter((p) => p.source === "busy").length;
      expect(fromBusy <= 2, `the busiest outlet supplied ${fromBusy} of ${picked.length} stories (limit 2)`);
    });

    await t.check("The same story from two outlets is shown once", () => {
      const pairs = [
        ["Taj Opens Hessischer Hof in Frankfurt", "Taj celebrates the opening of Taj Hessischer Hof Frankfurt"],
        ["CPP Investments to invest Rs 3,000 crore in Prestige Hospitality Ventures for 27% stake", "CPP Investments picks up 27% stake in Prestige Hospitality Ventures for Rs 3,000 crore"],
        ["ITC Hotels Marks 50th Welcomhotel Property", "ITC Hotels marks its 50th Welcomhotel property with Jaipur opening"],
      ];
      const wrong = [];
      for (const [a, b] of pairs) {
        const picked = news.pickDaily([newsItem(a, { feedId: "x" }), newsItem(b, { feedId: "y", daysAgo: 0.7 })]);
        if (picked.length !== 1) wrong.push(`both kept: "${a}" / "${b}"`);
      }
      expectNone(wrong);
    });

    await t.check("Different stories that share common words are both kept", () => {
      const pairs = [
        ["Marriott opens new hotel in Jaipur", "Hilton opens new hotel in Jaipur"],
        ["Lemon Tree Hotels signs new property in Rishikesh", "Lemon Tree Hotels signs new property in Shimla"],
        ["Goa hotel occupancy rises in September", "Jaipur hotel occupancy falls in September"],
      ];
      const wrong = [];
      for (const [a, b] of pairs) {
        const picked = news.pickDaily([newsItem(a, { feedId: "x" }), newsItem(b, { feedId: "y", daysAgo: 0.7 })]);
        if (picked.length !== 2) wrong.push(`treated as one story: "${a}" / "${b}"`);
      }
      expectNone(wrong);
    });

    // ---- summaries -----------------------------------------------------------------

    await t.check("Sentence splitting respects decimals and abbreviations", () => {
      expectEqual(splitSentences("Revenue rose 2.5 per cent to Rs. 1.5 crore. Rates held."), ["Revenue rose 2.5 per cent to Rs. 1.5 crore.", "Rates held."], "decimals and Rs.");
      expectEqual(splitSentences("The 6,000 sq. ft. banquet hall opens Friday. U.S. RevPAR fell."), ["The 6,000 sq. ft. banquet hall opens Friday.", "U.S. RevPAR fell."], "sq. ft. and U.S.");
      expectEqual(splitSentences("Hosts on Vrbo.com pay no guest fees. But Vrbo has said it will keep them."), ["Hosts on Vrbo.com pay no guest fees.", "But Vrbo has said it will keep them."], "web addresses");
      expectEqual(splitSentences("A complete sentence. A fragment cut off by the feed..."), ["A complete sentence."], "trailing fragment dropped");
      expectEqual(splitSentences("No full stop at the end"), ["No full stop at the end."], "text with no terminator");
    });

    await t.check("Summaries are whole sentences, within 420 characters, with no repeats", () => {
      const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} says something specific about hotel demand in the city this quarter.`).join(" ");
      const s = extractiveSummary(long, []);
      expect(s.length > 0 && s.length <= 420, `summary is ${s.length} characters`);
      expect(/[.!?]$/.test(s), `summary does not end at a sentence end: "…${s.slice(-30)}"`);
      const dup = extractiveSummary("The same opening line appears here. The same opening line appears here. Then a new point is made.", []);
      expect(dup.split("The same opening line").length === 2, "a repeated sentence was kept twice");
      const lead = "X".repeat(430) + ". A short second sentence that fits.";
      expectEqual(extractiveSummary(lead, []), "A short second sentence that fits.", "an over-long first sentence is skipped, not clipped");
      expectEqual(extractiveSummary("", []), "", "no text gives an empty summary");
    });

    // ---- company tagging -----------------------------------------------------------

    const tagCases = cases("company-tags.json");
    const tagProblems = (level) =>
      tagCases
        .filter((c) => (c.level || "fail") === level)
        .filter((c) => tagHeadline(c.text) !== c.expect)
        .map((c) => `"${c.text}" tagged ${tagHeadline(c.text) || "nothing"}, should be ${c.expect || "nothing"}${c.why ? ` (${c.why})` : ""}`);

    await t.check("Headlines are tagged with the right listed company (labelled examples)", () => {
      expectNone(tagProblems("fail"), 10);
      return `${tagCases.filter((c) => (c.level || "fail") === "fail").length} examples`;
    });
    await t.warn("Company tagging: known hard cases", () => expectNone(tagProblems("warn")));

    await t.check("Stock-rating chatter is never shown as a company's latest news", () => {
      const re = { test: lib("stockChatter").isStockChatter };
      const chatter = ["Samhi Hotels Ltd Downgraded to Strong Sell Amid Weak Fundamentals", "Buy, Sell Or Hold: Indian Hotels, EIH, Chalet Hotels", "Lemon Tree Hotels share price target raised", "ITC Hotels shares jump 4% after results"];
      const news = ["SAMHI Hotels to Develop 162-Room Upscale Hotel in Noida", "ITC Hotels Marks 50th Welcomhotel Property", "Chalet Hotels completes ₹100 crore CP placement"];
      expectNone([...chatter.filter((h) => !re.test(h)).map((h) => `not filtered: "${h}"`), ...news.filter((h) => re.test(h)).map((h) => `wrongly filtered: "${h}"`)]);
    });

    // ---- dates, long weekends, holidays ---------------------------------------------

    const dates = lib("dates");
    await t.check("Date helpers handle month ends, leap years and the India-time day boundary", () => {
      expectEqual(dates.addDays("2026-12-31", 1), "2027-01-01", "year end");
      expectEqual(dates.addDays("2028-02-28", 1), "2028-02-29", "leap day");
      expectEqual(dates.addDays("2026-03-01", -1), "2026-02-28", "back over a month end");
      expectEqual(dates.weekday("2026-10-02"), 5, "2 Oct 2026 is a Friday");
      expectEqual(dates.todayIst(new Date("2026-10-01T18:29:59Z")), "2026-10-01", "one second before midnight in India");
      expectEqual(dates.todayIst(new Date("2026-10-01T18:30:00Z")), "2026-10-02", "midnight in India");
      expectEqual(dates.eachDay("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], "day range");
    });

    await t.check("Long weekends and bridge days are worked out correctly", () => {
      const { findLongWeekends } = lib("longWeekends");
      const find = (date, isPublic = true) => findLongWeekends([{ date, name: "Test holiday", public: isPublic }], "2026-10-01", "2026-11-30");
      const one = (date) => {
        const r = find(date);
        expectEqual(r.length, 1, `long weekends found for a holiday on ${date}`);
        return r[0];
      };
      let w = one("2026-10-02"); // Friday
      expectEqual([w.start, w.end, w.length, w.bridge], ["2026-10-02", "2026-10-04", 3, null], "Friday holiday");
      w = one("2026-11-09"); // Monday
      expectEqual([w.start, w.end, w.length], ["2026-11-07", "2026-11-09", 3], "Monday holiday");
      w = one("2026-10-20"); // Tuesday
      expectEqual([w.bridge.day, w.bridge.start, w.bridge.end, w.bridge.length], ["2026-10-19", "2026-10-17", "2026-10-20", 4], "Tuesday holiday bridged by Monday");
      w = one("2026-11-05"); // Thursday
      expectEqual([w.bridge.day, w.bridge.start, w.bridge.end, w.bridge.length], ["2026-11-06", "2026-11-05", "2026-11-08", 4], "Thursday holiday bridged by Friday");
      expectEqual(find("2026-11-04").length, 0, "Wednesday holiday makes no long weekend");
      expectEqual(find("2026-10-02", false).length, 0, "an observance (not a public holiday) makes no long weekend");
    });

    await t.check("The holiday calendar reader understands Google's calendar format", () => {
      const { parseIcs } = lib("fetchHolidays");
      const ics = [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20261108",
        "SUMMARY:Diwali/Deepavali",
        "DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Setti",
        " ngs",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20261002",
        "SUMMARY:Mahatma Gandhi Jayanti",
        "DESCRIPTION:Public holiday",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "DTSTART;VALUE=DATE:20270310",
        "SUMMARY:Ramzan Id (tentative)",
        "DESCRIPTION:Public holiday\\nDate is tentative and may change.",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      expectEqual(parseIcs(ics), [
        { date: "2026-10-02", name: "Mahatma Gandhi Jayanti", public: true, tentative: false },
        { date: "2026-11-08", name: "Diwali/Deepavali", public: false, tentative: false },
        { date: "2027-03-10", name: "Ramzan Id (tentative)", public: true, tentative: true },
      ], "parsed holidays");
    });

    // ---- stocks ---------------------------------------------------------------------

    const stocks = lib("fetchStocks");
    await t.check("Market open/closed status follows NSE hours in India time", () => {
      const at = (isoTime) => {
        const s = stocks.marketStatus(new Date(isoTime));
        return [s.open, s.lastCloseAt.toISOString()];
      };
      expectEqual(at("2026-09-30T04:30:00Z"), [true, "2026-09-29T10:00:00.000Z"], "Wednesday 10:00 IST");
      expectEqual(at("2026-09-30T03:44:00Z"), [false, "2026-09-29T10:00:00.000Z"], "Wednesday 09:14 IST (before the open)");
      expectEqual(at("2026-09-30T10:00:00Z"), [false, "2026-09-30T10:00:00.000Z"], "Wednesday 15:30 IST (the close)");
      expectEqual(at("2026-10-03T06:00:00Z"), [false, "2026-10-02T10:00:00.000Z"], "Saturday");
      expectEqual(at("2026-10-05T03:00:00Z"), [false, "2026-10-02T10:00:00.000Z"], "Monday before the open");
    });

    await t.check("Prices are refreshed every 10 minutes while trading and once after the close", () => {
      const quotes = lib("stockSymbols").map((s) => ({ id: s.id }));
      const stale = (generatedAt, now, q = quotes) => stocks.isStale({ generatedAt, quotes: q }, new Date(now));
      expectEqual(stale("2026-09-30T05:00:00Z", "2026-09-30T05:05:00Z"), false, "5 minutes old while trading");
      expectEqual(stale("2026-09-30T05:00:00Z", "2026-09-30T05:11:00Z"), true, "11 minutes old while trading");
      expectEqual(stale("2026-09-30T09:50:00Z", "2026-09-30T14:00:00Z"), true, "fetched before the close, read in the evening");
      expectEqual(stale("2026-09-30T10:20:00Z", "2026-10-01T02:00:00Z"), false, "fetched after the close, read next morning before the open");
      expectEqual(stale("2026-09-30T10:20:00Z", "2026-09-30T14:00:00Z", quotes.slice(1)), true, "a newly added ticker is missing from the saved prices");
      expectEqual(stocks.isStale(null), true, "no saved prices");
    });

    await t.check("Stock comparison starts every line at 100 and carries prices over non-trading days", () => {
      const { alignAndRebase } = lib("fetchStockCompare");
      const out = alignAndRebase([
        { entry: { id: "a", name: "A", symbol: "A" }, points: [{ date: "2026-09-01", close: 50 }, { date: "2026-09-02", close: 55 }, { date: "2026-09-03", close: 60 }] },
        { entry: { id: "b", name: "B", symbol: "B" }, points: [{ date: "2026-09-02", close: 200 }, { date: "2026-09-04", close: 190 }] },
      ]);
      expectEqual(out.dates, ["2026-09-02", "2026-09-03", "2026-09-04"], "common dates");
      expectEqual(out.series[0].values, [100, 109.09, 109.09], "series A (rebased to its 2 Sep close)");
      expectEqual(out.series[1].values, [100, 100, 95], "series B");
      expectEqual(out.series[1].changePercent, -5, "series B change");
    });

    // ---- air traffic ----------------------------------------------------------------

    await t.check("Airport figures are added up per city and bad months are held back", () => {
      const air = lib("airTraffic");
      expect(typeof air.buildMonth === "function", "lib/airTraffic.js does not export buildMonth, so its checks cannot be tested");
      const row = (current, lastYear) => ({ current, lastYear, pct: Math.round((current / lastYear - 1) * 1000) / 10 });
      const sections = { international: {}, domestic: {}, total: {} };
      for (const airports of Object.values(air.CITY_AIRPORTS)) {
        for (const a of airports) {
          sections.international[a] = row(100, 80);
          sections.domestic[a] = row(900, 920);
          sections.total[a] = row(1000, 1000);
        }
      }
      let built = air.buildMonth(sections, "2026-08");
      expectEqual(built.problems, [], "problems for a clean month");
      expectEqual(built.cities.goa.passengers, 2000, "Goa = Mopa + Dabolim");
      expectEqual(built.cities.goa.change, 0, "Goa change");

      sections.total.PUNE = { current: 1100, lastYear: 1000, pct: 25 };
      built = air.buildMonth(sections, "2026-08");
      expect(built.problems.some((p) => p.startsWith("PUNE: total")), "a total that is not international + domestic was not caught");
      expect(built.problems.some((p) => p.startsWith("PUNE: printed change")), "a printed % that does not match the figures was not caught");

      delete sections.total.KOCHI;
      expect(air.buildMonth(sections, "2026-08").problems.some((p) => p.startsWith("KOCHI: not found")), "a missing airport was not caught");
    });

    // ---- found by the independent review ------------------------------------------------

    await t.check("On a stock-exchange holiday the market shows as closed, with the previous trading day as the last close", () => {
      const quote = (asOf) => [{ id: "a", currency: "INR", asOf }, { id: "mmyt", currency: "USD", asOf: "2026-10-01T20:00:00Z" }];
      const at = (now, asOf, generatedAt = now) => {
        const m = stocks.effectiveMarket(quote(asOf), new Date(now), new Date(generatedAt));
        return [m.open, m.holiday, m.lastCloseAt.toISOString()];
      };
      // Fri 2 Oct 2026 (Gandhi Jayanti): the last trade was Thursday's close.
      expectEqual(at("2026-10-02T06:00:00Z", "2026-10-01T09:59:00Z"), [false, true, "2026-10-01T10:00:00.000Z"], "11:30 IST on the holiday");
      expectEqual(at("2026-10-02T10:30:00Z", "2026-10-01T09:59:00Z"), [false, false, "2026-10-01T10:00:00.000Z"], "16:00 IST on the holiday");
      expectEqual(at("2026-10-03T06:00:00Z", "2026-10-01T09:59:00Z"), [false, false, "2026-10-01T10:00:00.000Z"], "the Saturday after");
      // An ordinary day.
      expectEqual(at("2026-09-30T06:00:00Z", "2026-09-30T05:58:00Z"), [true, false, "2026-09-29T10:00:00.000Z"], "trading normally");
      expectEqual(at("2026-09-30T11:00:00Z", "2026-09-30T09:59:00Z"), [false, false, "2026-09-30T10:00:00.000Z"], "after an ordinary close");
      // Trading hours but the saved prices are old (the refresh has not run yet): not a holiday.
      expectEqual(at("2026-09-30T06:00:00Z", "2026-09-29T09:59:00Z", "2026-09-29T10:20:00Z")[1], false, "stale prices are not mistaken for a holiday");
    });

    await t.check("Chart prices are dated as the exchange saw them; a weekly price is dated to that week's Friday", () => {
      const { historyPoints } = lib("fetchStockDetail");
      const ts = (iso) => Date.parse(iso) / 1000;
      // NSE weekly bars start Monday 00:00 India time (Sunday 18:30 UTC).
      const weekly = { meta: { gmtoffset: 19800, regularMarketTime: ts("2026-09-30T10:00:00Z") }, timestamp: [ts("2026-09-13T18:30:00Z"), ts("2026-09-20T18:30:00Z"), ts("2026-09-27T18:30:00Z")], indicators: { quote: [{ close: [290, 294.7, 301.1] }] } };
      expectEqual(historyPoints(weekly, true), [{ date: "2026-09-18", close: 290 }, { date: "2026-09-25", close: 294.7 }, { date: "2026-09-30", close: 301.1 }], "weekly bars (the current week is dated to the last day traded)");
      const daily = { meta: { gmtoffset: 19800 }, timestamp: [ts("2026-09-29T03:45:00Z"), ts("2026-09-30T03:45:00Z")], indicators: { quote: [{ close: [100, null] }] } };
      expectEqual(historyPoints(daily, false), [{ date: "2026-09-29", close: 100 }], "daily bars, skipping a day with no price");
      // A US stock's weekly bar starts Monday 00:00 New York time; it must land on the same Friday as the NSE one.
      const us = { meta: { gmtoffset: -14400, regularMarketTime: ts("2026-09-30T20:00:00Z") }, timestamp: [ts("2026-09-21T04:00:00Z")], indicators: { quote: [{ close: [47] }] } };
      expectEqual(historyPoints(us, true)[0].date, "2026-09-25", "US weekly bar");
    });

    await t.check("Company headlines: no analyst chatter, nothing over six weeks old, no story twice", () => {
      const { pickHeadlines } = lib("fetchStockDetail");
      const { isStockChatter } = lib("stockChatter");
      const now = Date.parse("2026-09-30T00:00:00Z");
      const item = (title, daysAgo) => ({ title, publishedAt: new Date(now - daysAgo * 86400000).toISOString() });
      const picked = pickHeadlines(
        [item("Taj Opens Hessischer Hof in Frankfurt", 1), item("Taj celebrates the opening of Taj Hessischer Hof Frankfurt", 1), item("Indian Hotels gains nearly 6% after block deal", 2), item("IHCL signs a new Taj hotel in Jaipur", 3), item("IHCL opens Taj in Kochi", 60), item("IHCL to add 30 hotels", 5), item("IHCL names new finance chief", 6)],
        3,
        now
      ).map((n) => n.title);
      expectEqual(picked, ["Taj Opens Hessischer Hof in Frankfurt", "IHCL signs a new Taj hotel in Jaipur", "IHCL to add 30 hotels"], "headlines picked");
      const chatter = ["Mahindra Holidays: Stock Signals to Watch This Week", "Thomas Cook India vs ixigo (Le Travenues Technology) vs TBO Tek", "Devyani International gains nearly 6% after block deal", "Jubilant FoodWorks stock reports 9 percent Q1 revenue growth", "Cost of goods sold of MakeMyTrip Ltd. – HAN:MY1", "Top 3 QSR Stocks in India 2026"];
      const news = ["Lemon Tree Hotels revenue rises 12% in second quarter", "Yatra Online wins new corporate travel accounts", "EIH to open Oberoi resort in Goa"];
      expectNone([...chatter.filter((h) => !isStockChatter(h)).map((h) => `not filtered: "${h}"`), ...news.filter((h) => isStockChatter(h)).map((h) => `wrongly filtered: "${h}"`)]);
    });

    await t.check("An event's 'In the news' line is only a story about that edition in that city", () => {
      const { storyFitsEvent } = lib("eventNews");
      const t20 = { name: "India vs West Indies, 1st T20I", category: "sports", cities: ["lucknow"], start: "2026-10-06", end: "2026-10-06" };
      const imtex = { name: "IMTEX 2027", category: "expo", cities: ["bengaluru"], start: "2027-01-21", end: "2027-01-27" };
      const iitf = { name: "India International Trade Fair (IITF)", category: "expo", cities: ["delhi"], start: "2026-11-13", end: "2026-11-27" };
      const cases = [
        [t20, "India vs West Indies LIVE Score, 2nd ODI: Gill chooses to bowl", false, "another match of the tour, in another city"],
        [t20, "Lucknow gears up for India vs West Indies T20I at Ekana", true, "names the city"],
        [imtex, "IMTEX Forming 2026 concludes with record orders", false, "last year's edition"],
        [imtex, "IMTEX 2027 to showcase machine tools in Bengaluru", true, "this edition"],
        [iitf, "46-year IITF tradition ends: India trade fair to open on Nov 13", true, "no year or city needed for an expo"],
        [iitf, "Licensable picture: crowds at IITF", false, "a stock photo, not news"],
        [iitf, "Photos: IITF pavilions draw crowds", false, "a photo gallery"],
      ];
      expectNone(cases.filter(([e, title, want]) => storyFitsEvent(e, title) !== want).map(([e, title, want, why]) => `"${title}" should be ${want ? "shown" : "left out"} for ${e.name} (${why})`));
    });

    await t.check("Sentence splitting copes with more abbreviations (p.m., No., Pvt., M/s.)", () => {
      expectEqual(splitSentences("Doors open at 5 p.m. on Friday. It is the No. 1 hotel brand."), ["Doors open at 5 p.m. on Friday.", "It is the No. 1 hotel brand."], "p.m. and No.");
      expectEqual(splitSentences("M/s. Sharma Hotels Pvt. Ltd. signed the lease. Work starts in May."), ["M/s. Sharma Hotels Pvt. Ltd. signed the lease.", "Work starts in May."], "M/s., Pvt. and Ltd.");
    });

    await t.check("Summaries leave out picture credits and a sentence repeated under a label", () => {
      const text = "Skift Take: The expected return of visitors matters. Photo Credit: Saadiyat Rotana in Abu Dhabi. The expected return of visitors matters. Rotana plans ten openings next year.";
      expectEqual(extractiveSummary(text, []), "Skift Take: The expected return of visitors matters. Rotana plans ten openings next year.", "summary");
    });

    await t.check("The server only fetches article pages from public web addresses", () => {
      const { isSafeToFetch } = lib("summarize");
      const bad = ["http://localhost:3000/api/health", "http://127.0.0.1/", "http://10.0.0.5/admin", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://example.com/x", "https://user:pass@example.com/", "not a url"];
      const good = ["https://www.hotelierindia.com/story", "http://example.com/a"];
      expectNone([...bad.filter(isSafeToFetch).map((u) => `allowed: ${u}`), ...good.filter((u) => !isSafeToFetch(u)).map((u) => `refused: ${u}`)]);
    });

    // ---- publishing schedule ---------------------------------------------------------

    if (!hasContent()) {
      t.skip("Publishing schedule and preview mode", NO_CONTENT);
      return;
    }

    await t.check("Every article and case study goes live at midnight India time on its date, and not before", () => {
      const { getResources } = lib("resources");
      const wrong = [];
      const walk = (items, key, label) => {
        const sorted = [...items].sort((a, b) => a.publishDate.localeCompare(b.publishDate));
        sorted.forEach((item, i) => {
          const midnightIst = Date.parse(`${item.publishDate}T00:00:00Z`) - 5.5 * 3600000;
          const before = getResources({ now: new Date(midnightIst - 60000) });
          const after = getResources({ now: new Date(midnightIst + 60000) });
          const prev = i ? sorted[i - 1].id : null;
          if (((before[key] || {}).id || null) !== prev) wrong.push(`${label} "${item.id}": a minute before its date the page shows ${(before[key] || {}).id || "nothing"}, expected ${prev || "nothing"}`);
          if ((after[key] || {}).id !== item.id) wrong.push(`${label} "${item.id}": a minute after midnight on ${item.publishDate} the page shows ${(after[key] || {}).id || "nothing"}`);
          const leaked = sorted.slice(i + 1).find((later) => JSON.stringify(after).includes(JSON.stringify(later.title)));
          if (leaked) wrong.push(`${label} "${leaked.id}" is sent to the browser before its date`);
        });
      };
      const briefs = read("briefs.json").articles;
      const studies = read("case-studies.json").cases;
      walk(briefs, "brief", "article");
      walk(studies, "caseStudy", "case study");
      expectNone(wrong);
      return `${briefs.length} articles, ${studies.length} case studies`;
    });

    await t.check("Preview mode shows the next unpublished piece, or the pieces due by a given date", () => {
      const { getResources } = lib("resources");
      const briefs = read("briefs.json").articles.map((a) => a.publishDate).sort();
      const lastCase = read("case-studies.json").cases.map((c) => c.publishDate).sort().pop();
      // The day the first article went live: the second one is still unpublished.
      const now = new Date(Date.parse(`${briefs[0]}T06:00:00Z`));
      const normal = getResources({ now });
      const next = getResources({ now, preview: true });
      expectEqual(normal.brief.publishDate, briefs[0], "article shown without preview");
      expectEqual(next.brief.publishDate, briefs[1], "article shown with preview on");
      expectEqual(next.brief.publishDate, normal.nextBriefDate, "previewed article's date");
      const dated = getResources({ now, preview: lastCase });
      expectEqual(dated.caseStudy.publishDate, lastCase, "case study shown when previewing the last scheduled date");
    });
  },
};
