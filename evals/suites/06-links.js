// External links: every source, report and event link in the content still
// opens. Slow (a few hundred web requests), so it only runs with
// `npm run evals:links` or `npm run evals:all`.

const fs = require("fs");
const path = require("path");
const { expectNone } = require("../lib/harness");

const { ROOT, read } = require("../lib/files");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const CONCURRENCY = 8;

// Every http(s) address in a data structure: url/source/creditUrl fields and links written in article text.
function collect(node, where, found) {
  if (Array.isArray(node)) node.forEach((n) => collect(n, where, found));
  else if (node && typeof node === "object") {
    const label = node.id || node.name || where;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        if (["url", "source", "creditUrl", "pdfUrl"].includes(key) && /^https?:\/\//.test(value)) found.push({ url: value, where: `${where}: ${label}` });
        for (const m of value.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) found.push({ url: m[1], where: `${where}: ${label}` });
      } else collect(value, node.id ? `${where} ${node.id}` : where, found);
    }
  }
}

// Sites that turn away every automated visitor (they answer 403 or 404 to a
// script but open normally in a browser), so a failure proves nothing.
const BLOCKS_AUTOMATED_VISITS = ["pib.gov.in"];

async function check(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/pdf,*/*" }, signal: AbortSignal.timeout(25000), redirect: "follow" });
    await res.body?.cancel();
    if (res.status >= 400 && BLOCKS_AUTOMATED_VISITS.some((host) => new URL(url).hostname.endsWith(host))) return "blocked";
    // A page that now redirects to a sign-in page is no longer readable by users.
    if (res.status < 400 && /\/(login|signin|sign-in|subscribe)\b/i.test(new URL(res.url).pathname) && !/\/(login|signin|sign-in|subscribe)\b/i.test(new URL(url).pathname)) return "needs sign-in";
    return res.status === 404 && /\/(login|signin|sign-in)\b/i.test(new URL(res.url).pathname) ? "needs sign-in" : res.status;
  } catch (err) {
    if (err.name === "TimeoutError") return "timeout";
    // Node is stricter than browsers about incomplete security certificates; the page may still open.
    return /CERT|SIGNATURE|certificate/i.test(String((err.cause && (err.cause.code || err.cause.message)) || "")) ? "certificate" : "unreachable";
  }
}

async function checkAll(links) {
  const unique = [...new Map(links.map((l) => [l.url, l])).values()];
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < unique.length) {
        const link = unique[next++];
        results.push({ ...link, status: await check(link.url) });
      }
    })
  );
  return results;
}

// 401/403/429 usually mean the site blocks automated visitors, not that the page is gone.
const isBlocked = (s) => [401, 403, 405, 406, 429, 999].includes(s) || ["timeout", "blocked", "certificate"].includes(s);
const isBroken = (s) => !(typeof s === "number" && s < 400) && !isBlocked(s);

module.exports = {
  id: "links",
  title: "6. External links (sources, reports and event pages still open)",
  about: "Every web link in the articles, case studies, events and reference data is visited.",
  needs: ["network"],
  slow: true,

  async run(t) {
    const groups = [
      ["Articles (The Hotelier's Brief)", ["briefs.json"]],
      ["Case studies", ["case-studies.json"]],
      ["Events and wedding-date sources", ["events-curated.json", "wedding-dates.json"]],
      ["Reports, GST sources, indicators and air traffic", ["resources-library.json", "market-indicators.json", "dashboard-indicators.json", "air-reasons.json", "air-traffic.json"]],
    ];
    for (const [label, files] of groups) {
      const links = [];
      for (const f of files) {
        const data = read(f);
        collect(data, f.replace(".json", ""), links);
        if (f === "wedding-dates.json") for (const s of data.sources) if (/^https?:\/\//.test(s)) links.push({ url: s, where: "wedding-dates" });
      }
      const results = await checkAll(links);
      await t.check(`${label}: no dead links`, () => {
        expectNone(results.filter((r) => isBroken(r.status)).map((r) => `${r.status} ${r.url} (${r.where})`), 12);
        return `${results.length} links`;
      });
      await t.warn(`${label}: links that block automatic checks (open these by hand)`, () => {
        expectNone(results.filter((r) => isBlocked(r.status)).map((r) => `${r.status} ${r.url}`), 12);
      });
    }

    await t.check("News feeds: every source address still returns a feed", async () => {
      const sources = require(path.join(ROOT, "lib", "sources.js"));
      const out = [];
      await Promise.all(
        sources.map(async (s) => {
          try {
            const res = await fetch(s.url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HospitalityIntelBot/1.0" }, signal: AbortSignal.timeout(20000) });
            const text = await res.text();
            if (!res.ok) out.push(`${s.name}: returned ${res.status}`);
            else if (!/<(rss|feed)[\s>]/i.test(text.slice(0, 2000))) out.push(`${s.name}: the address no longer returns a feed`);
          } catch (err) {
            out.push(`${s.name}: ${err.name === "TimeoutError" ? "timed out" : "unreachable"}`);
          }
        })
      );
      if (out.length > 2) expectNone(out);
      return out.length ? `${sources.length - out.length} of ${sources.length} (${out.join("; ")})` : `${sources.length} feeds`;
    });
  },
};
