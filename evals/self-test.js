// Tests the tests. Each entry below plants one deliberate bug in a throwaway copy
// of the project, runs the evals against that copy, and records whether they
// noticed. A bug the evals miss ("NOT CAUGHT") marks a real gap in the checks.
//
// This is the unbiased measure of the evals: it does not depend on whoever wrote
// them believing they are thorough. Nothing in the real project is touched.
//
//   npm run evals:self-test                   every planted bug (about 15 minutes)
//   npm run evals:self-test -- --group=quick  only the fast ones (under a minute)
//   groups: quick, app, deploy

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// what: the bug in plain words. file: relative path. find/replace: the edit
// (find must occur exactly once), or mutate(text) for edits that need code.
const json = (fn) => (text) => {
  const data = JSON.parse(text);
  fn(data);
  return JSON.stringify(data, null, 2);
};

const BUGS = [
  // ---- quick: caught (or not) by the rules and content suites ----
  { group: "quick", what: "Saturdays stop counting as days off for long weekends", file: "lib/longWeekends.js", find: "weekday(d) === 6 || ", replace: "" },
  { group: "quick", what: "India's clock is set an hour wrong", file: "lib/dates.js", find: "const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;", replace: "const IST_OFFSET_MS = 4.5 * 60 * 60 * 1000;" },
  { group: "quick", what: "Stories with no text are let through", file: "lib/newsFilters.js", find: "const MIN_BODY_CHARS = 60;", replace: "const MIN_BODY_CHARS = 0;" },
  { group: "quick", what: "Summaries are allowed to be ten times longer", file: "lib/summarize.js", find: "const SUMMARY_MAX_CHARS = 420;", replace: "const SUMMARY_MAX_CHARS = 4200;" },
  { group: "quick", what: "Any shared word makes two headlines 'the same story'", file: "lib/sameStory.js", find: "return [...small].every((w) => large.has(w));", replace: "return [...small].some((w) => large.has(w));" },
  { group: "quick", what: "Look-alike phrases (Taj Mahal, Oberoi Realty) are no longer excluded from tagging", file: "lib/companyMatch.js", find: "for (const source of excludePatterns || []) cleaned", replace: "for (const source of []) cleaned" },
  { group: "quick", what: "The market is treated as open an hour past the close", file: "lib/fetchStocks.js", find: "const MARKET_CLOSE_MINUTE = 15 * 60 + 30;", replace: "const MARKET_CLOSE_MINUTE = 16 * 60 + 30;" },
  { group: "quick", what: "Articles go live a day late", file: "lib/resources.js", find: "const published = sorted.filter((i) => i.publishDate <= cutoff);", replace: "const published = sorted.filter((i) => i.publishDate < cutoff);" },
  { group: "quick", what: "The stock comparison chart is calculated upside down", file: "lib/fetchStockCompare.js", find: "return Math.round((last / base) * 10000) / 100;", replace: "return Math.round((base / last) * 10000) / 100;" },
  { group: "quick", what: "Airport figures that do not match their printed % are accepted", file: "lib/airTraffic.js", find: "if (Math.abs(calc - t.pct) > 0.15)", replace: "if (Math.abs(calc - t.pct) > 50)" },
  { group: "quick", what: "One news outlet may fill the whole list", file: "lib/fetchNews.js", find: "const MAX_PER_SOURCE = 2;", replace: "const MAX_PER_SOURCE = 20;" },
  { group: "quick", what: "Sponsored stories are no longer filtered out", file: "lib/fetchNews.js", find: 'if (looksSponsored(item.link, item.title, item._text)) return "sponsored";', replace: "" },
  { group: "quick", what: "Analyst-rating headlines are no longer recognised", file: "lib/stockChatter.js", find: "const isStockChatter = (title) => STOCK_CHATTER_RE.test(title || \"\");", replace: "const isStockChatter = () => false;" },
  { group: "quick", what: "HTML codes in feed text are no longer decoded", file: "lib/fetchNews.js", find: "const decoded = decodeEntities(noTags)", replace: "const decoded = noTags" },
  { group: "quick", what: "The refresh job waits for the wrong hour", file: "lib/dates.js", find: "let next = Math.floor(istNow / DAY_MS) * DAY_MS + hour * 60 * 60 * 1000;", replace: "let next = Math.floor(istNow / DAY_MS) * DAY_MS + (hour + 3) * 60 * 60 * 1000;" },
  { group: "quick", what: "An article is scheduled on a Monday", file: "content/briefs.json", mutate: json((d) => (d.articles[2].publishDate = "2026-10-05")) },
  { group: "quick", what: "A case study loses its limitations note", file: "content/case-studies.json", mutate: json((d) => delete d.cases[4].limitations) },
  { group: "quick", what: "A glossary term loses its one-line summary", file: "data/glossary.json", mutate: json((d) => delete d.terms[3].short) },
  { group: "quick", what: "An air-traffic percentage no longer matches its passenger figures", file: "data/air-traffic.json", mutate: json((d) => (d.months[d.months.length - 1].cities.goa.change += 5)) },
  { group: "quick", what: "An event is given a city that does not exist", file: "data/events-curated.json", mutate: json((d) => d.events[5].cities.push("atlantis")) },
  { group: "quick", what: "A wedding date is entered out of order", file: "data/wedding-dates.json", mutate: json((d) => d.dates.push("2026-11-01")) },
  { group: "quick", what: "An article's picture file is missing", file: "content/briefs.json", mutate: json((d) => (d.articles.find((a) => a.image).image.src = "images/briefs/missing.jpg")) },
  { group: "quick", what: "Grey text is made too pale to read", file: "public/style.css", find: "--muted: #6b6359;", replace: "--muted: #b9b2a8;" },
  { group: "quick", what: "The GST slabs are put in the wrong order", file: "data/resources-library.json", mutate: json((d) => d.gst.roomSlabs.reverse()) },

  // ---- app: caught (or not) by the browser suite ----
  { group: "app", what: "Headlines are put into the page without escaping", file: "public/app.js", find: '<p class="news-title">${escapeHtml(item.title)}</p>', replace: '<p class="news-title">${item.title}</p>' },
  { group: "app", what: "'Top gainers' sorts the wrong way round", file: "public/app.js", find: 'if (currentSort === "gainers") sorted.sort((a, b) => b.changePercent - a.changePercent);', replace: 'if (currentSort === "gainers") sorted.sort((a, b) => a.changePercent - b.changePercent);' },
  { group: "app", what: "The occupancy calculator divides the wrong way round", file: "public/resources.js", find: '["Occupancy", pct((sold / avail) * 100), true],', replace: '["Occupancy", pct((avail / sold) * 100), true],' },
  { group: "app", what: "News shows three cards across on desktop", file: "public/style.css", mutate: (t) => t.replace(/(\.news-list \{\s+display: grid;\s+grid-template-columns: repeat\()2/, "$13") },
  { group: "app", what: "The dashboard shows five headlines", file: "public/dashboard.js", find: "const DASH_HEADLINES = 3;", replace: "const DASH_HEADLINES = 5;" },
  { group: "app", what: "The City filter shows every city except the chosen one", file: "public/events.js", find: '(city === "all" || e.cities.includes(city))', replace: '(city === "all" || !e.cities.includes(city))' },
  { group: "app", what: "The phone tab bar is no longer fixed to the bottom", file: "public/style.css", mutate: (t) => t.replace(/(\.tabs \{\s+position: )fixed/, "$1static") },
  { group: "app", what: "The watchlist accepts any number of stocks", file: "public/app.js", find: "const WATCHLIST_MAX = 6;", replace: "const WATCHLIST_MAX = 60;" },
  { group: "app", what: "The GST calculator always uses the lowest slab", file: "public/resources.js", find: "const slab = resData.gst.roomSlabs.find((s) => s.upTo === null || rate <= s.upTo);", replace: "const slab = resData.gst.roomSlabs[0];" },
  { group: "app", what: "The dashboard's saved city is forgotten on reload", file: "public/dashboard.js", find: "if (id) localStorage.setItem(DASH_CITY_KEY, id);", replace: "if (id) localStorage.setItem(DASH_CITY_KEY + '-x', id);" },
  { group: "app", what: "A phone screen is forced wider than the display", file: "public/style.css", find: ".dash-row-title { display: block;", replace: ".dash-row-title { min-width: 520px; display: block;" },
  { group: "app", what: "The term of the day is a day behind", file: "public/resources.js", find: "return terms[istDay % terms.length];", replace: "return terms[(istDay + 1) % terms.length];" },

  // ---- deploy: caught (or not) by the deployment suite ----
  { group: "deploy", what: "The anti-framing security header is dropped", file: "server.js", find: '  res.setHeader("X-Frame-Options", "SAMEORIGIN");', replace: "" },
  { group: "deploy", what: "Preview mode is open to everyone on the live site", file: "server.js", find: "const allowed = !IS_PRODUCTION || (PREVIEW_KEY && req.query.key === PREVIEW_KEY);", replace: "const allowed = true;" },
  { group: "deploy", what: "A failed news refresh wipes the saved stories again", file: "lib/fetchNews.js", find: "if (daily.length < MIN_USABLE_ITEMS && previous", replace: "if (false && previous" },
  { group: "deploy", what: "The data folder is served to the public", file: "server.js", find: 'app.use(express.static(path.join(__dirname, "public")));', replace: 'app.use(express.static(path.join(__dirname, "public")));\napp.use("/data", express.static(path.join(__dirname, "data")));' },
];

const SUITES = { quick: "rules,content", app: "app", deploy: "deploy" };

function makeCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hi-selftest-"));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) && !/report\.(html|json)$/.test(src) });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
  return dir;
}

function runEvals(dir, suites) {
  spawnSync(process.execPath, ["evals/run.js", `--only=${suites}`], { cwd: dir, encoding: "utf-8", timeout: 300000 });
  try {
    const report = JSON.parse(fs.readFileSync(path.join(dir, "evals", "report.json"), "utf-8"));
    return report.suites.flatMap((s) => s.results.filter((r) => r.status === "fail").map((r) => r.name));
  } catch {
    return ["(the evals themselves could not run)"];
  }
}

function main() {
  const group = (process.argv.find((a) => a.startsWith("--group=")) || "").slice(8);
  const match = (process.argv.find((a) => a.startsWith("--match=")) || "").slice(8).toLowerCase(); // only bugs whose description contains this
  const bugs = BUGS.filter((b) => (!group || b.group === group) && b.what.toLowerCase().includes(match));
  const dir = makeCopy();
  const results = [];
  try {
    for (const g of [...new Set(bugs.map((b) => b.group))]) {
      const baseline = runEvals(dir, SUITES[g]);
      if (baseline.length) {
        console.log(`The ${g} suites already fail before any bug is planted, so the self-test cannot judge them: ${baseline.join("; ")}`);
        continue;
      }
      for (const bug of bugs.filter((b) => b.group === g)) {
        const file = path.join(dir, bug.file);
        const original = fs.readFileSync(file, "utf-8");
        const mutated = bug.mutate ? bug.mutate(original) : original.split(bug.find).length === 2 ? original.replace(bug.find, bug.replace) : original;
        if (mutated === original) {
          results.push({ ...bug, outcome: "stale", caughtBy: [] });
          console.log(`  STALE       ${bug.what} (the code it edits has changed; update evals/self-test.js)`);
          continue;
        }
        fs.writeFileSync(file, mutated);
        let caughtBy;
        try {
          caughtBy = runEvals(dir, SUITES[g]);
        } finally {
          fs.writeFileSync(file, original);
        }
        results.push({ ...bug, outcome: caughtBy.length ? "caught" : "missed", caughtBy });
        console.log(`  ${caughtBy.length ? "CAUGHT     " : "NOT CAUGHT "} ${bug.what}${caughtBy.length ? `  ← ${caughtBy.join(" + ")}` : ""}`);
      }
    }
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp folder; safe to leave */
    }
  }
  const caught = results.filter((r) => r.outcome === "caught").length;
  const missed = results.filter((r) => r.outcome === "missed");
  console.log(`\n${caught} of ${results.length} planted bugs were caught by the evals.`);
  if (missed.length) console.log(`Gaps to close:\n${missed.map((m) => `  - ${m.what} (${m.file})`).join("\n")}`);
  fs.writeFileSync(path.join(__dirname, "self-test-report.json"), JSON.stringify({ ranAt: new Date().toISOString(), caught, total: results.length, results: results.map(({ mutate, ...r }) => r) }, null, 2));
  process.exitCode = missed.length ? 1 : 0;
}

main();
