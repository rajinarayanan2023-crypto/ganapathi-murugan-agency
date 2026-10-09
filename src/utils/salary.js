import { shiftUnits } from './attendance.js'
import { toISODate, todayISO } from './format.js'

// Salary history entry shape: { effectiveFrom: 'YYYY-MM-DD', amount: number }
// The entry with the latest effectiveFrom <= a given date is the one in force
// on that date, so a mid-month revision splits pay correctly across the change.

export function sortedSalaryHistory(employee) {
  return [...(employee.salaryHistory || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

export function salaryOnDate(employee, dateISO) {
  const history = sortedSalaryHistory(employee)
  let amount = 0
  for (const entry of history) {
    if (entry.effectiveFrom > dateISO) break
    amount = entry.amount
  }
  return amount
}

export function currentSalary(employee) {
  return salaryOnDate(employee, todayISO())
}

// An employee's "employee credit" entries (fuel/oil taken on credit at the
// pump, recorded via Fuel Entry — each with its own date/amount/reason) that
// fall within one calendar month, most recent first.
export function monthlyCreditEntries(employee, year, monthIdx) {
  const dates = isoDatesInMonth(year, monthIdx)
  const monthStart = dates[0]
  const monthEnd = dates[dates.length - 1]
  return [...(employee?.credits || [])]
    .filter((c) => c.date >= monthStart && c.date <= monthEnd)
    .sort((a, b) => b.date.localeCompare(a.date))
}

// Net of the above — credits taken minus repayments handed back directly in
// cash (type: 'repayment', separate from it just being deducted from pay)
// minus excess owed back to the employee (type: 'excess' — e.g. a Fuel
// Entry shift where more cash came in than the sale required) — the amount
// still owed back against that month's pay. Both repayment and excess
// amounts are always stored positive (never typed in as a negative
// number), so they're subtracted here rather than summed in directly; they
// net the same way arithmetically but are kept as distinct types so the
// ledger never shows an excess as if it were repaying a debt that was never
// actually owed.
export function monthlyCreditTotal(employee, year, monthIdx) {
  return monthlyCreditEntries(employee, year, monthIdx).reduce((sum, c) => {
    const amount = Number(c.amount) || 0
    return sum + (c.type === 'repayment' || c.type === 'excess' ? -amount : amount)
  }, 0)
}

// An employee's recorded salary payments FOR one calendar month (periodYear/
// periodMonth — the period being paid, never inferred from paidDate, since a
// payment is often made days into the following month), most recent first.
// Distinct from credits (money advanced, owed back) — this is money actually
// handed over as salary.
export function monthlyPaymentEntries(employee, year, monthIdx) {
  return [...(employee?.payments || [])]
    .filter((p) => p.periodYear === year && p.periodMonth === monthIdx + 1)
    .sort((a, b) => b.paidDate.localeCompare(a.paidDate))
}

// Sum of the above — what's already been physically paid out for that month.
export function monthlyPaymentTotal(employee, year, monthIdx) {
  return monthlyPaymentEntries(employee, year, monthIdx).reduce((sum, p) => sum + (Number(p.amountPaid) || 0), 0)
}

// Running balance carried into a given month from every earlier month since
// the employee joined — an unpaid/overdrawn balance doesn't vanish when the
// calendar page turns, it accumulates until it's settled. Positive means the
// employee is still owed money from before; negative means they've drawn
// more credit/payment than they'd earned as of those earlier months, and
// this month's payable is reduced to recover it. A month with nothing left
// outstanding (fully paid, no credit) contributes exactly 0, so an employee
// who's always been paid in full sees no change from before this existed.
// Hard cap on how many months this ever walks, regardless of what a bad
// join_date says — the backend now rejects an unreasonable join_date at
// entry time, but this is a second, independent backstop against any
// pre-existing bad data: without it, a single wrong date would make this
// walk (and Salary.jsx's attendance pre-loading, which uses the same
// starting point) try to compute/fetch over a thousand months on every load.
const MAX_CARRY_FORWARD_MONTHS = 1200

export function carryForwardBalance(employee, attendanceForEmployee, year, monthIdx) {
  const [joinYear, joinMonthNum] = (employee?.joinDate || '1970-01-01').split('-').map(Number)
  let y = joinYear
  let m = joinMonthNum - 1
  let balance = 0
  let iterations = 0
  while ((y < year || (y === year && m < monthIdx)) && iterations < MAX_CARRY_FORWARD_MONTHS) {
    const pay = computeMonthlyPay(employee, attendanceForEmployee, y, m)
    const credit = monthlyCreditTotal(employee, y, m)
    const paid = monthlyPaymentTotal(employee, y, m)
    balance += pay.earnedAmount - credit - paid
    iterations += 1
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
  }
  return Math.round(balance * 100) / 100
}

export function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate()
}

export function isoDatesInMonth(year, monthIdx) {
  const total = daysInMonth(year, monthIdx)
  const dates = []
  for (let day = 1; day <= total; day++) {
    dates.push(toISODate(new Date(year, monthIdx, day)))
  }
  return dates
}

// Pay for one calendar month, prorated by shift units completed so far against
// the days elapsed. Each day is priced at whichever salary was in force on
// that date, divided by the number of days in the month — so on day 15 of a
// 30-day month, an employee who has done all 15 shifts so far shows half the
// monthly salary; one who missed a few days shows proportionally less.
export function computeMonthlyPay(employee, attendanceForEmployee, year, monthIdx) {
  const totalDays = daysInMonth(year, monthIdx)
  const dates = isoDatesInMonth(year, monthIdx)
  const today = todayISO()
  const monthStart = dates[0]
  const monthEnd = dates[totalDays - 1]

  let elapsedDays
  if (today < monthStart) elapsedDays = 0
  else if (today > monthEnd) elapsedDays = totalDays
  else elapsedDays = Number(today.slice(-2))

  let earned = 0
  let shiftUnitsCompleted = 0
  for (let i = 0; i < elapsedDays; i++) {
    const date = dates[i]
    const units = shiftUnits(attendanceForEmployee?.[date])
    shiftUnitsCompleted += units
    earned += (salaryOnDate(employee, date) / totalDays) * units
  }

  return {
    totalDays,
    elapsedDays,
    expectedShiftUnits: elapsedDays,
    shiftUnitsCompleted,
    // Rounded to 2 decimal places (not to a whole rupee) — precise enough to
    // avoid floating-point noise while never approximating the real figure.
    earnedAmount: Math.round(earned * 100) / 100,
    fullMonthSalary: salaryOnDate(employee, monthEnd),
    isComplete: elapsedDays === totalDays,
    isMatched: elapsedDays > 0 && shiftUnitsCompleted >= elapsedDays,
  }
}
