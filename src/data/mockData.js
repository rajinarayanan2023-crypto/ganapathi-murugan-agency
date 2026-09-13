// Static seed data for the demo. Everything here is loaded once into React state
// (see src/context/DataContext.jsx) and mutated in-memory by CRUD actions.

import { entryFuelAmount, emptyOilRow, emptyCaneOilRow } from '../utils/fuelCalc.js'

export const STATION = {
  name: 'Ganapathi Murugan Agency',
  brand: 'IndianOil',
  dealerType: 'IOCL Dealer',
  sapNo: '350287',
  gstin: '33DNXPR1842E1ZO',
  dealerName: 'Narayanan Murugaiah',
  addressLines: ['1306/A, NH:208, Madurai Main Road', 'Chinthamani (Village) – 627855', 'Kadayanallur (Tk), Tenkasi (Dist), Tamil Nadu'],
  location: 'Chinthamani, Kadayanallur, Tenkasi District, Tamil Nadu',
  mobiles: ['98425 31354', '77083 51110'],
  email: 'narayananraji1986@gmail.com',
  logo: '/logo.png',
  photo: '/station-photo.jpg',
  // Who the Fuel Entry "Audit" report gets emailed to — editable right from
  // the Audit modal itself, since there's no separate settings screen.
  auditContactEmail: '',
}

// 2T oil (machine) retail rate rarely changes, so it stays a flat figure —
// petrol/diesel are tracked with real day-by-day history instead (see
// FUEL_RATE_HISTORY below), since the government/OMC revises pump price on
// those almost daily.
export const FUEL_RATES = {
  oil: 400,
}

// Petrol/diesel retail rate, day by day — the manager confirms (or revises)
// it directly from the Fuel Entry page, since it's realistic for it to
// change daily. Same date-effective pattern as employee salaryHistory /
// lubricant priceHistory: the entry whose effectiveFrom is the latest one
// on/before a given date is the rate in force on that date.
export const FUEL_RATE_HISTORY = [
  { effectiveFrom: isoDaysAgo(60), petrol: 108.6, diesel: 100.45 },
]

// The rate the demo's seeded fuel entries were sold at — the oldest
// FUEL_RATE_HISTORY entry plus the flat 2T oil rate, so past readings still
// carry a real per-nozzle rate instead of undefined.
const SEED_FUEL_RATES = { ...FUEL_RATE_HISTORY[0], oil: FUEL_RATES.oil }

// The dealer's standard commission — per litre for OMC-priced fuel
// (petrol/diesel/2T oil machine), per piece sold for 2T packet and Servo
// (cane) oil, since those move by the unit rather than through a nozzle
// meter. Separate from the retail rate charged to customers, and the basis
// for the Dashboard/Fuel Entry profit summary (commission earned − expenses,
// for the selected month). Editable from the Dashboard so it stays matched
// to the station's actual OMC agreement — a rare event (unlike the retail
// pump price above), so this is just a flat, current figure with no history.
export const COMMISSION_RATES = {
  petrol: 3,
  diesel: 2,
  oil: 5,
  oilPacket: 5,
  oilCane: 5,
}

function isoDaysAgo(n) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ---------- Employees & Attendance ----------

