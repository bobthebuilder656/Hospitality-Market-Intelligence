const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const sources = require("./sources");
const { classifyJunk } = require("./newsFilters");
const { summarizeItems } = require("./summarize");
const { sameStory } = require("./sameStory");

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HospitalityIntelBot/1.0" },
  customFields: {
    item: [["content:encoded", "contentEncoded"]],
  },
});

const CACHE_PATH = path.join(__dirname, "..", "data", "news.json");
const ITEMS_PER_SOURCE = 4;
const TARGET_ITEMS = 10;
const MIN_ITEMS = 8;
const MIN_USABLE_ITEMS = 3; // a refresh with fewer stories than this is treated as a failed fetch
const MIN_FORCE_REFRESH_MINUTES = 5; // the Refresh button can't hammer the feeds
const BODY_TEXT_MAX = 8000; // safety cap on how much feed text is kept per item
const POOL_PER_FEED = 15; // items read per feed before filtering
// Try the freshest window first and only reach further back when it can't
// fill MIN_ITEMS — so quiet days show older stories instead of a thin list.
const FRESHNESS_WINDOWS_DAYS = [2, 4, 7];
const MAX_AGE_DAYS = FRESHNESS_WINDOWS_DAYS[FRESHNESS_WINDOWS_DAYS.length - 1];
const DAY_MS = 24 * 60 * 60 * 1000;

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…",
  copy: "©", reg: "®", trade: "™",
};

// RSS feeds carry HTML-entity-encoded text (e.g. "isn&apos;t", "&#8211;");
// left undecoded these show up as literal garbage in the summary.
function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

// Strips known syndication boilerplate some feeds append/embed (WordPress's
// default "The post X appeared first on Y" excerpt, Skift's CTA footer, etc.)
// so the summary doesn't end in ad-like filler.
function stripBoilerplate(str) {
  return str
    .replace(/The post .*? appeared first on .*?\.?\s*$/i, "")
    .replace(/Read the Complete Story On \w+\.?\s*$/i, "")
    .replace(/Continue reading.*$/i, "")
    .replace(/\s*SOURCE:\s.*$/i, "") // eTurboNews appends "SOURCE: <title> BY: eTurboNews."
    .trim();
}

function stripHtml(str) {
  if (!str) return "";
  const noTags = str.replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(noTags).replace(/\s+/g, " ").trim();
  return stripBoilerplate(decoded);
}

// A couple of our global feeds (e.g. Business Traveller) mix in articles from
// non-English regional editions. This is a cheap heuristic, not real language
// detection. A lone accented letter is NOT a signal — English copy is full of
// "Café", "ÖBB", "Zürich", "José" — so we look for common German/French/
// Spanish/Italian function words instead (2+ distinct hits), with a heavy
// accent count as a backstop for text that has none.
const FOREIGN_STOPWORDS = new Set([
  "und", "der", "das", "für", "mit", "ist", "ein", "eine", "nicht", "von", "bei", "auf", "zu", "sind", "wird", "über", "zum", "zur",
  "les", "des", "une", "pour", "dans", "est", "sur", "avec", "aux", "du", "qui", "pas",
  "el", "los", "las", "del", "para", "una", "por", "con", "que", "más",
  "il", "della", "nel", "sono", "che", "gli",
]);

function looksNonEnglish(text) {
  const words = text.toLowerCase().match(/[a-zäöüßàâçèéêëîïôùûñãõ]+/g) || [];
  const stopwordHits = new Set(words.filter((w) => FOREIGN_STOPWORDS.has(w))).size;
  if (stopwordHits >= 2) return true;
  const accents = (text.match(/[äöüßàâçèéêëîïôùûñãõ]/gi) || []).length;
  return accents >= 4;
}

// Paid placements that some feeds mix in with editorial news (e.g. Business
// Traveller's /sponsored/ pages) — not news, so they never make the list.
function looksSponsored(link, title, text) {
  return (
    /\/(sponsored|advertorial|partner-content|promoted|brand-studio)\//i.test(link || "") ||
    /^(sponsored|advertorial|partner content|promoted)\b/i.test(title) ||
    /^(sponsored|advertorial)\b/i.test(text)
  );
}

function isTooOld(pubDate) {
  if (!pubDate) return false; // no date to judge by — let it through
  const t = new Date(pubDate).getTime();
  return !Number.isNaN(t) && Date.now() - t > MAX_AGE_DAYS * DAY_MS;
}

