// Deployment readiness: the things that work on a laptop and break, leak or get
// abused once the tool is on the internet. Covers security, resilience when a
// data source is down, and independence from the host machine's clock.

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { expect, expectEqual, expectNone } = require("../lib/harness");

const ROOT = path.join(__dirname, "..", "..");
const lib = (name) => require(path.join(ROOT, "lib", name));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

// Runs fn with a data file backed up, and puts the file back afterwards whatever happens.
async function withBackup(file, fn) {
  const p = path.join(ROOT, "data", file);
  const original = fs.readFileSync(p);
  try {
    return await fn(p);
  } finally {
    fs.writeFileSync(p, original);
  }
}

module.exports = {
  id: "deploy",
  title: "4. Deployment readiness (security, resilience, host independence)",
  about: "What works on a laptop but breaks, leaks or gets abused once the tool is on the internet.",
  needs: ["server", "network"],

  async run(t, ctx) {
    const { api } = ctx;

    // ---- security ------------------------------------------------------------------

    await t.check("Private files are not reachable from the web", async () => {
      const paths = ["/data/news.json", "/content/case-studies.json", "/content/briefs.json", "/case-studies.json", "/briefs.json", "/images/../briefs.json", "/images/%2e%2e/case-studies.json", "/server.js", "/package.json", "/lib/sources.js", "/evals/report.html", "/.env", "/PROGRESS.md", "/..%2fpackage.json", "/%2e%2e/server.js", "/node_modules/express/package.json"];
      const open = [];
      for (const p of paths) if ((await api(p)).status === 200) open.push(p);
      expectNone(open.map((p) => `${p} is publicly readable`));
    });

    await t.check("Responses carry basic security headers and do not advertise the server software", async () => {
      const res = await api("/");
      const h = (name) => res.headers.get(name);
      expectNone([
        h("x-powered-by") ? `X-Powered-By: ${h("x-powered-by")} tells attackers what the server runs` : null,
        h("x-content-type-options") !== "nosniff" ? "X-Content-Type-Options: nosniff is missing" : null,
        !h("x-frame-options") && !/frame-ancestors/.test(h("content-security-policy") || "") ? "X-Frame-Options is missing (the site could be framed by another site)" : null,
        !h("referrer-policy") ? "Referrer-Policy is missing" : null,
        !/script-src 'self'(;|$)/.test(h("content-security-policy") || "") ? "Content-Security-Policy is missing or allows scripts from outside the site" : null,
      ].filter(Boolean));
    });

    await t.check("The page has no inline scripts (they would be blocked by its own security policy)", async () => {
      const html = (await api("/")).text;
      const js = ["/app.js", "/air.js", "/events.js", "/resources.js", "/dashboard.js"];
      const out = [];
      if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) out.push("index.html contains an inline <script>");
      if (/\son[a-z]+\s*=\s*["']/i.test(html)) out.push("index.html contains an inline event handler");
      for (const p of js) if (/<[a-z][^>`]*\son(error|click|load|mouseover)\s*=/i.test((await api(p)).text)) out.push(`${p} writes an inline event handler into the page`);
      expectNone(out);
    });

    await t.check("The page is set up correctly for phones, search engines and screen readers", async () => {
      const html = (await api("/")).text;
      expectNone([
        !/<html[^>]*\slang="en"/.test(html) ? "no language set on the page" : null,
        !/<meta name="viewport" content="width=device-width, initial-scale=1/.test(html) ? "no mobile viewport setting" : null,
        !/<title>[^<]{5,}<\/title>/.test(html) ? "no page title" : null,
        !/<meta name="description" content="[^"]{30,}"/.test(html) ? "no page description (shown in search results and link previews)" : null,
        !/<link rel="icon"/.test(html) ? "no site icon (browsers will log a missing favicon on every visit)" : null,
      ].filter(Boolean));
    });

    await t.check("Unknown addresses return a clean 'not found', not a crash", async () => {
      const out = [];
      for (const p of ["/api/nope", "/api/stocks/x/y/z", "/no-such-page"]) {
        const res = await api(p);
        if (res.status !== 404) out.push(`${p} returned ${res.status}`);
        if (/at .*\.js:\d+/.test(res.text)) out.push(`${p} shows internal code paths`);
      }
      expectNone(out);
    });

    await t.check("A health-check address reports whether the data is fresh", async () => {
      const res = await api("/api/health");
      expect(res.status === 200 && res.json, `/api/health returned ${res.status} (hosts and uptime monitors need it)`);
      expect(typeof res.json.ok === "boolean" && res.json.news && res.json.stocks, "health response should say ok and give the age of news and stock data");
    });
    await t.warn("The health check says the data is fresh", async () => {
      const { json } = await api("/api/health");
      expect(json && json.ok, `health reports a problem: ${JSON.stringify(json)}`);
      return `news ${json.news.hoursOld}h old, ${json.stocks.prices} prices`;
    });

    if (ctx.remote) {
      t.skip("Unpublished articles cannot be read early on the live site", "checked separately below against the address given");
    } else {
      await t.check("On the live site, unpublished articles cannot be read early through preview mode", async () => {
        const prod = ctx.startServer(3198, { NODE_ENV: "production", PREVIEW_KEY: "" });
        try {
          await ctx.waitForServer(prod.url);
          const prodApi = ctx.makeApi(prod.url);
          const normal = (await prodApi("/api/resources")).json;
          for (const q of ["?preview=1", "?preview=2026-12-31", "?preview=2099-12-31&key="]) {
            const previewed = (await prodApi(`/api/resources${q}`)).json;
            expect((previewed.brief || {}).id === (normal.brief || {}).id && (previewed.caseStudy || {}).id === (normal.caseStudy || {}).id, `anyone can read unpublished pieces by adding ${q} to the address`);
          }
          // The expensive addresses (price history) are limited per visitor.
          const statuses = [];
          for (let i = 0; i < 34; i++) statuses.push((await prodApi("/api/stocks/not-a-stock/detail")).status);
          expect(statuses.slice(0, 30).every((s) => s === 404) && statuses.slice(30).every((s) => s === 429), `a visitor can call the price-history address without limit (statuses after 30 calls: ${statuses.slice(30).join(", ")})`);
        } finally {
          prod.proc.kill();
        }
      });
      await t.check("Preview mode still works for the owner with the preview key", async () => {
        const prod = ctx.startServer(3197, { NODE_ENV: "production", PREVIEW_KEY: "test-key-123" });
        try {
          await ctx.waitForServer(prod.url);
          const prodApi = ctx.makeApi(prod.url);
          const normal = (await prodApi("/api/resources")).json;
          const wrong = (await prodApi("/api/resources?preview=1&key=nope")).json;
          const right = (await prodApi("/api/resources?preview=1&key=test-key-123")).json;
          expectEqual(wrong.brief.id, normal.brief.id, "article shown with a wrong key");
          expect(right.brief.id !== normal.brief.id, "the right key did not unlock the next article");
        } finally {
          prod.proc.kill();
        }
      });
    }

    // ---- resilience ----------------------------------------------------------------

    if (ctx.remote) {
      t.skip("Resilience checks (failed refreshes keep the last good data)", "these run against the code on this machine, not a remote address");
    } else {
      const Parser = require(path.join(ROOT, "node_modules", "rss-parser"));
      const realParse = Parser.prototype.parseURL;
      const realFetch = global.fetch;
      const realConsole = { warn: console.warn, log: console.log, error: console.error };
      // The simulated failures make the code log warnings; keep them out of the report.
      const quiet = () => {
        console.warn = console.log = console.error = () => {};
      };
      const restore = () => {
        Parser.prototype.parseURL = realParse;
        global.fetch = realFetch;
        Object.assign(console, realConsole);
      };

      await t.check("If every news feed fails, yesterday's stories stay up (the list is not wiped)", () =>
        withBackup("news.json", async (p) => {
          const before = readJson(p);
          expect(before.items.length > 0, "there are no saved stories to protect");
          Parser.prototype.parseURL = async () => {
            throw new Error("simulated network failure");
          };
          quiet();
          try {
            await lib("fetchNews").refreshNews();
          } finally {
            restore();
          }
          const after = readJson(p);
          expectEqual(after.items.length, before.items.length, "stories saved after a failed refresh");
        })
      );

      await t.check("The Refresh button cannot be used to hammer the news feeds", () =>
        withBackup("news.json", async (p) => {
          const saved = readJson(p);
          fs.writeFileSync(p, JSON.stringify({ ...saved, generatedAt: new Date(Date.now() - 60000).toISOString() }));
          let calls = 0;
          Parser.prototype.parseURL = async () => {
            calls++;
            throw new Error("should not be called");
          };
          quiet();
          try {
            await lib("fetchNews").getNews({ forceRefresh: true });
          } finally {
            restore();
          }
          expectEqual(calls, 0, "feed requests made by a forced refresh one minute after the last one");
        })
      );

      await t.check("If the price service fails, the last known prices stay up", () =>
        withBackup("stocks.json", async (p) => {
          const before = readJson(p).quotes.filter((q) => !q.error).length;
          global.fetch = async () => {
            throw new Error("simulated network failure");
          };
          quiet();
          try {
            await lib("fetchStocks").refreshStocks();
          } finally {
            restore();
          }
          const after = readJson(p).quotes.filter((q) => !q.error).length;
          expectEqual(after, before, "companies with a price after a failed refresh");
        })
      );

      await t.check("If the holiday calendar is unreachable, the saved calendar is used", async () => {
        global.fetch = async () => {
          throw new Error("simulated network failure");
        };
        quiet();
        let result;
        try {
          result = await lib("fetchHolidays").getHolidays({ forceRefresh: true });
        } finally {
          restore();
        }
        expect(result && result.holidays.length > 100, "no holidays returned when the calendar is unreachable");
      });
    }

    // ---- host independence -----------------------------------------------------------

    await t.check("Dates, publishing and market hours do not depend on the host machine's time zone", () => {
      const probe = path.join(__dirname, "..", "lib", "tz-probe.js");
      const run = (tz) => JSON.parse(execFileSync(process.execPath, [probe], { env: { ...process.env, TZ: tz }, encoding: "utf-8" }));
      const zones = ["Asia/Kolkata", "UTC", "America/Los_Angeles", "Asia/Tokyo"];
      const results = zones.map(run);
      expect(new Set(results.map((r) => r.offsetMinutes)).size > 1, "could not simulate different time zones on this machine");
      const strip = ({ offsetMinutes, ...rest }) => JSON.stringify(rest);
      const differing = zones.filter((z, i) => strip(results[i]) !== strip(results[0]));
      if (differing.length) throw new Error(`results change when the host clock is set to ${differing.join(", ")}: ${strip(results[zones.indexOf(differing[0])])} vs ${strip(results[0])}`);
      expectEqual(results[0].today, "2026-10-01", "India's date at 20:00 UTC on 30 Sep");
      expectEqual(results[0].resourcesToday, "2026-10-01", "Resources tab's date");
      expectEqual(results[0].marketOpen, true, "market open at 10:00 IST on a Wednesday");
    });

    await t.check("The daily refresh runs at 11 am India time wherever the tool is hosted", () => {
      const dates = lib("dates");
      expect(typeof dates.msUntilIstHour === "function", "the daily refresh time is worked out from the host's local clock (server.js), so on a server abroad it would run at the wrong hour");
      expectEqual(dates.msUntilIstHour(11, new Date("2026-09-30T04:00:00Z")), 1.5 * 3600000, "wait from 09:30 IST to 11:00 IST");
      expectEqual(dates.msUntilIstHour(11, new Date("2026-09-30T05:30:00Z")), 24 * 3600000, "wait at exactly 11:00 IST (next day's run)");
      expectEqual(dates.msUntilIstHour(11, new Date("2026-09-30T18:00:00Z")), 11.5 * 3600000, "wait from 23:30 IST");
      const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf-8");
      expect(!/\.setHours\(/.test(server), "server.js still schedules by the host's local clock (setHours)");
    });

    // ---- project setup -----------------------------------------------------------------

    await t.check("package.json declares how to start the tool and which Node version it needs", () => {
      const pkg = readJson(path.join(ROOT, "package.json"));
      expectNone([
        !(pkg.scripts && pkg.scripts.start) ? "no start script" : null,
        !(pkg.engines && pkg.engines.node) ? "no engines.node (the code needs Node 18 or later; a host may default to an older one)" : null,
        !fs.existsSync(path.join(ROOT, "package-lock.json")) ? "no package-lock.json (hosts could install different versions)" : null,
      ].filter(Boolean));
    });

    await t.check("The port comes from the host's PORT setting", () => {
      expect(/process\.env\.PORT/.test(fs.readFileSync(path.join(ROOT, "server.js"), "utf-8")), "server.js ignores the PORT environment variable");
    });

    await t.check("No passwords or keys are written into the code", () => {
      const hits = [];
      const scan = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (["node_modules", ".git", "images", "evals"].includes(e.name)) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) scan(p);
          else if (/\.(js|json|html|env|md)$/.test(e.name) && fs.statSync(p).size < 2_000_000) {
            const text = fs.readFileSync(p, "utf-8");
            if (/(api[_-]?key|secret|password|passwd|access[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-./+]{12,}["']/i.test(text) || /\b(sk|pk)-[A-Za-z0-9]{20,}\b/.test(text)) hits.push(path.relative(ROOT, p));
          }
        }
      };
      scan(ROOT);
      expectNone(hits.map((f) => `${f} looks like it contains a key or password`));
    });

    await t.warn("The project is under version control, with node_modules ignored", () => {
      expectNone([
        !fs.existsSync(path.join(ROOT, ".git")) ? "not a git repository: most hosts deploy from git, and there is no history to roll back to" : null,
        !fs.existsSync(path.join(ROOT, ".gitignore")) ? "no .gitignore" : null,
      ].filter(Boolean));
    });

    await t.warn("Installed packages have no known high-severity vulnerabilities", () => {
      let out;
      try {
        out = execSync("npm audit --omit=dev --json", { cwd: ROOT, encoding: "utf-8", timeout: 90000, stdio: ["ignore", "pipe", "ignore"] });
      } catch (err) {
        out = err.stdout; // npm exits non-zero when it finds anything
      }
      let v;
      try {
        v = JSON.parse(out).metadata.vulnerabilities;
      } catch {
        throw new Error("could not run npm audit (no internet?)");
      }
      expect(!(v.high || v.critical), `${v.critical} critical and ${v.high} high severity (run "npm audit" for details)`);
      return `${v.total} advisories, none high or critical`;
    });

    await t.warn("The page is light enough for mobile data (under 400 KB before pictures)", async () => {
      let total = 0;
      for (const p of ["/", "/style.css", "/app.js", "/air.js", "/events.js", "/resources.js", "/dashboard.js"]) total += Buffer.byteLength((await api(p)).text);
      expect(total < 400 * 1024, `${Math.round(total / 1024)} KB`);
      return `${Math.round(total / 1024)} KB`;
    });
  },
};
