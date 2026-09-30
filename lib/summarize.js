// Extractive summarization, ported from the ai-news-digest project
// (fetch-digest.js): split the source's real text into whole sentences, then
// stitch the first few into a summary. Never cuts mid-sentence.

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HospitalityIntelBot/1.0";
const REQUEST_TIMEOUT_MS = 10000;

const SUMMARY_MAX_SENTENCES = 4;
const SUMMARY_MIN_SENTENCES = 3; // with this many in hand, stop once we have SUMMARY_TARGET_WORDS
const SUMMARY_TARGET_WORDS = 45;
const SUMMARY_MAX_CHARS = 420; // ~6 lines of card text; keeps the summary inside the fixed-height news card
const MIN_EXCERPT_SENTENCES = 4; // fewer than this in the feed text → also read the article page

const BOILERPLATE_PATTERNS = [
  /flash sale/i, /register now/i, /save \$\d/i, /% off/i,
  /subscribe (to|now)/i, /sign up for/i, /sign up now/i, /newsletter/i,
  /added to your daily email digest/i, /homepage feed/i,
  /advertisement/i, /related stories?/i, /image credits?:/i,
  /follow us on/i, /get the latest/i, /your browser does not support/i,
  /all rights reserved/i, /terms of (service|use)/i, /privacy policy/i,
  /^share this/i, /^tags?:/i, /comments?$/i,
  /\|\s*(photo|screenshot|image|illustration)\s*:/i,
  /appeared first on/i,
];

function isBoilerplate(text) {
  return BOILERPLATE_PATTERNS.some((re) => re.test(text));
}

// Strips trailing "Read the full story at X" teaser text that some sites glue
// onto the end of a truncated preview paragraph.
function stripReadMoreTeaser(text) {
  return text.replace(/[…]?\s*Read the full story at [^.]*\.?\s*$/i, "").trim();
}

// A period between two digits (e.g. "2.5", "$1.5 billion") is not a sentence
// boundary. Naively splitting on it there is a correctness bug, not just a
// style nit: since the next char isn't whitespace, the sentence-ending regex
// fails to match through that point, and JS's match() silently drops the
// unmatched span rather than merging it into a neighboring sentence.
//
// The same goes for a period followed directly by a letter ("Vrbo.com",
// "Booking.com", "No.1"): without protection everything before it was lost and
// the summary began mid-sentence ("com charge no guest fees.").
const DECIMAL_PLACEHOLDER = "DECPTOKEN";

// Same idea for abbreviations that carry a period but don't end a sentence
// ("6,000 sq. ft. banquet", "U.S. RevPAR", "Dr. Rao"). Added for this project —
// hotel copy is full of them and the digest's AI-news text was not.
const ABBREV_PLACEHOLDER = "ABBRPTOKEN";
const ABBREVIATION_RE = /\b(?:U\.S|U\.K|U\.A\.E|a\.m|p\.m|M\/s|Mr|Mrs|Ms|Dr|St|Rs|Inc|Ltd|Pvt|Co|Corp|No|Nos|Jr|Sr|Prof|Gen|Col|sq|ft|vs|approx|est)\./g;

