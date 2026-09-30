// Calendar-date helpers. Dates are plain "YYYY-MM-DD" strings handled in UTC,
// so results never shift with the server's timezone.
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const toTime = (d) => Date.parse(`${d}T00:00:00Z`);
const fromTime = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => fromTime(toTime(d) + n * DAY_MS);
const weekday = (d) => new Date(toTime(d)).getUTCDay(); // 0 = Sunday
const todayIst = (now = new Date()) => fromTime(now.getTime() + IST_OFFSET_MS);

function eachDay(start, end) {
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

// Milliseconds until the next time the clock in India reads `hour`:00. Worked
// out from UTC, so a server hosted abroad still runs its daily jobs on India time.
function msUntilIstHour(hour, now = new Date()) {
  const istNow = now.getTime() + IST_OFFSET_MS;
  let next = Math.floor(istNow / DAY_MS) * DAY_MS + hour * 60 * 60 * 1000;
  if (next <= istNow) next += DAY_MS;
  return next - istNow;
}

module.exports = { addDays, weekday, todayIst, eachDay, msUntilIstHour };
