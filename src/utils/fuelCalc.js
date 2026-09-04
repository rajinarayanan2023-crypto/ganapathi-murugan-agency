// Pure helpers for the daily fuel-entry reconciliation logic.
//
// Each employee's shift is now a fully independent, separately-saved record
// (a "shift entry") — NOT nested inside a shared day/pump document. Every
// shift entry stands alone: its own Save (draft or final), its own bills,
// its own payments. What used to be "the pump's shifts array" is now just
// "every shift entry that shares this pumpKey + date", and the Pump Total /
// Day Total readouts are computed by aggregating across those independent
// records (see aggregateEntries) rather than reading a nested list.
//
// Shift entry shape:
//   { id, date, pumpKey, shiftNumber, internalOnly, employeeId,
//     petrol: FuelNozzles, diesel: FuelNozzles, oil?: FuelNozzles,
//     oilRows?: [OilRow], caneOilRows?: [OilRow], caneOilOffer?: string,
//     payments: [PaymentLine], bills: [Bill], notes: string, status }
// pumpKey: 'pump1' | 'pump2'. Pump 1 sells petrol + diesel. Pump 2 also
// sells Oil (2T, through the nozzle) plus shelf-sold Pocket/Cane oil.
// shiftNumber: 1, 2, or 3 — this shift's position among the OTHER shift
// entries sharing the same pumpKey + date, used only to order them and to
// carry an opening reading forward; it's a position, not an identity.
// internalOnly: true only for shiftNumber 3 — excluded from attendance
// auto-marking (see DataContext) but included in every amount/reconciliation
// calculation exactly like any other shift.
//
// A FuelNozzles groups the two physical nozzle meters for that fuel, each a
// Reading: { nozzle1: Reading, nozzle2: Reading }
// A Reading is one nozzle's electronic-totalizer meter numbers for that shift:
//   { opening, closing, testing, rate }
// liters = closing - opening - testing (never negative — a bad reading reads as 0, not a phantom debt).
//
// Opening is never typed for anything but the very first shift a pump ever
// had — every later shift's opening is derived as the immediately preceding
// shift entry's closing (same pumpKey, chronologically: earlier date first,
// then earlier shiftNumber within the same date). See withCarriedOpenings.

export const PUMP_KEYS = ['pump1', 'pump2']
export const FUEL_KEYS_BY_PUMP = { pump1: ['petrol', 'diesel'], pump2: ['petrol', 'diesel', 'oil'] }
export const NOZZLE_KEYS = ['nozzle1', 'nozzle2']

export function readingLiters(reading) {
  if (!reading) return 0
  const opening = Number(reading.opening) || 0
  const closing = Number(reading.closing) || 0
  const testing = Number(reading.testing) || 0
  return Math.max(0, closing - opening - testing)
}

export function readingAmount(reading) {
  return readingLiters(reading) * (Number(reading?.rate) || 0)
}

// Chronological order for every shift entry belonging to one pump: earlier
// date first, then earlier shiftNumber within the same date.
export function sortPumpEntries(entries) {
  return [...(entries || [])].sort((a, b) => (a.date === b.date ? a.shiftNumber - b.shiftNumber : a.date.localeCompare(b.date)))
}

// Given a pump's entries in chronological order (see sortPumpEntries),
// returns a copy where every entry's reading `opening` fields are replaced
// by the immediately preceding entry's closing (per fuel + nozzle) — the
// first entry in the list keeps whatever opening it already has (typed in,
// or carried from an even earlier day via withCarriedOpenings' caller).
// Only fills in a nozzle's opening when nothing's been entered for it yet —
// once the manager types their own value (correcting a meter reset, a
// misread handover, etc.), it sticks instead of being silently overwritten
// on the next render. So this still auto-fills a brand new shift 2/3 card
// (emptyReading() starts opening at '') without ever fighting a manual edit.
//
// Returns the SAME entry object (and, one level down, the SAME fuelKey
// object) whenever nothing about it actually needed to change — never a new
// object with identical values. Every card on the SAME pump/day is
// recomputed together on every render (see PumpDayEditor's `effectiveCards`
// useMemo), so editing shift 1 used to hand shift 2/3 brand-new object
// identities purely from being re-mapped over, even though their own values
// were untouched. ShiftCard's autosave effect below only checks `value !==
// lastSeenValue.current` (cheap reference equality, not a deep diff), so
// that false "changed" signal used to autosave a still-blank shift 2/3 the
// moment shift 1 was edited — creating it as a real draft (with a backend
// id) and making its Discard button light up despite no reading ever having
// been entered on that shift.
export function withCarriedOpenings(sortedEntries) {
  return sortedEntries.map((entry, i) => {
    const prev = sortedEntries[i - 1]
    if (!prev) return entry
    const fuelKeys = FUEL_KEYS_BY_PUMP[entry.pumpKey]
    let entryChanged = false
    const next = { ...entry }
    for (const fuelKey of fuelKeys) {
      let nozzlesChanged = false
      const nozzles = { ...next[fuelKey] }
      for (const nozzleKey of NOZZLE_KEYS) {
        const current = nozzles[nozzleKey]
        const isBlank = current?.opening === '' || current?.opening == null
        if (!isBlank) continue
        const carried = prev[fuelKey]?.[nozzleKey]?.closing ?? ''
        if (carried === current.opening) continue
        nozzles[nozzleKey] = { ...current, opening: carried }
        nozzlesChanged = true
      }
      if (nozzlesChanged) {
        next[fuelKey] = nozzles
        entryChanged = true
      }
    }
    return entryChanged ? next : entry
  })
}

