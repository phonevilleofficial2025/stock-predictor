// months: chronologically sorted array of { month, totalCpfr, monthBalance }
// Returns the same rows with a cumulative `unserved` field:
//   unserved[i] = unserved[i-1] + totalCpfr[i] - monthBalance[i]
export function computeUnservedSeries(months) {
  let running = 0;
  return months.map((row) => {
    running = running + (row.totalCpfr || 0) - (row.monthBalance || 0);
    return { ...row, unserved: running };
  });
}
