import { parse } from 'csv-parse/sync';

export function parseCsvBuffer(buffer) {
  const records = parse(buffer, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  if (records.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = records;
  return { headers, rows };
}

export function rowsToObjects(headers, rows) {
  return rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Given a list of raw date strings/values, determines whether the span looks like
// a single week (6-8 days inclusive), a single day, or something longer (monthly+).
// Also surfaces the raw value that produced the min/max, and how many values could
// not be parsed as dates at all, so a bad column mapping or stray row is diagnosable
// from the error message alone instead of just a suspicious day count.
export function detectCadence(dateValues) {
  const parsed = dateValues.map((raw) => ({ raw, date: toDate(raw) }));
  const valid = parsed.filter((p) => p.date);
  const skippedCount = parsed.length - valid.length;

  if (valid.length === 0) {
    return { cadence: 'unknown', rangeDays: null, min: null, max: null, minRaw: null, maxRaw: null, skippedCount };
  }

  const minEntry = valid.reduce((a, b) => (a.date <= b.date ? a : b));
  const maxEntry = valid.reduce((a, b) => (a.date >= b.date ? a : b));
  const rangeDays = Math.round((maxEntry.date.getTime() - minEntry.date.getTime()) / 86400000) + 1;

  let cadence;
  if (rangeDays <= 1) cadence = 'daily';
  else if (rangeDays >= 6 && rangeDays <= 8) cadence = 'weekly';
  else if (rangeDays >= 27) cadence = 'monthly';
  else cadence = 'unknown';

  return { cadence, rangeDays, min: minEntry.date, max: maxEntry.date, minRaw: minEntry.raw, maxRaw: maxEntry.raw, skippedCount };
}

function sundayOnOrBefore(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

// Retail week-of-year: weeks run Sunday-Saturday, and Week 1 of a year starts on the
// Sunday on or before January 1st (e.g. Sept 6-12, 2026 is one such week). Returned as
// { retailYear, retailWeek } separately (rather than a single week-of-year 1-52 number)
// so callers can combine them into a week identifier that doesn't collide across a
// year boundary (e.g. retailYear * 100 + retailWeek).
export function retailWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  let year = d.getUTCFullYear();
  let week1Start = sundayOnOrBefore(new Date(Date.UTC(year, 0, 1)));

  if (d < week1Start) {
    year -= 1;
    week1Start = sundayOnOrBefore(new Date(Date.UTC(year, 0, 1)));
  } else {
    const nextWeek1Start = sundayOnOrBefore(new Date(Date.UTC(year + 1, 0, 1)));
    if (d >= nextWeek1Start) {
      year += 1;
      week1Start = nextWeek1Start;
    }
  }

  const retailWeek = Math.floor((d - week1Start) / (7 * 24 * 3600 * 1000)) + 1;
  return { retailYear: year, retailWeek };
}

// Last retail week number of a given year (52 or 53, depending on where Jan 1 falls
// relative to Sunday) — computed in UTC throughout so it's deterministic regardless
// of the server's local timezone, unlike `retailWeekInfo` which accepts a caller's Date.
// A few trailing December days can spill into next year's week 1 (e.g. when next
// Jan 1 lands on a Saturday, its week 1 starts the Sunday before, Dec 26), so this
// walks back from Dec 31 to the latest day that still belongs to `year`'s own retail
// calendar — the same rollover rule `retailWeekInfo` applies, just self-contained in UTC.
function lastWeekOfYear(year) {
  const DAY = 24 * 3600 * 1000;
  const week1Start = sundayOnOrBefore(new Date(Date.UTC(year, 0, 1)));
  const nextWeek1Start = sundayOnOrBefore(new Date(Date.UTC(year + 1, 0, 1)));
  let d = new Date(Date.UTC(year, 11, 31));
  while (d >= nextWeek1Start) d = new Date(d.getTime() - DAY);
  return Math.floor((d - week1Start) / (7 * DAY)) + 1;
}

// Every retail week number (yearWeek = year*100+week) from week 1 through the last
// week of `year` — the fixed, always-present column scaffold for the CPFR sheet's
// weekly Sell-Out/CPFR sections, independent of which weeks actually have data yet.
export function fullYearWeeks(year) {
  const last = lastWeekOfYear(year);
  return Array.from({ length: last }, (_, i) => year * 100 + i + 1);
}
