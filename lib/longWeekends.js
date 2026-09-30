const { addDays, weekday, eachDay } = require("./dates");

// Finds long weekends from gazetted public holidays (optional "observance"
// days don't count: most offices stay open). Saturdays are treated as off,
// matching most corporate calendars.
//
// - A long weekend is a run of 3+ consecutive days off that includes a holiday.
// - A bridge day is a single working day between days off: taking it as leave
//   turns the run into a 4+ day break (e.g. a Tuesday holiday bridged by Monday).
function findLongWeekends(holidays, from, to) {
  const publicDates = new Map();
  for (const h of holidays) if (h.public && !publicDates.has(h.date)) publicDates.set(h.date, h.name);

  const isOff = (d) => weekday(d) === 0 || weekday(d) === 6 || publicDates.has(d);
  const offRun = (d, step) => {
    let n = 0;
    while (isOff(addDays(d, step * (n + 1)))) n++;
    return n;
  };

  const results = [];
  const seen = new Set();
  for (const d of eachDay(addDays(from, -3), addDays(to, 3))) {
    if (!publicDates.has(d)) continue;

    // Natural run of days off around this holiday.
    const start = addDays(d, -offRun(d, -1));
    const end = addDays(d, offRun(d, 1));
    const length = eachDay(start, end).length;

    // A single working day on either side that joins another block of days off.
    let bridge = null;
    for (const [gap, step] of [[addDays(start, -1), -1], [addDays(end, 1), 1]]) {
      const beyond = offRun(gap, step);
      if (beyond > 0 && length + 1 + beyond >= 4) {
        const bStart = step < 0 ? addDays(gap, -beyond) : start;
        const bEnd = step < 0 ? end : addDays(gap, beyond);
        if (!bridge || eachDay(bStart, bEnd).length > bridge.length) {
          bridge = { day: gap, start: bStart, end: bEnd, length: eachDay(bStart, bEnd).length };
        }
      }
    }

    if (length < 3 && !bridge) continue;
    const key = `${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const holidayDates = eachDay(start, end).filter((x) => publicDates.has(x));
    results.push({ start, end, length, holidayDates, bridge });
  }
  return results.filter((w) => (w.bridge ? w.bridge.end : w.end) >= from && w.start <= to);
}

module.exports = { findLongWeekends };
