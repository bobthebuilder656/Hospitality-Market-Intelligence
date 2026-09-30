// Content: every hand-maintained data file is complete, consistent and correctly
// scheduled. Needs nothing but the files (no server, browser or internet).

const fs = require("fs");
const path = require("path");
const { expect, expectEqual, expectNone } = require("../lib/harness");

const { ROOT, DATA_DIR: DATA, CONTENT_DIR, read, hasContent, NO_CONTENT } = require("../lib/files");

const PUBLIC = path.join(ROOT, "public");
const lib = (name) => require(path.join(ROOT, "lib", name));

const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);
const isUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);
const filled = (v) => typeof v === "string" && v.trim().length > 0;
const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// All the running text of an article or case study.
function paragraphs(item) {
  return [item.dek, item.theme, ...item.sections.flatMap((s) => [...(s.body || []), ...(s.after || [])]), ...(item.takeaways || []), ...(item.limitations || [])].filter(Boolean);
}

function textProblems(item) {
  const out = [];
  for (const p of paragraphs(item)) {
    const where = `"${p.slice(0, 40)}…"`;
    if (/\b(TODO|TBD|TBC|lorem ipsum|xxx)\b/i.test(p)) out.push(`placeholder text in ${where}`);
    // Stars inside a link address or inside a word ("p**s" in a quote) are not bold markers.
    const markers = p.replace(/\]\([^)]*\)/g, "]").replace(/\w\*+\w/g, "");
    if ((markers.match(/\*\*/g) || []).length % 2) out.push(`unbalanced ** (bold) in ${where}`);
    if (/\]\((?!https?:\/\/[^)\s]+\))/.test(p)) out.push(`broken link markup in ${where}`);
    if (/\[[^\]]*\]\s+\(http/.test(p)) out.push(`space between link text and address in ${where}`);
    if (/ {2,}/.test(p.trim())) out.push(`double space in ${where}`);
    if (/<[a-z/][^>]*>/i.test(p)) out.push(`HTML tag in ${where}`);
  }
  return out;
}

// Contractions outside direct quotes (case studies avoid them).
function contractions(item) {
  const found = [];
  for (const p of paragraphs(item)) {
    const unquoted = p.replace(/"[^"]*"|“[^”]*”/g, " ");
    const hits = unquoted.match(/\b\w+(?:n['’]t|['’]re|['’]ve|['’]ll)\b|\b(?:it|that|there|here|what|who|he|she|let)['’]s\b|\bI['’]m\b/gi);
    if (hits) found.push(...hits);
  }
  return found;
}