export function entryFuelLiters(entry, fuelKey) {
  return NOZZLE_KEYS.reduce((sum, nozzleKey) => sum + readingLiters(entry?.[fuelKey]?.[nozzleKey]), 0)
}

export function entryFuelAmount(entry, fuelKey) {
  return NOZZLE_KEYS.reduce((sum, nozzleKey) => sum + readingAmount(entry?.[fuelKey]?.[nozzleKey]), 0)
}

// 2T pocket oil (Pump 2 only) — sachets sold by count × price, not through a
// nozzle meter. Now lives on each shift entry directly (whichever employee
// made the sale records it during their own shift), one or more rows (each
// its own product/count/rate).
export function pocketOilAmount(entry) {
  return (entry?.oilRows || []).reduce((sum, row) => sum + (Number(row.stockCount) || 0) * (Number(row.stockRate) || 0), 0)
}

// Piece count sold (independent of price/offer) — the basis for a per-unit
// commission, since these move by the sachet/can rather than through a
// nozzle meter with a litre reading.
export function pocketOilQty(entry) {
  return (entry?.oilRows || []).reduce((sum, row) => sum + (Number(row.stockCount) || 0), 0)
}

// 2T cane oil (Pump 2 only) — sold by the can/tin, one or more rows (each
// its own product/count/rate) on this shift entry, summed and then reduced
// once by a single flat offer/discount for the whole group — never below zero.
export function caneOilRawAmount(entry) {
  return (entry?.caneOilRows || []).reduce((sum, row) => sum + (Number(row.stockCount) || 0) * (Number(row.stockRate) || 0), 0)
}

export function caneOilAmount(entry) {
  return Math.max(0, caneOilRawAmount(entry) - (Number(entry?.caneOilOffer) || 0))
}

// Piece count sold, same basis as pocketOilQty above.
export function caneOilQty(entry) {
  return (entry?.caneOilRows || []).reduce((sum, row) => sum + (Number(row.stockCount) || 0), 0)
}

export function shiftSaleAmount(entry) {
  return ['petrol', 'diesel', 'oil'].reduce((sum, key) => sum + entryFuelAmount(entry, key), 0) + pocketOilAmount(entry) + caneOilAmount(entry)
}