function buildItem(item, source) {
  const title = stripHtml(item.title);
  // Prefer the full article body (content:encoded) over the feed's short
  // teaser (<description>/contentSnippet) so the summary reads like an
  // actual excerpt rather than a one-line auto-truncated blurb.
  const rawText = item.contentEncoded || item.content || item.contentSnippet || item.summary || "";
  const text = stripHtml(rawText).slice(0, BODY_TEXT_MAX);
  return {
    title,
    link: item.link,
    source: source.name,
    feedId: source.id,
    region: source.region,
    pubDate: item.isoDate || item.pubDate || null,
    snippet: "", // filled in by summarizeItems() once the day's stories are picked
    _text: text,
  };
}

// Why an item is dropped, or null to keep it. Age is counted rather than
// logged per item (a feed's archive is mostly old stories); every other reason
// is logged individually so the filters can be sanity-checked.
function dropReason(item, source) {
  // The link becomes a clickable address on the page, so it must be a web address.
  if (!/^https?:\/\/\S+$/i.test(item.link || "")) return "no usable link";
  if (isTooOld(item.pubDate)) return "too old";
  if (looksNonEnglish(`${item.title} ${item._text.slice(0, 150)}`)) return "non-English";
  if (looksSponsored(item.link, item.title, item._text)) return "sponsored";
  return classifyJunk(item, source);
}

async function fetchSource(source) {
  const health = { id: source.id, name: source.name, ok: false, fetched: 0, kept: 0, dropped: {}, error: null };
  const dropped = [];
  try {
    const feed = await parser.parseURL(source.url);
    const raw = feed.items || [];
    health.ok = true;
    health.fetched = raw.length;

    const kept = [];
    // Consider a wider pool than we'll keep, since some items get filtered out.
    for (const rawItem of raw.slice(0, POOL_PER_FEED)) {
      const item = buildItem(rawItem, source);
      const reason = dropReason(item, source);
      if (!reason) {
        kept.push(item);
        continue;
      }
      health.dropped[reason] = (health.dropped[reason] || 0) + 1;
      if (reason !== "too old") {
        dropped.push({ source: source.name, title: item.title, reason });
        console.log(`[news] dropped (${reason}) — ${source.name}: "${item.title}"`);
      }
    }

    const items = kept.slice(0, ITEMS_PER_SOURCE);
    health.kept = items.length;
    return { items, health, dropped };
  } catch (err) {
    console.warn(`[news] failed to fetch ${source.name} (${source.id}): ${err.message}`);
    health.error = err.message;
    return { items: [], health, dropped };
  }
}

// Dedupes both exact-title repeats and the same story covered by several
// outlets (see sameStory.js), keeping the first copy seen.
function dedupeItems(items) {
  const kept = [];
  for (const item of items) {
    if (!kept.some((k) => sameStory(item.title, k.title))) kept.push(item);
  }
  return kept;
}

const MAX_PER_SOURCE = 2; // keeps one outlet from flooding the list if others go quiet

// Within one region, guarantee one story per feed first (so no feed gets
// shut out by recency alone), then fill remaining region slots by recency —
// capped per feed so a single prolific (or PR-heavy) outlet can't crowd out
// the rest of the day's spread. The cap is relaxed only if it would otherwise
// leave slots unfilled.
function pickFromRegion(items, region, quota) {
  const regionItems = items.filter((item) => item.region === region).sort(byDateDesc);
  const feedsInRegion = [...new Set(regionItems.map((item) => item.feedId))];

  const picked = [];
  const countPerFeed = {};

  for (const feedId of feedsInRegion) {
    if (picked.length >= quota) break;
    const top = regionItems.find((item) => item.feedId === feedId && !picked.includes(item));
    if (top) {
      picked.push(top);
      countPerFeed[feedId] = 1;
    }
  }

  for (const item of regionItems) {
    if (picked.length >= quota) break;
    if (picked.includes(item)) continue;
    if ((countPerFeed[item.feedId] || 0) >= MAX_PER_SOURCE) continue;
    picked.push(item);
    countPerFeed[item.feedId] = (countPerFeed[item.feedId] || 0) + 1;
  }

  if (picked.length < quota) {
    for (const item of regionItems) {
      if (picked.length >= quota) break;
      if (!picked.includes(item)) picked.push(item);
    }
  }

  return picked;
}

function byDateDesc(a, b) {
  return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
}