// salaryHistory: [{ effectiveFrom: 'YYYY-MM-DD', amount }] — the entry whose
// effectiveFrom is the latest one on/before a given date is the salary in
// force on that date. First entry always starts at joinDate. e1 and e4 carry
// an extra revision each so the demo shows the "Revise Salary" feature.
export const EMPLOYEES = [
  {
    id: 'e1', name: 'Murugan S', fatherName: 'Shanmugam', role: 'Pump Operator', phone: '9843211001', joinDate: '2021-03-14', active: true, notes: 'Reliable morning-shift operator, good with customers.',
    salaryHistory: [{ effectiveFrom: '2021-03-14', amount: 12000 }, { effectiveFrom: '2023-04-01', amount: 15000 }],
  },
  {
    id: 'e2', name: 'Karthikeyan R', fatherName: 'Ramasamy', role: 'Pump Operator', phone: '9843211002', joinDate: '2021-06-02', active: true, notes: '',
    salaryHistory: [{ effectiveFrom: '2021-06-02', amount: 15000 }],
  },
  {
    id: 'e3', name: 'Lakshmi Priya', fatherName: 'Duraisamy', role: 'Cashier', phone: '9843211003', joinDate: '2022-01-19', active: true, notes: 'Handles cash reconciliation independently.',
    salaryHistory: [{ effectiveFrom: '2022-01-19', amount: 16000 }],
  },
  {
    id: 'e4', name: 'Selvam Nadar', fatherName: 'Kaliyaperumal Nadar', role: 'Supervisor', phone: '9843211004', joinDate: '2019-11-05', active: true, notes: 'Senior staff, oversees shift handovers.',
    salaryHistory: [{ effectiveFrom: '2019-11-05', amount: 18000 }, { effectiveFrom: '2022-04-01', amount: 22000 }],
  },
  {
    id: 'e5', name: 'Meena K', fatherName: 'Krishnan', role: 'Attendant', phone: '9843211005', joinDate: '2023-02-27', active: true, notes: '',
    salaryHistory: [{ effectiveFrom: '2023-02-27', amount: 12000 }],
  },
  {
    id: 'e6', name: 'Rajesh Kumar', fatherName: 'Govindasamy', role: 'Night Operator', phone: '9843211006', joinDate: '2022-08-11', active: true, notes: 'Often does a double (24hr) shift, then takes the next day off.',
    salaryHistory: [{ effectiveFrom: '2022-08-11', amount: 15000 }],
  },
  {
    id: 'e7', name: 'Suresh Babu', fatherName: 'Marimuthu', role: 'Cleaner', phone: '9843211007', joinDate: '2023-07-09', active: true, notes: '',
    salaryHistory: [{ effectiveFrom: '2023-07-09', amount: 10000 }],
  },
]

// ---------- Daily Fuel Entries ----------
//
// Each day is organised per physical pump island (see utils/fuelCalc.js for
// the shape). Pump 1 sells petrol + diesel; Pump 2 also sells Oil (coolant).
// Meter readings carry forward day-to-day (today's opening = yesterday's
// closing for that pump+fuel), and a day with two employees gets a handover
// reading splitting the day's liters between their two shifts.

// Per-day liters sold, oldest (offset 6) first -> newest (offset 0) last.
// `emp` is a single employeeId (one shift) or [empA, empB] (handover shift).
const PUMP_DAY_TEMPLATES = {
  pump1: [
    { offset: 6, petrol: 610, diesel: 940, emp: 'e1' },
    { offset: 5, petrol: 585, diesel: 905, emp: 'e1' },
    { offset: 4, petrol: 640, diesel: 970, emp: ['e1', 'e2'] },
    { offset: 3, petrol: 560, diesel: 860, emp: 'e2' },
    { offset: 2, petrol: 615, diesel: 930, emp: 'e1' },
    { offset: 1, petrol: 600, diesel: 915, emp: 'e1' },
    { offset: 0, petrol: 590, diesel: 900, emp: ['e1', 'e2'] },
  ],
  pump2: [
    { offset: 6, petrol: 480, diesel: 760, oil: 6, emp: 'e5' },
    { offset: 5, petrol: 505, diesel: 790, oil: 4, emp: 'e5' },
    { offset: 4, petrol: 470, diesel: 745, oil: 5, emp: ['e5', 'e6'] },
    { offset: 3, petrol: 495, diesel: 770, oil: 7, emp: 'e6' },
    { offset: 2, petrol: 460, diesel: 730, oil: 3, emp: 'e5' },
    { offset: 1, petrol: 500, diesel: 780, oil: 5, emp: 'e5' },
    { offset: 0, petrol: 475, diesel: 750, oil: 4, emp: ['e5', 'e6'] },
  ],
}

const TESTING_BY_FUEL = { petrol: 5, diesel: 5, oil: 1 }

// cashDelta = how far the "Cash" payment line drifts from the exact expected
// share — mostly small (realistic near-perfect closings), with one
// intentionally larger shortfall per pump so the reconciliation view has
// something to show.
const CASH_DELTAS = {
  pump1: [180, -420, 90, -1850, 260, -150, 340],
  pump2: [90, -60, 40, -960, -70, 200, -30],
}

