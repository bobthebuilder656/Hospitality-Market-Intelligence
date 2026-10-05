// How far ahead the articles and case studies are written. Prints JSON:
// { lastBrief, lastCase, daysLeft } where daysLeft counts from today (India time)
// to the earlier of the two last publish dates. Used by the reminder in the
// private content repository, which opens an issue when this falls to 7 days.

const { read } = require("../evals/lib/files");

const todayIst = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const last = (items) => items.map((i) => i.publishDate).sort().pop() || todayIst;
const lastBrief = last(read("briefs.json").articles);
const lastCase = last(read("case-studies.json").cases);
const until = lastBrief < lastCase ? lastBrief : lastCase;
const daysLeft = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${todayIst}T00:00:00Z`)) / 86400000);
console.log(JSON.stringify({ today: todayIst, lastBrief, lastCase, daysLeft }));
