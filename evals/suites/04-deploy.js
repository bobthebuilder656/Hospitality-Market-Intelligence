// Publishing safety: what must hold before the built site goes on the internet.
// Nothing private in it, the page's own protections in place, data sources that
// fail do not empty the page, and the results do not depend on the clock of the
// machine that builds it.

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { expect, expectEqual, expectNone } = require("../lib/harness");
const { read, hasContent } = require("../lib/files");

const ROOT = path.join(__dirname, "..", "..");
const lib = (name) => require(path.join(ROOT, "lib", name));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const todayIst = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

// Every file in a folder, as paths relative to it.
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).replace(/\\/g, "/"));
    }
  };
  walk(dir);
  return out;
}

module.exports = {
  id: "deploy",
  title: "4. Publishing safety (nothing private, protections, resilience, host independence)",
  about: "What must hold before the built site is published to the internet.",
  needs: ["site", "network"],

  async run(t, ctx) {
    const { api } = ctx;

    // ---- nothing private in the site ---------------------------------------------------

    if (ctx.siteDir) {
      const files = listFiles(ctx.siteDir);

      await t.check("The site contains only the page, its data and published pictures", () => {
        const allowed = /^(index\.html|style\.css|favicon\.svg|\.nojekyll|(app|air|events|resources|dashboard)\.js|data\/(news|stocks|stock-headlines|events|event-news|weather|resources|air-traffic|build)\.json|data\/stocks\/[a-z0-9-]+\.json|images\/(briefs|cases)\/[\w.-]+\.(jpg|jpeg|png|webp))$/;
        expectNone(files.filter((f) => !allowed.test(f)).map((f) => `unexpected file published: ${f}`));
        return `${files.length} files`;
      });

      if (hasContent()) {
        await t.check("No unpublished article or case study, or its picture, is anywhere in the site", () => {
          const built = readJson(path.join(ctx.siteDir, "data", "resources.json"));
          const today = built.today;
          const future = [...read("briefs.json").articles, ...read("case-studies.json").cases].filter((x) => x.publishDate > today);
          const text = files.filter((f) => /\.(json|html|js)$/.test(f)).map((f) => fs.readFileSync(path.join(ctx.siteDir, f), "utf-8")).join("\n");
          const out = [];
          for (const x of future) {
            if (text.includes(x.title) || text.includes(JSON.stringify(x.title).slice(1, -1))) out.push(`"${x.title}" (due ${x.publishDate})`);
            if (x.image && files.includes(x.image.src) && ![built.brief, built.caseStudy].some((b) => b && b.image && b.image.src === x.image.src)) out.push(`picture of "${x.id}" (due ${x.publishDate}): ${x.image.src}`);
          }
          expectNone(out);
          return `${future.length} unpublished pieces checked`;
        });
      } else {
        t.skip("No unpublished article or case study is anywhere in the site", "the private content folder is not on this machine");
      }

      await t.check("The news file sent to visitors holds no internal diagnostics", () => {
        const news = readJson(path.join(ctx.siteDir, "data", "news.json"));
        expectNone(Object.keys(news).filter((k) => !["generatedAt", "sources", "items"].includes(k)).map((k) => `"${k}" is published`));
      });
    } else {
      t.skip("Site contents", "checked against a build on this machine, not a remote address");
    }

    // ---- the page's own protections ------------------------------------------------------

    await t.check("The page only allows its own scripts to run (content security policy)", async () => {
      const html = (await api("/")).text;
      const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
      expectNone([
        !csp ? "no content security policy in the page" : null,
        csp && !/script-src 'self'(;|$)/.test(csp) ? "the policy allows scripts from outside the site" : null,
        /unsafe-eval/.test(csp) ? "the policy allows unsafe-eval" : null,
        /<script(?![^>]*\ssrc=)[^>]*>/i.test(html) ? "index.html contains an inline <script> (the policy would block it)" : null,
        /\son[a-z]+\s*=\s*["']/i.test(html) ? "index.html contains an inline event handler (the policy would block it)" : null,
      ].filter(Boolean));
    });

    await t.check("No script writes inline event handlers into the page (they would be blocked)", async () => {
      const out = [];
      for (const p of ["/app.js", "/air.js", "/events.js", "/resources.js", "/dashboard.js"]) if (/<[a-z][^>`]*\son(error|click|load|mouseover)\s*=/i.test((await api(p)).text)) out.push(p);
      expectNone(out);
    });

    await t.check("The page is set up correctly for phones, search engines and screen readers", async () => {
      const html = (await api("/")).text;
      expectNone([
        !/<html[^>]*\slang="en"/.test(html) ? "no language set on the page" : null,
        !/<meta name="viewport" content="width=device-width, initial-scale=1/.test(html) ? "no mobile viewport setting" : null,
        !/<title>[^<]{5,}<\/title>/.test(html) ? "no page title" : null,
        !/<meta name="description" content="[^"]{30,}"/.test(html) ? "no page description (shown in search results and link previews)" : null,
        !/<link rel="icon"/.test(html) ? "no site icon" : null,
      ].filter(Boolean));
    });

    await t.check("Every address in the page is relative, so it works under the GitHub Pages folder name", async () => {
      const out = [];
      const html = (await api("/")).text;
      for (const m of html.matchAll(/\s(?:src|href)="(\/[^"]*)"/g)) out.push(`index.html points at ${m[1]}`);
      for (const p of ["/app.js", "/air.js", "/events.js", "/resources.js", "/dashboard.js"]) {
        const js = (await api(p)).text;
        for (const m of js.matchAll(/fetch\(\s*[`"'](\/[^`"']*)/g)) out.push(`${p} fetches ${m[1]}`);
      }
      expectNone(out);
    });

    await t.warn("The page is light enough for mobile data (under 400 KB before pictures)", async () => {
      let total = 0;
      for (const p of ["/", "/style.css", "/app.js", "/air.js", "/events.js", "/resources.js", "/dashboard.js"]) total += Buffer.byteLength((await api(p)).text);
      expect(total < 400 * 1024, `${Math.round(total / 1024)} KB`);
      return `${Math.round(total / 1024)} KB`;
    });

    // ---- resilience: a failed source never empties the page ----------------------------------

    if (ctx.remote || !ctx.siteDir) {
      t.skip("Resilience checks (failed sources keep the previous data)", "these run against the build code on this machine");
    } else {
      const Parser = require(path.join(ROOT, "node_modules", "rss-parser"));
      const realParse = Parser.prototype.parseURL;
      const realFetch = global.fetch;
      const realConsole = { warn: console.warn, log: console.log, error: console.error };
      const quiet = () => {
        console.warn = console.log = console.error = () => {};
      };
      const restore = () => {
        Parser.prototype.parseURL = realParse;
        global.fetch = realFetch;
        Object.assign(console, realConsole);
      };
      // Saved copies the build writes into data/; put back afterwards.
      const saved = ["news.json", "stocks.json", "holidays.json", "air-traffic.json"].map((f) => [f, fs.readFileSync(path.join(ROOT, "data", f))]);

      await t.check("If every outside source is down, a new build keeps all of the previous build's data", async () => {
        const out = fs.mkdtempSync(path.join(os.tmpdir(), "hi-offline-build-"));
        Parser.prototype.parseURL = async () => {
          throw new Error("simulated network failure");
        };
        global.fetch = async () => {
          throw new Error("simulated network failure");
        };
        quiet();
        let build;
        try {
          build = await require(path.join(ROOT, "scripts", "build-site")).buildSite({ outDir: out, previousDir: ctx.siteDir, log: () => {} });
        } finally {
          restore();
          for (const [f, data] of saved) fs.writeFileSync(path.join(ROOT, "data", f), data);
        }
        const old = (rel) => readJson(path.join(ctx.siteDir, "data", rel));
        const fresh = (rel) => readJson(path.join(out, "data", rel));
        const problems = [];
        if (fresh("news.json").items.length < old("news.json").items.length) problems.push("news stories were lost");
        if (fresh("stocks.json").quotes.filter((q) => !q.error).length < old("stocks.json").quotes.filter((q) => !q.error).length) problems.push("share prices were lost");
        if (JSON.stringify(fresh("stocks/indian-hotels.json").history) !== JSON.stringify(old("stocks/indian-hotels.json").history)) problems.push("price history was lost");
        if (Object.values(fresh("weather.json").cities).filter(Boolean).length < Object.values(old("weather.json").cities).filter(Boolean).length) problems.push("weather forecasts were lost");
        if (fresh("events.json").events.length === 0) problems.push("events were lost");
        if (!build.problems.length) problems.push("the build did not report that its sources failed");
        fs.rmSync(out, { recursive: true, force: true });
        expectNone(problems);
        return `${build.problems.length} source failures reported, previous data kept`;
      });
    }

    // ---- host independence -----------------------------------------------------------

    await t.check("Dates, publishing and market hours do not depend on the build machine's time zone", () => {
      const probe = path.join(__dirname, "..", "lib", "tz-probe.js");
      const run = (tz) => JSON.parse(execFileSync(process.execPath, [probe], { env: { ...process.env, TZ: tz }, encoding: "utf-8" }));
      const zones = ["Asia/Kolkata", "UTC", "America/Los_Angeles", "Asia/Tokyo"];
      const results = zones.map(run);
      expect(new Set(results.map((r) => r.offsetMinutes)).size > 1, "could not simulate different time zones on this machine");
      const strip = ({ offsetMinutes, ...rest }) => JSON.stringify(rest);
      const differing = zones.filter((z, i) => strip(results[i]) !== strip(results[0]));
      if (differing.length) throw new Error(`results change when the clock is set to ${differing.join(", ")}: ${strip(results[zones.indexOf(differing[0])])} vs ${strip(results[0])}`);
      expectEqual(results[0].today, "2026-10-01", "India's date at 20:00 UTC on 30 Sep");
      expectEqual(results[0].resourcesToday, "2026-10-01", "Resources tab's date");
      expectEqual(results[0].marketOpen, true, "market open at 10:00 IST on a Wednesday");
    });

    await t.check("GitHub's schedule builds the site daily just after midnight India time, when new articles go live", () => {
      const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "site.yml"), "utf-8");
      const crons = [...wf.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
      // 00:05–00:59 India time is 18:35–19:29 UTC.
      const afterMidnight = crons.some((c) => {
        const [min, hour] = c.split(/\s+/);
        return (hour === "18" && /^\d+$/.test(min) && +min >= 35) || (hour === "19" && /^\d+$/.test(min) && +min < 30);
      });
      expect(afterMidnight, `no scheduled build shortly after midnight India time (schedules: ${crons.join(" | ")})`);
    });

    // ---- project setup -----------------------------------------------------------------

    await t.check("package.json declares how to build and start the tool and which Node version it needs", () => {
      const pkg = readJson(path.join(ROOT, "package.json"));
      expectNone([
        !(pkg.scripts && pkg.scripts.build && pkg.scripts.start) ? "no build or start script" : null,
        !(pkg.engines && pkg.engines.node) ? "no engines.node" : null,
        !fs.existsSync(path.join(ROOT, "package-lock.json")) ? "no package-lock.json (builds could install different versions)" : null,
      ].filter(Boolean));
    });

    await t.check("No passwords or keys are written into the code", () => {
      const hits = [];
      const scan = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (["node_modules", ".git", "images", "evals", "site", "content"].includes(e.name)) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) scan(p);
          else if (/\.(js|json|html|env|md|yml|yaml)$/.test(e.name) && fs.statSync(p).size < 2_000_000) {
            const text = fs.readFileSync(p, "utf-8");
            if (/(api[_-]?key|secret|password|passwd|access[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-./+]{12,}["']/i.test(text) || /\b(ghp|gho|github_pat|sk|pk)_[A-Za-z0-9_]{20,}\b/.test(text)) hits.push(path.relative(ROOT, p));
          }
        }
      };
      scan(ROOT);
      expectNone(hits.map((f) => `${f} looks like it contains a key or password`));
    });

    await t.warn("The project is under version control, with node_modules, the build and the private content ignored", () => {
      const ignore = fs.existsSync(path.join(ROOT, ".gitignore")) ? fs.readFileSync(path.join(ROOT, ".gitignore"), "utf-8") : "";
      expectNone([
        !fs.existsSync(path.join(ROOT, ".git")) ? "not a git repository" : null,
        ...["node_modules/", "content/", "site/"].filter((p) => !ignore.includes(p)).map((p) => `${p} is not in .gitignore`),
      ].filter(Boolean));
    });

    await t.warn("Installed packages have no known high-severity vulnerabilities", () => {
      let out;
      try {
        out = execSync("npm audit --omit=dev --json", { cwd: ROOT, encoding: "utf-8", timeout: 90000, stdio: ["ignore", "pipe", "ignore"] });
      } catch (err) {
        out = err.stdout;
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
  },
};
