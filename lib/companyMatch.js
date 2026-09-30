// Decides whether a piece of text (a headline) is about a listed company.
// Keywords are matched as whole words. `excludePatterns` (regex sources) remove
// look-alike phrases first — e.g. "Taj Mahal" the monument must not count as
// "Taj" the hotel brand — so the remaining text is what gets matched.
// Patterns must not use lookbehind: they also run in the browser, and older
// Safari versions reject it.
//
// public/app.js has a copy of this logic for tagging News-tab stories
// (stockMatchers / matcherHits); keep the two in step.

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `exactCaseKeywords` must match with their capitals: "Indian Hotels" is the
// company, "Indian hotels" is every hotel in India.
function matchesCompany(text, keywords, excludePatterns = [], exactCaseKeywords = []) {
  let cleaned = text || "";
  for (const source of excludePatterns || []) cleaned = cleaned.replace(new RegExp(source, "gi"), " ");
  return (
    (keywords || []).some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i").test(cleaned)) ||
    (exactCaseKeywords || []).some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(cleaned))
  );
}

module.exports = { matchesCompany };
