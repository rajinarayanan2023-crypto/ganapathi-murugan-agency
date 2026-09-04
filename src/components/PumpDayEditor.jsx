import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  Plus,
  X,
  Landmark,
  Droplet,
  Coins,
  Receipt,
  Fuel,
  Upload,
  Paperclip,
  StickyNote,
  Save,
  CloudUpload,
  AlertTriangle,
  TrendingUp,
  Trash2,
} from 'lucide-react'
import {
  FUEL_KEYS_BY_PUMP,
  NOZZLE_KEYS,
  readingLiters,
  readingAmount,
  entryFuelAmount,
  entryFuelLiters,
  shiftSaleAmount,
  paymentsTotal,
  emptyShiftEntry,
  emptyPaymentLine,
  emptyOilRow,
  emptyCaneOilRow,
  pocketOilAmount,
  caneOilAmount,
  sortPumpEntries,
  withCarriedOpenings,
  aggregateEntries,
  PAYMENT_METHOD_OPTIONS,
} from '../utils/fuelCalc.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { currentRate, purchaseBatchesByCost, sortedPriceHistory, stockAvailableAtRate, availableAtRateBreakdown, round3 } from '../utils/lubricants.js'
import { uploadBillFile, getDownloadUrl, deleteUpload } from '../lib/apiClient.js'
import { Input, Select, Textarea, IconButton, PrimaryButton, SecondaryButton } from './FormControls.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import AppTooltip from './AppTooltip.jsx'
import CalcBreakdown from './CalcBreakdown.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { FUEL_ENTRY_TEXT } from '../i18n/fuelEntry.js'

function makeBillId() {
  return `bill-${Math.random().toString(36).slice(2, 9)}`
}

// A labeled on/off switch — used for turning the 2nd/3rd shift employee on
// or off, instead of a plain "Add" button, so the pump header reads like a
// small settings row rather than a growing list of one-shot action buttons.
function ToggleSwitch({ checked, onChange, label, disabled, title }) {
  return (
    <label className={`flex items-center gap-2 select-none ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`} title={title}>
      <span className="text-sm font-semibold text-slate-600">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-200'}`}
      >
        <motion.span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
          initial={false}
          animate={{ left: checked ? '1.375rem' : '0.125rem' }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      </button>
    </label>
  )
}

const TINTS = {
  violet: { bg: 'bg-violet-100/70', border: 'border-violet-200' },
  blue: { bg: 'bg-blue-50/60', border: 'border-blue-100' },
}

// Distinct color per fuel type so Petrol/Diesel/Oil rows are tellable apart
// at a glance instead of all reading as the same muted gray label.
const FUEL_LABEL_COLORS = {
  petrol: 'text-orange-600',
  diesel: 'text-blue-600',
  oil: 'text-emerald-600',
}


// A currency figure that pops in whenever its displayed value actually
// changes (so totals updating as someone types is visible, not just a
// silent swap), and can "breathe" with a slow pulse for a figure that
// needs the manager's attention right now (a shortfall).
function AnimatedFigure({ value, signed = false, pulse = false, className = '' }) {
  const formatted = formatCurrency(value)
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={formatted}
        initial={{ opacity: 0, y: -6, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: pulse ? [1, 1.05, 1] : 1 }}
        transition={
          pulse
            ? { scale: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.22 }, y: { duration: 0.22 } }
            : { duration: 0.22, ease: 'easeOut' }
        }
        className={`inline-block ${className}`}
      >
        {signed && value >= 0 ? '+' : ''}
        {formatted}
      </motion.span>
    </AnimatePresence>
  )
}

// Payment-line labels that represent physical cash — these get the
// note/coin counter icon, whichever shift the cash was collected in.
const CASH_LABELS = new Set(['cash', 'day cash', 'night cash'])

// Which fuel a payment method's litres are converted at. Methods that name
// their fuel in the label (Card/QR (Petrol/Diesel)) use that directly;
// methods that don't (Company QR, Extra QR/Power/Reward) settle against one
// particular fuel at this station by fixed convention — Extra Test has no
// fixed fuel, so it's left unconverted.
const DIESEL_CONVENTION_LABELS = new Set(['company qr', 'extra power'])
const PETROL_CONVENTION_LABELS = new Set(['extra qr', 'extra reward'])
function paymentConversionFuel(label) {
  const lbl = (label || '').trim().toLowerCase()
  if (CASH_LABELS.has(lbl)) return null
  if (lbl.includes('petrol') || PETROL_CONVENTION_LABELS.has(lbl)) return 'petrol'
  if (lbl.includes('diesel') || DIESEL_CONVENTION_LABELS.has(lbl)) return 'diesel'
  return null
}

// A cash line at or above this is treated as "big cash" — worth a blinking
// highlight so it doesn't get glossed over while scanning the list.
const BIG_CASH_THRESHOLD = 50000

// Notes counted at these face values; anything smaller is lumped into one
// "coins" total rather than tracked coin-by-coin.
const NOTE_VALUES = [500, 200, 100, 50, 20, 10]

function denominationTotal(denominations) {
  if (!denominations) return 0
  const notesTotal = NOTE_VALUES.reduce((sum, note) => sum + note * (Number(denominations[note]) || 0), 0)
  return notesTotal + (Number(denominations.coins) || 0)
}

// Clamps a typed count so it can never exceed the product's available stock
// (when a product is selected and its stock is known).
function clampToStock(v, available) {
  if (v === '') return ''
  const n = Number(v)
  if (Number.isNaN(n)) return v
  const max = available == null ? Infinity : available
  return String(Math.min(Math.max(n, 0), max))
}

// The same product at the same rate should only ever be one row — picking
// it again in a second row is almost always a mistake (the manager meant to
// add to the existing row's count instead). Returns the set of row ids that
// share a (productId, rate) pair with at least one other row in the list;
// rows still missing either field are never flagged (nothing to conflict on
// yet). Pocket oil and cane oil are checked as two separate lists, never
// against each other.
function duplicateRowIds(rows) {
  const seen = new Map()
  for (const row of rows || []) {
    if (!row.productId || !row.stockRate) continue
    const key = `${row.productId}::${row.stockRate}`
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(row.id)
  }
  const duplicates = new Set()
  for (const ids of seen.values()) {
    if (ids.length > 1) ids.forEach((id) => duplicates.add(id))
  }
  return duplicates
}

// Every rate the product has ever sold at (its price history), most recent
// first and de-duplicated — the manager picks which one applies to this
// sale instead of typing a number freely.
function priceOptions(product) {
  const seen = new Set()
  const opts = []
  for (const entry of [...sortedPriceHistory(product)].reverse()) {
    if (seen.has(entry.rate)) continue
    seen.add(entry.rate)
    opts.push(entry.rate)
  }
  return opts
}

// Small chip row showing how many units of the selected product were bought
// at each distinct cost — e.g. "20 @ ₹260   10 @ ₹280" — so the manager can
// see the stock's purchase makeup at a glance. Only shown when purchases
// span more than one rate; at a single rate the combined "Available" count
// already says everything this row would, so it stays hidden to avoid
// repeating the same number twice.
function PurchaseBatches({ t, product }) {
  const batches = purchaseBatchesByCost(product)
  if (batches.length <= 1) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span className="font-semibold text-slate-500">{t.batchesLabel}:</span>
      {batches.map((b) => (
        <span key={b.cost} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
          {b.qty} @ {formatCurrency(b.cost)}
        </span>
      ))}
    </div>
  )
}

