// Weekly quality report (added 2026-10-22). The evals prove the site WORKS;
// this estimates whether what it shows is USEFUL and TRUE, and hands a person
// a short sample to check against the original sources.
//
// It looks at:
//   - News over the past week (from the daily data snapshots in git history):
//     stories with no hospitality or travel term, stories with no summary,
//     sources that supplied nothing
//   - Stock prices on the live site: quotes that look stale or outside their
//     52-week range
//   - Air traffic: how old the latest published month is
//   - Events: a sample of upcoming events for a person to check
//   - Publishing: builds that passed, were blocked, or were cancelled this week
//     (passed in by the workflow as RUNS_JSON)
//   - Problems the latest build reported (feeds or sources that failed)
// These are rough rule-based signals, not proof. Warnings only; it never blocks
// publishing. Writes Markdown to stdout:
//
//   node evals/quality-report.js > report.md

const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SITE = (process.env.SITE_URL || "https://bobthebuilder656.github.io/Hospitality-Market-Intelligence/").replace(/\/?$/, "/");
const DAY = 24 * 60 * 60 * 1000;

const HOSPITALITY_TERMS = /\b(hotels?|hospitality|resorts?|hostels?|homestays?|villas?|inns?|stays?|rooms?|occupancy|revpar|adr|guests?|travel(lers?|ers?)?|touris[mt]s?|trips?|holidays?|vacations?|leisure|airlines?|aviation|airports?|air ?fares?|fares?|flights?|fly|cruises?|ota|booking|bookings|mice|events?|weddings?|banquets?|restaurants?|dining|food|f&b|chefs?|qsr|brands?|propert(y|ies)|real estate|tourism|destinations?)\b/i;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

