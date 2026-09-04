import { isoDatesInMonth } from './salary.js'
import { aggregateEntries } from './fuelCalc.js'

// Every finalized (non-draft) fuel entry — across both pumps, every shift —
// whose date falls within the given calendar month.
export function monthlyFuelEntries(fuelEntries, year, monthIdx) {
  const dates = isoDatesInMonth(year, monthIdx)
  const monthStart = dates[0]
  const monthEnd = dates[dates.length - 1]
  return (fuelEntries || []).filter((e) => e.status !== 'draft' && e.date >= monthStart && e.date <= monthEnd)
}

// { petrolLtr, dieselLtr, oilLtr, ... } for the month — see aggregateEntries
// in fuelCalc.js for the full shape (also carries the sale-amount totals).
export function monthlyFuelTotals(fuelEntries, year, monthIdx) {
  return aggregateEntries(monthlyFuelEntries(fuelEntries, year, monthIdx))
}

// Sum of every expense line item logged on a date within the month.
export function monthlyExpensesTotal(expenseDays, year, monthIdx) {
  const dates = isoDatesInMonth(year, monthIdx)
  const monthStart = dates[0]
  const monthEnd = dates[dates.length - 1]
  return (expenseDays || [])
    .filter((d) => d.date >= monthStart && d.date <= monthEnd)
    .reduce((sum, d) => sum + (d.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0), 0)
}

// The dealer's standard commission (a flat, current figure — see
// commissionRates in DataContext — the OMC agreement it comes from is
// renegotiated rarely, so unlike the retail pump price this doesn't need
// day-by-day history) applied to the month's sales: per litre for
// OMC-priced fuel (petrol/diesel/2T oil machine), per piece sold for 2T
// packet and Servo (cane) oil, since those move by the unit rather than a
// nozzle meter. This is the station's actual earnings, separate from the
// pass-through retail sale amount.
export function commissionEarned(fuelTotals, commissionRates) {
  return (
    (Number(fuelTotals?.petrolLtr) || 0) * (Number(commissionRates?.petrol) || 0) +
    (Number(fuelTotals?.dieselLtr) || 0) * (Number(commissionRates?.diesel) || 0) +
    (Number(fuelTotals?.oilLtr) || 0) * (Number(commissionRates?.oil) || 0) +
    (Number(fuelTotals?.pocketOilQtyTotal) || 0) * (Number(commissionRates?.oilPacket) || 0) +
    (Number(fuelTotals?.caneOilQtyTotal) || 0) * (Number(commissionRates?.oilCane) || 0)
  )
}

// Commission earned minus expenses for one month — the single number behind
// every profit readout (stat tile, trend chart) so it's computed identically
// everywhere.
export function monthlyProfit(fuelEntries, expenseDays, commissionRates, year, monthIdx) {
  const fuelTotals = monthlyFuelTotals(fuelEntries, year, monthIdx)
  const expensesTotal = monthlyExpensesTotal(expenseDays, year, monthIdx)
  const commission = commissionEarned(fuelTotals, commissionRates)
  return commission - expensesTotal
}

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
