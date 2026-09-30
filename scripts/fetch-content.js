// Build step on the host: downloads the private content repository (articles,
// case studies and their pictures) into content/. The code repository is public,
// and these are scheduled ahead of their publish dates, so they are kept apart.
//
// Settings on the host:
//   CONTENT_REPO   owner/name of the private repository, e.g. someone/hospitality-intel-content
//   CONTENT_TOKEN  a GitHub token that can read that repository (fine-grained, Contents: read-only)
//
// With neither set, the tool is built without articles and still runs. With them
// set, a failed download stops the build, so a site never goes live missing its content.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { CONTENT_DIR } = require("../lib/paths");

const repo = process.env.CONTENT_REPO;
const token = process.env.CONTENT_TOKEN;

if (fs.existsSync(path.join(CONTENT_DIR, "briefs.json"))) {
  console.log("[content] already present; nothing to fetch");
  process.exit(0);
}
if (!repo || !token) {
  console.warn("[content] CONTENT_REPO / CONTENT_TOKEN are not set: building without articles and case studies");
  process.exit(0);
}
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error("[content] CONTENT_REPO must look like owner/name");
  process.exit(1);
}

try {
  fs.rmSync(CONTENT_DIR, { recursive: true, force: true });
  execFileSync("git", ["clone", "--depth", "1", `https://x-access-token:${token}@github.com/${repo}.git`, CONTENT_DIR], { stdio: "pipe" });
  fs.rmSync(path.join(CONTENT_DIR, ".git"), { recursive: true, force: true }); // the token is in its config
  const count = (file, key) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8"))[key].length;
  console.log(`[content] fetched ${count("briefs.json", "articles")} articles and ${count("case-studies.json", "cases")} case studies`);
} catch (err) {
  // Never print the command or git's output: both contain the token.
  console.error("[content] could not download the content repository. Check that CONTENT_REPO is right and CONTENT_TOKEN has not expired.");
  process.exit(1);
}
