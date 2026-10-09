// The `count` calendar months ending at (and including) year/monthIdx,
// oldest first — e.g. count=6 for "this month and the 5 before it".
export function trailingMonths(year, monthIdx, count) {
  const months = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(year, monthIdx - i, 1)
    months.push({ year: d.getFullYear(), monthIdx: d.getMonth() })
  }
  return months
}
