import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Send, Download, ClipboardCheck, X, Loader2, CalendarDays } from 'lucide-react'
import Modal from './Modal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { FullPageLoader } from './Loader.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton } from './FormControls.jsx'
import AppTooltip from './AppTooltip.jsx'
import CalcBreakdown from './CalcBreakdown.jsx'
import { formatDate, formatCurrency, formatLiters } from '../utils/format.js'
import { caneOilRawAmount, NOZZLE_KEYS, sortPumpEntries, withCarriedOpenings } from '../utils/fuelCalc.js'
import { fuelRatesOnDate } from '../utils/fuelRate.js'
import { closingBalance } from '../data/mockData.js'
import { useLanguage } from '../context/LanguageContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { sendAuditEmail } from '../lib/apiClient.js'
import { FUEL_ENTRY_TEXT } from '../i18n/fuelEntry.js'

// Suggested audit recipient — pre-filled but always editable, so the report
// still goes to whoever the manager types in instead.
const SUGGESTED_AUDIT_EMAIL = 'sreeabinayaassociates@gmail.com'

// Litres are rounded to whole numbers everywhere in this audit report (and
// only here — the fuel-entry screens elsewhere keep their 2-decimal
// precision) since an auditor reading/printing this report cares about
// round-number litres, not fractional ones.
function roundLtr(value) {
  return Math.round(Number(value) || 0)
}

// Same idea for money: every rupee figure in this audit report (on screen,
// in the emailed summary, and in the downloaded workbook) is rounded to the
// nearest whole rupee — and only here, formatCurrency's 2-decimal precision
// is untouched everywhere else in the app — since a printed/emailed audit
// report is read and reconciled in whole rupees, not paise.
function roundedCurrency(value) {
  return '₹' + Math.round(Number(value) || 0).toLocaleString('en-IN')
}

// Every fuel's meter is tested once a day with a fixed, standard 20 L —
// never sold, never varying — so the Audit report's Petrol/Diesel litres
// (see roundedPetrolLtr/roundedDieselLtr below) subtract exactly this once
// per fuel per day, regardless of whatever value actually ended up in each
// shift's own Testing field. That real, per-shift Testing field still drives
// every OTHER litres figure in the app (Entry History, Dashboard, the CSV
// export, dayTotals.petrolLtr/dieselLtr used for the Amount/rate columns
// right here) exactly as before — this fixed figure is deliberately scoped
// to the Audit report's own Petrol/Diesel meter-reading row only, not a
// replacement for the real field anywhere else.
const AUDIT_TESTING_DEDUCTION_LTR = 20

// A pump's litres for the Audit report: NOT the sum of every shift's own
// (closing − opening − testing) delta rounded once at the end (that's what
// pump.aggregate/dayTotals already give elsewhere, still used for the
// Amount/revenue figures) — this is the boundary-meter-reading calculation
// an auditor actually re-derives by hand off the physical totalizers: this
// pump's FIRST shift's opening reading and LAST shift's closing reading,
// each nozzle rounded to a whole litre first (the way it's actually read off
// the meter), then subtracted — per nozzle, then the two nozzles summed.
// The fixed AUDIT_TESTING_DEDUCTION_LTR above is applied once per fuel per
// day (both pumps combined), not per pump — so it's subtracted where
// roundedPetrolLtr/roundedDieselLtr are computed below, not in here.
// `entries` must already be chronologically sorted (see sortPumpEntries)
// with carried openings applied (see withCarriedOpenings) — same as
// pump1.entries/pump2.entries. Also keeps every nozzle's own opening/
// closing/liters per shift (not just the shift-level sum) so the tooltip
// can show the full nozzle → shift → pump → fuel chain, not just the two
// boundary totals. `exact: true` (2T Oil only, per manager request) skips
// the whole-litre rounding and keeps the real decimal reading instead —
// petrol/diesel keep rounding here since only 2T Oil was asked to stop
// rounding.
function pumpFuelBoundaryBreakdown(entries, fuelKey, { exact = false } = {}) {
  const list = (entries || []).filter((e) => e?.[fuelKey])
  if (!list.length) return { nozzles: [], liters: 0, firstShiftNumber: null, lastShiftNumber: null }
  const round = (v) => (exact ? Math.round((Number(v) || 0) * 100) / 100 : roundLtr(v))

  const firstEntry = list[0]
  const lastEntry = list[list.length - 1]
  // Per nozzle: THIS pump's first shift's opening vs. its last shift's
  // closing — a nozzle is only ever compared against itself, never combined
  // with the other nozzle's readings before subtracting.
  const nozzles = NOZZLE_KEYS.map((k) => {
    const opening = round(firstEntry[fuelKey]?.[k]?.opening)
    const closing = round(lastEntry[fuelKey]?.[k]?.closing)
    const liters = Math.max(0, closing - opening)
    return { nozzleKey: k, opening, closing, liters }
  })
  const liters = nozzles.reduce((sum, n) => sum + n.liters, 0)
  return { nozzles, liters, firstShiftNumber: firstEntry.shiftNumber, lastShiftNumber: lastEntry.shiftNumber }
}

// Sold litres for one stock CHECKPOINT — a calendar date's main-day
// (shift 1+2) reading, or that same date's Shift 3 reading — the same
// boundary-meter calculation that checkpoint's own audit shows as its Fuel
// Sold figure. The fixed AUDIT_TESTING_DEDUCTION_LTR is taken off exactly
// once per day, from whichever checkpoint is that day's LAST one: Shift 3's
// own reading when Shift 3 exists for targetDate, otherwise the day
// checkpoint — same rule as testingDeductionLtr in the component body.
function checkpointSoldLiters(fuelEntries, targetDate, isShift3, fuelKey) {
  const entries = (fuelEntries || []).filter(
    (e) => e.date === targetDate && (isShift3 ? e.shiftNumber === 3 : e.shiftNumber !== 3),
  )
  const pump1 = withCarriedOpenings(sortPumpEntries(entries.filter((e) => e.pumpKey === 'pump1')))
  const pump2 = withCarriedOpenings(sortPumpEntries(entries.filter((e) => e.pumpKey === 'pump2')))
  const raw = pumpFuelBoundaryBreakdown(pump1, fuelKey).liters + pumpFuelBoundaryBreakdown(pump2, fuelKey).liters
  const dayHasShift3 = (fuelEntries || []).some((e) => e.date === targetDate && e.shiftNumber === 3)
  const deduction = !isShift3 && dayHasShift3 ? 0 : AUDIT_TESTING_DEDUCTION_LTR
  return Math.max(0, raw - deduction)
}

// The checkpoint whose Current Stock a given (date, isShift3) checkpoint
// should carry its own Opening Stock forward from — see FuelStockLog's own
// model comment for the full chronology: Shift 3 always continues from
// that SAME date's day checkpoint (never an earlier date's); a day
// checkpoint carries from the most recent EARLIER date's latest checkpoint
// — that date's own Shift 3 one if it has one (the true latest that day),
// otherwise its day one.
function previousStockCheckpoint(fuelStockLogs, targetDate, isShift3) {
  const logs = fuelStockLogs || []
  if (isShift3) {
    const sameDayEntry = logs.find((l) => l.logDate === targetDate && !l.isShift3)
    if (sameDayEntry) return sameDayEntry
  }
  const earlier = logs.filter((l) => l.logDate < targetDate)
  if (!earlier.length) return null
  const latestDate = earlier.reduce((latest, l) => (l.logDate > latest ? l.logDate : latest), earlier[0].logDate)
  const onLatestDate = earlier.filter((l) => l.logDate === latestDate)
  return onLatestDate.find((l) => l.isShift3) || onLatestDate.find((l) => !l.isShift3) || null
}

