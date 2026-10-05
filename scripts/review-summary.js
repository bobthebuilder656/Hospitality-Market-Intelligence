// Turns the monthly events review (data/event-review.json, written by
// lib/monthlyCheck.js) into a short Markdown summary, for the monthly reminder
// GitHub sends to the owner. Prints the summary.

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../lib/paths");

const r = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "event-review.json"), "utf-8"));
const story = (n) => `[${n.title}](${n.link})${n.publisher ? ` (${n.publisher})` : ""}`;
const lines = [`Monthly review run on ${r.checkedAt.slice(0, 10)}. Nothing here has changed the site; each item needs checking against an official source before it is added.`, ""];

const section = (title, items, render) => {
  lines.push(`## ${title} (${items.length})`);
  lines.push(items.length ? items.map(render).join("\n") : "Nothing this month.");
  lines.push("");
};

section("Warnings", r.warnings, (w) => `- ${w}`);
section("Broken event links", r.brokenLinks, (b) => `- ${b.name}: ${b.kind} ${b.url} (${b.status}, ${b.note})`);
section("Broken links in articles, case studies and reports", r.resourceLinks, (b) => `- ${b.name}: ${b.url} (${b.status}, ${b.note})`);
section("Possible new events, by city", r.newEvents, (c) => `- **${c.name}**\n${c.news.slice(0, 4).map((n) => `  - ${story(n)}`).join("\n")}`);
section("Watched events with news of their dates", r.waiting, (w) => `- **${w.name}**: ${w.news.map(story).join("; ")}`);
section("New market figures that may be out", r.marketReleases, (m) => `- **${m.name}**: ${m.news.map(story).join("; ")}`);

lines.push("To act on this, ask Claude Code to \"review the new events\" or \"update the market figures\".");
console.log(lines.join("\n"));
