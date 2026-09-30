// Reads the tool's data files for the suites. Articles and case studies live in
// the private content folder (see lib/paths.js); everything else is in data/.

const fs = require("fs");
const path = require("path");
const { ROOT, DATA_DIR, CONTENT_DIR } = require("../../lib/paths");

const CONTENT_FILES = { "briefs.json": { articles: [] }, "case-studies.json": { cases: [] } };

// True when the private content is on this machine. Without it (for example a
// fresh copy of the public repository) content checks are skipped, not failed.
const hasContent = () => Object.keys(CONTENT_FILES).every((f) => fs.existsSync(path.join(CONTENT_DIR, f)));

function read(file) {
  if (file in CONTENT_FILES) {
    const p = path.join(CONTENT_DIR, file);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : CONTENT_FILES[file];
  }
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
}

const NO_CONTENT = "the private content folder (articles and case studies) is not on this machine";

module.exports = { ROOT, DATA_DIR, CONTENT_DIR, read, hasContent, NO_CONTENT };