// Builds the CalcBreakdown content for the Petrol/Diesel/2T-Oil
// round-off-formula tooltip: each nozzle's own first-shift-opening →
// last-shift-closing reading, rolled up into its pump's total, then (for a
// two-pump fuel) both pumps' formula — so an auditor can see exactly which
// two meter readings produced each nozzle's figure, and how the nozzles/
// pumps add up to the final total. `pumps` is one entry (2T Oil, pump 2
// only) or two (Petrol/Diesel, both pumps). `testingDeduction` (Petrol/
// Diesel only, see AUDIT_TESTING_DEDUCTION_LTR) is shown as its own row and
// folded into the formula, so the total here can never silently disagree
// with the fixed deduction actually applied to totalLabel.
function pumpLitersTooltip({ pumps, fuelLabel, totalLabel, note, shiftLabel, nozzleLabel, exact = false, testingDeduction = 0, testingDeductionLabel }) {
  const fmt = (v) => (exact ? (Number(v) || 0).toFixed(2) : String(v))
  const rows = []
  for (const { label: pumpLabel, breakdown } of pumps) {
    const firstLbl = shiftLabel(breakdown.firstShiftNumber)
    const lastLbl = shiftLabel(breakdown.lastShiftNumber)
    for (const n of breakdown.nozzles) {
      rows.push({
        label: `${pumpLabel} · ${nozzleLabel(Number(n.nozzleKey.slice(-1)))} (${firstLbl} opening → ${lastLbl} closing)`,
        value: `${fmt(n.opening)} → ${fmt(n.closing)} = ${fmt(n.liters)} L`,
      })
    }
    rows.push({ label: `${pumpLabel} Total`, value: `${fmt(breakdown.liters)} L` })
  }
  if (testingDeduction > 0) rows.push({ label: testingDeductionLabel, value: `− ${fmt(testingDeduction)} L` })
  const pumpsSum =
    pumps.length === 2
      ? `${pumps[0].label} (${fmt(pumps[0].breakdown.liters)} L) + ${pumps[1].label} (${fmt(pumps[1].breakdown.liters)} L)`
      : `${pumps[0].label} (${fmt(pumps[0].breakdown.liters)} L)`
  const formula =
    testingDeduction > 0
      ? `${pumpsSum} − ${testingDeductionLabel} (${fmt(testingDeduction)} L) = ${fuelLabel} (${totalLabel})`
      : `${pumpsSum} = ${fuelLabel} (${totalLabel})`
  return { rows, formula, note }
}