function round3(n) {
  return Math.round(n * 1000) / 1000
}

// Each fuel's daily liters are split across its two physical nozzles —
// nozzle1 does the majority of the traffic, nozzle2 the rest.
const NOZZLE_SPLIT = 0.6

// Builds this pump's shift entries for one day — each one a fully
// independent record (own id, own date+pumpKey+shiftNumber) rather than a
// row nested inside a shared day/pump document. Mutates `openings`
// (per-fuel, per-nozzle running meter totals) forward so the next day's
// template starts where this one left off.
function buildPumpShiftEntries(openings, template, fuelKeys, pumpKey, date) {
  const emps = Array.isArray(template.emp) ? template.emp : [template.emp]

  function baseEntry(shiftNumber, employeeId) {
    const entry = {
      id: `f-${template.offset}-${pumpKey}-s${shiftNumber}`,
      date,
      pumpKey,
      shiftNumber,
      internalOnly: false,
      employeeId,
      bills: [],
      notes: '',
      payments: [],
      status: 'final',
    }
    // Pump 2 shifts always carry at least one (empty) Pocket/Cane oil row,
    // same as a freshly-created shift — otherwise the section would render
    // with nothing to click into until "+ Add more" was pressed first.
    if (pumpKey === 'pump2') {
      entry.oilRows = [emptyOilRow('oil')]
      entry.caneOilRows = [emptyCaneOilRow()]
      entry.caneOilOffer = ''
    }
    return entry
  }

  if (emps.length === 1) {
    const entry = baseEntry(1, emps[0])
    for (const fuelKey of fuelKeys) {
      const testing = TESTING_BY_FUEL[fuelKey]
      const n1Ltr = round3(template[fuelKey] * NOZZLE_SPLIT)
      const n2Ltr = round3(template[fuelKey] - n1Ltr)
      const nozzles = {}
      for (const [nozzleKey, ltr] of [['nozzle1', n1Ltr], ['nozzle2', n2Ltr]]) {
        const opening = round3(openings[fuelKey][nozzleKey])
        const closing = round3(opening + ltr + testing)
        nozzles[nozzleKey] = { opening, closing, testing, rate: SEED_FUEL_RATES[fuelKey] }
        openings[fuelKey][nozzleKey] = closing
      }
      entry[fuelKey] = nozzles
    }
    return [entry]
  }

  const entry1 = baseEntry(1, emps[0])
  const entry2 = baseEntry(2, emps[1])
  for (const fuelKey of fuelKeys) {
    const testing = TESTING_BY_FUEL[fuelKey]
    const n1Ltr = round3(template[fuelKey] * NOZZLE_SPLIT)
    const n2Ltr = round3(template[fuelKey] - n1Ltr)
    const s1Nozzles = {}
    const s2Nozzles = {}
    for (const [nozzleKey, ltr] of [['nozzle1', n1Ltr], ['nozzle2', n2Ltr]]) {
      const opening = round3(openings[fuelKey][nozzleKey])
      const portion1 = round3(ltr * 0.55)
      const portion2 = round3(ltr - portion1)
      const handover = round3(opening + portion1)
      const closing = round3(handover + portion2 + testing)
      s1Nozzles[nozzleKey] = { opening, closing: handover, testing: 0, rate: SEED_FUEL_RATES[fuelKey] }
      s2Nozzles[nozzleKey] = { opening: handover, closing, testing, rate: SEED_FUEL_RATES[fuelKey] }
      openings[fuelKey][nozzleKey] = closing
    }
    entry1[fuelKey] = s1Nozzles
    entry2[fuelKey] = s2Nozzles
  }
  return [entry1, entry2]
}

// Common categories first, remainder assigned to Cash — mirrors the flexible
// payment-line list the Fuel Entry page lets a manager edit freely.
function buildPaymentLines(saleAmount, cashDelta) {
  const cardPetrol = Math.round(saleAmount * 0.05)
  const cardDiesel = Math.round(saleAmount * 0.06)
  const qrPetrol = Math.round(saleAmount * 0.12)
  const qrDiesel = Math.round(saleAmount * 0.14)
  const expectedCash = saleAmount - cardPetrol - cardDiesel - qrPetrol - qrDiesel
  const cash = Math.max(0, Math.round(expectedCash + cashDelta))
  return [
    { id: 'pay1', label: 'Cash', amount: cash },
    { id: 'pay2', label: 'Card (Petrol)', amount: cardPetrol },
    { id: 'pay3', label: 'Card (Diesel)', amount: cardDiesel },
    { id: 'pay4', label: 'QR (Petrol)', amount: qrPetrol },
    { id: 'pay5', label: 'QR (Diesel)', amount: qrDiesel },
  ]
}