function longReadProblems(item, kind, days) {
  const out = [];
  const need = (cond, msg) => cond || out.push(msg);
  need(filled(item.id) && /^[a-z0-9-]+$/.test(item.id), "id must be lowercase letters, digits and hyphens");
  need(isDate(item.publishDate), `publishDate "${item.publishDate}" is not a valid date`);
  if (isDate(item.publishDate)) need(days.includes(weekday(item.publishDate)), `publishDate ${item.publishDate} is not a ${kind === "case study" ? "Friday" : "Wednesday or Sunday"}`);
  need(filled(item.title) && item.title.length <= 110, "title is missing or longer than 110 characters");
  need(filled(item.dek), "dek (the standfirst) is missing");
  need(Number.isFinite(item.minutes) && item.minutes >= 1 && item.minutes <= 20, "minutes (reading time) is missing or implausible");
  need(Array.isArray(item.sections) && item.sections.length >= 3, "fewer than 3 sections");
  for (const s of item.sections || []) {
    need(Array.isArray(s.body) && s.body.length && s.body.every(filled), `section "${s.heading || "(opening)"}" has an empty body`);
    if (s.table) need(Array.isArray(s.table.head) && Array.isArray(s.table.rows) && s.table.rows.every((r) => r.length === s.table.head.length), `table in "${s.heading || "(opening)"}" has rows that do not match its header`);
  }
  need(Array.isArray(item.takeaways) && item.takeaways.length >= 3, "fewer than 3 takeaways");
  need(Array.isArray(item.sources) && item.sources.length >= 1, "no sources listed");
  for (const s of item.sources || []) {
    need(filled(s.name), "a source has no name");
    if (s.url !== undefined) need(isUrl(s.url), `source address is not a web link: ${s.url}`);
  }
  if (item.image) {
    const img = item.image;
    // Pictures are served from the content folder at /images/…
    need(filled(img.src) && /^images\//.test(img.src) && fs.existsSync(path.join(CONTENT_DIR, img.src)), `image file is missing: ${img.src}`);
    need(filled(img.alt), "image has no alt text");
    need(filled(img.credit) && isUrl(img.creditUrl) && filled(img.license), "image is missing its credit, credit link or licence");
  }
  if (item.link) need((item.link.tab && ["news", "stocks", "events", "resources", "dashboard"].includes(item.link.tab)) || (item.link.view && ["tools", "glossary", "glossary-all", "brief", "case"].includes(item.link.view)), "internal link points to a tab or view that does not exist");
  if (kind === "case study") {
    need(filled(item.theme), "theme (the main message) is missing");
    need(Array.isArray(item.limitations) && item.limitations.length >= 1, "limitations note is missing");
    need(Array.isArray(item.stats) && item.stats.length >= 2 && item.stats.length <= 3 && item.stats.every((s) => filled(s.value) && filled(s.label)), "needs 2 or 3 key numbers, each with a value and a label");
    need(!(item.sections || []).some((s) => /discussion|questions? (for|to)/i.test(s.heading || "")), "has a discussion-questions section (case studies do not carry one)");
    need(paragraphs(item).some((p) => /\]\(https?:\/\//.test(p)), "no fact in the text is linked to a source");
  }
  out.push(...textProblems(item));
  return out.map((p) => `${item.id}: ${p}`);
}

// Every slot between the first and last piece must be filled, or the page would
// show an old piece on a day readers expect a new one.
function scheduleGaps(items, days) {
  const dates = items.map((i) => i.publishDate).sort();
  const gaps = [];
  for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDays(d, 1)) if (days.includes(weekday(d)) && !dates.includes(d)) gaps.push(d);
  return gaps;
}

// WCAG contrast ratio between two #rrggbb colours.
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

module.exports = {
  id: "content",
  title: "2. Content (articles, case studies, glossary, events, reference data)",
  about: "Every hand-maintained file is complete, consistent, correctly scheduled and points at files that exist.",
  needs: [],

  async run(t) {
    await t.check("Every data file is valid JSON", () => {
      const bad = fs.readdirSync(DATA).filter((f) => f.endsWith(".json")).filter((f) => {
        try {
          read(f);
          return false;
        } catch {
          return true;
        }
      });
      expectNone(bad.map((f) => `${f} cannot be read`));
    });

    // ---- The Hotelier's Brief and case studies ---------------------------------------

    const briefs = read("briefs.json").articles;
    const studies = read("case-studies.json").cases;

    if (!hasContent()) t.skip("Articles and case studies: completeness, schedule, reading times, house rules", NO_CONTENT);
    else await this.longReads(t, briefs, studies);

    await this.reference(t, briefs, studies);
  },

  async longReads(t, briefs, studies) {
    await t.check("Articles (The Hotelier's Brief) are complete and well-formed", () => {
      expectNone(briefs.flatMap((b) => longReadProblems(b, "article", [0, 3])), 8);
      return `${briefs.length} articles`;
    });
    await t.check("Case studies are complete and follow the house rules", () => {
      expectNone(studies.flatMap((c) => longReadProblems(c, "case study", [5])), 8);
      return `${studies.length} case studies`;
    });
    await t.check("No two pieces share an id, a title or a publish date", () => {
      const dup = (list, key) => list.map((i) => i[key]).filter((v, i, all) => all.indexOf(v) !== i);
      expectNone([
        ...dup(briefs, "id").map((v) => `article id used twice: ${v}`),
        ...dup(briefs, "publishDate").map((v) => `two articles on ${v}`),
        ...dup(briefs, "title").map((v) => `article title used twice: ${v}`),
        ...dup(studies, "id").map((v) => `case study id used twice: ${v}`),
        ...dup(studies, "publishDate").map((v) => `two case studies on ${v}`),
        ...dup(studies, "title").map((v) => `case study title used twice: ${v}`),
      ]);
    });
    await t.check("The publishing schedule has no empty slots", () => {
      expectNone([...scheduleGaps(briefs, [0, 3]).map((d) => `no article for ${d}`), ...scheduleGaps(studies, [5]).map((d) => `no case study for ${d}`)]);
    });
    await t.warn("Scheduled content runs at least 3 weeks ahead", () => {
      const soon = addDays(todayIst(), 21);
      const lastBrief = briefs.map((b) => b.publishDate).sort().pop();
      const lastCase = studies.map((c) => c.publishDate).sort().pop();
      expectNone([lastBrief < soon ? `articles run out on ${lastBrief}` : null, lastCase < soon ? `case studies run out on ${lastCase}` : null].filter(Boolean));
      return `articles to ${lastBrief}, case studies to ${lastCase}`;
    });
    await t.warn("Stated reading times match the length of each piece", () => {
      // About 200 words a minute, counting headings and tables but not link addresses.
      const words = (i) =>
        [i.title, ...paragraphs(i), ...i.sections.flatMap((s) => [s.heading || "", ...(s.table ? [...s.table.head, ...s.table.rows.flat().map(String)] : [])])]
          .join(" ")
          .replace(/\]\([^)]*\)/g, "]")
          .split(/\s+/)
          .filter(Boolean).length;
      const off = [...briefs, ...studies]
        .map((i) => ({ i, est: words(i) / 200 }))
        .filter(({ i, est }) => Math.abs(i.minutes - est) > 1.5)
        .map(({ i, est }) => `${i.id}: says ${i.minutes} min, about ${Math.round(est)} min at ${words(i)} words`);
      expectNone(off, 4);
    });
    await t.warn("Case studies avoid contractions outside direct quotes", () => {
      expectNone(studies.map((c) => [c.id, contractions(c)]).filter(([, hits]) => hits.length).map(([id, hits]) => `${id}: ${[...new Set(hits)].slice(0, 5).join(", ")}`));
    });

  },

  async reference(t, briefs, studies) {
    // ---- glossary ------------------------------------------------------------------------

    await t.check("Glossary terms are complete, unique and grouped", () => {
      const terms = read("glossary.json").terms;
      const groups = ["performance", "pricing", "sales", "revenue", "distribution"];
      const out = [];
      for (const g of terms) {
        if (!filled(g.term)) out.push("a term has no name");
        if (!groups.includes(g.group)) out.push(`${g.term}: unknown group "${g.group}"`);
        if (!filled(g.short) || g.short.length > 170) out.push(`${g.term}: short line is missing or over 170 characters (it is shown on the dashboard)`);
        if (!filled(g.definition) || !filled(g.example)) out.push(`${g.term}: missing definition or example`);
      }
      const names = terms.map((g) => g.term.toLowerCase());
      out.push(...names.filter((n, i) => names.indexOf(n) !== i).map((n) => `term listed twice: ${n}`));
      expect(terms.length >= 30, `only ${terms.length} terms (one is shown each day)`);
      expectNone(out);
      return `${terms.length} terms`;
    });

    // ---- cities, events, weddings, holidays --------------------------------------------------

    const cities = lib("cities");
    const cityIds = cities.map((c) => c.id);

    await t.check("Cities: coordinates are in India and seasons cover each month exactly once", () => {
      const out = [];
      for (const c of cities) {
        if (!(c.lat > 6 && c.lat < 36 && c.lon > 68 && c.lon < 98)) out.push(`${c.name}: coordinates are outside India`);
        const count = Array(13).fill(0);
        for (const s of c.seasons) for (let m = s.from; ; m = (m % 12) + 1) {
          count[m]++;
          if (m === s.to) break;
        }
        const bad = count.slice(1).map((n, i) => (n === 1 ? null : i + 1)).filter(Boolean);
        if (bad.length) out.push(`${c.name}: month(s) ${bad.join(", ")} covered ${count[bad[0]]} times by its seasons`);
      }
      expectEqual(new Set(cityIds).size, cities.length, "unique city ids");
      const airports = Object.keys(lib("airTraffic").CITY_AIRPORTS);
      out.push(...cityIds.filter((id) => !airports.includes(id)).map((id) => `${id}: no airport listed for air traffic`));
      expectNone(out);
      return `${cities.length} cities`;
    });

    const curated = read("events-curated.json").events;
    await t.check("Curated events are complete, with valid dates, cities and sources", () => {
      const categories = ["expo", "conference", "sports", "culture", "festival"];
      const out = [];
      for (const e of curated) {
        const p = (msg) => out.push(`${e.id || e.name}: ${msg}`);
        if (!filled(e.id) || !filled(e.name) || !filled(e.note)) p("missing id, name or note");
        if (!categories.includes(e.category)) p(`unknown category "${e.category}"`);
        if (!isDate(e.start) || !isDate(e.end)) p("start or end is not a valid date");
        else if (e.end < e.start) p("ends before it starts");
        else if (Date.parse(e.end) - Date.parse(e.start) > 45 * 86400000) p("lasts more than 45 days");
        if (!Array.isArray(e.cities) || !e.cities.length || e.cities.some((c) => !cityIds.includes(c))) p(`unknown city in ${JSON.stringify(e.cities)}`);
        if (!isUrl(e.source)) p("source is not a web link");
        if (e.image && !isUrl(e.image) && !fs.existsSync(path.join(PUBLIC, e.image))) p(`picture is missing: ${e.image}`);
        if (e.newsKeywords && !(Array.isArray(e.newsKeywords) && e.newsKeywords.every(filled))) p("newsKeywords must be a list of words");
        for (const re of e.newsExclude || []) {
          try {
            new RegExp(re, "i");
          } catch {
            p(`newsExclude pattern is not valid: ${re}`);
          }
        }
      }
      const ids = curated.map((e) => e.id);
      out.push(...ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `id used twice: ${id}`));
      expectNone(out);
      return `${curated.length} events`;
    });
    await t.warn("Curated events reach at least 3 months ahead", () => {
      const last = curated.map((e) => e.start).sort().pop();
      expect(last >= addDays(todayIst(), 90), `the last curated event starts on ${last}; add events further ahead`);
      return `to ${last}`;
    });

    await t.check("Festival rules point at real cities and have sensible spans", () => {
      const rules = lib("festivalRules");
      const out = [];
      for (const r of rules) {
        if (!filled(r.match) || !filled(r.name) || !filled(r.note)) out.push(`${r.match}: missing name or note`);
        if (!["festival", "holiday"].includes(r.category)) out.push(`${r.match}: unknown category`);
        if (r.cities.some((c) => !cityIds.includes(c))) out.push(`${r.match}: unknown city`);
        if (r.span && !(r.span[0] <= 0 && r.span[1] >= 0 && r.span[1] - r.span[0] <= 12)) out.push(`${r.match}: span ${JSON.stringify(r.span)} looks wrong`);
      }
      expectNone(out);
    });
    await t.warn("Every festival rule still matches a name in the holiday calendar", () => {
      const names = new Set(read("holidays.json").holidays.filter((h) => h.date >= todayIst()).map((h) => h.name));
      const dead = lib("festivalRules").filter((r) => !names.has(r.match)).map((r) => `"${r.match}" is not in the calendar's upcoming holidays, so ${r.name} would silently lose its description and dates`);
      expectNone(dead);
    });

    await t.check("Wedding dates are valid, in order and backed by at least two sources", () => {
      const w = read("wedding-dates.json");
      expectNone(w.dates.filter((d) => !isDate(d)).map((d) => `not a date: ${d}`));
      expectEqual(w.dates, [...new Set(w.dates)].sort(), "dates (sorted, no repeats)");
      expect(w.sources.length >= 2, "fewer than two sources listed");
    });
    await t.warn("Wedding dates do not run out within 90 days", () => {
      const last = read("wedding-dates.json").dates.slice(-1)[0];
      expect(last > addDays(todayIst(), 90), `the list ends on ${last}; add the next season`);
      return `to ${last}`;
    });

    await t.check("Holiday calendar covers the next 6 months and marks public holidays", () => {
      const h = read("holidays.json").holidays;
      const horizon = addDays(todayIst(), 180);
      const upcoming = h.filter((x) => x.date >= todayIst() && x.date <= horizon);
      expect(upcoming.length >= 10, `only ${upcoming.length} holidays in the next 6 months`);
      expect(upcoming.some((x) => x.public), "no public holidays in the next 6 months");
      expect(h.some((x) => x.date > horizon), "the calendar ends inside the 6-month window");
      expectNone(h.filter((x) => !isDate(x.date) || !filled(x.name) || typeof x.public !== "boolean").slice(0, 3).map((x) => `malformed entry ${JSON.stringify(x)}`));
    });

    // ---- air traffic and indicators ------------------------------------------------------------

    const air = read("air-traffic.json");
    await t.check("Air traffic: every month has all cities and its percentages match its figures", () => {
      const out = [];
      air.months.forEach((m, i) => {
        if (!/^\d{4}-\d{2}$/.test(m.month)) out.push(`bad month key ${m.month}`);
        if (!isHttps(m.pdfUrl)) out.push(`${m.month}: source PDF link missing`);
        if (i) {
          const [y, mo] = air.months[i - 1].month.split("-").map(Number);
          const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
          if (m.month !== next) out.push(`${air.months[i - 1].month} is followed by ${m.month} (a month is missing)`);
        }
        for (const id of cityIds) {
          const v = m.cities[id];
          if (!v) {
            out.push(`${m.month}: ${id} is missing`);
            continue;
          }
          if (!(v.passengers > 0 && v.lastYear > 0)) out.push(`${m.month} ${id}: passenger figure is zero or missing`);
          else if (Math.abs(v.change - Math.round((v.passengers / v.lastYear - 1) * 1000) / 10) > 0.051) out.push(`${m.month} ${id}: change ${v.change}% does not match ${v.passengers} vs ${v.lastYear}`);
          if (Math.abs(v.change) > 60) out.push(`${m.month} ${id}: change of ${v.change}% is implausible`);
        }
      });
      expectNone(out);
      return `${air.months.length} months, ${air.months[0].month} to ${air.months[air.months.length - 1].month}`;
    });
    await t.warn("Air traffic is up to date and no month is held back", () => {
      const latest = air.months[air.months.length - 1].month;
      const age = (Date.now() - Date.parse(`${latest}-01T00:00:00Z`)) / 86400000;
      expectNone([age > 110 ? `latest month is ${latest}; AAI normally publishes within 4 weeks of month end` : null, ...(air.held || []).map((h) => `${h.month} failed its checks: ${h.problems.slice(0, 2).join("; ")}`)].filter(Boolean));
      return `latest ${latest}`;
    });
    await t.check("Air traffic explanations are sourced and name real cities", () => {
      const r = read("air-reasons.json");
      const out = [];
      for (const [id, c] of Object.entries(r.cities)) {
        if (!cityIds.includes(id)) out.push(`unknown city ${id}`);
        if (!["city", "national"].includes(c.basis)) out.push(`${id}: basis must be 'city' or 'national'`);
        if (c.basis === "city" && !(filled(c.text) && (c.sources || []).length && c.sources.every((s) => filled(s.name) && isUrl(s.url)))) out.push(`${id}: a city-specific reason needs text and a linked source`);
      }
      for (const key of ["all", "national"]) if (!(filled(r[key].text) && r[key].sources.every((s) => isUrl(s.url)))) out.push(`${key}: missing text or source links`);
      expectNone(out);
    });
    await t.warn("Air traffic explanations are for the latest month (otherwise they are hidden)", () => {
      expectEqual(read("air-reasons.json").month, air.months[air.months.length - 1].month, "month the explanations were written for");
    });

    await t.check("Market indicators have values, periods and sources", () => {
      const out = [];
      for (const file of ["market-indicators.json", "dashboard-indicators.json"]) {
        for (const ind of read(file).indicators) {
          const p = (msg) => out.push(`${file} ${ind.id}: ${msg}`);
          if (!filled(ind.title) || !filled(ind.measures) || !filled(ind.period)) p("missing title, description or period");
          if (!filled(ind.value) && !ind.compare) p("has neither a value nor a comparison table");
          if (!Array.isArray(ind.whatItMeans) || !ind.whatItMeans.length) p("no 'what it means' points");
          for (const s of [...(ind.official || []), ...(ind.reported || [])]) if (!filled(s.name) || !isUrl(s.url)) p(`source without a name or link: ${JSON.stringify(s)}`);
          if (!(ind.official || []).length) p("no official source");
          if (ind.compare && !ind.compare.rows.every((r) => r.values.length === ind.compare.columns.length)) p("comparison table rows do not match its columns");
        }
      }
      expectNone(out);
    });

    await t.check("GST slabs and the reports list are well-formed", () => {
      const libr = read("resources-library.json");
      const slabs = libr.gst.roomSlabs;
      const out = [];
      if (slabs[slabs.length - 1].upTo !== null) out.push("the last room slab must have no upper limit");
      slabs.slice(0, -1).forEach((s, i) => {
        if (!(s.upTo > 0) || (i && s.upTo <= slabs[i - 1].upTo)) out.push("room slabs are not in ascending order");
      });
      if (slabs.some((s) => !(s.rate >= 0 && s.rate <= 28))) out.push("a room slab has an implausible GST rate");
      if (!(libr.gst.food.standard >= 0 && libr.gst.food.specifiedPremises >= libr.gst.food.standard)) out.push("food GST rates look wrong");
      if (!isDate(libr.gst.effectiveFrom)) out.push("GST effective date is not a date");
      if (!libr.gst.sources.length || !libr.gst.sources.every((s) => isUrl(s.url))) out.push("GST rates need linked sources");
      for (const r of libr.reports) {
        if (!["market", "travel"].includes(r.group)) out.push(`${r.name}: unknown group "${r.group}"`);
        if (!filled(r.name) || !filled(r.publisher) || !filled(r.about) || !isUrl(r.url)) out.push(`${r.name}: missing publisher, description or link`);
      }
      expectNone(out);
    });

    // ---- configuration -----------------------------------------------------------------------------

    await t.check("Stock list: ids and symbols are unique, keywords and patterns are valid", () => {
      const symbols = lib("stockSymbols");
      const out = [];
      for (const s of symbols) {
        if (!["hotel", "restaurant", "ota"].includes(s.category)) out.push(`${s.id}: unknown category`);
        if (!Array.isArray(s.matchKeywords) || !s.matchKeywords.length) out.push(`${s.id}: no matchKeywords`);
        else if (s.matchKeywords.some((k) => k !== k.toLowerCase() || k.length < 3)) out.push(`${s.id}: keywords must be lowercase and at least 3 letters`);
        if (!filled(s.domain) || !filled(s.symbol)) out.push(`${s.id}: missing symbol or domain`);
        for (const re of s.excludePatterns || []) {
          try {
            new RegExp(re, "gi");
          } catch {
            out.push(`${s.id}: excludePattern is not valid: ${re}`);
          }
        }
      }
      for (const key of ["id", "symbol"]) out.push(...symbols.map((s) => s[key]).filter((v, i, all) => all.indexOf(v) !== i).map((v) => `${key} used twice: ${v}`));
      for (const cat of ["hotel", "restaurant", "ota"]) if (!symbols.some((s) => s.category === cat)) out.push(`no stocks in category ${cat}`);
      expectNone(out);
      return `${symbols.length} stocks`;
    });

    await t.check("News sources: unique, secure links, a mix of Indian and international", () => {
      const sources = lib("sources");
      const out = sources.filter((s) => !isHttps(s.url) || !filled(s.name) || !["India", "Global"].includes(s.region)).map((s) => `${s.id}: needs an https link, a name and a region`);
      out.push(...sources.map((s) => s.id).filter((v, i, all) => all.indexOf(v) !== i).map((v) => `id used twice: ${v}`));
      const india = sources.filter((s) => s.region === "India").length;
      if (india < 4 || sources.length - india < 4) out.push(`needs at least 4 Indian and 4 international sources (has ${india} and ${sources.length - india})`);
      expectNone(out);
      return `${sources.length} sources`;
    });

    // ---- pictures and design tokens --------------------------------------------------------------------

    await t.warn("Pictures: none unused, none over 600 KB", () => {
      const dir = path.join(CONTENT_DIR, "images");
      const files = [];
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
      if (fs.existsSync(dir)) walk(dir);
      const used = JSON.stringify([briefs, studies, curated]);
      const out = [];
      for (const f of files) {
        const rel = path.relative(CONTENT_DIR, f).replace(/\\/g, "/");
        if (!used.includes(rel)) out.push(`${rel} is not used anywhere`);
        const kb = Math.round(fs.statSync(f).size / 1024);
        if (kb > 600) out.push(`${rel} is ${kb} KB (slow on mobile data)`);
      }
      expectNone(out);
      return `${files.length} pictures`;
    });

    await t.check("Text colours are readable against their backgrounds (WCAG AA)", () => {
      const css = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf-8");
      const token = (name) => {
        const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
        expect(m, `colour token --${name} not found in style.css`);
        return m[1];
      };
      const pairs = [
        ["text", "panel", 4.5, "body text on a card"],
        ["text", "bg", 4.5, "body text on the page"],
        ["muted", "panel", 4.5, "grey text on a card"],
        ["muted", "bg", 4.5, "grey text on the page"],
        ["muted", "soft", 4.5, "grey text on a soft panel"],
        ["orange-dark", "panel", 4.5, "orange links on a card"],
        ["orange-dark", "bg", 4.5, "orange links on the page"],
        ["text", "yellow", 4.5, "black text on yellow (header, buttons)"],
        ["text", "yellow-soft", 4.5, "text on pale yellow"],
      ];
      expectNone(pairs.map(([fg, bg, min, what]) => [what, contrast(token(fg), token(bg)), min]).filter(([, ratio, min]) => ratio < min).map(([what, ratio, min]) => `${what}: contrast ${ratio.toFixed(2)} is below ${min}`));
    });
  },
};
