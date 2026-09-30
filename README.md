# Hospitality Market Intelligence

A daily market briefing for hotel sales and revenue teams in India. It gathers the day's hospitality news, hotel and travel share prices, upcoming demand dates for 15 Indian cities, and practical reading, and shows them in one place on a laptop or a phone.

**Live site:** _add the address here after deployment_

## What is in it

| Tab | What it shows |
|---|---|
| **Dashboard** | The day at a glance: top 3 headlines, a market snapshot, the next dates and big event for your city, and today's reading. Remembers your city and watchlist. |
| **News** | Up to 10 stories a day from 12 Indian and international hospitality outlets, each with a short summary and a tag when it names a listed company. |
| **Stock Prices** | 19 listed hotel, restaurant and online-travel companies, with a sector summary, watchlist, price history and side-by-side comparison. |
| **City Events** | Holidays, long weekends, festivals, expos, sports and wedding dates for 15 cities over six months, as a list or a calendar, with a 7-day forecast and monthly airport traffic. |
| **Resources** | Calculators (occupancy and RevPAR, GST on rooms, group quotes), a glossary with a term of the day, key industry reports, The Hotelier's Brief (Wednesdays and Sundays) and a case study (Fridays). |

## Where the data comes from

- **News:** RSS feeds of 12 hospitality publications, filtered and summarised by fixed rules (no AI model is used at run time).
- **Share prices:** Yahoo Finance; headlines from Google News.
- **Holidays:** Google's public "Holidays in India" calendar. **Weather:** Open-Meteo. **Airport traffic:** Airports Authority of India monthly tables.
- **Events, glossary, GST slabs and indicators:** written and sourced by hand in `data/`.
- **Articles and case studies:** written and sourced by hand. They are scheduled ahead of their publish dates, so they live in a separate private repository and are not part of this one. Without them the tool still runs; the Resources tab simply shows no article yet.

## Running it

Needs Node 22 or later.

```
npm install
npm start
```

Then open http://localhost:3000. News and prices refresh themselves; nothing else needs setting up.

## Checking it before a release

```
npm run evals
```

This runs about 140 checks (rules, content, live data, security, and the app in a real browser at desktop and phone sizes) and ends with READY or NOT READY TO PUBLISH. See `evals/README.md`. The same checks run automatically on GitHub for every change, and a change is only deployed once they pass.

`npm run evals:self-test` tests the tests: it plants 40 deliberate bugs in a throwaway copy of the project and reports any the checks fail to notice.

## Deploying

`render.yaml` describes the service for Render. The build downloads the private content repository (`CONTENT_REPO`, `CONTENT_TOKEN`). Unpublished articles can only be previewed with `?preview=1&key=<PREVIEW_KEY>`, or on the developer's own machine.

## Layout

| Path | Contents |
|---|---|
| `server.js` | The web server and the daily refresh job |
| `lib/` | Fetching, filtering and date logic |
| `public/` | The app that runs in the browser |
| `data/` | Reference content and saved copies of fetched data |
| `content/` | Articles, case studies and pictures (private; not in this repository) |
| `evals/` | The checks, and a self-test that plants bugs to confirm the checks catch them |

For information only; share prices may be delayed and nothing here is financial advice.
