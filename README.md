# Hospitality Market Intelligence

A free daily market briefing for hotel sales and revenue teams in India. It gathers the day's hospitality news, hotel and travel share prices, upcoming demand dates for 15 Indian cities, and practical reading, and shows them in one place on a laptop or a phone.

**Live site:** https://bobthebuilder656.github.io/Hospitality-Market-Intelligence/

## What is in it

| Tab | What it shows |
|---|---|
| **Dashboard** | The day at a glance: top 3 headlines, a market snapshot, the next dates and big event for your city, and today's reading. Remembers your city and watchlist. |
| **News** | Up to 10 stories a day from 12 Indian and international hospitality outlets, each with a short summary and a tag when it names a listed company. |
| **Stock Prices** | 19 listed hotel, restaurant and online-travel companies, with a sector summary, watchlist, price history and side-by-side comparison. |
| **City Events** | Holidays, long weekends, festivals, expos, sports and wedding dates for 15 cities over six months, as a list or a calendar, with a 7-day forecast and monthly airport traffic. |
| **Resources** | Calculators (occupancy and RevPAR, GST on rooms, group quotes), a glossary with a term of the day, key industry reports, The Hotelier's Brief (Wednesdays and Sundays) and a case study (Fridays). |

## How it updates itself

The site is plain files on GitHub Pages; there is no server. GitHub Actions does the work (`.github/workflows/site.yml`):

1. **Fetch:** every 30 minutes while the stock market is open and every hour otherwise, `scripts/build-site.js` fetches the news feeds, share prices, price histories, headlines, weather, holidays and airport traffic, and writes them as files beside the page.
2. **Check:** about 130 checks run on the result, including the whole site in a real browser at desktop and phone sizes (see below).
3. **Publish:** only if every check passes does the new version replace the live site. If a check fails, the previous version stays up and the owner is emailed.

If a source is down during a build (a feed, Yahoo, the weather service), its data from the previous build is kept, so one bad fetch never empties part of the page.

## Where the data comes from

- **News:** RSS feeds of 12 hospitality publications, filtered and summarised by fixed rules (no AI model is used at run time).
- **Share prices:** Yahoo Finance; headlines from Google News.
- **Holidays:** Google's public "Holidays in India" calendar. **Weather:** Open-Meteo. **Airport traffic:** Airports Authority of India monthly tables.
- **Events, glossary, GST slabs and indicators:** written and sourced by hand in `data/`.
- **Articles and case studies:** written and sourced by hand. They are scheduled ahead of their publish dates, so they live in a separate private repository; each build includes only the pieces already due. Without them the tool still runs, and the Resources tab simply shows no article yet.

## Running it on your machine

Needs Node 22 or later.

```
npm install
npm start
```

This builds the site with today's data and serves it at http://localhost:3000. `npm run build` refreshes the data. To read articles before their date: `npm run preview -- --date=2026-10-09` (never publish a preview build).

## The checks

```
npm run evals
```

This runs the rules against labelled examples, checks every content file, the built data, publishing safety (nothing private, security policy, resilience when sources fail), and the app itself in a headless browser, and ends with READY or NOT READY TO PUBLISH. See `evals/README.md`.

`npm run evals:self-test` tests the checks themselves: it plants deliberate bugs in a throwaway copy of the project and reports any the checks fail to notice.

The checks were also reviewed by an independent agent that knew nothing of how the tool was built and was asked only to find faults; its findings were fixed and each now has a check.

## Layout

| Path | Contents |
|---|---|
| `scripts/build-site.js` | Builds the site: fetches every source and writes the data files |
| `lib/` | Fetching, filtering and date logic |
| `public/` | The page that runs in the browser |
| `data/` | Reference content and a daily snapshot of fetched data |
| `content/` | Articles, case studies and pictures (private; not in this repository) |
| `evals/` | The checks, and the self-test that plants bugs to confirm they catch them |
| `server.js` | Builds and serves the site on your own machine |

For information only; share prices may be delayed and nothing here is financial advice.
