// Content for the Resources tab. It's all hand-maintained JSON (reference
// material in data/, articles and case studies in the private content/ folder),
// read fresh on each request so edits show up without restarting the server.
//
// Articles (The Hotelier's Brief) and case studies are written ahead of time,
// each with a publishDate. The latest published one is sent to the page in full,
// along with when the next one is due; older published ones are listed in short
// (the build writes each one's full text to its own file, read when it is opened).
// Unpublished pieces are never included, so nothing leaks early.

const fs = require("fs");
const path = require("path");
const { addDays, weekday, todayIst } = require("./dates");
const { DATA_DIR, CONTENT_DIR } = require("./paths");

// Publishing days (0 = Sunday): articles on Wednesday and Sunday, case studies on Friday.
const BRIEF_DAYS = [0, 3];
const CASE_DAYS = [5];

function readOptional(file, dir = DATA_DIR) {
  const p = path.join(dir, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
}

// The next publishing day strictly after `date`.
function nextSlot(date, days) {
  let d = addDays(date, 1);
  while (!days.includes(weekday(d))) d = addDays(d, 1);
  return d;
}

// The latest piece published on or before today, and the date the next one is due.
// In preview mode (for reviewing drafts locally) the next unpublished piece counts as
// published, or, if preview is a date (YYYY-MM-DD), everything up to that date does.
function current(items, today, days, preview) {
  const sorted = [...items].sort((a, b) => a.publishDate.localeCompare(b.publishDate));
  const firstUpcoming = sorted.find((i) => i.publishDate > today);
  const cutoff = typeof preview === "string" ? preview : preview && firstUpcoming ? firstUpcoming.publishDate : today;
  const published = sorted.filter((i) => i.publishDate <= cutoff);
  const upcoming = sorted.find((i) => i.publishDate > cutoff);
  // The next date is only promised when a piece is actually scheduled for it.
  // Before anything has been written at all, the first slot is shown instead.
  return {
    current: published[published.length - 1] || null,
    older: published.slice(0, -1).reverse(), // newest first
    nextDate: upcoming ? upcoming.publishDate : sorted.length ? null : nextSlot(cutoff, days),
  };
}

// An older piece as listed on the page: enough to show it and find it in search.
const summary = (x) => ({
  id: x.id,
  publishDate: x.publishDate,
  title: x.title,
  dek: x.dek,
  minutes: x.minutes,
  headings: x.sections.map((s) => s.heading).filter(Boolean),
});

// Articles and case studies live in the private content folder (see paths.js).
function published({ now = new Date(), preview = false } = {}) {
  const today = todayIst(now);
  return {
    today,
    briefs: current((readOptional("briefs.json", CONTENT_DIR) || {}).articles || [], today, BRIEF_DAYS, preview),
    cases: current((readOptional("case-studies.json", CONTENT_DIR) || {}).cases || [], today, CASE_DAYS, preview),
  };
}

function getResources({ now = new Date(), preview = false } = {}) {
  const { today, briefs, cases } = published({ now, preview });
  const library = readOptional("resources-library.json") || {};
  return {
    today,
    glossary: (readOptional("glossary.json") || {}).terms || [],
    indicators: (readOptional("market-indicators.json") || {}).indicators || [],
    gst: library.gst || null,
    reports: library.reports || [],
    brief: briefs.current,
    nextBriefDate: briefs.nextDate,
    pastBriefs: briefs.older.map(summary),
    caseStudy: cases.current,
    nextCaseDate: cases.nextDate,
    pastCases: cases.older.map(summary),
  };
}

// The full text of every older published piece, for the build to write one file each.
function getPastPieces(opts) {
  const { briefs, cases } = published(opts);
  return { briefs: briefs.older, cases: cases.older };
}

module.exports = { getResources, getPastPieces };
