function sundayOnOrBefore(date) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

// Retail week-of-year (Sunday-Saturday, Week 1 starts on the Sunday on/before Jan 1st)
// — mirrors the server's calculation so a mapped/picked date can be previewed
// client-side before committing; the server recomputes it authoritatively over the
// full file.
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
