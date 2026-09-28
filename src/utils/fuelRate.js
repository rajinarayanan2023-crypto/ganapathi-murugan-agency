import { todayISO, toISODate } from './format.js'

// fuelRateHistory: [{ effectiveFrom: 'YYYY-MM-DD', petrol, diesel, oil }] —
// the entry whose effectiveFrom is the latest one on/before a given date is
// the retail rate in force on that date. Same date-effective pattern as
// employee salaryHistory / lubricant priceHistory — real, backend-persisted
// history now (see DataContext's reviseFuelRate), covering 2T oil too, not
// just petrol/diesel.

export function sortedFuelRateHistory(history) {
  return [...(history || [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

const ZERO_RATE = { petrol: 0, diesel: 0, oil: 0 }

export function fuelRatesOnDate(history, dateISO) {
  let rates = ZERO_RATE
  for (const entry of sortedFuelRateHistory(history)) {
    if (entry.effectiveFrom > dateISO) break
    rates = entry
  }
  return rates
}

export function currentFuelRates(history) {
  return fuelRatesOnDate(history, todayISO())
}

// True once today's rate has actually been confirmed (an entry dated today
// exists) rather than just carried forward from whatever was last set —
// drives the "confirm today's rate" prompt on the Fuel Entry page.
export function isTodayRateConfirmed(history) {
  return sortedFuelRateHistory(history).some((h) => h.effectiveFrom === todayISO())
}

// One calendar day before a given ISO date — used only to look up the rate
// that was in force immediately before a same-day revision (see
// fuelRatesForShiftScope below).
function previousDateISO(dateISO) {
  return toISODate(new Date(new Date(dateISO).getTime() - 86400000))
}

// The rate that actually applies to a given shift, on a given date — this is
// the one place a same-day rate revision behaves differently depending on
// which shift it's for. Real dealer workflow: Shift 1/Shift 2 (and the main
// day audit) cover the day's normal operating hours, which already happened
// under whatever rate was already in force BEFORE any change entered for
// this date — revising "Today's Fuel Rate" mid-day must never retroactively
// reprice a shift that already ran. Shift 3 (and its own audit) is
// specifically the narrow price-change window, so it's the one that should
// pick up the brand new rate, reducing what the manager has to type by
// hand. On any OTHER date — one with no revision effective exactly that
// day — there's only ever been one settled rate throughout, so every shift
// uses it the same way, exactly as before this distinction existed.
export function fuelRatesForShiftScope(history, dateISO, isShift3) {
  const current = fuelRatesOnDate(history, dateISO)
  if (isShift3 || current.effectiveFrom !== dateISO) return current
  return fuelRatesOnDate(history, previousDateISO(dateISO))
}