// Payments live per shift entry — a single-employee day gets the whole
// pump's payment lines on that one entry; a handover day splits each line
// 55/45 (mirroring the same ratio used for liters) between the two
// independent shift entries, so the demo data has something to show in
// both shifts' Payments Received / Bills sections.
function distributePaymentsAcrossEntries(entries, lines) {
  if (entries.length === 1) {
    entries[0].payments = lines.map((l) => ({ ...l }))
    return
  }
  const firstShare = lines.map((l) => ({ ...l, amount: Math.round(l.amount * 0.55) }))
  const secondShare = lines.map((l, i) => ({ ...l, id: `${l.id}b`, amount: l.amount - firstShare[i].amount }))
  entries[0].payments = firstShare
  entries[1].payments = secondShare
}

export function buildFuelEntries() {
  const openings = {
    pump1: {
      petrol: { nozzle1: 260000, nozzle2: 160000 },
      diesel: { nozzle1: 370000, nozzle2: 240000 },
    },
    pump2: {
      petrol: { nozzle1: 190000, nozzle2: 120000 },
      diesel: { nozzle1: 305000, nozzle2: 200000 },
      oil: { nozzle1: 2600, nozzle2: 1600 },
    },
  }

  const entries = []
  for (let i = 0; i < PUMP_DAY_TEMPLATES.pump1.length; i++) {
    const t1 = PUMP_DAY_TEMPLATES.pump1[i]
    const t2 = PUMP_DAY_TEMPLATES.pump2[i]
    const date = isoDaysAgo(t1.offset)

    const pump1Entries = buildPumpShiftEntries(openings.pump1, t1, ['petrol', 'diesel'], 'pump1', date)
    const pump2Entries = buildPumpShiftEntries(openings.pump2, t2, ['petrol', 'diesel', 'oil'], 'pump2', date)

    const pump1Sale = pump1Entries.reduce((sum, e) => sum + ['petrol', 'diesel'].reduce((s, k) => s + entryFuelAmount(e, k), 0), 0)
    const pump2Sale = pump2Entries.reduce((sum, e) => sum + ['petrol', 'diesel', 'oil'].reduce((s, k) => s + entryFuelAmount(e, k), 0), 0)

    distributePaymentsAcrossEntries(pump1Entries, buildPaymentLines(pump1Sale, CASH_DELTAS.pump1[i]))
    distributePaymentsAcrossEntries(pump2Entries, buildPaymentLines(pump2Sale, CASH_DELTAS.pump2[i]))

    entries.push(...pump1Entries, ...pump2Entries)
  }

  // newest first for display — a plain reverse() would also flip each day's
  // internal push order (pump2 before pump1, shift 2 before shift 1), so
  // sort by date instead; Array.sort is stable, so same-date entries keep
  // their insertion order.
  return entries.sort((a, b) => b.date.localeCompare(a.date))
}

// ---------- Credit Customers / Ledger ----------

export function closingBalance(customer) {
  return customer.ledger.reduce((bal, entry) => {
    return entry.type === 'credit' ? bal + entry.amount : bal - entry.amount
  }, customer.openingBalance)
}

// The same three numbers closingBalance() above adds/subtracts, split out so
// a tooltip can show its working — computed from the exact same ledger, so
// it can never disagree with the balance actually shown.
export function closingBalanceBreakdown(customer) {
  const totalCredit = (customer.ledger || []).filter((e) => e.type === 'credit').reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  const totalPayments = (customer.ledger || []).filter((e) => e.type === 'payment').reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  return {
    openingBalance: Number(customer.openingBalance) || 0,
    totalCredit,
    totalPayments,
    balance: closingBalance(customer),
  }
}
