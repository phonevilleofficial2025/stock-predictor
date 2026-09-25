// Week numbers are stored as isoYear*100+isoWeek (e.g. 202638 for 2026-W38) so they
// never collide across a year boundary. This renders that back as a readable label.
export function formatWeekNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const year = Math.floor(n / 100);
  const week = n % 100;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
