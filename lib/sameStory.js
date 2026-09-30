// Decides whether two headlines are the same story told by two outlets
// ("Taj Opens Hessischer Hof in Frankfurt" / "Taj celebrates the opening of Taj
// Hessischer Hof Frankfurt"), as opposed to two stories that share common words
// ("Marriott opens new hotel in Jaipur" / "Hilton opens new hotel in Jaipur").
//
// Each headline is reduced to its distinctive words (small words dropped, the
// rest cut to four letters so "opens" and "opening" agree; numbers kept whole).
// Two headlines are the same story when every distinctive word of one appears
// in the other and they share at least three. If each has a word the other
// lacks (a different company, city or figure), they are treated as different.
//
// public/dashboard.js has a copy of this logic (dashSameStory); keep the two in step.

const SMALL_WORDS = new Set(["the", "and", "for", "with", "its", "his", "her", "from", "into", "that", "this", "has", "have", "are", "was", "will", "new", "says", "said", "over", "after", "amid"]);
const MIN_SHARED = 3;

function storyWords(title) {
  const words = title.toLowerCase().replace(/(\d)[,.](?=\d)/g, "$1").match(/[a-z0-9]+/g) || [];
  return new Set(
    words
      .filter((w) => (/\d/.test(w) ? true : w.length >= 3 && !SMALL_WORDS.has(w)))
      .map((w) => (/\d/.test(w) ? w : w.slice(0, 4)))
  );
}

function sameStory(a, b) {
  const [small, large] = [storyWords(a), storyWords(b)].sort((x, y) => x.size - y.size);
  if (small.size < MIN_SHARED) return [...small].join(" ") === [...large].join(" ") && small.size > 0;
  return [...small].every((w) => large.has(w));
}

module.exports = { sameStory, storyWords };
