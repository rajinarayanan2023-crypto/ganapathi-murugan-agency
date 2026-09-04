import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Send, Download, ClipboardCheck, X } from 'lucide-react'
import Modal from './Modal.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton } from './FormControls.jsx'
import AppTooltip from './AppTooltip.jsx'
import CalcBreakdown from './CalcBreakdown.jsx'
import { formatDate, formatCurrency, formatLiters } from '../utils/format.js'
import { caneOilRawAmount, NOZZLE_KEYS } from '../utils/fuelCalc.js'
import { closingBalance } from '../data/mockData.js'
import { useLanguage } from '../context/LanguageContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { FUEL_ENTRY_TEXT } from '../i18n/fuelEntry.js'

// Suggested audit recipient — pre-filled but always editable, so the report
// still goes to whoever the manager types in instead.
const SUGGESTED_AUDIT_EMAIL = 'sreeabinayaassociates@gmail.com'

// mailto: can't attach a file (no browser API allows it for security
// reasons), so — same limitation the earlier WhatsApp flow had — this opens
// the manager's email app with the recipient/subject/body pre-filled and the
// report is downloaded alongside for them to attach by hand.
function buildMailtoLink(email, subject, body) {
  return `mailto:${(email || '').trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

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

// A pump's litres for the round-off-formula tooltip: NOT the sum of every
// shift's own (closing − opening − testing) delta rounded once at the end
// (that's what pump.aggregate/dayTotals already give elsewhere) — this is
// the boundary-meter-reading calculation an auditor actually re-derives by
// hand off the physical totalizers: this pump's FIRST shift's opening
// reading and LAST shift's closing reading, each nozzle rounded to a whole
// litre first (the way it's actually read off the meter), subtracted, minus
// every shift's testing litres in between. `entries` must already be
// chronologically sorted (see sortPumpEntries) with carried openings
// applied (see withCarriedOpenings) — same as pump1.entries/pump2.entries.
function pumpFuelBoundaryBreakdown(entries, fuelKey) {
  const list = (entries || []).filter((e) => e?.[fuelKey])
  if (!list.length) return { shifts: [], liters: 0 }

  const shifts = list.map((e) => ({
    shiftNumber: e.shiftNumber,
    opening: NOZZLE_KEYS.reduce((sum, k) => sum + roundLtr(e[fuelKey]?.[k]?.opening), 0),
    closing: NOZZLE_KEYS.reduce((sum, k) => sum + roundLtr(e[fuelKey]?.[k]?.closing), 0),
    testing: NOZZLE_KEYS.reduce((sum, k) => sum + roundLtr(e[fuelKey]?.[k]?.testing), 0),
  }))
  const openingTotal = shifts[0].opening
  const closingTotal = shifts[shifts.length - 1].closing
  const testingTotal = shifts.reduce((sum, s) => sum + s.testing, 0)
  const liters = Math.max(0, closingTotal - openingTotal - testingTotal)
  return { shifts, openingTotal, closingTotal, testingTotal, liters }
}

// Builds the CalcBreakdown content for the Petrol/Diesel round-off-formula
// tooltip: every shift that fed into the boundary calculation above, in
// order, so an auditor can see exactly which readings produced each pump's
// figure — not just the two totals.
function pumpLitersTooltip({ pump1Label, pump2Label, breakdown1, breakdown2, fuelLabel, roundedTotal, note, shiftLabel }) {
  const rows = []
  for (const [pumpLabel, breakdown] of [[pump1Label, breakdown1], [pump2Label, breakdown2]]) {
    for (const shift of breakdown.shifts) {
      rows.push({
        label: `${pumpLabel} · ${shiftLabel(shift.shiftNumber)}`,
        value: `${shift.opening} → ${shift.closing} L${shift.testing ? ` (−${shift.testing})` : ''}`,
      })
    }
    rows.push({ label: `${pumpLabel} Total`, value: `${breakdown.liters} L` })
  }
  return {
    rows,
    formula: `${pump1Label} (${breakdown1.liters} L) + ${pump2Label} (${breakdown2.liters} L) = ${fuelLabel} (${roundedTotal} L)`,
    note,
  }
}

// Builds the CalcBreakdown content for a fuel row's pricing tooltip — same
// idea as the Rate/Litres/Amount columns on the Fuel Entry screen's nozzle
// grid, condensed into one tooltip since this table only has room for a
// single (rounded) Litres figure and a single Amount figure per fuel.
// `exactLiters` must be the unrounded total (before AuditModal's own
// roundLtr) so the rate shown here is the real one, not skewed by rounding.
function pricingTooltip(exactLiters, amount, t) {
  const liters = Number(exactLiters) || 0
  const rate = liters > 0 ? amount / liters : 0
  return {
    rows: [
      { label: t.exactLitersLabel, value: formatLiters(liters) },
      { label: t.rateLabel, value: `${formatCurrency(rate)} / L` },
    ],
    formula: `${formatLiters(liters)} × ${formatCurrency(rate)} = ${formatCurrency(amount)}`,
    note: t.pricingNote,
  }
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
function remainingExpensesBreakdown(entries) {
  const totals = new Map()
  for (const entry of entries || []) {
    for (const p of entry.payments || []) {
      if (isCashPayment(p) || p.type === 'credit') continue
      const label = (p.label || '').trim() || '—'
      totals.set(label, (totals.get(label) || 0) + (Number(p.amount) || 0))
    }
  }
  return [...totals.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount)
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
}) {
  const { language } = useLanguage()
  const t = FUEL_ENTRY_TEXT[language].audit
  const { addLedgerEntry, removeLedgerEntry } = useData()

  // A second, independent audit (e.g. the Shift 3 / price-change report)
  // reuses this exact component but is labeled distinctly, both on screen
  // and in the exported report, so the two are never mistaken for each other.
  const modalTitle = variantLabel ? `${t.modalTitle} — ${variantLabel}` : t.modalTitle
  const reportTitle = variantLabel ? `${t.reportTitle} — ${variantLabel}` : t.reportTitle

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
  // This modal never unmounts between opens (its parent just toggles isOpen),
  // so without this the "Overall Day Total" fields would keep whatever value
  // they had the very first time the modal ever opened — silently drifting
  // out of sync with the live "Entire Day Total" banner above it as more
  // shifts get saved. Re-sync from the current dayTotals every time it opens
  // (the auditor can still type their own override afterward).
  useEffect(() => {
    if (!isOpen) return
    setEditedSale(String(Math.round(dayTotals.totalSaleAmount)))
    setEditedPayments(String(Math.round(dayTotals.totalPayments)))
    setEditedVariance(String(Math.round(dayTotals.excessShortage)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])
  const [contactEmail, setContactEmail] = useState(station?.auditContactEmail || SUGGESTED_AUDIT_EMAIL)
  const [sending, setSending] = useState(false)
  // Opening Stock (what was already in the tank before today's delivery) +
  // Stock Received Today, minus what the meters show as sold today, is
  // what's left right now — the manager types both sides of that balance in.
  const [openingStockPetrol, setOpeningStockPetrol] = useState('')
  const [openingStockDiesel, setOpeningStockDiesel] = useState('')
  const [stockReceivedPetrol, setStockReceivedPetrol] = useState('')
  const [stockReceivedDiesel, setStockReceivedDiesel] = useState('')

  const variance = Number(editedVariance) || 0
  const dayEntries = useMemo(() => [...(pump1.entries || []), ...(pump2.entries || [])], [pump1.entries, pump2.entries])
  // Petrol/Diesel/2T Oil litres for the whole day — rounded to a whole litre
  // ONLY for display here (see roundLtr's own comment), from the exact same
  // `dayTotals`/`pump1.aggregate`/`pump2.aggregate` figures (aggregateEntries
  // in fuelCalc.js) the rest of the app already shows for this date — the
  // Entire Day Total banner, the Entry History table, the CSV export. Each
  // pump's own reading used to derive its litres independently (rounding
  // each shift's opening/closing to a whole number first, then subtracting)
  // used to produce a different total than that shared figure whenever a
  // reading wasn't a whole number — this rounds the one true total once,
  // instead, so the audit report can never disagree with every other screen
  // that shows "litres sold today" for the same date.
  const roundedPetrolLtr = roundLtr(dayTotals.petrolLtr)
  const roundedDieselLtr = roundLtr(dayTotals.dieselLtr)
  const roundedOilLtr = roundLtr(dayTotals.oilLtr)
  // Same totals roundedPetrolLtr/roundedDieselLtr add up to, kept separately
  // for the round-off-formula tooltip on those two rows — each pump's own
  // exact figure, rounded the same way, so the breakdown reads consistently
  // with the combined total (a ±1L rounding gap between the two halves and
  // their already-rounded sum is possible, same as any two numbers rounded
  // independently — never the larger, unpredictable mismatch the old
  // per-boundary-reading method could produce).
  const pump1PetrolBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump1.entries, 'petrol'), [pump1.entries])
  const pump2PetrolBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump2.entries, 'petrol'), [pump2.entries])
  const pump1DieselBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump1.entries, 'diesel'), [pump1.entries])
  const pump2DieselBreakdown = useMemo(() => pumpFuelBoundaryBreakdown(pump2.entries, 'diesel'), [pump2.entries])
  const shiftLabel = FUEL_ENTRY_TEXT[language].pumpEditor.shiftLabel
  const currentStockPetrol = (Number(openingStockPetrol) || 0) + (Number(stockReceivedPetrol) || 0) - roundedPetrolLtr
  const currentStockDiesel = (Number(openingStockDiesel) || 0) + (Number(stockReceivedDiesel) || 0) - roundedDieselLtr
  const paymentRows = useMemo(() => combinedPaymentRows(dayEntries, creditCustomers), [dayEntries, creditCustomers])
  const remainingExpenseRows = useMemo(() => remainingExpensesBreakdown(dayEntries), [dayEntries])
  const remainingExpensesTotal = useMemo(() => remainingExpenseRows.reduce((sum, r) => sum + r.amount, 0), [remainingExpenseRows])
  const pocketAndServoOilAmount = dayTotals.pocketOilTotal + dayTotals.caneOilTotal
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

  function handleAddCreditPayment(e) {
    e.preventDefault()
    const amount = Number(creditPaymentForm.amount)
    if (!creditPaymentForm.customerId) {
      toast.error(t.errorSelectCustomer)
      return
    }
    if (!amount) {
      toast.error(t.errorCreditAmount)
      return
    }
    addLedgerEntry(creditPaymentForm.customerId, {
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
  }

  // Undo a mistaken entry — whether it was added here or on the Credit Bills
  // page, as long as it's a payment dated to this audit's day it shows up in
  // the list above, so it should be removable from right here too.
  function handleRemoveCreditPayment(row) {
    removeLedgerEntry(row.customerId, row.id)
    toast.success(t.toastCreditPaymentRemoved)
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
    const header = sheet.addRow([t.colFuel, t.colLitres, t.colAmount])
    header.font = { bold: true }
    sheet.addRow([t.colPetrol, roundedPetrolLtr, roundedCurrency(dayTotals.petrolAmount)])
    sheet.addRow([t.colDiesel, roundedDieselLtr, roundedCurrency(dayTotals.dieselAmount)])
    if (dayTotals.oilLtr) sheet.addRow([t.colOil, roundedOilLtr, roundedCurrency(dayTotals.oilAmount)])
    sheet.addRow([t.colPocketCane, '—', roundedCurrency(pocketAndServoOilAmount)])
    sheet.addRow([t.fieldSale, '', roundedCurrency(dayTotals.totalSaleAmount)]).font = { bold: true }
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
        sheet.addRow([row.label, roundedCurrency(row.amount)])
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
    setSending(true)
    try {
      downloadBlob(await buildWorkbookBlob())
      toast.success(t.toastDownloaded)
    } finally {
      setSending(false)
    }
  }

  async function handleSendEmail() {
    if (!contactEmail.trim()) {
      toast.error(t.contactRequired)
      return
    }
    // Must be the very first thing in this click handler — opening a mailto:
    // link is only reliably treated as a direct response to the click (not
    // blocked as a pop-up) when it's the first thing the handler does;
    // building the file (below, async) has to happen after this.
    const subject = `${station?.name || ''} — ${reportTitle} — ${formatDate(date)}`
    const body = t.whatsAppMessage(
      station?.name || '',
      formatDate(date),
      roundedCurrency(Number(editedSale) || 0),
      roundedCurrency(Number(editedPayments) || 0),
      `${t.fieldVariance}: ${variance >= 0 ? '+' : ''}${roundedCurrency(variance)}`,
    )
    window.location.href = buildMailtoLink(contactEmail, subject, body)
    onUpdateAuditContact?.(contactEmail.trim())

    setSending(true)
    try {
      downloadBlob(await buildWorkbookBlob())
      toast.success(t.toastSent)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} maxWidth="max-w-7xl">
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
                            pump1Label: t.pump1Label,
                            pump2Label: t.pump2Label,
                            breakdown1: pump1PetrolBreakdown,
                            breakdown2: pump2PetrolBreakdown,
                            fuelLabel: t.colPetrol,
                            roundedTotal: roundedPetrolLtr,
                            note: t.litersRoundOffNote,
                            shiftLabel,
                          })}
                        />
                      }
                    >
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{roundedPetrolLtr} L</span>
                    </AppTooltip>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    <AppTooltip title={<CalcBreakdown {...pricingTooltip(dayTotals.petrolLtr, dayTotals.petrolAmount, t)} />}>
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">
                        {roundedCurrency(dayTotals.petrolAmount)}
                      </span>
                    </AppTooltip>
                  </td>
                </tr>
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-blue-600">{t.colDiesel}</td>
                  <td className="px-3 py-2 font-semibold text-slate-700">
                    <AppTooltip
                      title={
                        <CalcBreakdown
                          {...pumpLitersTooltip({
                            pump1Label: t.pump1Label,
                            pump2Label: t.pump2Label,
                            breakdown1: pump1DieselBreakdown,
                            breakdown2: pump2DieselBreakdown,
                            fuelLabel: t.colDiesel,
                            roundedTotal: roundedDieselLtr,
                            note: t.litersRoundOffNote,
                            shiftLabel,
                          })}
                        />
                      }
                    >
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{roundedDieselLtr} L</span>
                    </AppTooltip>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    <AppTooltip title={<CalcBreakdown {...pricingTooltip(dayTotals.dieselLtr, dayTotals.dieselAmount, t)} />}>
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">
                        {roundedCurrency(dayTotals.dieselAmount)}
                      </span>
                    </AppTooltip>
                  </td>
                </tr>
                {dayTotals.oilLtr ? (
                  <tr className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-emerald-600">{t.colOil}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{roundedOilLtr} L</td>
                    <td className="px-3 py-2 text-right text-slate-600">
                      <AppTooltip title={<CalcBreakdown {...pricingTooltip(dayTotals.oilLtr, dayTotals.oilAmount, t)} />}>
                        <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">
                          {roundedCurrency(dayTotals.oilAmount)}
                        </span>
                      </AppTooltip>
                    </td>
                  </tr>
                ) : null}
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-emerald-700">{t.colPocketCane}</td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-right text-slate-600">{roundedCurrency(pocketAndServoOilAmount)}</td>
                </tr>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="px-3 py-2 font-bold text-slate-800" colSpan={2}>{t.fieldSale}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-800">{roundedCurrency(dayTotals.totalSaleAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.lubricantSalesTitle}</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50">
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
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50">
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
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-slate-400">
                    <th className="px-3 py-2 font-semibold">{t.colMethod}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t.colAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {remainingExpenseRows.map((row) => (
                    <tr key={row.label} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-amber-700">{row.label}</td>
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
                />
              </Field>
            </div>
            <div className="w-28 shrink-0">
              <Field label={t.fieldMode}>
                <Select value={creditPaymentForm.mode} onChange={(e) => setCreditPaymentForm({ ...creditPaymentForm, mode: e.target.value })}>
                  <option value="Cash">{t.modeLabel.Cash}</option>
                  <option value="Card">{t.modeLabel.Card}</option>
                  <option value="Online">{t.modeLabel.Online}</option>
                </Select>
              </Field>
            </div>
            <PrimaryButton type="submit" className="shrink-0">
              {t.addCreditPaymentButton}
            </PrimaryButton>
          </form>

          {todaysCreditPayments.length ? (
            <div className="space-y-1.5">
              {todaysCreditPayments.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-xs">
                  <span className="min-w-0 truncate font-medium text-slate-700">
                    {row.customerName} <span className="text-slate-400">· {row.mode}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="font-bold text-emerald-700">{roundedCurrency(row.amount)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCreditPayment(row)}
                      aria-label={t.removeCreditPayment}
                      title={t.removeCreditPayment}
                      className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                    >
                      <X size={13} />
                    </button>
                  </span>
                </div>
              ))}
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
            <PrimaryButton type="button" onClick={handleSendEmail} disabled={sending}>
              <Send size={15} /> {t.sendWhatsAppButton}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </Modal>
  )
}
