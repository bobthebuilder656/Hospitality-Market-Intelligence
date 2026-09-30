// Where the tool's files live.
//
// data/     reference data and saved copies of fetched data (in the public repository)
// content/  the articles, case studies and their pictures. These are scheduled
//           ahead of their publish dates, so they are kept in a separate private
//           repository and are not part of the public one. Locally it is a folder
//           beside the code; on the host it is fetched at build time
//           (scripts/fetch-content.js). CONTENT_DIR can point somewhere else.
//
// The tool runs without content/: the Resources tab then shows no article yet.

const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONTENT_DIR = process.env.CONTENT_DIR ? path.resolve(process.env.CONTENT_DIR) : path.join(ROOT, "content");

module.exports = { ROOT, DATA_DIR, CONTENT_DIR };