export function paymentsTotal(paymentLines) {
  return (paymentLines || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
}

export function shiftPaymentsTotal(entry) {
  return paymentsTotal(entry?.payments)
}

export function shiftVariance(entry) {
  return shiftPaymentsTotal(entry) - shiftSaleAmount(entry)
}

// Aggregates any list of shift entries (a single pump's shifts for one day,
// or every shift across both pumps for one day) into the combined totals —
// field names match what the Fuel Entry page, Dashboard, and CSV export
// expect (petrolLtr, dieselLtr, totalSaleAmount, excessShortage). Pass
// entries that already have carried-forward openings applied (see
// withCarriedOpenings) so liters/amounts are correct.
export function aggregateEntries(entries) {
  const list = entries || []
  const sumFuel = (fn, key) => list.reduce((sum, e) => sum + fn(e, key), 0)

  const petrolLtr = sumFuel(entryFuelLiters, 'petrol')
  const petrolAmount = sumFuel(entryFuelAmount, 'petrol')
  const dieselLtr = sumFuel(entryFuelLiters, 'diesel')
  const dieselAmount = sumFuel(entryFuelAmount, 'diesel')
  const oilLtr = sumFuel(entryFuelLiters, 'oil')
  const oilAmount = sumFuel(entryFuelAmount, 'oil')
  const pocketOilTotal = list.reduce((sum, e) => sum + pocketOilAmount(e), 0)
  const caneOilTotal = list.reduce((sum, e) => sum + caneOilAmount(e), 0)
  const pocketOilQtyTotal = list.reduce((sum, e) => sum + pocketOilQty(e), 0)
  const caneOilQtyTotal = list.reduce((sum, e) => sum + caneOilQty(e), 0)
  const totalSaleAmount = petrolAmount + dieselAmount + oilAmount + pocketOilTotal + caneOilTotal
  const totalPayments = list.reduce((sum, e) => sum + shiftPaymentsTotal(e), 0)
  const excessShortage = totalPayments - totalSaleAmount

  return {
    petrolLtr,
    petrolAmount,
    dieselLtr,
    dieselAmount,
    oilLtr,
    oilAmount,
    pocketOilTotal,
    caneOilTotal,
    pocketOilQtyTotal,
    caneOilQtyTotal,
    totalSaleAmount,
    totalPayments,
    excessShortage,
  }
}

function localId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function emptyReading(rate) {
  return { opening: '', closing: '', testing: '', rate }
}

function emptyFuelNozzles(rate) {
  return { nozzle1: emptyReading(rate), nozzle2: emptyReading(rate) }
}

// The fixed set of payment methods a line can be — picked from a dropdown
// rather than typed freely, so entries stay consistent across days/pumps.
export const PAYMENT_METHOD_OPTIONS = [
  'Cash',
  'Day Cash',
  'Night Cash',
  'Card (Petrol)',
  'Card (Diesel)',
  'QR (Petrol)',
  'QR (Diesel)',
  'Company QR',
  'Extra QR',
  'Extra Power',
  'Extra Reward',
  'Extra Test',
]

// A brand new shift entry seeds one line per payment method up front — the
// manager clears out whichever didn't apply rather than hunting through
// "Add line" for each one.
const DEFAULT_PAYMENT_LABELS = PAYMENT_METHOD_OPTIONS

// type 'cash' is a free-typed label (Cash/Card/QR/anything). type 'credit'
// picks a real Credit Bills customer via customerId — saving the fuel entry
// then writes a matching ledger entry onto that customer's account. type
// 'employeeCredit' works the same way but against employeeId instead —
// saving the fuel entry then writes a credit entry onto that employee's
// record, which the Salary page totals up per month; its free-typed `note`
// records why the credit was taken (e.g. "fuel for personal bike").
export function emptyPaymentLine(label = '', type = 'cash') {
  return { id: localId('pay'), label, amount: '', type, customerId: '', employeeId: '', note: '' }
}

export function emptyOilRow(prefix = 'oil') {
  return { id: localId(prefix), productId: '', stockCount: '', stockRate: '' }
}

export function emptyCaneOilRow() {
  return emptyOilRow('cane')
}

// A brand new, not-yet-saved shift entry. `localOnlyId` is a client-side key
// (used for React lists / local edit state) before the real save assigns a
// persisted id.
export function emptyShiftEntry(pumpKey, date, shiftNumber, fuelRates) {
  const entry = {
    id: null,
    localOnlyId: localId('shift'),
    date,
    pumpKey,
    shiftNumber,
    internalOnly: shiftNumber === 3,
    employeeId: '',
    petrol: emptyFuelNozzles(fuelRates.petrol),
    diesel: emptyFuelNozzles(fuelRates.diesel),
    payments: DEFAULT_PAYMENT_LABELS.map((label) => emptyPaymentLine(label)),
    bills: [],
    notes: '',
    status: 'draft',
  }
  if (pumpKey === 'pump2') {
    entry.oil = emptyFuelNozzles(fuelRates.oil)
    // Pocket oil is sold by the sachet — one or more rows (each its own
    // product/count/rate, added with "+ Add more oil"). Rate is snapshotted
    // at selection time rather than looked up live, so a later price change
    // never rewrites a past shift's amount.
    entry.oilRows = [emptyOilRow('oil')]
    // Cane oil is sold by the can/tin — one or more rows, plus a single flat
    // offer/discount applied once to the whole group's total.
    entry.caneOilRows = [emptyCaneOilRow()]
    entry.caneOilOffer = ''
  }
  return entry
}
