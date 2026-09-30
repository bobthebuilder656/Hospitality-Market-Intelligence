// Run by the deploy suite under several TZ settings. Prints what the server-side
// date logic produces for one fixed moment, so the suite can confirm the answers
// do not depend on the clock setting of the machine the tool is hosted on.
const path = require("path");
const lib = (name) => require(path.join(__dirname, "..", "..", "lib", name));

const now = new Date("2026-09-30T20:00:00Z"); // 1 Oct, 01:30 in India; still 30 Sep in the UK and US
const dates = lib("dates");
const market = lib("fetchStocks").marketStatus(new Date("2026-09-30T04:30:00Z"));
const resources = lib("resources").getResources({ now });

console.log(
  JSON.stringify({
    offsetMinutes: new Date().getTimezoneOffset(),
    today: dates.todayIst(now),
    resourcesToday: resources.today,
    brief: resources.brief && resources.brief.id,
    marketOpen: market.open,
    lastClose: market.lastCloseAt.toISOString(),
    msUntil11amIst: typeof dates.msUntilIstHour === "function" ? dates.msUntilIstHour(11, new Date("2026-09-30T04:00:00Z")) : null,
  })
);