// Every 2T pocket-oil / Servo (cane) oil row sold today, grouped by product
// (both sections share one product catalog, so the same product could
// appear in either) — this is the per-SKU detail the printed audit sheet
// always carries (each grade/size gets its own count·rate·amount line) that
// the day-summary's single combined "Pocket + Servo Oil" figure doesn't
// show on its own.
function lubricantSalesBreakdown(entries, lubricants) {
  const totals = new Map()
  function addRows(rows) {
    for (const row of rows || []) {
      if (!row.productId) continue
      const qty = Number(row.stockCount) || 0
      const rate = Number(row.stockRate) || 0
      if (!qty && !rate) continue
      const existing = totals.get(row.productId) || { productId: row.productId, qty: 0, amount: 0 }
      existing.qty += qty
      existing.amount += qty * rate
      totals.set(row.productId, existing)
    }
  }
  for (const entry of entries || []) {
    addRows(entry.oilRows)
    addRows(entry.caneOilRows)
  }
  return [...totals.values()]
    .map((row) => ({
      ...row,
      name: (lubricants || []).find((p) => p.id === row.productId)?.name || '—',
      rate: row.qty > 0 ? row.amount / row.qty : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

// The cane-oil "Offer" is one flat discount per entry, capped so it can
// never take that entry's cane-oil total below zero (see caneOilAmount in
// fuelCalc.js) — summing the actually-applied amount (not the raw typed
// offer) is what keeps the breakdown table's total matching
// dayTotals.pocketOilTotal + dayTotals.caneOilTotal exactly.
function caneOilOffersApplied(entries) {
  return (entries || []).reduce((sum, entry) => {
    const raw = caneOilRawAmount(entry)
    const offer = Number(entry.caneOilOffer) || 0
    return sum + Math.min(offer, raw)
  }, 0)
}

// Real payment collection methods only (Cash/Day Cash/Card/QR/...) — every
// line added via the plain "Add line" flow is type 'cash' regardless of its
// label, so this is the full set of money actually collected at the pump.
// Grouped by label and summed across both pumps, since the whole report is
// now an entire-day figure rather than split per pump.
// A payment line with no `type` at all (older data saved before the field
// existed) is a plain cash/card/QR line, same as emptyPaymentLine()'s own
// default — only an explicit 'credit'/'employeeCredit'/'expense' type means
// it's something else.
function isCashPayment(p) {
  return !p.type || p.type === 'cash'
}

// Cash, Day Cash and Night Cash are all still physical cash in the till —
// the shift-level split matters for handover accounting, but a day-level
// audit just wants one "Cash" figure, not three near-duplicate rows.
const CASH_LABELS = new Set(['cash', 'day cash', 'night cash'])
const CANONICAL_CASH_LABEL = 'Cash'

function paymentsBreakdown(entries) {
  const totals = new Map()
  for (const entry of entries || []) {
    for (const p of entry.payments || []) {
      if (!isCashPayment(p)) continue
      const rawLabel = (p.label || '').trim() || '—'
      const label = CASH_LABELS.has(rawLabel.toLowerCase()) ? CANONICAL_CASH_LABEL : rawLabel
      totals.set(label, (totals.get(label) || 0) + (Number(p.amount) || 0))
    }
  }
  return [...totals.entries()].map(([label, amount]) => ({ label, amount, kind: 'cash' }))
}

// Customer credit lines only (never employee credit) summed per customer —
// shown by name, right alongside the real payment methods, since credit is
// just another way the day's sale was settled (owed back later instead of
// collected today).
function customerCreditBreakdown(entries, creditCustomers) {
  const totals = new Map()
  for (const entry of entries || []) {
    for (const p of entry.payments || []) {
      if (p.type !== 'credit') continue
      const key = p.customerId || `unassigned:${p.note || ''}`
      const existing = totals.get(key) || { customerId: p.customerId || '', amount: 0 }
      existing.amount += Number(p.amount) || 0
      totals.set(key, existing)
    }
  }
  return [...totals.values()].map((row) => ({
    label: (creditCustomers || []).find((c) => c.id === row.customerId)?.name || '—',
    amount: row.amount,
    customerId: row.customerId,
    kind: 'credit',
  }))
}

// Payment methods and customer credit, combined into one table sorted by
// amount — this is "how the day's sale was settled", cash/card/QR and
// credit together.
function combinedPaymentRows(entries, creditCustomers) {
  return [...paymentsBreakdown(entries), ...customerCreditBreakdown(entries, creditCustomers)].sort((a, b) => b.amount - a.amount)
}

// Everything that isn't money collected for fuel today: employee credit
// (an employee's personal draw, tracked against their salary — not a
// customer sale) and expense lines (cash paid straight back out). Grouped
// by label and summed, same as the payment breakdown.
// Grouped by (type, label) together, NOT label alone — an employee's
// personal draw and an unrelated vendor expense that happen to share the
// exact same free-typed label (e.g. both called "Diesel") used to silently
// merge into one combined figure here, which could read as one thing being
// mistaken for the other in the report. Keeping `type` on each row lets the
// table below show which is which whenever that happens.
function remainingExpensesBreakdown(entries) {
  const totals = new Map()
  for (const entry of entries || []) {
    for (const p of entry.payments || []) {
      if (isCashPayment(p) || p.type === 'credit') continue
      const label = (p.label || '').trim() || '—'
      const key = `${p.type}::${label}`
      const existing = totals.get(key) || { label, type: p.type, amount: 0 }
      existing.amount += Number(p.amount) || 0
      totals.set(key, existing)
    }
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount)
}

// Cash lines don't get a litres figure — a cash line commonly covers a mix
// of fuels, so there's no single rate to divide by. Every other payment
// method settles against one particular fuel: the ones that name it in
// their own label (Card/QR (Petrol/Diesel)), plus a fixed house convention
// for the ones that don't (Company QR/Extra Power → diesel, Extra QR/Extra
// Reward → petrol) — Extra Test has no fixed fuel, so it's left blank.
// Customer credit always converts at the diesel rate, regardless of label.
const DIESEL_CONVENTION_LABELS = new Set(['company qr', 'extra power'])
const PETROL_CONVENTION_LABELS = new Set(['extra qr', 'extra reward'])

// Which fuel a row's litres are converted at — shown right next to the
// method/customer name so it's never ambiguous which rate produced the figure.
function rowConversionFuel(row) {
  if (row.kind === 'credit') return 'diesel'
  const lbl = (row.label || '').trim().toLowerCase()
  if (CASH_LABELS.has(lbl)) return null
  if (lbl.includes('petrol') || PETROL_CONVENTION_LABELS.has(lbl)) return 'petrol'
  if (lbl.includes('diesel') || DIESEL_CONVENTION_LABELS.has(lbl)) return 'diesel'
  return null
}

function rowLiters(row, dayTotals) {
  const fuel = rowConversionFuel(row)
  if (!fuel) return null
  const amt = Number(row.amount) || 0
  if (!amt) return null
  const petrolRate = dayTotals.petrolLtr > 0 ? dayTotals.petrolAmount / dayTotals.petrolLtr : 0
  const dieselRate = dayTotals.dieselLtr > 0 ? dayTotals.dieselAmount / dayTotals.dieselLtr : 0
  if (fuel === 'petrol' && petrolRate > 0) return amt / petrolRate
  if (fuel === 'diesel' && dieselRate > 0) return amt / dieselRate
  return null
}

// Everything here is a client-side snapshot: editing the "Overall Day Total"
// fields lets the auditor record their own reconciled figures on the report
// without silently rewriting the real, saved fuel entries underneath.
export default function AuditModal({
  isOpen,
  onClose,
  date,
  station,
  onUpdateAuditContact,
  pump1,
  pump2,
  dayTotals,
  billsCount,
  employees,
  creditCustomers,
  lubricants,
  variantLabel,
  hasShift3 = false,
}) {
  const { language } = useLanguage()
  const t = FUEL_ENTRY_TEXT[language].audit
  const { addLedgerEntry, removeLedgerEntry, fuelEntries, fuelStockLogs, saveFuelStockLog, fuelRateHistory } = useData()

  // A second, independent audit (e.g. the Shift 3 / price-change report)
  // reuses this exact component but is labeled distinctly, both on screen
  // and in the exported report, so the two are never mistaken for each other.
  const modalTitle = variantLabel ? `${t.modalTitle} — ${variantLabel}` : t.modalTitle
  const reportTitle = variantLabel ? `${t.reportTitle} — ${variantLabel}` : t.reportTitle
  // Everything gated on this is a WHOLE-DAY concept — the fixed daily
  // testing allowance and the tank-stock reconciliation (Opening/Received/
  // Current/Sold Today, carried forward from the previous day's own sold
  // litres) — that only makes sense for the real Shift 1+2 day total.
  // Shift 3 is a separate, narrow report for one specific price-change
  // moment (see FuelEntryForm's dayBreakdown.shift3Pump1/shift3Pump2, a
  // single shift's own entries, not the day's), passed in here with
  // variantLabel set — a day-level stock carry-forward applied to that
  // narrow window would be meaningless, not just redundant. The fixed daily
  // testing deduction, though, moves to whichever audit is that day's LAST
  // one — see testingDeductionLtr below.
  const isDayAudit = !variantLabel

  const [auditorName, setAuditorName] = useState('')
  const [remarks, setRemarks] = useState('')
  // Recording a "Customer Credit Paid" entry here updates the customer's real
  // credit ledger (same balance CreditBills shows) immediately — it's a real
  // payment, not a draft. It's deliberately kept OUT of editedSale/editedPayments
  // above: this money settles a PAST credit sale, it was never part of today's
  // fuel-entry sale/payments totals, so folding it in would double-count it and
  // throw off the excess/shortage math. This section exists purely so the
  // audit report also shows what credit was collected on this date.
  const [creditPaymentForm, setCreditPaymentForm] = useState({ customerId: '', amount: '', mode: 'Cash' })
  // Rounded to the nearest rupee, same as every other amount in this report
  // (see roundedCurrency) — the auditor is reconciling whole-rupee cash/UPI
  // totals, not fractional paise, so that's the exact figure to start from.
  const [editedSale, setEditedSale] = useState(String(Math.round(dayTotals.totalSaleAmount)))
  const [editedPayments, setEditedPayments] = useState(String(Math.round(dayTotals.totalPayments)))
  const [editedVariance, setEditedVariance] = useState(String(Math.round(dayTotals.excessShortage)))
  // This modal never unmounts between opens (its parent just toggles isOpen)
  // and, unlike PumpDayEditor, isn't even remounted on a date change (no
  // `key={date}` — FuelEntryForm just flips `date` in place) — so without
  // this, every field below would silently keep whatever was typed for a
  // PREVIOUS date/opening, right through a date change, with nothing on
  // screen to say so. "Overall Day Total" needs the live dayTotals resync
  // regardless (it can keep drifting out of sync purely from new shifts
  // being saved for the SAME date too); everything else here — auditor
  // name, remarks, the manual stock-reconciliation numbers, the credit-
  // payment mini-form — is per-report data entry for one specific date, so
  // it's reset back to blank on every open, the same as a fresh form.
  // `contactEmail` below is the one deliberate exception: that one really is
  // meant to persist as a station-level default across audits.
  useEffect(() => {
    if (!isOpen) return
    setEditedSale(String(Math.round(dayTotals.totalSaleAmount)))
    setEditedPayments(String(Math.round(dayTotals.totalPayments)))
    setEditedVariance(String(Math.round(dayTotals.excessShortage)))
    setAuditorName('')
    setRemarks('')
    // Defaults to the real rate effective on this audit's date, same
    // date-effective lookup the Fuel Entry screen itself uses — not just
    // "today's" rate, since an audit can be reopened for a past date.
    const ratesOnDate = fuelRatesOnDate(fuelRateHistory, date)
    setAuditRatePetrol(String(ratesOnDate.petrol || 0))
    setAuditRateDiesel(String(ratesOnDate.diesel || 0))
    setAuditRateOil(String(ratesOnDate.oil || 0))
    // Fuel Stock — real, saved DB records now (see app/models/fuel_stock_log.py
    // and DataContext's saveFuelStockLog), not re-derived guesses. Both the
    // day audit and the Shift 3 audit get their own checkpoint here
    // (is_shift3 distinguishes them) — see previousStockCheckpoint/
    // checkpointSoldLiters above for the carry-forward chain between them.
    const todayLog = (fuelStockLogs || []).find((l) => l.logDate === date && l.isShift3 === !isDayAudit)
    if (todayLog) {
      // Already saved once already (e.g. reopening this same audit later) —
      // resume exactly what was saved, not a freshly re-derived default,
      // so reopening never looks like it forgot what was already entered.
      // Still surfaced below (mode 'saved') so it's never ambiguous whether
      // a number is a fresh carry-forward guess or an already-confirmed record.
      setOpeningStockPetrol(String(todayLog.petrolOpeningStock))
      setStockReceivedPetrol(String(todayLog.petrolStockReceived))
      setOpeningStockDiesel(String(todayLog.dieselOpeningStock))
      setStockReceivedDiesel(String(todayLog.dieselStockReceived))
      setOpeningStockSource({ mode: 'saved', logDate: date, isShift3: !isDayAudit })
    } else {
      // No record for this checkpoint yet — Opening Stock defaults from the
      // previous checkpoint's true closing balance: that checkpoint's own
      // saved opening + received, minus its real sold litres (re-derived
      // fresh from its actual fuel entries, exactly the same
      // pumpFuelBoundaryBreakdown + testing deduction its own audit would
      // show) — never a stored "sold" figure, so a reading corrected after
      // the fact can't leave this stale. For the Shift 3 audit, that
      // "previous checkpoint" is always this SAME date's day checkpoint
      // (previousStockCheckpoint handles that); for the day audit, it's the
      // latest checkpoint (day or Shift 3) from the most recent earlier date.
      const source = previousStockCheckpoint(fuelStockLogs, date, !isDayAudit)
      if (source) {
        const petrolSold = checkpointSoldLiters(fuelEntries, source.logDate, source.isShift3, 'petrol')
        const dieselSold = checkpointSoldLiters(fuelEntries, source.logDate, source.isShift3, 'diesel')
        setOpeningStockPetrol(String(Math.max(0, source.petrolOpeningStock + source.petrolStockReceived - petrolSold)))
        setOpeningStockDiesel(String(Math.max(0, source.dieselOpeningStock + source.dieselStockReceived - dieselSold)))
        // Surfaced on screen next to the Fuel Stock table (see
        // openingStockSource below) so the manager can see exactly which
        // earlier checkpoint this default was carried forward from, instead
        // of it looking like an unexplained number.
        setOpeningStockSource({ mode: 'carried', logDate: source.logDate, isShift3: source.isShift3 })
      } else {
        // No fuel stock log exists yet anywhere before this checkpoint (e.g.
        // the very first audit ever) — '0' is a real, correct answer here
        // (nothing logged before any record existed), not a guess. Still
        // surfaced (mode 'none') so every audit shows SOME explanation for
        // its Opening Stock, never a silent, unexplained number.
        setOpeningStockPetrol('0')
        setOpeningStockDiesel('0')
        setOpeningStockSource({ mode: 'none' })
      }
      setStockReceivedPetrol('')
      setStockReceivedDiesel('')
    }
    setCreditPaymentForm({ customerId: '', amount: '', mode: 'Cash' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, date])
  const [contactEmail, setContactEmail] = useState(station?.auditContactEmail || SUGGESTED_AUDIT_EMAIL)
  // Tracks WHICH of Download/Send Email is in flight (not just whether one
  // is) so only the button actually clicked shows its own spinner, while
  // both still disable — same "one write in flight blocks the other" intent
  // as elsewhere in this file (see removingCreditPaymentId).
  const [sendingAction, setSendingAction] = useState(null) // null | 'download' | 'email'
  const sending = sendingAction != null
  // Opening Stock (what was already in the tank before today's delivery) +
  // Stock Received Today, minus what the meters show as sold today, is
  // what's left right now — the manager types both sides of that balance in.
  const [openingStockPetrol, setOpeningStockPetrol] = useState('')
  const [openingStockDiesel, setOpeningStockDiesel] = useState('')
  const [stockReceivedPetrol, setStockReceivedPetrol] = useState('')
  const [stockReceivedDiesel, setStockReceivedDiesel] = useState('')
  // Which earlier checkpoint (date + day/shift3 scope) the Opening Stock
  // fields above were just auto-carried forward from — null whenever
  // there's nothing to explain (a saved checkpoint was resumed as-is, or
  // this is the very first checkpoint ever with nothing before it).
  const [openingStockSource, setOpeningStockSource] = useState(null)
  // Audit-only rate override — defaults to the real rate effective on this
  // audit's date (see fuelRatesOnDate), but the auditor can revise it here to
  // see the Fuel Sold table recompute live. This never writes back to Fuel
  // Rate History or any fuel entry — it only changes what THIS report's
  // Amount column shows (Rounded Litres × this rate), independent of
  // whatever rate each shift's own entries were actually saved with
  // (dayTotals.petrolAmount/dieselAmount/oilAmount, still used elsewhere on
  // this screen, e.g. the Overall Day Total banner).
  const [auditRatePetrol, setAuditRatePetrol] = useState('')
  const [auditRateDiesel, setAuditRateDiesel] = useState('')
  const [auditRateOil, setAuditRateOil] = useState('')

  const variance = Number(editedVariance) || 0
  const dayEntries = useMemo(() => [...(pump1.entries || []), ...(pump2.entries || [])], [pump1.entries, pump2.entries])
  // Petrol/Diesel/2T Oil litres for the whole day — the audit-specific
  // boundary-meter-reading figure (see pumpFuelBoundaryBreakdown's own
  // comment), NOT dayTotals.petrolLtr/dieselLtr/oilLtr (which sum each
  // shift's own closing−opening−testing delta instead — still used for the
  // Amount/rate figures elsewhere on this screen, a different question from
  // "what do the physical meters show"). Each pump's own two nozzles are
  // rounded and subtracted independently, then the two pumps added — so this
  // CAN differ by a litre or two from the Entire Day Total banner/Entry
  // History table/CSV export elsewhere in the app, which is expected: this
  // figure is deliberately the meter-to-meter audit check, not the
  // net-of-testing sale figure those other screens show.
  const pump1PetrolBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump1.entries, 'petrol'), [pump1.entries])
  const pump2PetrolBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump2.entries, 'petrol'), [pump2.entries])
  const pump1DieselBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump1.entries, 'diesel'), [pump1.entries])
  const pump2DieselBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump2.entries, 'diesel'), [pump2.entries])
  // Oil is only ever sold through Pump 2's nozzle (see FUEL_KEYS_BY_PUMP in
  // fuelCalc.js) — one pump's breakdown, kept unrounded (`exact: true`) —
  // 2T Oil is deliberately NOT rounded off (per manager request), shown and
  // reported at its real decimal litres, unlike Petrol/Diesel above. It also
  // gets no AUDIT_TESTING_DEDUCTION_LTR — that fixed deduction is Petrol/
  // Diesel only, per how it was requested.
  const pump2OilBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump2.entries, 'oil', { exact: true }), [pump2.entries])
  // Math.max(0, ...): a day with barely any fuel sold (a half-day open, or a
  // near-empty tank) could plausibly sell under 20L total — the fixed daily
  // testing deduction must never push a real, small sale figure negative.
  // The 20L allowance is charged exactly once per day, against whichever
  // audit is that day's LAST one: the main day audit when there's no Shift 3
  // report, or Shift 3's own report when Shift 3 IS enabled for this date
  // (hasShift3) — never both, and never the main audit once Shift 3 exists.
  const testingDeductionLtr = isDayAudit ? (hasShift3 ? 0 : AUDIT_TESTING_DEDUCTION_LTR) : AUDIT_TESTING_DEDUCTION_LTR
  const roundedPetrolLtr = Math.max(0, pump1PetrolBreakdown.liters + pump2PetrolBreakdown.liters - testingDeductionLtr)
  const roundedDieselLtr = Math.max(0, pump1DieselBreakdown.liters + pump2DieselBreakdown.liters - testingDeductionLtr)
  const exactOilLtr = pump2OilBreakdown.liters
  // Audit-only Amount = this report's own Rounded/Exact Litres × the
  // auditor-revisable rate above — deliberately NOT dayTotals.petrolAmount/
  // dieselAmount/oilAmount (each shift's own saved rate × its own litres),
  // so revising the rate here recomputes the whole row instantly.
  const auditPetrolAmount = roundedPetrolLtr * (Number(auditRatePetrol) || 0)
  const auditDieselAmount = roundedDieselLtr * (Number(auditRateDiesel) || 0)
  const auditOilAmount = exactOilLtr * (Number(auditRateOil) || 0)
  const shiftLabel = FUEL_ENTRY_TEXT[language].pumpEditor.shiftLabel
  const nozzleLabel = FUEL_ENTRY_TEXT[language].pumpEditor.nozzleLabel
  const employeeCreditLabel = FUEL_ENTRY_TEXT[language].pumpEditor.employeeCreditLabel
  const currentStockPetrol = (Number(openingStockPetrol) || 0) + (Number(stockReceivedPetrol) || 0) - roundedPetrolLtr
  const currentStockDiesel = (Number(openingStockDiesel) || 0) + (Number(stockReceivedDiesel) || 0) - roundedDieselLtr
  const paymentRows = useMemo(() => combinedPaymentRows(dayEntries, creditCustomers), [dayEntries, creditCustomers])
  const remainingExpenseRows = useMemo(() => remainingExpensesBreakdown(dayEntries), [dayEntries])
  const remainingExpensesTotal = useMemo(() => remainingExpenseRows.reduce((sum, r) => sum + r.amount, 0), [remainingExpenseRows])
  const pocketAndServoOilAmount = dayTotals.pocketOilTotal + dayTotals.caneOilTotal
  // This table's own bottom-line total — mirrors fuelCalc.js's
  // totalSaleAmount formula (fuel amounts + pocket/servo oil), but built from
  // the audit-rate amounts above instead of dayTotals', so it stays
  // internally consistent with the rows actually shown in this table.
  const auditTotalSaleAmount = auditPetrolAmount + auditDieselAmount + auditOilAmount + pocketAndServoOilAmount
  const lubricantSalesRows = useMemo(() => lubricantSalesBreakdown(dayEntries, lubricants), [dayEntries, lubricants])
  const lubricantOffersApplied = useMemo(() => caneOilOffersApplied(dayEntries), [dayEntries])

  // Every credit-customer payment recorded against THIS audit date — whether
  // added here or straight from the Credit Bills page — so the report always
  // shows the real thing that happened, not just what this modal itself added.
  const todaysCreditPayments = useMemo(() => {
    const rows = []
    for (const c of creditCustomers || []) {
      for (const entry of c.ledger || []) {
        if (entry.type === 'payment' && entry.date === date) {
          rows.push({ id: entry.id, customerId: c.id, customerName: c.name, amount: Number(entry.amount) || 0, mode: entry.mode || '—' })
        }
      }
    }
    return rows
  }, [creditCustomers, date])
  const todaysCreditPaymentsTotal = useMemo(() => todaysCreditPayments.reduce((sum, r) => sum + r.amount, 0), [todaysCreditPayments])

  // Explicit action, never automatic — the manager fills in Opening Stock/
  // Stock Received and clicks Save, same "nothing happens until a real
  // click" contract as every other write in this app (see
  // FuelStockLogService.create_or_revise for the actual upsert-by-date
  // logic). Sold Today/Current Stock are never part of this write — they're
  // always computed live from the real fuel entries wherever they're shown,
  // so editing a meter reading for this date afterward can't leave a stale
  // figure behind; only Opening Stock/Stock Received themselves are ever
  // saved, and saving them again for the same date just replaces this row.
  const [savingStock, setSavingStock] = useState(false)

  async function handleSaveStock() {
    // Current Stock going negative means the typed Opening Stock/Stock
    // Received figures can't be right (there's physically no such thing as
    // negative fuel in the tank) — caught here, before the write, rather
    // than saving a nonsensical figure the next checkpoint would then carry
    // forward too.
    if (currentStockPetrol < 0) {
      toast.error(t.toastNegativeStock(t.colPetrol, roundLtr(currentStockPetrol)))
      return
    }
    if (currentStockDiesel < 0) {
      toast.error(t.toastNegativeStock(t.colDiesel, roundLtr(currentStockDiesel)))
      return
    }
    setSavingStock(true)
    try {
      await saveFuelStockLog(date, {
        isShift3: !isDayAudit,
        petrolOpeningStock: Number(openingStockPetrol) || 0,
        petrolStockReceived: Number(stockReceivedPetrol) || 0,
        dieselOpeningStock: Number(openingStockDiesel) || 0,
        dieselStockReceived: Number(stockReceivedDiesel) || 0,
      })
      toast.success(t.toastStockSaved)
      // Flips the button straight to "Update Stock" without needing to
      // close/reopen this modal — mirrors what reopening it would show
      // anyway (see the isOpen/date effect above, which sets this same
      // 'saved' mode from the freshly-written row).
      setOpeningStockSource({ mode: 'saved', logDate: date, isShift3: !isDayAudit })
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingStock(false)
    }
  }

  // addLedgerEntry is a real network call with no optimistic update (unlike
  // the fuel-entry autosave elsewhere in this app) — the "today's credit
  // paid" list right below only actually shows the new row once
  // creditCustomers itself updates, after the request resolves. Firing the
  // success toast and clearing the form immediately used to claim it was
  // recorded before the request had even landed — with no error handling at
  // all, so a failed request still said "success". addingCreditPayment
  // disables the form and the button shows a spinner for exactly that
  // window, so what's on screen never gets ahead of what's actually saved.
  const [addingCreditPayment, setAddingCreditPayment] = useState(false)

  async function handleAddCreditPayment(e) {
    e.preventDefault()
    const amount = Number(creditPaymentForm.amount)
    if (!creditPaymentForm.customerId) {
      toast.error(t.errorSelectCustomer)
      return
    }
    if (!(amount > 0)) {
      toast.error(t.errorCreditAmount)
      return
    }
    setAddingCreditPayment(true)
    try {
      await addLedgerEntry(creditPaymentForm.customerId, {
        date,
        type: 'payment',
        fuelType: null,
        ltr: null,
        rate: null,
        amount,
        mode: creditPaymentForm.mode,
        note: t.creditPaidNote,
      })
      toast.success(t.toastCreditPaymentRecorded)
      setCreditPaymentForm((prev) => ({ ...prev, amount: '' }))
    } catch (err) {
      toast.error(err.message || t.errorCreditAmount)
    } finally {
      setAddingCreditPayment(false)
    }
  }

  // Same before-it-actually-happened gap as adding one above — the row
  // stays in the list (and could be removed again, or double-toasted) until
  // the request that's supposed to remove it has actually finished.
  const [removingCreditPaymentId, setRemovingCreditPaymentId] = useState(null)
  // Clicking the X no longer removes immediately — it just opens this
  // confirmation (holds the row itself, not just an id, so the dialog can
  // show the customer name/amount) — a real network delete, so an
  // accidental click shouldn't silently undo a real credit payment.
  const [confirmRemoveCreditPayment, setConfirmRemoveCreditPayment] = useState(null)

  // Undo a mistaken entry — whether it was added here or on the Credit Bills
  // page, as long as it's a payment dated to this audit's day it shows up in
  // the list above, so it should be removable from right here too.
  async function handleRemoveCreditPayment(row) {
    if (removingCreditPaymentId) return
    setRemovingCreditPaymentId(row.id)
    try {
      await removeLedgerEntry(row.customerId, row.id)
      toast.success(t.toastCreditPaymentRemoved)
      setConfirmRemoveCreditPayment(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setRemovingCreditPaymentId(null)
    }
  }

  async function buildWorkbookBlob() {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    workbook.creator = station?.name || 'Fuel Pump Manager'
    const sheet = workbook.addWorksheet('Audit Report')

    sheet.addRow([reportTitle]).font = { bold: true, size: 14 }
    sheet.addRow([station?.name || ''])
    sheet.addRow([t.dateLabel, formatDate(date)])
    sheet.addRow([t.auditorNameLabel, auditorName || '—'])
    sheet.addRow([])

    sheet.addRow([t.daySummaryTitle]).font = { bold: true }
    const header = sheet.addRow([t.colFuel, t.colLitres, t.colRate, t.colAmount])
    header.font = { bold: true }
    sheet.addRow([t.colPetrol, roundedPetrolLtr, Number(auditRatePetrol) || 0, roundedCurrency(auditPetrolAmount)])
    if (testingDeductionLtr > 0) sheet.addRow(['', t.testingDeductionNote(testingDeductionLtr)]).font = { italic: true, color: { argb: 'FF94A3B8' } }
    sheet.addRow([t.colDiesel, roundedDieselLtr, Number(auditRateDiesel) || 0, roundedCurrency(auditDieselAmount)])
    if (testingDeductionLtr > 0) sheet.addRow(['', t.testingDeductionNote(testingDeductionLtr)]).font = { italic: true, color: { argb: 'FF94A3B8' } }
    if (dayTotals.oilLtr) sheet.addRow([t.colOil, Math.round(exactOilLtr * 100) / 100, Number(auditRateOil) || 0, roundedCurrency(auditOilAmount)])
    sheet.addRow([t.colPocketCane, '—', '—', roundedCurrency(pocketAndServoOilAmount)])
    sheet.addRow([t.fieldSale, '', '', roundedCurrency(auditTotalSaleAmount)]).font = { bold: true }
    sheet.addRow([])

    sheet.addRow([t.lubricantSalesTitle]).font = { bold: true }
    const lubricantHeader = sheet.addRow([t.colProduct, t.colCount, t.colRate, t.colAmount])
    lubricantHeader.font = { bold: true }
    if (lubricantSalesRows.length) {
      for (const row of lubricantSalesRows) {
        sheet.addRow([row.name, row.qty, roundedCurrency(row.rate), roundedCurrency(row.amount)])
      }
    } else {
      sheet.addRow([t.noLubricantSales])
    }
    if (lubricantOffersApplied > 0) {
      sheet.addRow([t.colOfferApplied, '', '', `-${roundedCurrency(lubricantOffersApplied)}`])
    }
    sheet.addRow([t.colPocketCane, '', '', roundedCurrency(pocketAndServoOilAmount)]).font = { bold: true }
    sheet.addRow([])

    sheet.addRow([t.paymentsBreakdownTitle]).font = { bold: true }
    const paymentsHeader = sheet.addRow([t.colMethod, t.colLitres, t.colAmount])
    paymentsHeader.font = { bold: true }
    for (const row of paymentRows) {
      const fuel = rowConversionFuel(row)
      const litres = rowLiters(row, dayTotals)
      const labelWithFuel = fuel ? `${row.label} (${fuel === 'petrol' ? t.colPetrol : t.colDiesel})` : row.label
      sheet.addRow([labelWithFuel, litres != null ? roundLtr(litres) : '—', roundedCurrency(row.amount)])
    }
    sheet.addRow([])

    if (remainingExpenseRows.length) {
      sheet.addRow([t.remainingExpensesTitle]).font = { bold: true }
      const remainingHeader = sheet.addRow([t.colMethod, t.colAmount])
      remainingHeader.font = { bold: true }
      for (const row of remainingExpenseRows) {
        const label = row.type === 'employeeCredit' ? `${row.label} (${employeeCreditLabel})` : row.label
        sheet.addRow([label, roundedCurrency(row.amount)])
      }
      sheet.addRow([t.totalRemainingExpensesLabel, roundedCurrency(remainingExpensesTotal)]).font = { bold: true }
      sheet.addRow([])
    }

    if (todaysCreditPayments.length) {
      sheet.addRow([t.creditPaidTitle]).font = { bold: true }
      const creditPaidHeader = sheet.addRow([t.colCustomer, t.colMode, t.colAmount])
      creditPaidHeader.font = { bold: true }
      for (const row of todaysCreditPayments) {
        sheet.addRow([row.customerName, row.mode, roundedCurrency(row.amount)])
      }
      sheet.addRow([t.totalCreditPaidLabel, '', roundedCurrency(todaysCreditPaymentsTotal)]).font = { bold: true }
      sheet.addRow([])
    }

    sheet.addRow([t.fuelStockTitle]).font = { bold: true }
    const stockHeader = sheet.addRow([t.colFuel, t.colOpeningStock, t.colStockReceived, t.colCurrentStock, t.colSoldToday])
    stockHeader.font = { bold: true }
    sheet.addRow([
      t.colPetrol,
      Number(openingStockPetrol) || 0,
      Number(stockReceivedPetrol) || 0,
      roundLtr(currentStockPetrol),
      roundedPetrolLtr,
    ])
    sheet.addRow([
      t.colDiesel,
      Number(openingStockDiesel) || 0,
      Number(stockReceivedDiesel) || 0,
      roundLtr(currentStockDiesel),
      roundedDieselLtr,
    ])
    sheet.addRow([])

    sheet.addRow([t.overallTitle]).font = { bold: true }
    sheet.addRow([t.fieldSale, roundedCurrency(Number(editedSale) || 0)])
    sheet.addRow([t.fieldPayments, roundedCurrency(Number(editedPayments) || 0)])
    sheet.addRow([t.fieldVariance, roundedCurrency(variance)])
    sheet.addRow([t.billsLabel, billsCount])
    sheet.addRow([])
    sheet.addRow([t.remarksLabel, remarks || '—'])

    sheet.columns.forEach((col) => { col.width = 22 })

    const buffer = await workbook.xlsx.writeBuffer()
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  }

  function downloadBlob(blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-report-${date}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDownload() {
    setSendingAction('download')
    try {
      downloadBlob(await buildWorkbookBlob())
      toast.success(t.toastDownloaded)
    } catch (err) {
      toast.error(err.message || t.toastReportFailed)
    } finally {
      setSendingAction(null)
    }
  }

  async function handleSendEmail() {
    if (!contactEmail.trim()) {
      toast.error(t.contactRequired)
      return
    }
    const trimmedEmail = contactEmail.trim()
    const subject = `${station?.name || ''} — ${reportTitle} — ${formatDate(date)}`
    const body = t.whatsAppMessage(
      station?.name || '',
      formatDate(date),
      roundedCurrency(Number(editedSale) || 0),
      roundedCurrency(Number(editedPayments) || 0),
      `${t.fieldVariance}: ${variance >= 0 ? '+' : ''}${roundedCurrency(variance)}`,
    )

    setSendingAction('email')
    try {
      const workbookBlob = await buildWorkbookBlob()
      // Sent server-side over real SMTP now (see app/core/email.py) — the
      // workbook built above is attached exactly as-is, never rebuilt or
      // re-validated on the backend. Only persist this as the new default
      // contact once the send has actually succeeded, not just attempted.
      await sendAuditEmail({
        toEmail: trimmedEmail,
        subject,
        bodyText: body,
        workbookBlob,
        filename: `audit-report-${date}.xlsx`,
      })
      onUpdateAuditContact?.(trimmedEmail)
      toast.success(t.toastSent)
    } catch (err) {
      toast.error(err.message || t.toastReportFailed)
    } finally {
      setSendingAction(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} maxWidth="max-w-7xl">
      {sendingAction === 'email' ? <FullPageLoader label={t.sendingEmailLabel} /> : null}
      {savingStock ? <FullPageLoader label={t.savingStockLabel} /> : null}
      {addingCreditPayment ? (
        <FullPageLoader label={t.recordingCreditPaymentLabel} />
      ) : removingCreditPaymentId != null ? (
        <FullPageLoader label={t.removingCreditPaymentLabel} />
      ) : null}
      <div className="space-y-5">
        <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-sm">
          <ClipboardCheck size={16} className="shrink-0 text-brand-600" />
          <span className="font-semibold text-slate-700">{station?.name}</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600">{formatDate(date)}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t.auditorNameLabel}>
            <Input value={auditorName} onChange={(e) => setAuditorName(e.target.value)} placeholder={t.auditorNamePlaceholder} />
          </Field>
          <Field label={t.billsLabel}>
            <Input value={billsCount} readOnly disabled className="bg-slate-50" />
          </Field>
        </div>

        {/* Two side-by-side columns on wide screens instead of one long stack —
            left is the read-only day breakdown, right is what the auditor
            reconciles/edits — so the modal scrolls a lot less to get through it. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.daySummaryTitle}</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50">
                <tr className="text-slate-400">
                  <th className="px-3 py-2 font-semibold">{t.colFuel}</th>
                  <th className="px-3 py-2 font-semibold">{t.colLitres}</th>
                  <th className="px-3 py-2 font-semibold">{t.colRate}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-orange-600">{t.colPetrol}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700">
                    <AppTooltip
                      title={
                        <CalcBreakdown
                          {...pumpLitersTooltip({
                            pumps: [
                              { label: t.pump1Label, breakdown: pump1PetrolBreakdown },
                              { label: t.pump2Label, breakdown: pump2PetrolBreakdown },
                            ],
                            fuelLabel: t.colPetrol,
                            totalLabel: `${roundedPetrolLtr} L`,
                            note: t.litersRoundOffNote,
                            shiftLabel,
                            nozzleLabel,
                            testingDeduction: testingDeductionLtr,
                            testingDeductionLabel: t.testingDeductionLabel,
                          })}
                        />
                      }
                    >
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{roundedPetrolLtr} L</span>
                    </AppTooltip>
                    {testingDeductionLtr > 0 ? (
                      <p className="mt-0.5 text-[11px] font-normal text-slate-400">{t.testingDeductionNote(testingDeductionLtr)}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-20">
                      <Input type="number" step="any" min="0" value={auditRatePetrol} onChange={(e) => setAuditRatePetrol(e.target.value)} placeholder="0" />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{roundedCurrency(auditPetrolAmount)}</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-blue-600">{t.colDiesel}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700">
                    <AppTooltip
                      title={
                        <CalcBreakdown
                          {...pumpLitersTooltip({
                            pumps: [
                              { label: t.pump1Label, breakdown: pump1DieselBreakdown },
                              { label: t.pump2Label, breakdown: pump2DieselBreakdown },
                            ],
                            fuelLabel: t.colDiesel,
                            totalLabel: `${roundedDieselLtr} L`,
                            note: t.litersRoundOffNote,
                            shiftLabel,
                            nozzleLabel,
                            testingDeduction: testingDeductionLtr,
                            testingDeductionLabel: t.testingDeductionLabel,
                          })}
                        />
                      }
                    >
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{roundedDieselLtr} L</span>
                    </AppTooltip>
                    {testingDeductionLtr > 0 ? (
                      <p className="mt-0.5 text-[11px] font-normal text-slate-400">{t.testingDeductionNote(testingDeductionLtr)}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-20">
                      <Input type="number" step="any" min="0" value={auditRateDiesel} onChange={(e) => setAuditRateDiesel(e.target.value)} placeholder="0" />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{roundedCurrency(auditDieselAmount)}</td>
                </tr>
                {dayTotals.oilLtr ? (
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-emerald-600">{t.colOil}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">
                      <AppTooltip
                        title={
                          <CalcBreakdown
                            {...pumpLitersTooltip({
                              pumps: [{ label: t.pump2Label, breakdown: pump2OilBreakdown }],
                              fuelLabel: t.colOil,
                              totalLabel: formatLiters(exactOilLtr),
                              note: t.oilExactLitersNote,
                              shiftLabel,
                              nozzleLabel,
                              exact: true,
                            })}
                          />
                        }
                      >
                        <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">
                          {formatLiters(exactOilLtr)}
                        </span>
                      </AppTooltip>
                    </td>
                    <td className="px-3 py-2">
                      <div className="w-20">
                        <Input type="number" step="any" min="0" value={auditRateOil} onChange={(e) => setAuditRateOil(e.target.value)} placeholder="0" />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{roundedCurrency(auditOilAmount)}</td>
                  </tr>
                ) : null}
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-emerald-700">{t.colPocketCane}</td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-right text-slate-600">{roundedCurrency(pocketAndServoOilAmount)}</td>
                </tr>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-800" colSpan={3}>{t.fieldSale}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{roundedCurrency(auditTotalSaleAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.lubricantSalesTitle}</p>
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-slate-400">
                  <th className="px-3 py-2 font-semibold">{t.colProduct}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colCount}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colRate}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {lubricantSalesRows.length ? (
                  lubricantSalesRows.map((row) => (
                    <tr key={row.productId} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{row.name}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{row.qty}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{roundedCurrency(row.rate)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{roundedCurrency(row.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-2 text-slate-400" colSpan={4}>{t.noLubricantSales}</td>
                  </tr>
                )}
                {lubricantOffersApplied > 0 ? (
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-rose-600" colSpan={3}>{t.colOfferApplied}</td>
                    <td className="px-3 py-2 text-right font-semibold text-rose-600">−{roundedCurrency(lubricantOffersApplied)}</td>
                  </tr>
                ) : null}
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-800" colSpan={3}>{t.colPocketCane}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{roundedCurrency(pocketAndServoOilAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.paymentsBreakdownTitle}</p>
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-slate-400">
                  <th className="px-3 py-2 font-semibold">{t.colMethod}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colLitres}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colAmount}</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((row, i) => {
                  const fuel = rowConversionFuel(row)
                  const litres = rowLiters(row, dayTotals)
                  return (
                    <tr key={`${row.kind}-${row.label}-${i}`} className="border-t border-slate-100">
                      <td className={`px-3 py-2 font-medium ${row.kind === 'credit' ? 'text-rose-600' : 'text-slate-700'}`}>
                        {row.label}
                        {row.kind === 'credit' ? (
                          <span className="ml-1.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{t.creditPillLabel}</span>
                        ) : null}
                        {fuel ? (
                          <span
                            className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              fuel === 'petrol' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                            }`}
                          >
                            {fuel === 'petrol' ? t.colPetrol : t.colDiesel}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{litres != null ? `${roundLtr(litres)} L` : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{roundedCurrency(row.amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {remainingExpenseRows.length ? (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.remainingExpensesTitle}</p>
            <div className="max-h-56 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="text-slate-400">
                    <th className="px-3 py-2 font-semibold">{t.colMethod}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.colAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {remainingExpenseRows.map((row, i) => (
                    <tr key={`${row.type}-${row.label}-${i}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-amber-700">
                        {row.label}
                        {row.type === 'employeeCredit' ? (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                            {employeeCreditLabel}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{roundedCurrency(row.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="px-3 py-2 font-bold text-slate-800">{t.totalRemainingExpensesLabel}</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">{roundedCurrency(remainingExpensesTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        </div>

        <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.fuelStockTitle}</p>
          <p className="mb-2 text-xs text-slate-400">{t.stockHint}</p>
          {openingStockSource ? (
            <p className="mb-2 flex items-center gap-1 text-xs font-medium text-brand-600">
              <CalendarDays size={11} className="shrink-0" />
              {openingStockSource.mode === 'none'
                ? t.openingStockNoneNote
                : (openingStockSource.mode === 'saved' ? t.openingStockSavedNote : t.openingStockSourceNote)(
                    formatDate(openingStockSource.logDate),
                    openingStockSource.isShift3 ? t.scopeShift3Label : t.scopeDayLabel,
                  )}
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50">
                <tr className="text-slate-400">
                  <th className="px-3 py-2 font-semibold">{t.colFuel}</th>
                  <th className="px-3 py-2 font-semibold">{t.colOpeningStock}</th>
                  <th className="px-3 py-2 font-semibold">{t.colStockReceived}</th>
                  <th className="px-3 py-2 font-semibold">{t.colCurrentStock}</th>
                  <th className="px-3 py-2 text-right font-semibold">{t.colSoldToday}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-orange-600">{t.colPetrol}</td>
                  <td className="px-3 py-2">
                    <div className="w-28">
                      <Input type="number" step="any" min="0" value={openingStockPetrol} onChange={(e) => setOpeningStockPetrol(e.target.value)} placeholder="0" />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-28">
                      <Input type="number" step="any" min="0" value={stockReceivedPetrol} onChange={(e) => setStockReceivedPetrol(e.target.value)} placeholder="0" />
                    </div>
                  </td>
                  <td className={`px-3 py-2 font-semibold ${currentStockPetrol >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {roundLtr(currentStockPetrol)} L
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{roundedPetrolLtr} L</td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-blue-600">{t.colDiesel}</td>
                  <td className="px-3 py-2">
                    <div className="w-28">
                      <Input type="number" step="any" min="0" value={openingStockDiesel} onChange={(e) => setOpeningStockDiesel(e.target.value)} placeholder="0" />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-28">
                      <Input type="number" step="any" min="0" value={stockReceivedDiesel} onChange={(e) => setStockReceivedDiesel(e.target.value)} placeholder="0" />
                    </div>
                  </td>
                  <td className={`px-3 py-2 font-semibold ${currentStockDiesel >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {roundLtr(currentStockDiesel)} L
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{roundedDieselLtr} L</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3.5">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-rose-700">{t.creditPaidTitle}</p>
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {t.creditPaidNoEffectBadge}
            </span>
          </div>
          <p className="mb-3 text-xs text-rose-700/80">{t.creditPaidHint}</p>

          <form onSubmit={handleAddCreditPayment} className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1">
              <Field label={t.fieldCustomer}>
                <Select
                  value={creditPaymentForm.customerId}
                  onChange={(e) => setCreditPaymentForm({ ...creditPaymentForm, customerId: e.target.value })}
                  disabled={addingCreditPayment}
                >
                  <option value="">{t.selectCustomerPlaceholder}</option>
                  {(creditCustomers || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {t.balanceLabel} {roundedCurrency(closingBalance(c))}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-28 shrink-0">
              <Field label={t.fieldAmount}>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={creditPaymentForm.amount}
                  onChange={(e) => setCreditPaymentForm({ ...creditPaymentForm, amount: e.target.value })}
                  placeholder="0"
                  disabled={addingCreditPayment}
                />
              </Field>
            </div>
            <div className="w-28 shrink-0">
              <Field label={t.fieldMode}>
                <Select
                  value={creditPaymentForm.mode}
                  onChange={(e) => setCreditPaymentForm({ ...creditPaymentForm, mode: e.target.value })}
                  disabled={addingCreditPayment}
                >
                  <option value="Cash">{t.modeLabel.Cash}</option>
                  <option value="Card">{t.modeLabel.Card}</option>
                  <option value="Online">{t.modeLabel.Online}</option>
                </Select>
              </Field>
            </div>
            <PrimaryButton type="submit" className="shrink-0" disabled={addingCreditPayment}>
              {addingCreditPayment ? <Loader2 size={15} className="animate-spin" /> : null}
              {t.addCreditPaymentButton}
            </PrimaryButton>
          </form>

          {todaysCreditPayments.length ? (
            <div className="space-y-1.5">
              <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {todaysCreditPayments.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
                    <span className="min-w-0 truncate font-medium text-slate-700">
                      {row.customerName} <span className="text-slate-400">· {row.mode}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-bold text-emerald-700">{roundedCurrency(row.amount)}</span>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveCreditPayment(row)}
                        disabled={removingCreditPaymentId != null}
                        aria-label={t.removeCreditPayment}
                        title={t.removeCreditPayment}
                        className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {removingCreditPaymentId === row.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-rose-100/60 px-3 py-1.5 text-xs font-bold text-rose-700">
                <span>{t.totalCreditPaidLabel}</span>
                <span>{roundedCurrency(todaysCreditPaymentsTotal)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">{t.noCreditPayments}</p>
          )}
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">{t.overallTitle}</p>
          <p className="mb-3 text-xs text-amber-700/80">{t.overallHint}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t.fieldSale}>
              <Input type="number" step="any" value={editedSale} onChange={(e) => setEditedSale(e.target.value)} />
            </Field>
            <Field label={t.fieldPayments}>
              <Input type="number" step="any" value={editedPayments} onChange={(e) => setEditedPayments(e.target.value)} />
            </Field>
            <Field label={t.fieldVariance}>
              <Input
                type="number"
                step="any"
                value={editedVariance}
                onChange={(e) => setEditedVariance(e.target.value)}
                className={variance >= 0 ? 'text-emerald-700' : 'text-rose-600'}
              />
            </Field>
          </div>
        </div>
        </div>
        </div>

        <Field label={t.remarksLabel}>
          <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t.remarksPlaceholder} rows={2} />
        </Field>

        <div className="border-t border-slate-100 pt-4">
          <Field label={t.contactLabel}>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={t.contactPlaceholder}
            />
          </Field>
          {contactEmail.trim() !== SUGGESTED_AUDIT_EMAIL ? (
            <button
              type="button"
              onClick={() => setContactEmail(SUGGESTED_AUDIT_EMAIL)}
              className="mt-1.5 text-xs font-semibold text-brand-600 hover:underline"
            >
              {t.contactSuggestedHint(SUGGESTED_AUDIT_EMAIL)}
            </button>
          ) : null}
          <p className="mt-1.5 text-xs text-slate-400">{t.sendHint}</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <SecondaryButton type="button" onClick={handleDownload} disabled={sending}>
              <Download size={15} /> {t.downloadButton}
            </SecondaryButton>
            {/* PrimaryButton, not SecondaryButton — this is a real write to
                the database (see saveFuelStockLog), not a passive display
                action. */}
            <PrimaryButton type="button" onClick={handleSaveStock} disabled={savingStock}>
              {savingStock ? <Loader2 size={15} className="animate-spin" /> : null}
              {openingStockSource?.mode === 'saved' ? t.updateStockButton : t.saveStockButton}
            </PrimaryButton>
            <PrimaryButton type="button" onClick={handleSendEmail} disabled={sending}>
              {sendingAction === 'email' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {t.sendWhatsAppButton}
            </PrimaryButton>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!confirmRemoveCreditPayment}
        onClose={() => setConfirmRemoveCreditPayment(null)}
        onConfirm={() => handleRemoveCreditPayment(confirmRemoveCreditPayment)}
        title={t.removeCreditPaymentTitle}
        description={
          confirmRemoveCreditPayment
            ? t.removeCreditPaymentDesc(confirmRemoveCreditPayment.customerName, roundedCurrency(confirmRemoveCreditPayment.amount))
            : ''
        }
        loading={removingCreditPaymentId != null}
      />
    </Modal>
  )
}