// One row of "sold by count, not by nozzle" oil — Product/Count/Rate → Amount.
// Shared by both the Pocket and Cane oil sections, which are otherwise
// identical (each supports multiple rows via its own "Add more" button).
// Rate and Count always update together through one callback — updating
// them via two separate calls let the second silently clobber the first
// (both closed over the same not-yet-updated `value`), so a rate change
// could get lost the instant it also re-clamped the count.
function OilRow({ t, lubricants, productId, onSelectProduct, count, rate, onRateAndCountChange, amount, onRemove, showRemove, isDuplicate }) {
  const selectedProduct = (lubricants || []).find((p) => p.id === productId)
  const available = selectedProduct ? (rate ? stockAvailableAtRate(selectedProduct, rate) : round3(Number(selectedProduct.stock) || 0)) : null

  // Same breakdown stockAvailableAtRate() itself used to reach `available` —
  // read fresh from the live product/rate every render, so the tooltip can
  // never show a number that disagrees with the clamp actually applied above.
  const availableBreakdown = selectedProduct
    ? rate
      ? availableAtRateBreakdown(selectedProduct, rate)
      : { available, totalStock: Number(selectedProduct.stock) || 0, singleRate: true }
    : null
  const availableTooltipRows = availableBreakdown
    ? availableBreakdown.singleRate || availableBreakdown.rateNotFound
      ? [{ label: t.currentStockLabel, value: `${availableBreakdown.totalStock} ${selectedProduct.unit}` }]
      : [
          { label: t.purchasedInPeriodLabel, value: `${availableBreakdown.purchasedInPeriod} ${selectedProduct.unit}` },
          { label: t.currentStockLabel, value: `${availableBreakdown.totalStock} ${selectedProduct.unit}` },
        ]
    : []
  const availableTooltipFormula = availableBreakdown
    ? availableBreakdown.singleRate
      ? `${t.currentStockLabel} (${availableBreakdown.totalStock}) = ${t.availableLabel} (${available} ${selectedProduct.unit})`
      : availableBreakdown.rateNotFound
        ? t.rateNotInHistoryNote
        : `min(${t.purchasedInPeriodLabel} ${availableBreakdown.purchasedInPeriod}, ${t.currentStockLabel} ${availableBreakdown.totalStock}) = ${t.availableLabel} (${available} ${selectedProduct.unit})`
    : ''
  const availableTooltipNote = availableBreakdown && !availableBreakdown.singleRate && !availableBreakdown.rateNotFound ? t.availableApproxNote : undefined

  function handleCountChange(v) {
    onRateAndCountChange(rate, clampToStock(v, available))
  }

  function handleRateChange(newRate) {
    if (selectedProduct && newRate) {
      const newAvailable = stockAvailableAtRate(selectedProduct, newRate)
      onRateAndCountChange(newRate, Number(count) > newAvailable ? String(newAvailable) : count)
    } else {
      onRateAndCountChange(newRate, count)
    }
  }

  return (
    <div>
      <div className="flex flex-nowrap items-center gap-1.5">
        <span className="shrink-0 text-xs font-semibold text-slate-600">{t.oilProductLabel}</span>
        <div className="min-w-[130px] flex-[2]">
          <Select
            value={productId || ''}
            onChange={(e) => onSelectProduct(e.target.value)}
            className={`text-xs ${isDuplicate ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : ''}`}
          >
            <option value="">{t.selectProduct}</option>
            {(lubricants || []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </div>
        <span className="shrink-0 text-xs font-semibold text-slate-600">{t.rate}</span>
        <div className="min-w-[80px] flex-1">
          <Select
            value={rate || ''}
            onChange={(e) => handleRateChange(e.target.value)}
            disabled={!selectedProduct}
            title={t.oilStockRateHint}
            className={`text-xs ${isDuplicate ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : ''}`}
          >
            <option value="">{t.selectRate}</option>
            {priceOptions(selectedProduct).map((r) => (
              <option key={r} value={r}>
                {formatCurrency(r)}
              </option>
            ))}
          </Select>
        </div>
        {selectedProduct ? (
          <AppTooltip title={<CalcBreakdown rows={availableTooltipRows} formula={availableTooltipFormula} note={availableTooltipNote} />}>
            <span className="shrink-0 cursor-help whitespace-nowrap text-xs font-medium text-slate-500">
              <span className="underline decoration-dotted decoration-slate-300 underline-offset-4">{t.availableLabel}</span>:{' '}
              <span className="font-bold text-slate-700">{available} {selectedProduct.unit}</span>
            </span>
          </AppTooltip>
        ) : null}
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-600">{t.soldCountLabel}</span>
        <div className="min-w-[70px] flex-1">
          <Input
            type="number"
            min="0"
            max={available ?? undefined}
            step="any"
            value={count || ''}
            onChange={(e) => handleCountChange(e.target.value)}
            placeholder="0"
            title={available != null ? t.soldCountHint(available) : undefined}
            className="text-xs"
          />
        </div>
        <span className="shrink-0 text-xs font-semibold text-slate-600">{t.amount}:</span>
        <div className="min-w-[100px] flex-[1.5]">
          <Input value={formatCurrency(amount)} readOnly disabled className="bg-slate-50 text-xs font-bold text-emerald-700" />
        </div>
        {showRemove ? (
          <IconButton onClick={onRemove} aria-label={t.removeOilRow} title={t.removeOilRow} tone="delete">
            <X size={15} />
          </IconButton>
        ) : null}
      </div>
      {selectedProduct ? <PurchaseBatches t={t} product={selectedProduct} /> : null}
      {isDuplicate ? <p className="mt-1.5 text-xs font-medium text-rose-500">{t.duplicateOilRowHint}</p> : null}
    </div>
  )
}

// One employee's shift — a fully independent, separately-saved record.
// There's no "Save as Draft" button: any edit here quietly persists itself
// (debounced) as a draft, so switching pages or refreshing the browser
// never loses progress. "Save Entry" stays a deliberate action — it's the
// only thing that finalizes a shift (requires bills, applies attendance/
// credit/stock effects) — so autosave never touches an already-final shift.
function ShiftCard({
  t,
  tRoot,
  pumpKey,
  value,
  onChange,
  isDerivedOpening,
  employees,
  unavailableEmployeeIds,
  creditCustomers,
  lubricants,
  onSaveDraft,
  onSaveFinal,
  savingFinal,
  onDiscardDraft,
}) {
  const fuelKeys = FUEL_KEYS_BY_PUMP[pumpKey]
  // Employees marked absent/leave/duty-off for this shift's date shouldn't
  // be assignable to work it — but never hide whoever is ALREADY assigned
  // just because their attendance was (perhaps later) marked that way; that
  // would leave this dropdown showing blank for an existing selection.
  const assignableEmployees = useMemo(
    () => employees.filter((emp) => emp.id === value.employeeId || !unavailableEmployeeIds?.has(emp.id)),
    [employees, unavailableEmployeeIds, value.employeeId],
  )
  // This shift's own sale/payments/excess — not every shift on this pump
  // added together. Only the top-level "Entire Day Total" (in FuelEntryForm,
  // above the pump tabs) is meant to combine every shift across both pumps;
  // this block sits right above this one shift's own Save button, so it
  // should read as this shift's own totals, not the pump's.
  const shiftTotals = useMemo(() => aggregateEntries([value]), [value])
  // Readings and payments each used to just run one after another, making
  // the card very long — splitting them into tabs lets the manager focus on
  // one job (meter readings, then payments) without scrolling past the other.
  const [activeShiftTab, setActiveShiftTab] = useState('reading')
  const [openDenomId, setOpenDenomId] = useState(null)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)
  const [autoSaveStatus, setAutoSaveStatus] = useState('idle') // 'idle' | 'pending' | 'saved'
  const [uploadingBill, setUploadingBill] = useState(false)
  // Id of a just-added payment line still waiting to be scrolled to and
  // focused — set by the add* functions below, consumed by the effect right
  // after this one.
  const [pendingFocusId, setPendingFocusId] = useState(null)
  const paymentRowRefs = useRef(new Map())
  const oilRowRefs = useRef(new Map())
  // Id of a just-added oil/cane-oil row still briefly highlighted so it's
  // obvious where the new row landed — cleared automatically a moment later.
  const [highlightedRowId, setHighlightedRowId] = useState(null)
  useEffect(() => {
    if (!highlightedRowId) return
    const timer = setTimeout(() => setHighlightedRowId(null), 1400)
    return () => clearTimeout(timer)
  }, [highlightedRowId])
  // Prepends a new row (oil/cane-oil rows are added to the top, same as
  // payment lines below) and queues it to be scrolled to, focused, and
  // briefly highlighted, so a row added while scrolled elsewhere in a long
  // list is impossible to miss.
  function flashRow(id) {
    setPendingFocusId(id)
    setHighlightedRowId(id)
  }

  // New lines are prepended (see addPaymentLine etc. below), which can land
  // above whatever the manager has scrolled to — inside this list's own
  // internal scroll area, the tab content, or the page itself. scrollIntoView
  // walks every scrollable ancestor, so one call handles all of those at
  // once; focusing the row's first control then puts the cursor right where
  // they'd type/select next, instead of making them go hunting for the row.
  useEffect(() => {
    if (!pendingFocusId) return
    const row = paymentRowRefs.current.get(pendingFocusId) || oilRowRefs.current.get(pendingFocusId)
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    row?.querySelector('input, button, select')?.focus()
    setPendingFocusId(null)
  }, [pendingFocusId])

  // Snapshot of `value` as of the last time this effect actually scheduled a
  // save (or, initially, as of first render) — comparing by reference rather
  // than a one-shot boolean flag survives React StrictMode's dev-only double
  // invocation of effects, which would otherwise consume a "skip the first
  // run" flag on its extra invocation and fire a phantom save on mount.
  const lastSeenValue = useRef(value)

  // Lets a manual save (handleSaveFinalClick below) cancel a pending
  // autosave outright, instead of leaving its setTimeout free to fire a
  // draft PUT for the same fuel entry moments after (or during) the manual
  // save's own PUT — two concurrent writes to the same entry each try to
  // replace its Fuel_Readings rows, and the second one's INSERT can land
  // before the first's DELETE is visible to it, hitting
  // uq_fuel_readings_entry_type_nozzle.
  const autoSaveTimerRef = useRef(null)

  // Debounced autosave — waits for a pause in typing before persisting, and
  // never fires on mount (that would just re-save data that's already
  // exactly as loaded) or once the shift has been finalized.
  useEffect(() => {
    if (value.status === 'final') return
    if (value === lastSeenValue.current) return
    lastSeenValue.current = value
    setAutoSaveStatus('pending')
    const timer = setTimeout(() => {
      autoSaveTimerRef.current = null
      onSaveDraft(value)
      setAutoSaveStatus('saved')
    }, 900)
    autoSaveTimerRef.current = timer
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const packetProducts = (lubricants || []).filter((p) => p.packaging !== 'cane')
  const caneProducts = (lubricants || []).filter((p) => p.packaging === 'cane')

  function updateReading(fuelKey, nozzleKey, field, v) {
    onChange({ ...value, [fuelKey]: { ...value[fuelKey], [nozzleKey]: { ...value[fuelKey][nozzleKey], [field]: v } } })
  }

  function updatePayments(updater) {
    onChange({ ...value, payments: updater(value.payments || []) })
  }

  // Litres a payment line's amount represents, at this shift's own average
  // fuel rate — worked out from the label (Petrol/Diesel) rather than typed
  // separately, since a payment is always for one fuel or the other. Cash
  // lines skip this (a cash line commonly covers a mix of fuels, so there's
  // no single rate to divide by).
  const petrolLtrThisShift = entryFuelLiters(value, 'petrol')
  const petrolRateThisShift = petrolLtrThisShift > 0 ? entryFuelAmount(value, 'petrol') / petrolLtrThisShift : 0
  const dieselLtrThisShift = entryFuelLiters(value, 'diesel')
  const dieselRateThisShift = dieselLtrThisShift > 0 ? entryFuelAmount(value, 'diesel') / dieselLtrThisShift : 0
  function paymentLiters(p) {
    const fuel = paymentConversionFuel(p.label)
    if (!fuel) return null
    const amount = Number(p.amount) || 0
    if (!amount) return null
    if (fuel === 'petrol' && petrolRateThisShift > 0) return amount / petrolRateThisShift
    if (fuel === 'diesel' && dieselRateThisShift > 0) return amount / dieselRateThisShift
    return null
  }

  // New lines go at the top, not the bottom — the manager just clicked one
  // of the "Add..." buttons above the list, so the row they're about to fill
  // in should appear right there instead of making them scroll past every
  // existing line to find it. Each one also queues itself to be scrolled to
  // and focused (see the pendingFocusId effect above).
  function addPaymentLine() {
    const line = emptyPaymentLine()
    updatePayments((payments) => [line, ...payments])
    setPendingFocusId(line.id)
    toast.success(t.toastLineAdded)
  }
  function addCreditLine() {
    const line = emptyPaymentLine(t.creditLabel, 'credit')
    updatePayments((payments) => [line, ...payments])
    setPendingFocusId(line.id)
    toast.success(t.toastCreditLineAdded)
  }
  function addEmployeeCreditLine() {
    const line = emptyPaymentLine(t.employeeCreditLabel, 'employeeCredit')
    updatePayments((payments) => [line, ...payments])
    setPendingFocusId(line.id)
    toast.success(t.toastEmployeeCreditLineAdded)
  }
  function addExpenseLine() {
    const line = emptyPaymentLine('', 'expense')
    updatePayments((payments) => [line, ...payments])
    setPendingFocusId(line.id)
    toast.success(t.toastExpenseLineAdded)
  }
  function updatePaymentLine(id, field, v) {
    updatePayments((payments) => payments.map((p) => (p.id === id ? { ...p, [field]: v } : p)))
  }
  function removePaymentLine(id) {
    updatePayments((payments) => payments.filter((p) => p.id !== id))
  }
  function updateDenomination(paymentId, key, v) {
    updatePayments((payments) =>
      payments.map((p) => {
        if (p.id !== paymentId) return p
        const denominations = { ...(p.denominations || {}), [key]: v }
        return { ...p, denominations, amount: denominationTotal(denominations) }
      }),
    )
  }

  function updateBills(updater) {
    onChange({ ...value, bills: updater(value.bills || []) })
  }
  async function handleBillFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingBill(true)
    try {
      // Uploads straight to S3 (see apiClient.uploadBillFile) — the backend
      // only ever learns the resulting key, on the next save, never the
      // file bytes themselves. `url` here holds that key, unchanged, for as
      // long as this bill sits untouched — that's what lets the backend's
      // own diff-on-save recognize it as the same bill and skip re-touching
      // it in S3 or Postgres.
      const { name, key } = await uploadBillFile(file, 'fuel-entry-bills')
      const newBill = { id: makeBillId(), name, url: key, date: todayISO() }
      updateBills((bills) => [...bills, newBill])
      toast.success(tRoot.toastBillAttached(file.name))
    } catch (err) {
      toast.error(err.message || tRoot.toastSaveFailed)
    } finally {
      setUploadingBill(false)
    }
  }
  // Local-only splice — the shift itself isn't saved here, so nothing tells
  // the backend a bill disappeared until the next autosave/save. A bill
  // attached and removed again within that same window (before any save
  // ever included it) would otherwise leak in S3 forever with no DB row
  // left to ever clean it up from — so this deletes the S3 object directly,
  // right away, rather than waiting on a save that might not come.
  async function removeBill(billId) {
    const bill = (value.bills || []).find((b) => b.id === billId)
    updateBills((bills) => bills.filter((b) => b.id !== billId))
    toast.success(tRoot.toastBillRemoved)
    if (bill?.url) {
      try {
        await deleteUpload(bill.url)
      } catch {
        // Best-effort: if this one call fails, the next save's own
        // backend-side diff (see fuel_entry_service.py) still catches the
        // removal and retries the S3 delete from there.
      }
    }
  }
  // Presigned GET URLs expire, so one is fetched fresh right when the
  // manager actually clicks to view a bill — never pre-fetched for the
  // whole list up front.
  async function openBill(bill) {
    try {
      const url = await getDownloadUrl(bill.url)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      toast.error(err.message || tRoot.toastSaveFailed)
    }
  }

  function addOilRow() {
    const row = emptyOilRow('oil')
    onChange({ ...value, oilRows: [row, ...(value.oilRows || [])] })
    flashRow(row.id)
  }
  function removeOilRow(id) {
    onChange({ ...value, oilRows: value.oilRows.filter((row) => row.id !== id) })
  }
  // Switching products mid-row has to clear the old Sold Count too — it was
  // a count of the PREVIOUS product, and leaving it in place (even clamped)
  // meant the new product's Amount could silently be based on a stock level
  // that was never actually checked against it.
  function selectOilRowProduct(id, productId) {
    const product = (lubricants || []).find((p) => p.id === productId)
    onChange({
      ...value,
      oilRows: value.oilRows.map((row) => (row.id === id ? { ...row, productId, stockRate: product ? currentRate(product) : '', stockCount: '' } : row)),
    })
  }

  function addCaneOilRow() {
    const row = emptyCaneOilRow()
    onChange({ ...value, caneOilRows: [row, ...(value.caneOilRows || [])] })
    flashRow(row.id)
  }
  function removeCaneOilRow(id) {
    onChange({ ...value, caneOilRows: value.caneOilRows.filter((row) => row.id !== id) })
  }
  function selectCaneOilRowProduct(id, productId) {
    const product = (lubricants || []).find((p) => p.id === productId)
    onChange({
      ...value,
      caneOilRows: value.caneOilRows.map((row) =>
        row.id === id ? { ...row, productId, stockRate: product ? currentRate(product) : '', stockCount: '' } : row,
      ),
    })
  }

  const pocketOilStockAmount = pocketOilAmount(value)
  const caneOilStockAmount = caneOilAmount(value)
  const shiftTotal = shiftSaleAmount(value)
  const paymentsCollected = paymentsTotal(value.payments)
  // Same four/five numbers shiftSaleAmount() itself adds together, laid out
  // for the tooltip below — read straight off `value`, so it's exactly what
  // shiftTotal was just computed from, never a separately-cached copy.
  const petrolSaleAmount = entryFuelAmount(value, 'petrol')
  const dieselSaleAmount = entryFuelAmount(value, 'diesel')
  const oilSaleAmount = pumpKey === 'pump2' ? entryFuelAmount(value, 'oil') : 0
  const shiftTotalBreakdownRows = [
    { label: t.fuelLabels.petrol, value: formatCurrency(petrolSaleAmount) },
    { label: t.fuelLabels.diesel, value: formatCurrency(dieselSaleAmount) },
  ]
  if (pumpKey === 'pump2') {
    shiftTotalBreakdownRows.push({ label: t.fuelLabels.oil, value: formatCurrency(oilSaleAmount) })
    shiftTotalBreakdownRows.push({ label: t.pocketOilLabel, value: formatCurrency(pocketOilStockAmount) })
    shiftTotalBreakdownRows.push({ label: t.caneOilLabel, value: formatCurrency(caneOilStockAmount) })
  }
  const shiftTotalFormula = `${shiftTotalBreakdownRows.map((r) => `${r.label} (${r.value})`).join(' + ')} = ${t.shiftTotalLabel} (${formatCurrency(shiftTotal)})`
  // Bill-upload requirement temporarily disabled — restore the commented
  // condition below (and in handleSaveFinalClick, and the backend's
  // create()/update() in fuel_entry_service.py) to bring it back.
  const shiftBillsMissing = false // attemptedSubmit && (!value.bills || value.bills.length === 0)
  const shiftEmployeeMissing = attemptedSubmit && !value.employeeId
  const isDraft = value.status === 'draft'
  // A blank/just-discarded shift is internally `status: 'draft'` too (that's
  // what makes it autosave-eligible), but there's nothing real to discard
  // until it's actually been autosaved with an id — same condition the
  // "Draft" badge above already uses, so the two stay in sync.
  const hasDraftToDiscard = isDraft && Boolean(value.id)
  // Same product at the same rate should only ever be one row — checked
  // separately per section (a pocket-oil duplicate never flags a cane-oil row).
  const duplicateOilRowIds = useMemo(() => duplicateRowIds(value.oilRows), [value.oilRows])
  const duplicateCaneOilRowIds = useMemo(() => duplicateRowIds(value.caneOilRows), [value.caneOilRows])
  const hasDuplicateOilRows = duplicateOilRowIds.size > 0 || duplicateCaneOilRowIds.size > 0

  function handleSaveFinalClick() {
    if (hasDuplicateOilRows) {
      toast.error(tRoot.errorDuplicateOilRow)
      return
    }
    // A credit line with money in it but no customer/employee attached would
    // still count toward Payments Collected (paymentsTotal sums every line
    // unconditionally), but silently never reach anyone's ledger — the
    // amount would look "accounted for" here while nobody's balance actually
    // reflects it. Block the save instead of letting that slip through.
    const missingCreditCustomer = (value.payments || []).some((p) => p.type === 'credit' && Number(p.amount) > 0 && !p.customerId)
    const missingCreditEmployee = (value.payments || []).some((p) => p.type === 'employeeCredit' && Number(p.amount) > 0 && !p.employeeId)
    if (missingCreditCustomer || missingCreditEmployee) {
      setAttemptedSubmit(true)
      setShakeKey((k) => k + 1)
      toast.error(missingCreditCustomer ? tRoot.errorCreditCustomerRequired : tRoot.errorCreditEmployeeRequired)
      return
    }
    // Bill-upload requirement temporarily disabled — see shiftBillsMissing above.
    if (!value.employeeId /* || !value.bills || value.bills.length === 0 */) {
      setAttemptedSubmit(true)
      setShakeKey((k) => k + 1)
      if (!value.employeeId) toast.error(tRoot.errorEmployeeRequired)
      return
    }
    setAttemptedSubmit(true)
    // A pending autosave firing during/after this save's own PUT is exactly
    // the concurrent-write race described above — cancel it and mark this
    // value as already "seen" so the autosave effect doesn't reschedule one
    // right after, either.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    lastSeenValue.current = value
    onSaveFinal(value)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white/80 p-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        {value.id ? (
          isDraft ? (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600" title={tRoot.editingDraft}>
              {tRoot.draftBadge}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">{t.savedLabel}</span>
          )
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{t.unsavedLabel}</span>
        )}
        {value.status !== 'final' && autoSaveStatus === 'pending' ? (
          <span className="flex items-center gap-1 text-xs font-medium text-slate-400">
            <CloudUpload size={13} className="animate-pulse" /> {tRoot.autoSaving}
          </span>
        ) : null}
        <motion.div
          key={`employee-${shakeKey}`}
          animate={shiftEmployeeMissing ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className="max-w-xs flex-1"
        >
          <Select
            value={value.employeeId}
            onChange={(e) => onChange({ ...value, employeeId: e.target.value })}
            error={shiftEmployeeMissing}
          >
            <option value="">{t.selectEmployee}</option>
            {assignableEmployees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
                {unavailableEmployeeIds?.has(emp.id) ? ` (${tRoot.employeeUnavailableSuffix})` : ''}
              </option>
            ))}
          </Select>
          {shiftEmployeeMissing ? <span className="mt-1 block text-xs font-medium text-rose-500">{tRoot.errorEmployeeRequired}</span> : null}
        </motion.div>
        <SecondaryButton
          type="button"
          onClick={onDiscardDraft}
          disabled={!hasDraftToDiscard}
          title={hasDraftToDiscard ? undefined : tRoot.discardDraftDisabledHint}
          className={
            hasDraftToDiscard
              ? '!border-rose-300 !bg-rose-50 !text-rose-600 hover:!border-rose-400 hover:!bg-rose-100'
              : '!border-slate-200 !bg-slate-50 !text-slate-400'
          }
        >
          <Trash2 size={14} /> {tRoot.discardDraftButton}
        </SecondaryButton>
      </div>

      <div className="mb-3.5 flex gap-2 border-b border-slate-200">
        {['reading', 'payments'].map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveShiftTab(tab)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${
              activeShiftTab === tab ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab === 'reading' ? t.readingTabLabel : t.payments}
          </button>
        ))}
      </div>

      <div className={activeShiftTab === 'reading' ? '' : 'hidden'}>
      {/* The nozzle grid's columns (opening/closing/testing/rate/liters/
          amount) each need real room for a full meter reading — squeezed to
          a phone's width they'd be too narrow to read or tap. Scrolling the
          whole grid horizontally as one block (rather than shrinking it)
          keeps every column usable; the fixed pump-total banner below stays
          full-width so the running total is always visible without scrolling.
          The 640px floor only applies below the sm breakpoint — anything
          wider already fits the grid naturally, and forcing it there too
          left a stray horizontal scrollbar that flashed during this card's
          mount/tab-switch animation even when nothing actually overflowed.
          overflow-y is pinned to hidden too — setting only overflow-x:auto
          leaves the browser free to compute overflow-y as auto as well
          (per the CSS spec), and the Total row's continuous pulse animation
          was enough sub-pixel height jitter each frame to keep flipping an
          unwanted vertical scrollbar on and off. */}
      <div className="-mx-1 overflow-x-auto overflow-y-hidden px-1">
        <div className="min-w-[640px] sm:min-w-0">
          <div className="grid grid-cols-[0.6fr_1.7fr_1.7fr_0.7fr_1.5fr_1fr_1.1fr] gap-2 px-1 pb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span className="text-brand-700">{t.fuel}</span>
            <span>{t.opening}</span>
            <span>{t.closing}</span>
            <span>{t.testing}</span>
            <span>{t.rate}</span>
            <span className="text-right">{t.liters}</span>
            <span className="text-right">{t.amount}</span>
          </div>
          <div className="space-y-3">
            {fuelKeys.map((fuelKey) => {
          const fuelTotal = entryFuelAmount(value, fuelKey)
          const fuelTotalLiters = entryFuelLiters(value, fuelKey)
          return (
            <div key={fuelKey} className="space-y-1.5">
              <span className={`text-sm font-bold ${FUEL_LABEL_COLORS[fuelKey] || 'text-slate-600'}`}>{t.fuelLabels[fuelKey]}</span>
              <div className="space-y-1.5">
                {NOZZLE_KEYS.map((nozzleKey, nozzleIdx) => {
                  const reading = value[fuelKey][nozzleKey]
                  const closingRaw = reading.closing
                  const hasClosing = closingRaw !== '' && closingRaw != null
                  const netLiters = readingLiters(reading)
                  const isClosingTooLow =
                    hasClosing && (Number(closingRaw) || 0) - (Number(reading.opening) || 0) - (Number(reading.testing) || 0) < 0
                  return (
                    <div key={nozzleKey}>
                      <div className="grid grid-cols-[0.6fr_1.7fr_1.7fr_0.7fr_1.5fr_1fr_1.1fr] items-center gap-2">
                        <span className="pl-2 text-xs font-medium text-slate-500">{t.nozzleLabel(nozzleIdx + 1)}</span>
                        <Input
                          type="number"
                          step="any"
                          value={reading.opening}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'opening', e.target.value)}
                          placeholder="0"
                          className="px-2.5 py-2"
                          title={isDerivedOpening ? t.autoFromHandover : undefined}
                        />
                        <Input
                          type="number"
                          step="any"
                          value={closingRaw}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'closing', e.target.value)}
                          placeholder="0"
                          className={`px-2.5 py-2 ${isClosingTooLow ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : ''}`}
                          title={isClosingTooLow ? t.closingTooLowHint : undefined}
                        />
                        <Input
                          type="number"
                          step="any"
                          value={reading.testing}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'testing', e.target.value)}
                          placeholder="0"
                          className="px-2.5 py-2"
                        />
                        <Input
                          type="number"
                          step="any"
                          value={reading.rate}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'rate', e.target.value)}
                          placeholder="0.00"
                          className="px-2.5 py-2"
                        />
                        <span
                          className={`text-right text-sm ${isClosingTooLow ? 'font-semibold text-rose-500' : 'text-slate-500'}`}
                          title={isClosingTooLow ? t.closingTooLowHint : t.litersHint}
                        >
                          {netLiters.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-right text-sm font-semibold ${isClosingTooLow ? 'text-rose-500' : 'text-slate-700'}`}>
                          {formatCurrency(readingAmount(reading))}
                        </span>
                      </div>
                      {isClosingTooLow ? (
                        <p className="pl-2 pt-1 text-xs font-medium text-rose-500">
                          {t.closingTooLowHint} ({t.opening.toLowerCase()}: {Number(reading.opening).toLocaleString('en-IN')})
                        </p>
                      ) : null}
                    </div>
                  )
                })}
                <div className="grid grid-cols-[0.6fr_1.7fr_1.7fr_0.7fr_1.5fr_1fr_1.1fr] items-center gap-2 border-t border-dashed border-slate-200 pt-1.5">
                  <span className={`pl-2 text-xs font-bold ${FUEL_LABEL_COLORS[fuelKey] || 'text-slate-600'}`}>{t.fuelTotalLabel}</span>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span className={`text-right text-sm font-bold ${FUEL_LABEL_COLORS[fuelKey] || 'text-slate-700'}`}>
                    <motion.span
                      animate={{ scale: [1, 1.06, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                      className="inline-block"
                    >
                      {fuelTotalLiters.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </motion.span>
                  </span>
                  <span className={`text-right text-sm font-bold ${FUEL_LABEL_COLORS[fuelKey] || 'text-slate-700'}`}>
                    <motion.span
                      animate={{ scale: [1, 1.06, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }}
                      className="inline-block"
                    >
                      {formatCurrency(fuelTotal)}
                    </motion.span>
                  </span>
                </div>
              </div>
            </div>
          )
        })}
          </div>
        </div>
      </div>

      {pumpKey === 'pump2' ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white/80 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplet size={16} className="shrink-0 text-emerald-600" />
                <span className="text-sm font-bold text-emerald-600">{t.pocketOilLabel}</span>
              </div>
              <button
                type="button"
                onClick={addOilRow}
                className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <Plus size={15} /> {t.addMorePacketOil}
              </button>
            </div>
            {/* Scrolls internally once there are more than ~4 rows, instead
                of pushing the rest of the form down indefinitely. */}
            <div className="max-h-[240px] space-y-3 overflow-y-auto pr-1">
              {(value.oilRows || []).length === 0 ? (
                <p className="text-xs text-slate-400">{t.noOilRowsAdded}</p>
              ) : null}
              {(value.oilRows || []).map((row) => (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) oilRowRefs.current.set(row.id, el)
                    else oilRowRefs.current.delete(row.id)
                  }}
                  className={`rounded-lg transition-colors duration-700 ${
                    highlightedRowId === row.id ? 'bg-emerald-100 ring-2 ring-emerald-300' : ''
                  }`}
                >
                  <OilRow
                    t={t}
                    lubricants={packetProducts}
                    productId={row.productId}
                    onSelectProduct={(productId) => selectOilRowProduct(row.id, productId)}
                    count={row.stockCount}
                    rate={row.stockRate}
                    onRateAndCountChange={(rate, count) =>
                      onChange({ ...value, oilRows: value.oilRows.map((r) => (r.id === row.id ? { ...r, stockRate: rate, stockCount: count } : r)) })
                    }
                    amount={(Number(row.stockCount) || 0) * (Number(row.stockRate) || 0)}
                    onRemove={() => removeOilRow(row.id)}
                    showRemove
                    isDuplicate={duplicateOilRowIds.has(row.id)}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-end border-t border-dashed border-slate-200 pt-3">
              <span className="text-sm font-semibold text-slate-600">
                {t.amount}: <span className="font-bold text-emerald-700">{formatCurrency(pocketOilStockAmount)}</span>
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white/80 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Droplet size={16} className="shrink-0 text-emerald-600" />
                <span className="text-sm font-bold text-emerald-600">{t.caneOilLabel}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-sm font-semibold text-rose-500">{t.offerLabel}</span>
                  <div className="w-28 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={value.caneOilOffer || ''}
                      onChange={(e) => onChange({ ...value, caneOilOffer: e.target.value })}
                      placeholder="0.00"
                      title={t.offerHint}
                      className="border-rose-200"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addCaneOilRow}
                  className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                >
                  <Plus size={15} /> {t.addMoreCaneOil}
                </button>
              </div>
            </div>
            {/* Scrolls internally once there are more than ~4 rows, instead
                of pushing the rest of the form down indefinitely. */}
            <div className="max-h-[240px] space-y-3 overflow-y-auto pr-1">
              {(value.caneOilRows || []).length === 0 ? (
                <p className="text-xs text-slate-400">{t.noOilRowsAdded}</p>
              ) : null}
              {(value.caneOilRows || []).map((row) => (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) oilRowRefs.current.set(row.id, el)
                    else oilRowRefs.current.delete(row.id)
                  }}
                  className={`rounded-lg transition-colors duration-700 ${
                    highlightedRowId === row.id ? 'bg-emerald-100 ring-2 ring-emerald-300' : ''
                  }`}
                >
                  <OilRow
                    t={t}
                    lubricants={caneProducts}
                    productId={row.productId}
                    onSelectProduct={(productId) => selectCaneOilRowProduct(row.id, productId)}
                    count={row.stockCount}
                    rate={row.stockRate}
                    onRateAndCountChange={(rate, count) =>
                      onChange({ ...value, caneOilRows: value.caneOilRows.map((r) => (r.id === row.id ? { ...r, stockRate: rate, stockCount: count } : r)) })
                    }
                    amount={(Number(row.stockCount) || 0) * (Number(row.stockRate) || 0)}
                    onRemove={() => removeCaneOilRow(row.id)}
                    showRemove
                    isDuplicate={duplicateCaneOilRowIds.has(row.id)}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-end border-t border-dashed border-slate-200 pt-3">
              <span className="text-sm font-semibold text-slate-600">
                {t.amount}: <span className="font-bold text-emerald-700">{formatCurrency(caneOilStockAmount)}</span>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <motion.div
        key={shiftTotal > 0 ? 'has-total' : 'zero-total'}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="mt-3 rounded-lg bg-gradient-to-r from-brand-600 to-brand-800 px-4 py-3 shadow-md shadow-brand-600/30"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <AppTooltip title={<CalcBreakdown rows={shiftTotalBreakdownRows} formula={shiftTotalFormula} />} placement="top-start">
            <span className="cursor-help whitespace-nowrap text-sm font-bold uppercase tracking-wide text-brand-100 underline decoration-dotted decoration-brand-300/60 underline-offset-4">
              {t.shiftTotalLabel}
            </span>
          </AppTooltip>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={formatCurrency(shiftTotal)}
              initial={{ opacity: 0, y: -6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: [1, 1.07, 1] }}
              transition={{
                opacity: { duration: 0.22, ease: 'easeOut' },
                y: { duration: 0.22, ease: 'easeOut' },
                scale: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
              }}
              className="inline-block text-lg font-extrabold text-white"
            >
              {formatCurrency(shiftTotal)}
            </motion.span>
          </AnimatePresence>
        </div>
      </motion.div>
      </div>

      <div className={`mt-4 ${activeShiftTab === 'payments' ? '' : 'hidden'}`}>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-sm font-bold text-slate-700">{t.payments}</h5>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={addCreditLine}
              className="flex items-center gap-1.5 rounded-full bg-rose-50 px-3.5 py-1.5 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100"
            >
              <Landmark size={15} /> {t.addCreditLine}
            </button>
            <button
              type="button"
              onClick={addEmployeeCreditLine}
              className="flex items-center gap-1.5 rounded-full bg-violet-50 px-3.5 py-1.5 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-100"
            >
              <Landmark size={15} /> {t.addEmployeeCreditLine}
            </button>
            <button
              type="button"
              onClick={addExpenseLine}
              className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100"
            >
              <Receipt size={15} /> {t.addExpenseLine}
            </button>
            <button
              type="button"
              onClick={addPaymentLine}
              className="flex items-center gap-1.5 rounded-full bg-brand-50 px-3.5 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100"
            >
              <Plus size={15} /> {t.addLine}
            </button>
          </div>
        </div>
        {/* A fresh shift seeds a row per payment method, plus credit/expense
            lines the manager adds on top — that list can run long, so it
            scrolls internally instead of stretching the whole page. */}
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {(value.payments || []).map((p) => {
            const isCash = p.type !== 'credit' && CASH_LABELS.has(p.label.trim().toLowerCase())
            const isCounting = isCash && openDenomId === p.id
            // A large cash line is worth a second look before saving — the
            // amber highlight keeps it noticeable without needing a click.
            const isBigCash = isCash && Number(p.amount) >= BIG_CASH_THRESHOLD
            return (
              <div
                key={p.id}
                ref={(el) => {
                  if (el) paymentRowRefs.current.set(p.id, el)
                  else paymentRowRefs.current.delete(p.id)
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className={p.type === 'credit' || p.type === 'employeeCredit' ? 'w-full sm:w-48 sm:shrink-0' : 'w-full sm:w-64 sm:shrink-0'}>
                    {p.type === 'credit' ? (
                      <Select
                        value={p.customerId || ''}
                        onChange={(e) => updatePaymentLine(p.id, 'customerId', e.target.value)}
                        className={
                          attemptedSubmit && !p.customerId && Number(p.amount) > 0
                            ? 'border-rose-400 text-rose-600 focus:border-rose-500 focus:ring-rose-100'
                            : 'text-rose-600'
                        }
                        title={attemptedSubmit && !p.customerId && Number(p.amount) > 0 ? tRoot.errorCreditCustomerRequired : undefined}
                      >
                        <option value="">{t.selectCustomer}</option>
                        {(creditCustomers || []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    ) : p.type === 'employeeCredit' ? (
                      <Select
                        value={p.employeeId || ''}
                        onChange={(e) => updatePaymentLine(p.id, 'employeeId', e.target.value)}
                        className={
                          attemptedSubmit && !p.employeeId && Number(p.amount) > 0
                            ? 'border-rose-400 text-violet-600 focus:border-rose-500 focus:ring-rose-100'
                            : 'text-violet-600'
                        }
                        title={attemptedSubmit && !p.employeeId && Number(p.amount) > 0 ? tRoot.errorCreditEmployeeRequired : undefined}
                      >
                        <option value="">{t.selectEmployee}</option>
                        {(employees || []).map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </Select>
                    ) : p.type === 'expense' ? (
                      <Input
                        value={p.label}
                        onChange={(e) => updatePaymentLine(p.id, 'label', e.target.value)}
                        placeholder={t.placeholderExpenseLabel}
                        className="text-amber-700"
                      />
                    ) : (
                      <Select value={p.label} onChange={(e) => updatePaymentLine(p.id, 'label', e.target.value)}>
                        <option value="">{t.selectPaymentMethod}</option>
                        {PAYMENT_METHOD_OPTIONS.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                  {/* Amount always sits right after the method/customer picker —
                      same column position on every row type — so a credit line
                      can never be mistaken for the (separate, optional) reason
                      field below and left at its default 0. */}
                  <div className={p.type === 'credit' || p.type === 'employeeCredit' ? 'w-full sm:w-40 sm:shrink-0' : 'min-w-0 flex-1'}>
                    <Input
                      type="number"
                      step="any"
                      value={p.amount}
                      onChange={(e) => updatePaymentLine(p.id, 'amount', e.target.value)}
                      placeholder="0"
                      title={isBigCash ? t.bigCashHint : t.creditAmountHint}
                      className={isBigCash ? 'border-amber-400 font-bold text-amber-700' : p.type === 'credit' ? 'border-rose-200 font-semibold text-rose-700' : p.type === 'employeeCredit' ? 'border-violet-200 font-semibold text-violet-700' : ''}
                    />
                  </div>
                  {p.type === 'credit' ? (
                    <div className="w-full sm:min-w-0 sm:flex-1">
                      <Input
                        value={p.note || ''}
                        onChange={(e) => updatePaymentLine(p.id, 'note', e.target.value)}
                        placeholder={t.placeholderCreditNote}
                        title={t.creditNoteHint}
                        className="min-w-0 flex-1 text-rose-600"
                      />
                    </div>
                  ) : p.type === 'employeeCredit' ? (
                    <div className="w-full sm:min-w-0 sm:flex-1">
                      <Input
                        value={p.note || ''}
                        onChange={(e) => updatePaymentLine(p.id, 'note', e.target.value)}
                        placeholder={t.placeholderEmployeeCreditNote}
                        title={t.employeeCreditNoteHint}
                        className="min-w-0 flex-1 text-violet-600"
                      />
                    </div>
                  ) : null}
                  {!isCash ? (
                    <div className="w-24 shrink-0 text-right text-xs" title={t.paymentLitersHint}>
                      <div className="font-semibold text-slate-500">{paymentLiters(p) != null ? `${paymentLiters(p).toFixed(2)} L` : '—'}</div>
                      {paymentConversionFuel(p.label) ? (
                        <span
                          className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            paymentConversionFuel(p.label) === 'petrol' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
                          }`}
                        >
                          {paymentConversionFuel(p.label) === 'petrol' ? t.fuelLabels.petrol : t.fuelLabels.diesel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {isCash ? (
                    <IconButton
                      onClick={() => setOpenDenomId(isCounting ? null : p.id)}
                      aria-label={t.countCash}
                      title={t.countCash}
                      tone={isCounting ? 'brand' : 'success'}
                    >
                      <Coins size={16} />
                    </IconButton>
                  ) : null}
                  <IconButton onClick={() => removePaymentLine(p.id)} aria-label="Remove" title="Remove" tone="delete">
                    <X size={15} />
                  </IconButton>
                </div>

                {isCounting ? (
                  <div className="mt-2 grid grid-cols-4 gap-2 rounded-lg border border-brand-100 bg-brand-50/50 p-3 sm:grid-cols-7">
                    {NOTE_VALUES.map((note) => (
                      <label key={note} className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-500">{t.denomNote(note)}</span>
                        <Input
                          type="number"
                          min="0"
                          value={p.denominations?.[note] ?? ''}
                          onChange={(e) => updateDenomination(p.id, note, e.target.value)}
                          placeholder="0"
                          className="px-2.5 py-2"
                        />
                      </label>
                    ))}
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">{t.denomCoins}</span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={p.denominations?.coins ?? ''}
                        onChange={(e) => updateDenomination(p.id, 'coins', e.target.value)}
                        placeholder="0"
                        className="px-2.5 py-2"
                      />
                    </label>
                    <div className="col-span-4 flex items-center justify-between border-t border-brand-100 pt-2 sm:col-span-7">
                      <AppTooltip
                        title={
                          <CalcBreakdown
                            rows={[
                              ...NOTE_VALUES.filter((note) => Number(p.denominations?.[note]) > 0).map((note) => ({
                                label: t.denomNote(note),
                                value: `${Number(p.denominations[note])} × ₹${note} = ${formatCurrency(note * Number(p.denominations[note]))}`,
                              })),
                              ...(Number(p.denominations?.coins) > 0 ? [{ label: t.denomCoins, value: formatCurrency(Number(p.denominations.coins)) }] : []),
                            ]}
                            formula={`${t.denomTotal} = ${formatCurrency(denominationTotal(p.denominations))}`}
                          />
                        }
                      >
                        <span className="cursor-help text-xs font-semibold text-slate-500 underline decoration-dotted decoration-slate-300 underline-offset-4">
                          {t.denomTotal}
                        </span>
                      </AppTooltip>
                      <span className="text-sm font-bold text-brand-700">{formatCurrency(denominationTotal(p.denominations))}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mt-3 rounded-lg bg-gradient-to-r from-brand-600 to-brand-800 px-4 py-3 shadow-md shadow-brand-600/30"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="whitespace-nowrap text-sm font-bold uppercase tracking-wide text-brand-100">{t.paymentsTotalLabel}</span>
            <AnimatePresence mode="popLayout">
              <motion.span
                key={formatCurrency(paymentsCollected)}
                initial={{ opacity: 0, y: -6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: [1, 1.07, 1] }}
                transition={{
                  opacity: { duration: 0.22, ease: 'easeOut' },
                  y: { duration: 0.22, ease: 'easeOut' },
                  scale: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
                }}
                className="inline-block text-lg font-extrabold text-white"
              >
                {formatCurrency(paymentsCollected)}
              </motion.span>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <motion.div
          key={`${shakeKey}`}
          animate={shiftBillsMissing ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className={`rounded-xl border p-3 ${shiftBillsMissing ? 'border-rose-400 bg-rose-50 ring-2 ring-rose-100' : 'border-violet-300 bg-violet-100'}`}
        >
          <div className="mb-2 flex items-center gap-1.5">
            <Paperclip size={14} className={shiftBillsMissing ? 'text-rose-500' : 'text-violet-600'} />
            <h4 className="text-sm font-bold text-slate-800">
              {tRoot.billsAndDocuments}
              {/* Required-asterisk hidden while the bill-upload requirement is disabled — see shiftBillsMissing above. */}
              {/* <span className="text-rose-500"> *</span> */}
            </h4>
          </div>
          {value.bills?.length > 0 ? (
            <ul className="mb-2 space-y-1.5">
              {value.bills.map((bill) => (
                <li key={bill.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => openBill(bill)}
                    className="flex min-w-0 items-center gap-1.5 font-medium text-brand-700 hover:underline"
                  >
                    <Paperclip size={12} className="shrink-0" />
                    <span className="truncate">{bill.name}</span>
                  </button>
                  <span className="shrink-0 text-slate-400">&middot; {formatDate(bill.date)}</span>
                  <IconButton onClick={() => removeBill(bill.id)} aria-label={tRoot.removeBill} title={tRoot.removeBill} tone="delete">
                    <X size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-xs text-slate-400">{tRoot.noBillsYet}</p>
          )}
          <label
            className={`flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition-colors ${
              uploadingBill ? 'cursor-wait opacity-60' : 'cursor-pointer hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            <Upload size={14} />
            {uploadingBill ? tRoot.uploadingBillPrompt : tRoot.uploadBillPrompt}
            <input type="file" accept="image/*,.pdf" className="hidden" disabled={uploadingBill} onChange={handleBillFileChange} />
          </label>
          {shiftBillsMissing ? <span className="mt-1.5 block text-xs font-medium text-rose-500">{tRoot.errorBillsRequired}</span> : null}
        </motion.div>

        <div className="rounded-xl border border-amber-300 bg-amber-100 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <StickyNote size={14} className="text-amber-700" />
            <h4 className="text-sm font-bold text-slate-800">{tRoot.additionalInfo}</h4>
          </div>
          <Textarea value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} placeholder={tRoot.additionalInfoPlaceholder} rows={2} className="text-xs" />
        </div>
      </div>

      <motion.div
        animate={shiftTotals.excessShortage < 0 ? { backgroundColor: ['#fef2f2', '#fee2e2', '#fef2f2'] } : { backgroundColor: '#f8fafc' }}
        transition={shiftTotals.excessShortage < 0 ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border-t border-slate-100 px-4 py-3.5 text-sm ${shiftTotals.excessShortage < 0 ? 'ring-1 ring-rose-200' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="shrink-0 rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
            {t.shiftLabel(value.shiftNumber)} {t.shiftTotalSuffix}
          </span>
          <div className="flex items-center gap-1.5">
            <AppTooltip title={<CalcBreakdown rows={shiftTotalBreakdownRows} formula={shiftTotalFormula} />}>
              <span className="cursor-help text-slate-500 underline decoration-dotted decoration-slate-300 underline-offset-4">{t.saleAmount}</span>
            </AppTooltip>
            <AnimatedFigure value={shiftTotals.totalSaleAmount} className="font-semibold text-slate-800" />
          </div>
          <div className="flex items-center gap-1.5">
            <AppTooltip
              title={
                <CalcBreakdown
                  rows={
                    (value.payments || []).length
                      ? value.payments.map((p) => ({ label: p.label || '—', value: formatCurrency(Number(p.amount) || 0) }))
                      : [{ label: t.noPaymentLinesYet, value: formatCurrency(0) }]
                  }
                  formula={`${(value.payments || []).length} ${t.paymentLinesSuffix} = ${t.paymentsCollected} (${formatCurrency(paymentsCollected)})`}
                />
              }
            >
              <span className="cursor-help text-slate-500 underline decoration-dotted decoration-slate-300 underline-offset-4">{t.paymentsCollected}</span>
            </AppTooltip>
            <AnimatedFigure value={shiftTotals.totalPayments} className="font-semibold text-slate-800" />
          </div>
          <div className="flex items-center gap-1.5">
            <AppTooltip
              title={
                <CalcBreakdown
                  rows={[
                    { label: t.paymentsCollected, value: formatCurrency(shiftTotals.totalPayments) },
                    { label: t.saleAmount, value: formatCurrency(shiftTotals.totalSaleAmount) },
                  ]}
                  formula={`${t.paymentsCollected} (${formatCurrency(shiftTotals.totalPayments)}) − ${t.saleAmount} (${formatCurrency(shiftTotals.totalSaleAmount)}) = ${
                    shiftTotals.excessShortage >= 0 ? t.excess : t.shortage
                  } (${formatCurrency(shiftTotals.excessShortage)})`}
                />
              }
            >
              <span
                className={`flex cursor-help items-center gap-1 font-semibold underline decoration-dotted underline-offset-4 ${
                  shiftTotals.excessShortage >= 0 ? 'text-emerald-600 decoration-emerald-300' : 'text-rose-500 decoration-rose-300'
                }`}
              >
                {shiftTotals.excessShortage >= 0 ? (
                  <TrendingUp size={13} />
                ) : (
                  <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}>
                    <AlertTriangle size={13} />
                  </motion.span>
                )}
                {shiftTotals.excessShortage >= 0 ? t.excess : t.shortage}
              </span>
            </AppTooltip>
            <AnimatedFigure
              value={shiftTotals.excessShortage}
              signed
              pulse={shiftTotals.excessShortage < 0}
              className={`font-bold ${shiftTotals.excessShortage >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryButton type="button" onClick={handleSaveFinalClick} disabled={savingFinal}>
            <Save size={15} /> {savingFinal ? tRoot.savingChanges : value.id ? tRoot.saveChanges : tRoot.saveEntry}
          </PrimaryButton>
        </div>
      </motion.div>
    </div>
  )
}

export default function PumpDayEditor({ pumpKey, label, accent, tint, date, employees, fuelRates, creditCustomers, lubricants, unavailableEmployeeIds }) {
  const { language } = useLanguage()
  const tRoot = FUEL_ENTRY_TEXT[language]
  const t = tRoot.pumpEditor
  const theme = TINTS[tint] || { bg: 'bg-white', border: 'border-slate-200' }
  const { fuelEntries, fuelEntriesLoading, addFuelEntry, updateFuelEntry, deleteFuelEntry } = useData()

  const priorEntries = useMemo(
    () => sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey && e.date < date)),
    [fuelEntries, pumpKey, date],
  )

  // A brand new Shift 1 pre-fills its opening reading from the pump's last
  // saved shift (whichever earlier day that was) — Shift 2+ never needs this
  // since withCarriedOpenings always derives their opening live from the
  // card right before them in the same array. Shared by the initial state
  // below and by "Discard Draft" rebuilding a card from scratch.
  function blankShiftEntry(shiftNumber) {
    const blank = emptyShiftEntry(pumpKey, date, shiftNumber, fuelRates)
    if (shiftNumber === 1) {
      const last = priorEntries[priorEntries.length - 1]
      if (last) {
        for (const fuelKey of FUEL_KEYS_BY_PUMP[pumpKey]) {
          blank[fuelKey] = {
            nozzle1: { ...blank[fuelKey].nozzle1, opening: last[fuelKey]?.nozzle1?.closing ?? '' },
            nozzle2: { ...blank[fuelKey].nozzle2, opening: last[fuelKey]?.nozzle2?.closing ?? '' },
          }
        }
      }
    }
    return blank
  }

  const [cards, setCards] = useState(() => {
    const existing = sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey && e.date === date))
    if (existing.length > 0) return existing.map((e) => ({ ...e }))
    return [blankShiftEntry(1)]
  })

  // fuelEntries now loads from the API asynchronously (previously it was
  // synchronous, from localStorage) — a hard refresh landing directly on
  // this pump/date can mount before that fetch resolves, so `cards`' lazy
  // initializer above may have seeded a blank card even though a real
  // draft/final entry for this shift already exists. Once loading finishes,
  // re-check for that entry and swap it in — but only once, and only if
  // nothing's been typed yet (never clobber an edit in progress), so this
  // never fights a manager who's already typing by the time the fetch
  // lands. A day that's genuinely still blank is left alone: swapping in an
  // equivalent-but-new blank object would look like a "value changed" to
  // ShiftCard's autosave effect and fire a phantom save of nothing.
  const hasUserEditedRef = useRef(false)
  const resyncedAfterLoadRef = useRef(false)
  useEffect(() => {
    if (fuelEntriesLoading || resyncedAfterLoadRef.current || hasUserEditedRef.current) return
    resyncedAfterLoadRef.current = true
    const existing = sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey && e.date === date))
    if (existing.length === 0) return
    setCards(existing.map((e) => ({ ...e })))
    setActiveShiftIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuelEntriesLoading])

  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState(null)
  // Separate from confirmRemoveIndex above: removing a shift (via the 2nd/
  // 3rd shift toggle) drops the tab entirely; discarding a draft keeps the
  // tab but wipes it back to a blank entry — Shift 1 can't be toggled off,
  // so this is the only way to reset it if a draft was typed by mistake.
  const [confirmDiscardIndex, setConfirmDiscardIndex] = useState(null)
  // Only one shift's full form (readings, payments, bills...) shows at a
  // time — a "Shift 1 / Shift 2 / Shift 3" tab strip switches between them,
  // instead of stacking every shift's whole form one below the other.
  const [activeShiftIndex, setActiveShiftIndex] = useState(0)

  // Shift 1's opening is directly editable (pre-filled once above from the
  // pump's last saved shift, whichever earlier day that was). Shift 2+'s
  // opening is never independently stored — it's always the live closing of
  // the card right before it, so a handover reading is entered exactly once.
  const effectiveCards = useMemo(() => withCarriedOpenings(cards), [cards])

  function updateCard(index, patch) {
    hasUserEditedRef.current = true
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function addShift(shiftNumber) {
    hasUserEditedRef.current = true
    setCards((prev) => [...prev, emptyShiftEntry(pumpKey, date, shiftNumber, fuelRates)])
    setActiveShiftIndex(shiftNumber - 1)
  }

  function requestRemove(index) {
    if (cards[index].id) {
      setConfirmRemoveIndex(index)
    } else {
      hasUserEditedRef.current = true
      setCards((prev) => prev.filter((_, i) => i !== index))
      setActiveShiftIndex((i) => Math.min(i, cards.length - 2))
    }
  }

  async function confirmRemove() {
    const index = confirmRemoveIndex
    setConfirmRemoveIndex(null)
    if (index == null) return
    const card = cards[index]
    if (card.id) {
      try {
        await deleteFuelEntry(card.id)
        toast.success(tRoot.toastDeleted)
      } catch (err) {
        toast.error(err.message || tRoot.toastSaveFailed)
        return
      }
    }
    setCards((prev) => prev.filter((_, i) => i !== index))
    setActiveShiftIndex((i) => Math.min(i, cards.length - 2))
  }

  // Draft-only by design: a shift that's already final can't reach this
  // (the button only shows while value.status === 'draft'), so there's no
  // risk of accidentally erasing a real, saved sale — only ever an
  // unfinished draft, whether autosaved (has an id → also deleted from
  // fuelEntries) or never even saved yet (no id → just clears the form).
  function requestDiscardDraft(index) {
    setConfirmDiscardIndex(index)
  }

  async function confirmDiscardDraft() {
    const index = confirmDiscardIndex
    setConfirmDiscardIndex(null)
    if (index == null) return
    const card = cards[index]
    if (card.id) {
      try {
        await deleteFuelEntry(card.id)
      } catch (err) {
        toast.error(err.message || tRoot.toastSaveFailed)
        return
      }
    }
    updateCard(index, blankShiftEntry(card.shiftNumber))
    toast.success(tRoot.toastDraftDiscarded)
  }

  function buildPayload(index) {
    const effective = effectiveCards[index]
    const { id, localOnlyId, ...rest } = effective
    return rest
  }

  // Whether an as-yet-unsaved card (no id) has a create already in flight —
  // guards against a second autosave firing (e.g. the manager resumes
  // typing, then pauses again) before the first create's response comes
  // back, which would otherwise POST a second draft row for the same shift.
  // The dropped attempt isn't lost: its edits already live in `cards` (the
  // form's own source of truth), so the very next autosave picks them up —
  // or, if the create was mid-flight when it fired, `pending` here retriggers
  // one immediately once that create resolves.
  const draftCreateStateRef = useRef({})

  // Called by ShiftCard's own debounced autosave — NOT awaited there by
  // design (fire-and-forget), so being `async`/awaiting the network call in
  // here never blocks typing. Silent on success (no toast), since this can
  // fire many times a minute while someone is typing — the card's own
  // "Draft"/"Saving..." badge is the persistent signal that progress is
  // safe. Only a real failure surfaces a toast.
  //
  // Only call updateCard when something in local `cards` state actually
  // needs to change (a fresh id, or status not yet marked 'draft'). Calling
  // it unconditionally would replace the card object every time even when
  // it's already an unchanged draft — that new reference flows back into
  // ShiftCard's `value` prop, which its own autosave effect sees as "value
  // changed", scheduling another autosave, which calls back in here again:
  // an infinite loop that never lets the "Saving..." indicator settle.
  async function handleSaveDraft(index) {
    const payload = { ...buildPayload(index), status: 'draft' }
    const card = cards[index]
    if (card.id) {
      if (card.status !== 'draft') updateCard(index, { status: 'draft' })
      try {
        await updateFuelEntry(card.id, payload)
      } catch (err) {
        toast.error(err.message || tRoot.toastSaveFailed)
      }
      return
    }
    const state = draftCreateStateRef.current
    if (state[index] === 'saving') {
      state[index] = 'pending'
      return
    }
    state[index] = 'saving'
    try {
      const id = await addFuelEntry(payload)
      updateCard(index, { id, status: 'draft' })
    } catch (err) {
      toast.error(err.message || tRoot.toastSaveFailed)
    } finally {
      const shouldRetry = state[index] === 'pending'
      state[index] = 'idle'
      if (shouldRetry) handleSaveDraft(index)
    }
  }

  // Final save happens once per shift (not per keystroke), so a normal
  // awaited call — with a "Saving..." state on the button itself, never a
  // page-blocking spinner — is expected and fine here.
  const [savingFinalIndex, setSavingFinalIndex] = useState(null)

  async function handleSaveFinal(index) {
    const payload = { ...buildPayload(index), status: 'final' }
    const card = cards[index]
    setSavingFinalIndex(index)
    try {
      if (card.id) {
        await updateFuelEntry(card.id, payload)
        toast.success(tRoot.toastUpdated)
      } else {
        const id = await addFuelEntry(payload)
        updateCard(index, { id })
        toast.success(tRoot.toastAdded)
      }
      updateCard(index, { status: 'final' })
    } catch (err) {
      toast.error(err.message || tRoot.toastSaveFailed)
    } finally {
      setSavingFinalIndex(null)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`rounded-xl border p-5 shadow-card ${theme.bg} ${theme.border}`}
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`h-3 w-3 rounded-full ${accent}`} />
          <Fuel size={19} className={accent.replace('bg-', 'text-')} />
          <h4 className="text-base font-bold text-slate-800">{label}</h4>
          {cards.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              {cards.map((card, index) => {
                const cardStatus = effectiveCards[index]?.status
                return (
                  <button
                    key={card.id || card.localOnlyId}
                    type="button"
                    onClick={() => setActiveShiftIndex(index)}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                      index === activeShiftIndex ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {t.shiftLabel(index + 1)}
                    {!card.id ? (
                      <span className={`h-1.5 w-1.5 rounded-full ${index === activeShiftIndex ? 'bg-white/70' : 'bg-slate-400'}`} />
                    ) : cardStatus === 'draft' ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <ToggleSwitch
            checked={cards.length >= 2}
            disabled={cards.length >= 3}
            title={cards.length >= 3 ? t.removeThirdShiftFirst : undefined}
            label={t.secondShiftToggle}
            onChange={(on) => (on ? addShift(2) : requestRemove(1))}
          />
          {cards.length >= 2 ? (
            <ToggleSwitch
              checked={cards.length >= 3}
              title={t.internalShiftHint}
              label={t.thirdShiftToggle}
              onChange={(on) => (on ? addShift(3) : requestRemove(2))}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {cards.map((card, index) => (
          <div key={card.id || card.localOnlyId} className={index === activeShiftIndex ? '' : 'hidden'}>
            <ShiftCard
              t={t}
              tRoot={tRoot}
              pumpKey={pumpKey}
              value={effectiveCards[index]}
              onChange={(next) => updateCard(index, next)}
              isDerivedOpening={index > 0}
              employees={employees}
              unavailableEmployeeIds={unavailableEmployeeIds}
              creditCustomers={creditCustomers}
              lubricants={lubricants}
              onSaveDraft={() => handleSaveDraft(index)}
              onSaveFinal={() => handleSaveFinal(index)}
              savingFinal={savingFinalIndex === index}
              onDiscardDraft={() => requestDiscardDraft(index)}
            />
          </div>
        ))}
      </div>

      <ConfirmDialog
        isOpen={confirmRemoveIndex != null}
        onClose={() => setConfirmRemoveIndex(null)}
        onConfirm={confirmRemove}
        title={tRoot.deleteTitle}
        description={tRoot.deleteDesc}
      />

      <ConfirmDialog
        isOpen={confirmDiscardIndex != null}
        onClose={() => setConfirmDiscardIndex(null)}
        onConfirm={confirmDiscardDraft}
        title={tRoot.discardDraftTitle}
        description={tRoot.discardDraftDesc}
        confirmLabel={tRoot.discardDraftButton}
      />
    </motion.div>
  )
}