async function live(file) {
  const res = await fetch(`${SITE}data/${file}?nocache=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
}

// One news snapshot per day for the last 7 days, newest first
function weekOfNews() {
  const lines = git(["log", "--since=8 days ago", "--format=%H %cI", "--", "data/news.json"]).trim().split("\n").filter(Boolean);
  const byDay = new Map();
  for (const line of lines) {
    const [hash, when] = line.split(" ");
    const day = when.slice(0, 10);
    if (byDay.has(day)) continue;
    try {
      byDay.set(day, JSON.parse(git(["show", `${hash}:data/news.json`])));
    } catch { /* unreadable old version */ }
  }
  return [...byDay.entries()].map(([day, d]) => ({ day, ...d }));
}

const pct = (n, total) => (total ? `${Math.round((n / total) * 100)}%` : "n/a");
const status = (bad) => (bad ? "Look" : "OK");

function googleFinance(q) {
  if (q.symbol.endsWith(".NS")) return `https://www.google.com/finance/quote/${q.symbol.slice(0, -3)}:NSE`;
  if (q.symbol.endsWith(".BO")) return `https://www.google.com/finance/quote/${q.symbol.slice(0, -3)}:BOM`;
  return `https://www.google.com/finance/quote/${q.symbol}:NASDAQ`;
}

async function main() {
  const now = Date.now();
  const lines = [];
  const rows = [];
  const details = [];

  // ---- news, past week ----
  const snapshots = weekOfNews();
  const seen = new Map();
  for (const s of snapshots) for (const it of s.items || []) if (!seen.has(it.link)) seen.set(it.link, { ...it, day: s.day });
  const stories = [...seen.values()];
  const offTopic = stories.filter((s) => !HOSPITALITY_TERMS.test(`${s.title} ${s.snippet || ""}`));
  const noSummary = stories.filter((s) => !s.snippet || s.snippet.trim().split(/\s+/).length < 8);
  const perSource = new Map();
  for (const s of stories) perSource.set(s.source, (perSource.get(s.source) || 0) + 1);
  const allSources = ((snapshots[0] && snapshots[0].sources) || []).map((s) => s.name);
  const silent = allSources.filter((n) => !perSource.has(n));
  rows.push(["News stories that may not be about hospitality or travel", `${offTopic.length} of ${stories.length} (${pct(offTopic.length, stories.length)})`, status(offTopic.length)]);
  rows.push(["News stories with no real summary", `${noSummary.length} of ${stories.length} (${pct(noSummary.length, stories.length)})`, status(noSummary.length)]);
  rows.push(["News sources that supplied nothing all week", silent.length ? silent.join(", ") : "none", status(silent.length)]);
  if (offTopic.length) details.push("### News that may not be about hospitality or travel", "", ...offTopic.slice(0, 10).map((s) => `- [${s.title}](${s.link}) (${s.source}, ${s.day})`), "");
  if (noSummary.length) details.push("### News with no real summary", "", ...noSummary.slice(0, 10).map((s) => `- [${s.title}](${s.link}) (${s.source}, ${s.day})`), "");

  // ---- live data ----
  let stocks = { quotes: [] }, air = { months: [] }, events = { events: [], cities: [] }, build = { problems: [] };
  try { [stocks, air, events, build] = await Promise.all(["stocks.json", "air-traffic.json", "events.json", "build.json"].map(live)); }
  catch (err) { rows.push(["Live site data", `could not be read: ${err.message}`, "Look"]); }

  const staleQuotes = stocks.quotes.filter((q) => !q.asOf || now - new Date(q.asOf) > 4 * DAY);
  const oddQuotes = stocks.quotes.filter((q) => typeof q.price !== "number" || (q.weekLow52 && q.price < q.weekLow52 * 0.9) || (q.weekHigh52 && q.price > q.weekHigh52 * 1.1));
  rows.push(["Stock prices older than 4 days", `${staleQuotes.length} of ${stocks.quotes.length}`, status(staleQuotes.length)]);
  rows.push(["Stock prices outside their 52-week range", `${oddQuotes.length} of ${stocks.quotes.length}`, status(oddQuotes.length)]);
  if (staleQuotes.length || oddQuotes.length) details.push("### Stock prices to look at", "", ...[...staleQuotes, ...oddQuotes].map((q) => `- ${q.name}: ${q.price} ${q.currency || ""} as of ${q.asOf || "unknown"} ([compare](${googleFinance(q)}))`), "");

  const months = Array.isArray(air.months) ? air.months : [];
  const latest = months.length ? months[months.length - 1] : null;
  const monthsOld = latest ? Math.round((now - new Date(`${latest.month}-15`)) / (30 * DAY)) : null;
  rows.push(["Latest air-traffic month", latest ? `${latest.month} (about ${monthsOld} months ago; AAI usually publishes 1 to 2 months late)` : "none", status(!latest || monthsOld > 3)]);

  // (Quiet cities are already reported by the evals' City Events warning.)
  const horizon = new Date(now + 60 * DAY).toISOString().slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = events.events.filter((e) => e.end >= today && e.start <= horizon);

  // ---- publishing ----
  let runs = [];
  try { runs = JSON.parse(process.env.RUNS_JSON || "[]"); } catch { runs = []; }
  if (runs.length) {
    const count = (c) => runs.filter((r) => r.conclusion === c).length;
    const failed = count("failure");
    rows.push(["Publishing this week", `${count("success")} published, ${failed} blocked by a failed check, ${count("cancelled")} skipped (a newer run took over)`, status(failed)]);
  }
  const problems = build.problems || [];
  rows.push(["Problems reported by the latest build", problems.length ? `${problems.length} (the site used the previous data for these)` : "none", status(problems.length)]);
  if (problems.length) details.push("### Problems reported by the latest build", "", ...problems.slice(0, 15).map((p) => `- ${p}`), "");

  // ---- summary ----
  lines.push(`Covers news from **${snapshots.length} daily snapshots** (${stories.length} stories) and the live site as of ${new Date(now).toUTCString()}.`, "");
  lines.push("| Measure | Result | Status |", "|---|---|---|", ...rows.map((r) => `| ${r.join(" | ")} |`), "");
  lines.push('"Look" means a rule flagged something for a person to check. It is not proof of a problem.', "");
  lines.push(...details);
  lines.push("### News stories per source this week", "", ...[...perSource.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `- ${n}: ${c}`), "");

  // ---- the human check: a sample spread across the data ----
  const pick = (arr, n) => { const step = Math.max(1, Math.floor(arr.length / n)); return [0, 1, 2, 3, 4].slice(0, n).map((k) => arr[k * step]).filter(Boolean); };
  const latestNews = (snapshots[0] && snapshots[0].items) || [];
  lines.push("## Your 10-15 minute check", "");
  lines.push("**News** (open each one): is it useful to an Indian hotel sales team? Does the summary match the article?", "");
  pick(latestNews, 5).forEach((s, i) => lines.push(`${i + 1}. [${s.title}](${s.link}) (${s.source})`, `   > ${s.snippet || "(no summary)"}`));
  lines.push("", "**Stock prices** (compare with Google Finance, an independent source; small gaps from timing are normal):", "");
  pick(stocks.quotes, 2).forEach((q) => lines.push(`- ${q.name}: **${q.price} ${q.currency || ""}** as of ${q.asOf} ([check on Google Finance](${googleFinance(q)}))`));
  lines.push("", "**Events** (open the source): are the dates, city and venue right, and is it still happening?", "");
  pick(soon, 2).forEach((e) => lines.push(`- ${e.name}: ${e.start} to ${e.end}, ${e.venue || ""} ([source](${e.source}))`));
  if (latest) lines.push("", `**Air traffic:** open the [AAI report for ${latest.month}](${latest.pdfUrl}) and compare one city's passenger number with the site.`);
  lines.push("", "If anything looks wrong, tell Claude which item and what is wrong. Otherwise close this issue.");

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
