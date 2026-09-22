import { todayISO } from './format.js'

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
