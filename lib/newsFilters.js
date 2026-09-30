// Junk filtering for the News tab. Runs on the feed's full cleaned text,
// before selection and before summarization: an item that isn't a single real
// story should never reach the summarizer. classifyJunk() returns the reason an
// item should be dropped, or null to keep it.

const { splitSentences } = require("./summarize");

const MIN_BODY_CHARS = 60; // shorter than this usually means the feed gave us no real content
const AWARD_MIN_BODY_WORDS = 45; // an award headline with less body than this is just the announcement

// Recurring multi-story formats and digest wording. "This week in …" only counts
// at the start of a title: "Bookings surge this week in Goa" is a normal story.
const ROUNDUP_TITLE_RE =
  /\b(round-?ups?|weekly (digest|wrap|recap|briefing|news)|daily (digest|briefing|wrap)|news digest|week in review|the week (in|ahead)|top stories|in brief|lodging lowdown)\b|^this week in\b|\bthis week\s*[:–—-]/i;

// A "Something News: A, B and C" column title lists several stories under one
// label (e.g. "Global Hotel News: New Resorts, Billion-Dollar Deals and ...").
// It takes a list of three after the colon; "Update: X, effective Monday" is one story.
const NEWS_COLUMN_TITLE_RE = /\b(news|updates|headlines|briefing)\s*:.*,.*(,|\band\b|&)/i;

// People-move announcements ("X appoints Y as Director of Sales"). Only applied
// to sources flagged dropAppointments — elsewhere (e.g. "Marriott appoints
// loyalty SVP") they can still be real industry news.
const STAFF_APPOINTMENT_TITLE_RE = /\b(appoints?|appointed|elevates|promoted|joins as|takes charge|takes over as|assumes charge|steps down)\b/i;

const AWARD_TITLE_RE = /\b(awards?|awarded|felicitat\w+|honou?red|accolades?|trophy|laureate)\b/i;

function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

// "A story, Another story, A third story" — a title made of 3+ headline-sized
// clauses is several stories strung together, not one.
function looksLikeMultiHeadlineTitle(title) {
  const parts = title.split(/,\s+(?=[A-Z0-9])/);
  return parts.length >= 3 && parts.every((p) => wordCount(p) >= 3);
}

// Body text that is a run of headline fragments instead of prose: very long
// "sentences" (or none at all) with a high share of capitalised words.
function looksLikeHeadlineList(text) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 40) return false;
  const sentences = splitSentences(text);
  const avgWordsPerSentence = words.length / Math.max(1, sentences.length);
  const capitalised = words.slice(1).filter((w) => /^[A-Z]/.test(w)).length / words.length;
  return avgWordsPerSentence > 50 && capitalised > 0.35;
}

function classifyJunk(item, source) {
  const body = item._text || "";

  if (ROUNDUP_TITLE_RE.test(item.title)) return "roundup/digest (title)";
  if (NEWS_COLUMN_TITLE_RE.test(item.title)) return "news-column title listing several stories";
  if (looksLikeMultiHeadlineTitle(item.title)) return "several headlines in one title";
  if (looksLikeHeadlineList(body)) return "body reads as a list of headlines";
  if (AWARD_TITLE_RE.test(item.title) && wordCount(body) < AWARD_MIN_BODY_WORDS) {
    return "award announcement with no real content";
  }
  if (source.dropAppointments && STAFF_APPOINTMENT_TITLE_RE.test(item.title)) return "staff appointment";
  if (!source.titleOnly && body.length < MIN_BODY_CHARS) return "no usable body text";
  return null;
}

module.exports = { classifyJunk, MIN_BODY_CHARS };
