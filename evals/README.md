# Evals: is the tool fit to publish?

These checks answer one question before every release: **can this go in front of users?** They run the tool's rules against examples with known answers, inspect every content file, read what the server is sending right now, and use the app in a real browser at desktop and phone sizes.

## How to run

Open a terminal in the project folder and run one of these.

| Command | What it runs | Time |
|---|---|---|
| `npm run evals` | Everything except the external-link check. Run this before every release. | about 1.5 minutes |
| `npm run evals:quick` | Only the checks that need no server, browser or internet. Run this after editing content. | 2 seconds |
| `npm run evals:links` | Visits every source link in the articles, case studies and events. Run this weekly. | about 1 minute |
| `npm run evals:all` | All of the above. | about 2.5 minutes |
| `npm run evals -- --url=https://your-site` | Checks a deployed copy instead of this machine. Run this after every deployment. | about 1.5 minutes |

The run ends with **READY TO PUBLISH** or **NOT READY TO PUBLISH**, and writes a readable report to `evals/report.html` (open it in a browser).

## Reading the results

- **PASS**: the check succeeded.
- **FAIL**: a blocker. Users would see something wrong or broken. Fix it before publishing.
- **WARN**: needs a look, but does not block publishing (for example, a site that refuses automatic visits, or content that will run out in a few weeks).
- **SKIP**: could not be run this time (for example, no Chrome or Edge on the machine).

## What is checked

| Suite | Covers |
|---|---|
| 1. Rules | News filters, duplicate-story detection, summaries, company tagging, long weekends, holiday calendar, market hours, price refresh timing, air-traffic checks, publishing schedule |
| 2. Content | Every article, case study, glossary term, event, wedding date, holiday, city, indicator, GST slab, stock and news source; pictures; text colour contrast |
| 3. Live data | What the server sends right now: news quality, stock prices, stock popups, comparison, events, long weekends, weather, resources, speed |
| 4. Deployment readiness | Private files not exposed, security headers, preview lock, behaviour when feeds or the price service fail, independence from the host's time zone, project setup |
| 5. The app in a browser | Every tab, filter, popup, calculator and scheduled article; hostile feed text; desktop and phone layouts; accessibility; behaviour when the server is unreachable |
| 6. External links | Every source, report and event link still opens; every news feed still returns a feed |

## Adding to the checks

When a problem slips through, add an example so it cannot return:

- **A junk story got through, or a good one was dropped:** add the headline to `evals/cases/news-filter.json` with `"expect": "drop"` or `"keep"`.
- **A story was tagged with the wrong company:** add the headline to `evals/cases/company-tags.json` with the company it should (or should not) be tagged with.

Then run `npm run evals:quick`. It will fail until the rule is fixed.

## Requirements

Node 22 or later, and Chrome or Edge for the browser suite (set `CHROME_PATH` if it is installed somewhere unusual).
