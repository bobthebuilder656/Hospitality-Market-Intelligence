// After-publish check (added 2026-10-22): opens the public site and confirms it
// is serving the build this run just made, and that its main data loads.
// A build can pass every check while GitHub Pages keeps serving an older copy,
// so this is the only check that looks at what readers actually get.
//
//   node evals/verify-live.js <builtAt from site/data/build.json> [site url]
//
// GitHub Pages can take a few minutes to refresh, so it retries for ~10 minutes.

const builtAt = process.argv[2];
const SITE = (process.argv[3] || "https://bobthebuilder656.github.io/Hospitality-Market-Intelligence/").replace(/\/?$/, "/");
const ATTEMPTS = 10;
const WAIT_MS = 60 * 1000;

if (!builtAt) {
  console.log("[FAIL] Live site :: no build time given (expected the builtAt value from site/data/build.json)");
  process.exit(1);
}

async function getJson(file) {
  const res = await fetch(`${SITE}data/${file}?nocache=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${file} answered HTTP ${res.status}`);
  return res.json();
}

async function check() {
  const page = await fetch(`${SITE}?nocache=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!page.ok) return `the home page answered HTTP ${page.status}`;
  const build = await getJson("build.json");
  if (build.builtAt !== builtAt) return `the site still shows the build from ${build.builtAt}`;
  const news = await getJson("news.json");
  if (!Array.isArray(news.items) || news.items.length === 0) return "the news list is empty";
  const stocks = await getJson("stocks.json");
  if (!Array.isArray(stocks.quotes) || stocks.quotes.length === 0) return "the stock list is empty";
  return null;
}

(async () => {
  let problem = "not checked";
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      problem = await check();
    } catch (err) {
      problem = err.message;
    }
    if (!problem) {
      console.log(`[PASS] Live site :: ${SITE} shows the build from ${builtAt}, with news and stock data`);
      process.exit(0);
    }
    console.log(`[wait] attempt ${i}/${ATTEMPTS}: ${problem}`);
    if (i < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
  console.log(`[FAIL] Live site :: after ${ATTEMPTS} attempts, ${problem}`);
  process.exit(1);
})();