function splitSentences(text) {
  let protectedText = text
    .replace(ABBREVIATION_RE, (m) => m.split(".").join(ABBREV_PLACEHOLDER))
    .replace(/([A-Za-z0-9])\.(?=[A-Za-z0-9])/g, (m, a) => a.concat(DECIMAL_PLACEHOLDER));
  // Feed excerpts are often cut off mid-sentence and end in "…" — that last
  // fragment has no terminator, so the match below drops it. A text with no
  // terminator and no ellipsis is treated as one complete sentence.
  protectedText = protectedText.trim().replace(/\.{3}\s*$/, "…");
  if (protectedText && !/[.!?…"”’)]$/.test(protectedText)) protectedText += ".";
  const sentences = protectedText.match(/[^.!?]+[.!?]+(\s|$)/g) || [];
  return sentences
    .map((s) => s.split(DECIMAL_PLACEHOLDER).join(".").split(ABBREV_PLACEHOLDER).join(".").trim())
    .filter(Boolean);
}

function extractiveSummary(excerpt, articleParagraphs) {
  const excerptSentences = excerpt ? splitSentences(excerpt) : [];
  const articleText = articleParagraphs.join(" ");
  const articleSentences = articleText ? splitSentences(articleText) : [];

  const out = [];
  const seen = new Set();
  let wordCount = 0;
  let charCount = 0;

  // A label some feeds put in front of their own summary ("Skift Take: …"); the
  // same sentence then appears again, without the label, in the article.
  const bare = (s) => s.replace(/^[A-Z][\w ]{2,20}:\s+/, "").toLowerCase();

  for (const raw of [...excerptSentences, ...articleSentences]) {
    // A sentence carrying a picture credit is a caption, not part of the story.
    if (/\b(Photo|Image|Picture) Credits?:/i.test(raw)) continue;
    const s = raw;
    const key = bare(s).slice(0, 40);
    if (seen.has(key) || out.some((kept) => bare(kept).includes(bare(s)) || bare(s).includes(bare(kept)))) continue;
    if (charCount + s.length > SUMMARY_MAX_CHARS) {
      // A sentence that does not fit is skipped when it is the first one (so a
      // long lead sentence never gets clipped by the card), otherwise we stop.
      if (out.length === 0) continue;
      break;
    }
    seen.add(key);
    out.push(s);
    wordCount += s.split(" ").length;
    charCount += s.length + 1;
    if (out.length >= SUMMARY_MAX_SENTENCES || (out.length >= SUMMARY_MIN_SENTENCES && wordCount >= SUMMARY_TARGET_WORDS)) break;
  }

  return out.join(" ");
}

// The address comes from a feed, so it is checked before the server visits it:
// web addresses only, never this machine or a private network, and the page is
// cut off at MAX_PAGE_BYTES so an enormous file cannot tie the server up.
const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

function isSafeToFetch(url) {
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) && !PRIVATE_HOST.test(u.hostname) && !u.username;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  if (!isSafeToFetch(url)) throw new Error("address not allowed");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > MAX_PAGE_BYTES) break;
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Pulls the readable paragraphs out of an article page. `htmlToText` is the
// tag/entity stripper from fetchNews.js.
async function extractArticleParagraphs(url, htmlToText) {
  try {
    const html = await fetchText(url);
    const readableParagraphs = (scope) =>
      (scope.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [])
        .map((p) => stripReadMoreTeaser(htmlToText(p.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "))))
        .filter((t) => t.split(" ").length > 6 && !isBoilerplate(t));

    // Some sites wrap related-story cards in <article> tags before the real
    // one, so take the article block with the most text rather than the first,
    // and fall back to the whole page if that yields almost nothing.
    const articles = html.match(/<article\b[\s\S]*?<\/article>/gi) || [];
    const biggest = articles.sort((a, b) => b.length - a.length)[0];
    const fromArticle = biggest ? readableParagraphs(biggest) : [];
    return fromArticle.length >= 3 ? fromArticle : readableParagraphs(html);
  } catch (err) {
    return [];
  }
}

// Drop paragraphs that recur verbatim across multiple articles from the same
// source — that's site chrome (newsletter prompts, ad slots), not article text.
function dropCrossArticleBoilerplate(paragraphsByItem, sources) {
  const countBySourceAndText = new Map();
  paragraphsByItem.forEach((paragraphs, i) => {
    for (const p of new Set(paragraphs)) {
      const mapKey = sources[i].concat("::", p);
      countBySourceAndText.set(mapKey, (countBySourceAndText.get(mapKey) || 0) + 1);
    }
  });
  return paragraphsByItem.map((paragraphs, i) =>
    paragraphs.filter((p) => (countBySourceAndText.get(sources[i].concat("::", p)) || 0) <= 1)
  );
}

// Sets `snippet` on each item to a whole-sentence summary. Items must already
// have passed junk filtering. The article page is only fetched when the feed's
// own text is too thin to yield a proper summary.
async function summarizeItems(items, htmlToText) {
  const paragraphs = await Promise.all(
    items.map((item) => {
      const excerptSentences = item._text ? splitSentences(item._text).length : 0;
      return excerptSentences >= MIN_EXCERPT_SENTENCES ? [] : extractArticleParagraphs(item.link, htmlToText);
    })
  );
  const cleaned = dropCrossArticleBoilerplate(paragraphs, items.map((i) => i.source));
  return items.map((item, i) => {
    const { _text, ...rest } = item;
    return { ...rest, snippet: extractiveSummary(_text, cleaned[i]) };
  });
}

module.exports = { splitSentences, extractiveSummary, summarizeItems, isSafeToFetch };
