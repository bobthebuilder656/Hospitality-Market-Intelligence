// Runs the tool on this machine. The live site is plain files on GitHub Pages,
// rebuilt by GitHub Actions; this does the same build here and serves the result
// at http://localhost:3000, so what you see locally is what visitors get.
//
//   npm start                                 build with today's data, then serve
//   npm start -- --no-build                   serve the last build as it is
//   npm run preview -- --date=2026-10-09      include articles and case studies due by that date
//
// Rebuild with fresh data any time with `npm run build` and reload the page.

const express = require("express");
const path = require("path");
const fs = require("fs");
const { buildSite } = require("./scripts/build-site");

const PORT = process.env.PORT || 3000;
const SITE_DIR = path.join(__dirname, "site");
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || null;

async function main() {
  if (!process.argv.includes("--no-build") || !fs.existsSync(path.join(SITE_DIR, "index.html"))) {
    const preview = arg("date") || (process.argv.includes("--preview") ? true : false);
    if (preview) console.log(`Building a preview that includes pieces due by ${preview === true ? "the next publish date" : preview}. Do not publish this build.`);
    // Fall back on the previous local build if a source is unreachable.
    let previousDir = null;
    if (fs.existsSync(path.join(SITE_DIR, "data"))) {
      previousDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "hi-previous-"));
      fs.cpSync(SITE_DIR, previousDir, { recursive: true });
    }
    try {
      await buildSite({ outDir: SITE_DIR, preview, previousDir });
    } finally {
      if (previousDir) fs.rmSync(previousDir, { recursive: true, force: true });
    }
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.static(SITE_DIR, { extensions: ["html"] }));
  app.listen(PORT, () => console.log(`Hospitality Intel running at http://localhost:${PORT}`));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