function pickDaily(items) {
  // Try the freshest window first; only reach further back if it can't fill MIN_ITEMS.
  let deduped = [];
  for (const days of FRESHNESS_WINDOWS_DAYS) {
    const cutoff = Date.now() - days * DAY_MS;
    const inWindow = items.filter((i) => !i.pubDate || new Date(i.pubDate).getTime() >= cutoff);
    deduped = dedupeItems([...inWindow].sort(byDateDesc));
    if (deduped.length >= MIN_ITEMS) break;
  }

  // Target a 60/40 India/Global split (this is for an Indian audience); if one
  // region comes up short, backfill the remaining slots from the other's leftovers.
  const indiaQuota = Math.round(TARGET_ITEMS * 0.6);
  const globalQuota = TARGET_ITEMS - indiaQuota;

  let picked = [
    ...pickFromRegion(deduped, "India", indiaQuota),
    ...pickFromRegion(deduped, "Global", globalQuota),
  ];

  if (picked.length < TARGET_ITEMS) {
    const leftovers = deduped.filter((item) => !picked.includes(item));
    picked = picked.concat(leftovers.slice(0, TARGET_ITEMS - picked.length));
  }

  picked.sort(byDateDesc);
  return picked.slice(0, TARGET_ITEMS).map(({ feedId, ...rest }) => rest);
}

// Concurrent callers (the daily job, a Refresh click, several visitors) share one fetch.
let refreshInFlight = null;
let lastRefreshAttempt = 0;
function refreshNews() {
  if (!refreshInFlight) {
    lastRefreshAttempt = Date.now();
    refreshInFlight = doRefreshNews().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefreshNews() {
  const results = await Promise.all(sources.map(fetchSource));
  const allItems = results.flatMap((r) => r.items);
  const feedHealth = results.map((r) => r.health);
  const droppedItems = results.flatMap((r) => r.dropped);
  // Summaries are written only for the stories that survived filtering and selection.
  const daily = await summarizeItems(pickDaily(allItems), stripHtml);

  for (const h of feedHealth) {
    if (!h.ok) continue; // failure already logged with its error
    if (h.kept === 0) console.warn(`[news] ${h.name} (${h.id}) returned ${h.fetched} items but none survived filtering`);
  }
  const okCount = feedHealth.filter((h) => h.ok).length;
  console.log(`[news] ${okCount}/${feedHealth.length} feeds healthy, ${allItems.length} candidate stories`);

  if (daily.length < MIN_ITEMS) {
    console.warn(`[news] only found ${daily.length} unique stories (target ${MIN_ITEMS}-${TARGET_ITEMS})`);
  }

  // A refresh that comes back nearly empty means the feeds were unreachable (the
  // network was down, or most sites failed at once), not that there is no news.
  // Keep showing the saved stories rather than wiping the tab until tomorrow.
  const previous = readCache();
  if (daily.length < MIN_USABLE_ITEMS && previous && previous.items && previous.items.length > daily.length) {
    console.warn(`[news] refresh found only ${daily.length} stories (${okCount}/${feedHealth.length} feeds responded); keeping the ${previous.items.length} saved stories`);
    return previous;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: sources.map((s) => ({ name: s.name, region: s.region })),
    feedHealth,
    droppedItems,
    items: daily,
  };

  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2));
  console.log(`[news] wrote ${daily.length} items to ${CACHE_PATH}`);
  return payload;
}

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return null;
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
}

function isStale(payload, maxAgeHours = 24) {
  if (!payload) return true;
  const ageMs = Date.now() - new Date(payload.generatedAt).getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

// The Refresh button (forceRefresh) re-reads all 12 feeds, so it is honoured at
// most once every few minutes; in between, everyone gets the saved copy.
// A refresh that failed leaves the saved copy (and its old date) in place, so
// the last attempt is tracked too: otherwise every page view would retry all
// the feeds while they are down.
async function getNews({ forceRefresh = false } = {}) {
  const cached = readCache();
  const recently = (ms) => Date.now() - ms < MIN_FORCE_REFRESH_MINUTES * 60 * 1000;
  const justRefreshed = cached && (recently(new Date(cached.generatedAt).getTime()) || recently(lastRefreshAttempt));
  if (cached && (justRefreshed || (!forceRefresh && !isStale(cached)))) return cached;
  return refreshNews();
}

module.exports = { refreshNews, getNews, readCache, isStale, fetchSource, stripHtml, pickDaily, buildItem, dropReason };

if (require.main === module) {
  refreshNews().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
