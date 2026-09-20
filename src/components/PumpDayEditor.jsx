import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  AlertTriangle,
  TrendingUp,
  ExternalLink,
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
import { formatCurrency, formatDate, formatDateTime, formatEmployeeName, todayISO } from '../utils/format.js'
import { purchaseBatchesByCost, lastPurchaseOf, stockAvailableAtCost, availableAtCostBreakdown, round3 } from '../utils/lubricants.js'
import { uploadBillFile, getDownloadUrl, deleteUpload } from '../lib/apiClient.js'
import { prepareBillFile } from '../utils/fileValidation.js'
import { Input, Select, Textarea, IconButton, PrimaryButton } from './FormControls.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { FullPageLoader } from './Loader.jsx'
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

// A typed Sold Count is flagged when it exceeds available stock, never
// silently clamped to it. Clamping used to make a wrongly-large count
// impossible to fix once available stock dropped below it — e.g. another
// shift's sale of the same product got finalized after this one already had
// a big number typed in — because every fresh keystroke snapped straight
// back down to whatever the new (lower) ceiling was: retyping a smaller
// REPLACEMENT number one digit at a time kept getting reverted mid-edit,
// which just looked like the field refusing to change at all. Same pattern
// as Closing-below-Opening and an out-of-range reading elsewhere on this
// screen — inline warning, the actual typed number always accepted, only
// blocked at Save.
function isOilCountOverStock(count, available) {
  return available != null && count !== '' && count != null && Number(count) > available
}

// A closing reading below opening+testing would mean the meter ran
// backwards — physically impossible for a running total, and almost always
// means the manager typed a standalone liters figure into Closing instead
// of the actual meter reading. Blank Closing (not yet typed) is never
// flagged — only an actually-entered value that doesn't add up.
function isReadingClosingTooLow(reading) {
  const closingRaw = reading?.closing
  const hasClosing = closingRaw !== '' && closingRaw != null
  return hasClosing && (Number(closingRaw) || 0) - (Number(reading.opening) || 0) - (Number(reading.testing) || 0) < 0
}

// A blank Closing next to a real Opening reading means the meter was never
// actually read this shift — Opening auto-fills from the previous shift's
// Closing (see blankShiftEntry/withCarriedOpenings), so saving with Closing
// still blank would otherwise slip through with no reading recorded for
// this nozzle at all. Only flagged once Opening has an actual value — a
// genuinely fresh nozzle with no prior history (both fields still blank)
// isn't flagged, same as isReadingClosingTooLow above.
function isReadingClosingMissing(reading) {
  const closingRaw = reading?.closing
  const hasClosing = closingRaw !== '' && closingRaw != null
  const openingRaw = reading?.opening
  const hasOpening = openingRaw !== '' && openingRaw != null
  return hasOpening && !hasClosing
}

// The API stores every reading field as a Decimal capped at 12 total digits,
// 3 of them after the point (see FuelReadingIn in the backend schema) — i.e.
// nothing at or past one billion. Every reading input here is a plain
// type="number" with no matching client-side cap, so a value that crosses
// that line sails through every on-screen check same as excess decimal
// precision did (see toApiNum in DataContext.jsx) and only 422s once Save
// Entry actually sends it — nothing reaches the backend before that
// deliberate click — a bare "Validation error." toast with no field
// highlighted, and the edit that triggered it never actually saved.
// Checked as its own thing rather than folded into toApiNum's
// rounding, since a value this size isn't noise to clean up quietly — it's
// almost always a mistyped extra digit, so it has to stop the manager here
// instead.
const MAX_READING_VALUE = 999999999.999
function isReadingValueTooLarge(reading) {
  return ['opening', 'closing', 'testing', 'rate'].some((field) => {
    const raw = reading?.[field]
    if (raw === '' || raw == null) return false
    const n = Number(raw)
    return Number.isFinite(n) && n > MAX_READING_VALUE
  })
}

// isReadingClosingTooLow/isReadingValueTooLarge only ever catch a reading
// that's internally inconsistent (closing behind opening) or past the
// database's own raw storage limit (~1 billion) — neither one objects to a
// reading that's merely absurd for what one shift could plausibly sell,
// e.g. closing typed with an extra couple of digits, or opening still
// carrying forward bad historical data (see blankShiftEntry's carry-forward
// above) that a normal closing value then reads as "hundreds of millions of
// litres sold." 100,000 L is already far beyond any real shift/day at a
// single nozzle — generous on purpose, so this only ever catches an
// obvious typo or bad carried-forward figure, never a genuinely busy day.
const MAX_REALISTIC_SHIFT_LITERS = 100000
function isReadingLitersUnrealistic(reading) {
  return readingLiters(reading) > MAX_REALISTIC_SHIFT_LITERS
}

// First fuel/nozzle combination (in display order) whose reading fails
// either check above, or null if every reading on this shift is internally
// consistent and in bounds. Used to block "Save Entry" and to know exactly
// which input to scroll to and focus, the same way duplicate oil/payment
// rows already do.
function findInvalidReading(value, fuelKeys) {
  for (const fuelKey of fuelKeys) {
    for (const nozzleKey of NOZZLE_KEYS) {
      const reading = value[fuelKey]?.[nozzleKey]
      if (!reading) continue
      if (isReadingValueTooLarge(reading)) return { fuelKey, nozzleKey, reason: 'tooLarge' }
      if (isReadingClosingTooLow(reading) || isReadingClosingMissing(reading)) return { fuelKey, nozzleKey, reason: 'closingTooLow' }
      if (isReadingLitersUnrealistic(reading)) return { fuelKey, nozzleKey, reason: 'litersTooLarge' }
    }
  }
  return null
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

// A product picked in Pocket oil/Servo oil without both a Rate and a Sold
// Count would silently contribute ₹0 to the shift total — the row looks
// filled in (a product is chosen) but nothing was actually recorded against
// it. Only flagged once a product is actually selected — an empty,
// never-touched row isn't "incomplete", it's just unused (same "don't flag
// what nobody's touched yet" rule as isReadingClosingTooLow above).
//
// Checked as "> 0", not just "not blank": a row loaded back from the server
// (see normalizeFuelOilRow in DataContext.jsx) always carries real numbers,
// never '' — a legacy row saved before this validation existed (product
// picked, Rate/Count never actually filled in) round-trips as stockCount: 0,
// stockRate: 0, which a blank-string check alone would wrongly read as
// "already filled in". Neither field is ever legitimately 0 for a real oil
// sale — a rate of ₹0 or a sold count of 0 both mean nothing was recorded —
// so either one is exactly as incomplete as it being blank.
function isOilRowIncomplete(row) {
  if (!row?.productId) return false
  const hasRate = row.stockRate !== '' && row.stockRate != null && Number(row.stockRate) > 0
  const hasCount = row.stockCount !== '' && row.stockCount != null && Number(row.stockCount) > 0
  return !hasRate || !hasCount
}

// First oil/cane-oil row (in display order) with a product selected but
// Rate and/or Sold Count still blank, or null if every row is either fully
// filled in or has no product picked at all. Same "find the exact offender,
// then block+focus" pattern as findOilRowExceedingStock below.
function findIncompleteOilRow(oilRows, caneOilRows) {
  for (const row of [...(oilRows || []), ...(caneOilRows || [])]) {
    if (isOilRowIncomplete(row)) return row
  }
  return null
}

// Same available-stock derivation OilRow itself uses, so "Save Entry" can
// never disagree with what the row is already showing inline.
function oilRowAvailable(row, lubricants, committedCount) {
  const product = (lubricants || []).find((p) => p.id === row.productId)
  if (!product) return null
  const available = row.stockRate ? stockAvailableAtCost(product, row.stockRate) : round3(Number(product.stock) || 0)
  return available + (Number(committedCount) || 0)
}

// First oil/cane-oil row (in display order) whose Sold Count exceeds its
// product's available stock, or null if every row is within bounds — same
// "find the exact offender, then block+focus" pattern as findInvalidReading
// and duplicateRowIds above. `committedCountFor(rowId)` supplies the same
// already-committed-for-a-final-shift adjustment OilRow itself applies (see
// its comment) — passed in rather than recomputed here so Save can never
// disagree with what the row is already showing inline.
function findOilRowExceedingStock(oilRows, caneOilRows, lubricants, committedCountFor) {
  for (const row of [...(oilRows || []), ...(caneOilRows || [])]) {
    const committed = committedCountFor ? committedCountFor(row.id) : 0
    if (isOilCountOverStock(row.stockCount, oilRowAvailable(row, lubricants, committed))) return row
  }
  return null
}

// A payment line's "key" — whichever field actually identifies who/what the
// money is for. Cash and expense lines key off their (free-typed or
// dropdown) label; credit/employeeCredit key off the selected
// customer/employee instead, since two credit lines could share a label
// ("Credit") but must never share a customer.
function paymentLineKeyValue(p) {
  if (p.type === 'credit') return p.customerId || ''
  if (p.type === 'employeeCredit') return p.employeeId || ''
  return (p.label || '').trim().toLowerCase()
}

// A line with money entered but no key would still count toward Payments
// Collected (paymentsTotal sums every line unconditionally) while never
// actually reaching anyone's ledger/expense record — the amount looks
// "accounted for" here but silently goes nowhere. A line with NO value
// entered is exempt entirely, key or no key — there's nothing to lose track
// of yet, so it's not worth blocking the save over.
function paymentLineMissingKey(p) {
  if (!(Number(p.amount) > 0)) return false
  return !paymentLineKeyValue(p)
}

// Same "one key, one row" rule as duplicateRowIds above, applied to payment
// lines — grouped by type first so a customer id can never collide with an
// employee id or a payment-method label that happens to look similar. Rows
// with no value entered are exempt (same reasoning as paymentLineMissingKey
// above) — a duplicate blank row isn't a real problem, only a duplicate row
// that actually counts toward the total is.
function duplicatePaymentLineIds(payments) {
  const seen = new Map()
  for (const p of payments || []) {
    if (!(Number(p.amount) > 0)) continue
    const key = paymentLineKeyValue(p)
    if (!key) continue
    const groupKey = `${p.type}::${key}`
    if (!seen.has(groupKey)) seen.set(groupKey, [])
    seen.get(groupKey).push(p.id)
  }
  const duplicates = new Set()
  for (const ids of seen.values()) {
    if (ids.length > 1) ids.forEach((id) => duplicates.add(id))
  }
  return duplicates
}

// A field whose real value is exactly 0 used to render the literal digit
// "0" inside the input, with the same visual weight as any other typed
// value — so replacing it meant deleting that "0" first before typing the
// real reading/amount, every single time, since most readings/payment
// lines genuinely start at 0. Showing 0 as a placeholder instead (the field
// looks empty, "0" greyed out, same as the already-blank case) means typing
// straight over it just works. Purely a display choice for the `value` prop
// handed to the input — onChange still receives whatever's actually typed,
// and blank is saved as 0 exactly as before, so nothing about what gets
// saved changes.
function zeroAsPlaceholder(value) {
  return value === '' || value == null || Number(value) === 0 ? '' : value
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
function OilRow({ t, lubricants, productId, onSelectProduct, count, rate, onRateAndCountChange, amount, onRemove, showRemove, isDuplicate, isIncomplete, committedCount }) {
  const selectedProduct = (lubricants || []).find((p) => p.id === productId)
  // Available is per PURCHASE COST batch (see stockAvailableAtCost) — before
  // a rate is picked there's no batch to report yet, so this used to fall
  // back to the product's TOTAL stock across every batch. That number could
  // (and often did) let a manager type a Sold Count that looked fine against
  // it, only for isOverStock below to flip on the moment they then picked a
  // rate whose own batch held less — a validation error appearing to come
  // out of nowhere. Null here (nothing shown, Sold Count disabled below)
  // until a rate is actually selected removes that moving target entirely.
  const available = selectedProduct && rate ? stockAvailableAtCost(selectedProduct, rate) : null

  // A FINAL shift already had this exact row's count subtracted from the
  // product's stock the moment it was finalized (see _apply_oil_stock on the
  // backend) — so reopening it to edit something else shows `available`
  // already short by however much THIS row itself is holding, and the row's
  // own already-saved count then reads as "exceeding" stock that, from this
  // row's own point of view, it already legitimately claimed. Reopening a
  // final entry (touching nothing) must never show a validation error it
  // didn't have when it was saved — so `committedCount` (this row's count as
  // of when the shift card was first opened — see ShiftCard's
  // committedOilCountFor, the same lookup the Save-time check below also
  // uses, so the two can never disagree) is added back to `available`
  // before checking it. ShiftCard already zeroes this out entirely for a
  // draft shift, which never reserved anything against real stock in the
  // first place — this component doesn't need to know draft vs final at all.
  const effectiveAvailable = available == null ? null : available + (Number(committedCount) || 0)

  // Same breakdown stockAvailableAtCost() itself used to reach `available` —
  // read fresh from the live product/rate every render, so the tooltip can
  // never show a number that disagrees with the clamp actually applied above.
  const availableBreakdown = selectedProduct && rate ? availableAtCostBreakdown(selectedProduct, rate) : null
  const availableTooltipRows = availableBreakdown
    ? availableBreakdown.singleBatch || availableBreakdown.costNotFound
      ? [{ label: t.currentStockLabel, value: `${availableBreakdown.totalStock} ${selectedProduct.unit}` }]
      : [
          { label: t.purchasedInPeriodLabel, value: `${availableBreakdown.purchasedAtCost} ${selectedProduct.unit}` },
          { label: t.currentStockLabel, value: `${availableBreakdown.totalStock} ${selectedProduct.unit}` },
        ]
    : []
  const availableTooltipFormula = availableBreakdown
    ? availableBreakdown.singleBatch
      ? `${t.currentStockLabel} (${availableBreakdown.totalStock}) = ${t.availableLabel} (${available} ${selectedProduct.unit})`
      : availableBreakdown.costNotFound
        ? t.rateNotInHistoryNote
        : `min(${t.purchasedInPeriodLabel} ${availableBreakdown.purchasedAtCost}, ${t.currentStockLabel} ${availableBreakdown.totalStock}) = ${t.availableLabel} (${available} ${selectedProduct.unit})`
    : ''
  const availableTooltipNote = availableBreakdown && !availableBreakdown.singleBatch && !availableBreakdown.costNotFound ? t.availableApproxNote : undefined
  const isOverStock = isOilCountOverStock(count, effectiveAvailable)
  // isIncomplete just means "this row needs attention" — only actually
  // highlight whichever of Rate/Count is the one still blank, not both, when
  // the manager already filled in one of them.
  const missingRate = isIncomplete && !(rate !== '' && rate != null && Number(rate) > 0)
  const missingCount = isIncomplete && !(count !== '' && count != null && Number(count) > 0)

  function handleCountChange(v) {
    onRateAndCountChange(rate, v)
  }

  // Switching rate no longer auto-clamps Count down either — same reasoning
  // as handleCountChange above. A rate change can legitimately land the
  // count over the new rate's own available stock; isOverStock flags it the
  // same way, rather than silently rewriting a number the manager didn't
  // touch.
  function handleRateChange(newRate) {
    onRateAndCountChange(newRate, count)
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
            title={missingRate ? t.oilRowIncompleteHint : t.oilStockRateHint}
            className={`text-xs ${isDuplicate || missingRate ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : ''}`}
          >
            <option value="">{t.selectRate}</option>
            {purchaseBatchesByCost(selectedProduct).map((b) => (
              <option key={b.cost} value={b.cost}>
                {formatCurrency(b.cost)}
              </option>
            ))}
          </Select>
        </div>
        {selectedProduct && rate ? (
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
            step="any"
            value={count || ''}
            onChange={(e) => handleCountChange(e.target.value)}
            placeholder="0"
            disabled={!rate}
            title={
              !rate
                ? t.oilStockSelectRateFirstHint
                : isOverStock
                  ? t.oilCountExceedsStockHint(effectiveAvailable)
                  : missingCount
                    ? t.oilRowIncompleteHint
                    : available != null
                      ? t.soldCountHint(available)
                      : undefined
            }
            className={`text-xs ${isOverStock || missingCount ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : ''}`}
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
      {isOverStock ? (
        <p className="mt-1.5 text-xs font-medium text-rose-500">{t.oilCountExceedsStockHint(effectiveAvailable)}</p>
      ) : isDuplicate ? (
        <p className="mt-1.5 text-xs font-medium text-rose-500">{t.duplicateOilRowHint}</p>
      ) : isIncomplete ? (
        <p className="mt-1.5 text-xs font-medium text-rose-500">{t.oilRowIncompleteHint}</p>
      ) : null}
    </div>
  )
}

// One employee's shift — a fully independent, separately-saved record.
// There's no draft/autosave of any kind any more: nothing is persisted
// anywhere (not the database, not this browser) until a deliberate "Save
// Entry" click. That's the only thing that ever reaches the backend, the
// only thing that finalizes a shift (applies attendance/credit/stock
// effects) — and, now, the only way anything typed here survives at all.
const ShiftCard = forwardRef(function ShiftCard(
  {
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
    onSaveFinal,
    savingFinal,
  },
  ref,
) {
  const navigate = useNavigate()
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
  const [uploadingBill, setUploadingBill] = useState(false)
  // Id of an uploaded bill the manager clicked the X on — removal (below)
  // deletes the real S3 object right away, not just this local list entry,
  // so it's gated behind a confirmation instead of firing immediately.
  const [confirmRemoveBillId, setConfirmRemoveBillId] = useState(null)
  // Id of a just-added payment line still waiting to be scrolled to and
  // focused — set by the add* functions below, consumed by the effect right
  // after this one.
  const [pendingFocusId, setPendingFocusId] = useState(null)
  const paymentRowRefs = useRef(new Map())
  const oilRowRefs = useRef(new Map())
  const readingRowRefs = useRef(new Map())
  const employeeFieldRef = useRef(null)
  // Snapshot of this shift's oil/cane-oil rows as they were the moment this
  // card first mounted — i.e., for an already-final shift, exactly how much
  // of each row's own count is already subtracted from the product's live
  // stock (see _apply_oil_stock on the backend). Deliberately captured once
  // (useRef's initial value is only ever read on the first render) rather
  // than kept live, so a fresh edit to THIS row's own count can't "add
  // itself back" and defeat the over-stock check entirely — only a NEW
  // edit's count is ever compared against the ORIGINAL committed amount.
  const committedOilRowsRef = useRef(value.oilRows)
  const committedCaneOilRowsRef = useRef(value.caneOilRows)
  // A not-yet-final shift never reserved anything against real stock in the
  // first place (only a final save applies oil-stock side effects), so this
  // stays 0 for one and only ever adds back a final shift's own
  // already-committed share.
  function committedOilCountFor(rowId) {
    if (value.status !== 'final') return 0
    return (
      committedOilRowsRef.current?.find((r) => r.id === rowId)?.stockCount ??
      committedCaneOilRowsRef.current?.find((r) => r.id === rowId)?.stockCount ??
      0
    )
  }
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
      // For an oversized image this transparently shrinks it under the cap
      // instead of rejecting it outright — see prepareBillFile.
      const { file: preparedFile, error } = await prepareBillFile(file)
      if (error) {
        toast.error(error === 'size' ? tRoot.errorBillTooLarge : tRoot.errorBillFileType)
        return
      }
      // Uploads straight to S3 (see apiClient.uploadBillFile) — the backend
      // only ever learns the resulting key, on the next save, never the
      // file bytes themselves. `url` here holds that key, unchanged, for as
      // long as this bill sits untouched — that's what lets the backend's
      // own diff-on-save recognize it as the same bill and skip re-touching
      // it in S3 or Postgres.
      const { name, key } = await uploadBillFile(preparedFile, 'fuel-entry-bills')
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
      oilRows: value.oilRows.map((row) => (row.id === id ? { ...row, productId, stockRate: product ? lastPurchaseOf(product)?.cost ?? '' : '', stockCount: '' } : row)),
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
        row.id === id ? { ...row, productId, stockRate: product ? lastPurchaseOf(product)?.cost ?? '' : '', stockCount: '' } : row,
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
  // Same product at the same rate should only ever be one row — checked
  // separately per section (a pocket-oil duplicate never flags a cane-oil row).
  const duplicateOilRowIds = useMemo(() => duplicateRowIds(value.oilRows), [value.oilRows])
  const duplicateCaneOilRowIds = useMemo(() => duplicateRowIds(value.caneOilRows), [value.caneOilRows])
  const hasDuplicateOilRows = duplicateOilRowIds.size > 0 || duplicateCaneOilRowIds.size > 0
  // A row with a product picked but Rate/Sold Count still blank only turns
  // red once a save was actually attempted — same as shiftEmployeeMissing —
  // so a product just picked a moment ago doesn't immediately look like an
  // error before the manager's even had a chance to fill in the rest.
  const incompleteOilRowIds = useMemo(() => {
    const ids = new Set()
    for (const row of [...(value.oilRows || []), ...(value.caneOilRows || [])]) {
      if (isOilRowIncomplete(row)) ids.add(row.id)
    }
    return ids
  }, [value.oilRows, value.caneOilRows])
  // Live, not gated by attemptedSubmit — same as the oil-row duplicate check
  // above, a duplicate payment-line key is unambiguously wrong the moment it
  // happens, not just at save time.
  const duplicatePaymentIds = useMemo(() => duplicatePaymentLineIds(value.payments), [value.payments])

  // Scrolls to and focuses whichever payment line failed validation, and
  // switches to the Payments tab first if the manager was on Reading — so
  // "there's a problem" always comes with "here's exactly where", instead of
  // just a toast the manager then has to go hunting for the row themselves.
  function focusPaymentLine(id) {
    setActiveShiftTab('payments')
    requestAnimationFrame(() => {
      const row = paymentRowRefs.current.get(id)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      row?.querySelector('input, select')?.focus()
    })
  }

  // Same pattern as focusPaymentLine above, for a bad meter reading — the
  // Closing input is always the 2nd of the row's 4 inputs (Opening/Closing/
  // Testing/Rate), so that's the one actually focused, not just the row
  // scrolled into view.
  function focusReadingRow(fuelKey, nozzleKey) {
    setActiveShiftTab('reading')
    requestAnimationFrame(() => {
      const row = readingRowRefs.current.get(`${fuelKey}-${nozzleKey}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const inputs = row?.querySelectorAll('input')
      ;(inputs?.[1] || inputs?.[0])?.focus()
    })
  }

  // Same pattern as focusPaymentLine/focusReadingRow above, minus the tab
  // switch — the employee picker sits above the Reading/Payments tabs, so
  // it's always on screen already. Select is a custom combobox rendered as
  // a <button> (see FormControls.jsx), not a real <select>, hence querying
  // for "button" specifically rather than "input, select".
  function focusEmployeeField() {
    requestAnimationFrame(() => {
      const field = employeeFieldRef.current
      field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      field?.querySelector('button')?.focus()
    })
  }

  // Oil/cane-oil rows live on the Reading tab, same as focusReadingRow above
  // — flashRow already scrolls/focuses/highlights via oilRowRefs (it's also
  // what a newly-added row uses), this just also makes sure that tab is
  // actually showing first.
  function focusOilRow(rowId) {
    setActiveShiftTab('reading')
    flashRow(rowId)
  }

  // Returns whether the save actually went through — false on any
  // validation block (the manager sees the same shake/toast/focus-jump as
  // always) or a failed API call, true once it's genuinely saved. This lets
  // an external caller (see attemptSave below, used by the unsaved-changes
  // prompt's "Save" button) know whether it's safe to also proceed with
  // whatever navigation that prompt was guarding, without duplicating a
  // single line of this validation.
  async function handleSaveFinalClick() {
    // A bill still mid-compress/upload hasn't been added to value.bills yet
    // — saving right now would go through without it, and the compressed
    // file would land a moment later with nothing left listening for it.
    // The Save button below is already disabled while this is true; this is
    // the belt-and-braces guard for the function itself.
    if (uploadingBill) return false
    // A closing reading below opening+testing means the meter ran
    // backwards — physically impossible, and the UI already shows this as
    // an inline error the moment it happens. That visual warning alone
    // never stopped the save going through; this is what actually blocks
    // it, checked first since a meter reading this wrong makes everything
    // downstream (litres, amount, totals) meaningless too.
    const invalidReading = findInvalidReading(value, fuelKeys)
    if (invalidReading) {
      setAttemptedSubmit(true)
      toast.error(
        invalidReading.reason === 'tooLarge'
          ? t.readingTooLargeHint
          : invalidReading.reason === 'litersTooLarge'
            ? t.readingLitersUnrealisticHint
            : t.closingTooLowHint,
      )
      focusReadingRow(invalidReading.fuelKey, invalidReading.nozzleKey)
      return false
    }
    if (hasDuplicateOilRows) {
      toast.error(tRoot.errorDuplicateOilRow)
      return false
    }
    // A product picked in Pocket oil/Servo oil without a Rate and Sold Count
    // would otherwise save silently contributing ₹0 — same
    // "shows a problem, but only blocking Save actually stops it" pattern as
    // the meter-reading check above.
    const incompleteOilRow = findIncompleteOilRow(value.oilRows, value.caneOilRows)
    if (incompleteOilRow) {
      setAttemptedSubmit(true)
      toast.error(tRoot.errorOilRowIncomplete)
      focusOilRow(incompleteOilRow.id)
      return false
    }
    // A Sold Count can end up over its product's available stock without
    // the manager ever having typed something absurd — e.g. another shift's
    // sale of the same product got finalized after this row's count was
    // already set. The field itself never blocks typing (see
    // isOilCountOverStock above), so this is what actually stops the save.
    const overStockRow = findOilRowExceedingStock(value.oilRows, value.caneOilRows, lubricants, committedOilCountFor)
    if (overStockRow) {
      toast.error(tRoot.errorOilCountExceedsStock)
      focusOilRow(overStockRow.id)
      return false
    }
    // A payment line with money entered but no key (no method picked, no
    // customer/employee selected, no expense name typed) would still count
    // toward Payments Collected (paymentsTotal sums every line
    // unconditionally), but silently never reach anyone's ledger/expense
    // record — the amount looks "accounted for" here while it actually goes
    // nowhere. Block the save and take the manager straight to that exact
    // row instead of letting it slip through with just a toast.
    const missingKeyLine = (value.payments || []).find(paymentLineMissingKey)
    if (missingKeyLine) {
      setAttemptedSubmit(true)
      const message =
        missingKeyLine.type === 'credit'
          ? tRoot.errorCreditCustomerRequired
          : missingKeyLine.type === 'employeeCredit'
            ? tRoot.errorCreditEmployeeRequired
            : missingKeyLine.type === 'expense'
              ? tRoot.errorExpenseLabelRequired
              : tRoot.errorPaymentMethodRequired
      toast.error(message)
      focusPaymentLine(missingKeyLine.id)
      return false
    }
    // Two rows for the same customer/employee/payment method/expense name
    // would double-count that one payment — same "one key, one row" rule as
    // the oil-row duplicate check above.
    if (duplicatePaymentIds.size > 0) {
      const duplicateLine = (value.payments || []).find((p) => duplicatePaymentIds.has(p.id))
      toast.error(tRoot.errorDuplicatePaymentKey)
      if (duplicateLine) focusPaymentLine(duplicateLine.id)
      return false
    }
    // Bill-upload requirement temporarily disabled — see shiftBillsMissing above.
    if (!value.employeeId /* || !value.bills || value.bills.length === 0 */) {
      setAttemptedSubmit(true)
      setShakeKey((k) => k + 1)
      // No toast here — the rose-colored hint under the field (driven by
      // shiftEmployeeMissing) plus the shake and the focus jump below are
      // the error; a toast on top just repeated the same message a beat
      // later, since it has to wait for its own mount/animate-in.
      if (!value.employeeId) focusEmployeeField()
      return false
    }
    setAttemptedSubmit(true)
    return (await onSaveFinal(value)) !== false
  }

  // Exposed via ref as-is (no navigation) — this is what the shift/pump/date
  // switch prompts' "Save" button calls (see PumpDayEditor's
  // attemptSaveDirtyShifts), and those want to save-then-continue-switching,
  // never save-then-leave-the-page-entirely.
  useImperativeHandle(ref, () => ({ attemptSave: handleSaveFinalClick }))

  // Only for a direct "Save Entry"/"Save Changes" click (or its Enter-key
  // equivalent below) — a genuine save succeeding here means the manager is
  // done with this shift, so it's back to the history table, new entry or
  // edit alike. A failed save (validation or the request itself) returns
  // false and never navigates, leaving them right where the error still is.
  async function handleSaveFinalAndReturn() {
    const ok = await handleSaveFinalClick()
    if (ok) navigate('/fuel-entry')
    return ok
  }

  // This card isn't a <form> (it holds several tab sections plus its own
  // internal "add row"/tab-switch buttons, which would need their own
  // type="button" auditing if it were), so pressing Enter never reaches
  // Save Entry on its own. Mirror native form Enter-to-submit behavior by
  // hand: only for a plain text/number <input> (never a <textarea>, and
  // never a <button> — that would double up with the browser's own
  // Enter-triggers-click on whichever button is focused, e.g. "Add row").
  function handleCardKeyDown(e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return
    e.preventDefault()
    handleSaveFinalAndReturn()
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white/80 p-4" onKeyDown={handleCardKeyDown}>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        {value.id ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">{t.savedLabel}</span>
        ) : (
          <span className="shrink-0 text-xs font-semibold text-slate-600">{t.employeeNameLabel}</span>
        )}
        {/* value.id + createdByName — a genuinely saved shift whose creator
            actually resolved to a real Users row (see attach_actor_names on
            the backend; null if that account's since been deleted). Purely
            informational, same as the Saved badge next to it — never read
            by any total/calculation, which still come solely from
            utils/fuelCalc.js. */}
        {value.id && value.createdByName ? (
          <span className="text-xs text-slate-400">{t.createdByLabel(value.createdByName, formatDateTime(value.createdAt))}</span>
        ) : null}
        <motion.div
          ref={employeeFieldRef}
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
                {formatEmployeeName(emp)}
                {unavailableEmployeeIds?.has(emp.id) ? ` (${tRoot.employeeUnavailableSuffix})` : ''}
              </option>
            ))}
          </Select>
          {shiftEmployeeMissing ? <span className="mt-1 block text-xs font-medium text-rose-500">{tRoot.errorEmployeeRequired}</span> : null}
        </motion.div>
      </div>

      <div className="mb-3.5 border-b border-slate-200 pb-3.5">
        <div className="inline-flex gap-2 rounded-full border border-slate-200 p-1">
          {['reading', 'payments'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveShiftTab(tab)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                activeShiftTab === tab ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {tab === 'reading' ? t.readingTabLabel : t.payments}
            </button>
          ))}
        </div>
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
          unwanted vertical scrollbar on and off. scrollbar-hide (index.css)
          keeps the scroll itself working — still needed when an unusually
          large reading (an extra mistyped digit) makes a row overflow even
          above the sm breakpoint — it just hides the scrollbar chrome, which
          otherwise visibly flashed during this card's mount/tab-switch
          animation. */}
      <div className="-mx-1 overflow-x-auto overflow-y-hidden px-1 scrollbar-hide">
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
                  const netLiters = readingLiters(reading)
                  // The "already typed something inconsistent" case is live,
                  // same as the duplicate-row checks — but the "still blank"
                  // case only lights up once a save was actually attempted,
                  // same as shiftEmployeeMissing below, so a fresh auto-filled
                  // card doesn't show red before the manager has had a chance
                  // to type anything.
                  const isClosingTooLow = isReadingClosingTooLow(reading) || (attemptedSubmit && isReadingClosingMissing(reading))
                  const isRowTooLarge = isReadingValueTooLarge(reading)
                  const isLitersUnrealistic = !isRowTooLarge && !isClosingTooLow && isReadingLitersUnrealistic(reading)
                  const tooLargeField = (field) => {
                    const raw = reading[field]
                    if (raw === '' || raw == null) return false
                    const n = Number(raw)
                    return Number.isFinite(n) && n > MAX_READING_VALUE
                  }
                  return (
                    <div
                      key={nozzleKey}
                      ref={(el) => {
                        const rowKey = `${fuelKey}-${nozzleKey}`
                        if (el) readingRowRefs.current.set(rowKey, el)
                        else readingRowRefs.current.delete(rowKey)
                      }}
                    >
                      <div className="grid grid-cols-[0.6fr_1.7fr_1.7fr_0.7fr_1.5fr_1fr_1.1fr] items-center gap-2">
                        <span className="pl-2 text-xs font-medium text-slate-500">{t.nozzleLabel(nozzleIdx + 1)}</span>
                        <Input
                          type="number"
                          step="any"
                          value={zeroAsPlaceholder(reading.opening)}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'opening', e.target.value)}
                          placeholder="0"
                          className={`px-2.5 py-2 ${tooLargeField('opening') ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : ''}`}
                          title={isDerivedOpening ? t.autoFromHandover : tooLargeField('opening') ? t.readingTooLargeHint : undefined}
                        />
                        <Input
                          type="number"
                          step="any"
                          value={zeroAsPlaceholder(closingRaw)}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'closing', e.target.value)}
                          placeholder="0"
                          className={`px-2.5 py-2 ${
                            isClosingTooLow || isLitersUnrealistic || tooLargeField('closing')
                              ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100'
                              : ''
                          }`}
                          title={
                            tooLargeField('closing')
                              ? t.readingTooLargeHint
                              : isClosingTooLow
                                ? t.closingTooLowHint
                                : isLitersUnrealistic
                                  ? t.readingLitersUnrealisticHint
                                  : undefined
                          }
                        />
                        <Input
                          type="number"
                          step="any"
                          value={zeroAsPlaceholder(reading.testing)}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'testing', e.target.value)}
                          placeholder="0"
                          className={`px-2.5 py-2 ${tooLargeField('testing') ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : ''}`}
                          title={tooLargeField('testing') ? t.readingTooLargeHint : undefined}
                        />
                        <Input
                          type="number"
                          step="any"
                          value={zeroAsPlaceholder(reading.rate)}
                          onChange={(e) => updateReading(fuelKey, nozzleKey, 'rate', e.target.value)}
                          placeholder="0.00"
                          className={`px-2.5 py-2 ${tooLargeField('rate') ? 'border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-100' : ''}`}
                          title={tooLargeField('rate') ? t.readingTooLargeHint : undefined}
                        />
                        <span
                          className={`text-right text-sm ${isClosingTooLow || isLitersUnrealistic ? 'font-semibold text-rose-500' : 'text-slate-500'}`}
                          title={isClosingTooLow ? t.closingTooLowHint : isLitersUnrealistic ? t.readingLitersUnrealisticHint : t.litersHint}
                        >
                          {netLiters.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-right text-sm font-semibold ${isClosingTooLow || isLitersUnrealistic ? 'text-rose-500' : 'text-slate-700'}`}>
                          {formatCurrency(readingAmount(reading))}
                        </span>
                      </div>
                      {isRowTooLarge ? (
                        <p className="pl-2 pt-1 text-xs font-medium text-rose-500">{t.readingTooLargeHint}</p>
                      ) : isClosingTooLow ? (
                        <p className="pl-2 pt-1 text-xs font-medium text-rose-500">
                          {t.closingTooLowHint} ({t.opening.toLowerCase()}: {Number(reading.opening).toLocaleString('en-IN')})
                        </p>
                      ) : isLitersUnrealistic ? (
                        <p className="pl-2 pt-1 text-xs font-medium text-rose-500">
                          {t.readingLitersUnrealisticHint} ({netLiters.toLocaleString('en-IN', { maximumFractionDigits: 0 })} L)
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
                    isIncomplete={attemptedSubmit && incompleteOilRowIds.has(row.id)}
                    committedCount={committedOilCountFor(row.id)}
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
                    isIncomplete={attemptedSubmit && incompleteOilRowIds.has(row.id)}
                    committedCount={committedOilCountFor(row.id)}
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
            const isDuplicateKey = duplicatePaymentIds.has(p.id)
            const isMissingKey = attemptedSubmit && paymentLineMissingKey(p)
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
                          isMissingKey || isDuplicateKey
                            ? 'border-rose-400 text-rose-600 focus:border-rose-500 focus:ring-rose-100'
                            : 'text-rose-600'
                        }
                        title={isDuplicateKey ? tRoot.duplicatePaymentKeyHint : isMissingKey ? tRoot.errorCreditCustomerRequired : undefined}
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
                          isMissingKey || isDuplicateKey
                            ? 'border-rose-400 text-violet-600 focus:border-rose-500 focus:ring-rose-100'
                            : 'text-violet-600'
                        }
                        title={isDuplicateKey ? tRoot.duplicatePaymentKeyHint : isMissingKey ? tRoot.errorCreditEmployeeRequired : undefined}
                      >
                        <option value="">{t.selectEmployee}</option>
                        {(employees || []).map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {formatEmployeeName(emp)}
                          </option>
                        ))}
                      </Select>
                    ) : p.type === 'expense' ? (
                      <Input
                        value={p.label}
                        onChange={(e) => updatePaymentLine(p.id, 'label', e.target.value)}
                        placeholder={t.placeholderExpenseLabel}
                        className={isMissingKey || isDuplicateKey ? 'border-rose-400 text-amber-700 focus:border-rose-500 focus:ring-rose-100' : 'text-amber-700'}
                        title={isDuplicateKey ? tRoot.duplicatePaymentKeyHint : isMissingKey ? tRoot.errorExpenseLabelRequired : undefined}
                      />
                    ) : (
                      <Select
                        value={p.label}
                        onChange={(e) => updatePaymentLine(p.id, 'label', e.target.value)}
                        className={isMissingKey || isDuplicateKey ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100' : ''}
                        title={isDuplicateKey ? tRoot.duplicatePaymentKeyHint : isMissingKey ? tRoot.errorPaymentMethodRequired : undefined}
                      >
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
                      value={zeroAsPlaceholder(p.amount)}
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
                {isDuplicateKey ? <p className="mt-1 text-xs font-medium text-rose-500">{tRoot.duplicatePaymentKeyHint}</p> : null}
                {isMissingKey ? (
                  <p className="mt-1 text-xs font-medium text-rose-500">
                    {p.type === 'credit'
                      ? tRoot.errorCreditCustomerRequired
                      : p.type === 'employeeCredit'
                        ? tRoot.errorCreditEmployeeRequired
                        : p.type === 'expense'
                          ? tRoot.errorExpenseLabelRequired
                          : tRoot.errorPaymentMethodRequired}
                  </p>
                ) : null}

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
            <ul className="mb-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
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
                  <IconButton onClick={() => setConfirmRemoveBillId(bill.id)} aria-label={tRoot.removeBill} title={tRoot.removeBill} tone="delete">
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
          <PrimaryButton type="button" onClick={handleSaveFinalAndReturn} disabled={savingFinal || uploadingBill}>
            <Save size={15} /> {savingFinal ? tRoot.savingChanges : value.id ? tRoot.saveChanges : tRoot.saveEntry}
          </PrimaryButton>
        </div>
      </motion.div>
      {/* Blocks the whole page (not just this card's file input) — a bill
          upload takes long enough on a slow connection that Save Entry
          elsewhere on the page being disabled isn't obvious enough on its
          own; this makes it unmistakable that nothing is clickable yet. */}
      {uploadingBill ? <FullPageLoader label={tRoot.uploadingBillPrompt} /> : null}

      <ConfirmDialog
        isOpen={confirmRemoveBillId != null}
        onClose={() => setConfirmRemoveBillId(null)}
        onConfirm={() => removeBill(confirmRemoveBillId)}
        title={tRoot.removeBillTitle}
        description={tRoot.removeBillDesc}
        confirmLabel={tRoot.removeBill}
      />
    </div>
  )
})

const PumpDayEditor = forwardRef(function PumpDayEditor(
  {
    pumpKey,
    label,
    accent,
    tint,
    date,
    employees,
    fuelRates,
    creditCustomers,
    lubricants,
    unavailableEmployeeIds,
    onDirtyChange,
  },
  ref,
) {
  const { language } = useLanguage()
  const tRoot = FUEL_ENTRY_TEXT[language]
  const t = tRoot.pumpEditor
  const theme = TINTS[tint] || { bg: 'bg-white', border: 'border-slate-200' }
  const { fuelEntries, fuelEntriesLoading, addFuelEntry, updateFuelEntry, deleteFuelEntry } = useData()
  const navigate = useNavigate()

  // status: 'final' only — an incomplete/still-being-typed reading (or a
  // legacy status:'draft' row from before drafts were removed from this
  // page) must never be what tomorrow's Shift 1 opens from. Only a reading
  // the manager actually finished and saved counts as "where the meter
  // really left off."
  const priorEntries = useMemo(
    () => sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey && e.date < date && e.status === 'final')),
    [fuelEntries, pumpKey, date],
  )

  // A brand new Shift 1 pre-fills its opening reading from the pump's last
  // FINAL saved shift (whichever earlier day that was), or '0' if there's no
  // final record at all yet — never blank, and never anything short of the
  // real DB value. Shift 2+ never needs this since withCarriedOpenings
  // always derives their opening live from the card right before them in
  // the same array. Shared by the initial state below.
  function shift1CarriedOpenings() {
    const last = priorEntries[priorEntries.length - 1]
    const openings = {}
    for (const fuelKey of FUEL_KEYS_BY_PUMP[pumpKey]) {
      openings[fuelKey] = {
        nozzle1: last?.[fuelKey]?.nozzle1?.closing ?? '0',
        nozzle2: last?.[fuelKey]?.nozzle2?.closing ?? '0',
      }
    }
    return openings
  }

  function blankShiftEntry(shiftNumber) {
    const blank = emptyShiftEntry(pumpKey, date, shiftNumber, fuelRates)
    if (shiftNumber === 1) {
      const openings = shift1CarriedOpenings()
      for (const fuelKey of FUEL_KEYS_BY_PUMP[pumpKey]) {
        blank[fuelKey] = {
          nozzle1: { ...blank[fuelKey].nozzle1, opening: openings[fuelKey].nozzle1 },
          nozzle2: { ...blank[fuelKey].nozzle2, opening: openings[fuelKey].nozzle2 },
        }
      }
    }
    return blank
  }

  // Nothing is persisted anywhere (backend or browser) until a deliberate
  // "Save Entry" click — so the only starting point for this pump+day is
  // whatever the server already has. Nothing saved yet at all starts from a
  // single blank Shift 1; refreshing or navigating away before Save Entry
  // simply loses whatever was mid-typing, same as any plain form.
  const [cards, setCards] = useState(() => {
    const existing = sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey && e.date === date))
    return existing.length > 0 ? existing.map((e) => ({ ...e })) : [blankShiftEntry(1)]
  })

  // fuelEntries now loads from the API asynchronously — a hard refresh (or
  // just navigating here fast) can mount this before that fetch resolves,
  // so `cards`' lazy initializer above may have seeded a blank shift even
  // though a real entry for it already exists on the server (including a
  // legacy status:'draft' row saved before drafts were removed from this
  // page). Once loading finishes, merge that real data in per SHIFT SLOT —
  // not all-or-nothing — using the same _editGen marker updateCard sets (see
  // its comment): a slot the manager has genuinely typed into is left
  // exactly as-is, but an untouched slot always gets swapped for the real
  // server row. Getting this merge wrong the OTHER way (skipping it
  // entirely the moment ANY slot on this pump had been touched) risks a
  // stale, still-blank slot's own Save Entry click sending a CREATE for a
  // shift that already exists on the server, surfacing as "A shift entry
  // already exists for this date, pump, and shift number".
  const resyncedAfterLoadRef = useRef(false)
  useEffect(() => {
    if (fuelEntriesLoading || resyncedAfterLoadRef.current) return
    resyncedAfterLoadRef.current = true
    const existing = sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey && e.date === date))
    if (existing.length === 0) return
    let changed = false
    setCards((prev) => {
      const byShift = new Map(existing.map((e) => [e.shiftNumber, e]))
      const merged = prev.map((card) => {
        const server = byShift.get(card.shiftNumber)
        if (!server) return card
        if (!card._editGen) {
          // Untouched — the real server row is strictly better than
          // whatever the initial blank/guessed seed had.
          changed = true
          return { ...server }
        }
        // Genuinely being edited locally from here down — never overwrite
        // what the manager actually typed with the server's own field
        // values. But the shift number itself already has a row on the
        // server, most often because this same manager started typing
        // before the initial fuelEntries fetch resolved (a hard refresh
        // landing straight on this page) — two cases:
        if (server.status === 'final') {
          // Already finalized elsewhere/earlier: that record is now THE
          // real entry for this shift, full stop. Letting a local draft
          // attempt that never knew it existed keep "editing" a phantom
          // duplicate is exactly the confusion this whole merge exists to
          // avoid — the finalized row wins outright, same as an untouched
          // card above.
          changed = true
          return { ...server }
        }
        if (!card.id) {
          // Still just a draft server-side too, and this card hasn't
          // picked up an id of its own yet — adopt the server's id/status
          // so the NEXT autosave becomes an UPDATE instead of colliding
          // with that row as a duplicate CREATE (the "already exists" 409
          // this per-slot merge was built to prevent), without touching a
          // single field the manager has actually typed.
          changed = true
          return { ...card, id: server.id, status: 'draft' }
        }
        return card
      })
      // A server shift with no local slot at all yet (the initial blank
      // seed only ever creates Shift 1) needs its own card appended.
      for (const entry of existing) {
        if (!merged.some((c) => c.shiftNumber === entry.shiftNumber)) {
          merged.push({ ...entry })
          changed = true
        }
      }
      if (!changed) return prev
      merged.sort((a, b) => a.shiftNumber - b.shiftNumber)
      return merged
    })
    if (changed) setActiveShiftIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuelEntriesLoading])

  const [confirmRemoveIndex, setConfirmRemoveIndex] = useState(null)
  const [removing, setRemoving] = useState(false)
  // Only one shift's full form (readings, payments, bills...) shows at a
  // time — a "Shift 1 / Shift 2 / Shift 3" tab strip switches between them,
  // instead of stacking every shift's whole form one below the other.
  const [activeShiftIndex, setActiveShiftIndex] = useState(0)
  // Switching to another shift tab leaves the current one's unsaved edits
  // sitting untouched in memory (nothing about them changes) — "Leave
  // Anyway" just switches, without saving anything. "Save" (see
  // handleSaveAndSwitchShift below) actually runs the real Save Entry flow
  // for whichever shift(s) on this pump are dirty.
  const [pendingShiftIndex, setPendingShiftIndex] = useState(null)
  function requestSwitchShift(index) {
    if (index === activeShiftIndex) return
    if (hasEditedThisSessionRef.current && cards[activeShiftIndex]?._dirty) {
      setPendingShiftIndex(index)
      return
    }
    setActiveShiftIndex(index)
  }
  function confirmSwitchShift() {
    setActiveShiftIndex(pendingShiftIndex)
    setPendingShiftIndex(null)
  }

  // One ShiftCard instance per shift index — attemptSave (exposed via
  // useImperativeHandle) runs the exact same validation+save as that card's
  // own Save Entry button, so this never has to duplicate a single rule.
  const shiftCardRefs = useRef({})

  // Attempts to save every currently-dirty shift on this pump (almost
  // always just one). Returns true only once ALL of them genuinely saved —
  // a validation failure or a failed request on any one of them (already
  // surfaced to the manager via that shift's own toast/shake/focus-jump)
  // means the caller should NOT proceed with whatever it was about to do.
  async function attemptSaveDirtyShifts() {
    const dirtyIndices = cards.map((c, i) => (c._dirty ? i : -1)).filter((i) => i !== -1)
    if (dirtyIndices.length === 0) return true
    const results = await Promise.all(dirtyIndices.map((i) => shiftCardRefs.current[i]?.attemptSave() ?? false))
    return results.every(Boolean)
  }

  // Exposed so FuelEntryForm can save this pump's dirty shift(s) from ITS
  // OWN unsaved-changes prompts (switching pumps, changing date, leaving the
  // page/screen entirely) — same underlying save as the shift-switch prompt
  // above, just triggered from one level up.
  useImperativeHandle(ref, () => ({ attemptSaveDirtyShifts }))

  // "Save" in the shift-switch prompt: save whatever's dirty on this pump,
  // and only actually switch tabs once that's genuinely succeeded — a
  // blocked/failed save leaves the manager right where the error is, same
  // as clicking Save Entry directly would.
  async function handleSaveAndSwitchShift() {
    const target = pendingShiftIndex
    const ok = await attemptSaveDirtyShifts()
    setPendingShiftIndex(null)
    if (ok) setActiveShiftIndex(target)
  }

  // Shift 1's opening is directly editable (pre-filled once above from the
  // pump's last saved shift, whichever earlier day that was). Shift 2+'s
  // opening is never independently stored — it's always the live closing of
  // the card right before it, so a handover reading is entered exactly once.
  const effectiveCards = useMemo(() => withCarriedOpenings(cards), [cards])

  // Whether THIS pump/day actually has a Shift 2 / Shift 3 card, checked by
  // its real shiftNumber — never by cards.length, which silently assumes
  // shift 1 is always at index 0, shift 2 at index 1, etc. Deleting a shift
  // straight from the History table (rather than via the toggles below,
  // which only ever remove from the end) can leave a gap — e.g. Shift 1
  // deleted while Shift 2 remains — where that assumption breaks and the
  // toggles/tab labels/add-shift logic would otherwise mismatch or silently
  // hide/override a real shift.
  const hasShift2 = cards.some((c) => c.shiftNumber === 2)
  const hasShift3 = cards.some((c) => c.shiftNumber === 3)

  // Gates the "Save this shift before moving on?" prompts (both
  // requestSwitchShift's own shift-tab guard above and pumpDirty/
  // onDirtyChange just below) on top of raw `_dirty`. Set once true and
  // never reset for the life of this component; a ref rather than state
  // since it's read at click/save time, never rendered on its own.
  const hasEditedThisSessionRef = useRef(false)

  // Whether ANY shift on this pump has unsaved changes right now — reported
  // up to FuelEntryForm (see onDirtyChange) so it can warn before switching
  // pumps or leaving the page entirely, on top of this component's own
  // guard on switching shift tabs, below.
  const pumpDirty = useMemo(
    () => hasEditedThisSessionRef.current && cards.some((c) => c._dirty),
    [cards],
  )
  useEffect(() => {
    onDirtyChange?.(pumpDirty)
    // A remount (the date changes — see FuelEntryForm's `key` prop) or this
    // component going away entirely must not leave a stale "dirty" signal
    // behind for whatever pump/date the manager lands on next.
    return () => onDirtyChange?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpDirty])

  // "Add Lubricant" (pump2 only) used to be a plain <Link> straight to
  // /lubricants — a real route change, not just a tab switch within this
  // page, so it skipped every unsaved-changes guard entirely (FuelEntryForm's
  // own guard only wraps its OWN back-button/date-picker/pump-tab handlers,
  // never this link buried inside PumpDayEditor). Same "Save / Leave Anyway"
  // prompt as the shift-switch guard above, just navigating to a different
  // route on either branch instead of switching this pump's active tab.
  const [confirmLeaveForLubricant, setConfirmLeaveForLubricant] = useState(false)
  function requestAddLubricant() {
    if (pumpDirty) {
      setConfirmLeaveForLubricant(true)
      return
    }
    navigate('/lubricants')
  }
  function confirmGoToLubricantsAnyway() {
    setConfirmLeaveForLubricant(false)
    navigate('/lubricants')
  }
  async function handleSaveAndGoToLubricants() {
    const ok = await attemptSaveDirtyShifts()
    setConfirmLeaveForLubricant(false)
    if (ok) navigate('/lubricants')
  }


  // _editGen is bumped on every genuine edit to this specific card (typing)
  // — the reconciliation effect above keys off THIS, not object identity,
  // specifically because withCarriedOpenings (below) hands every later
  // shift a brand-new object reference the instant an EARLIER shift's
  // closing changes (its derived Opening tracks that live) — even though
  // nobody touched the later shift at all. _editGen survives that
  // recomputation untouched (withCarriedOpenings spreads the existing
  // object, it doesn't rebuild it), so only a real edit moves it, letting
  // that effect tell "untouched" apart from "genuinely being edited".
  // `dirty` defaults to true — the overwhelming majority of calls are a
  // genuine keystroke (ShiftCard's onChange below). The one call site that
  // ISN'T an edit the manager could lose — attaching the id/status a
  // successful Save Entry just returned — passes `dirty: false` explicitly,
  // since that leaves nothing unsaved behind for the unsaved-changes prompt
  // to warn about (see pumpDirty below).
  function updateCard(index, patch, dirty = true) {
    if (dirty) hasEditedThisSessionRef.current = true
    setCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch, _editGen: (c._editGen || 0) + 1, _dirty: dirty } : c)),
    )
  }

  function addShift(shiftNumber) {
    // The new card always lands at the END of the array (plain append) —
    // `cards.length` (captured before the append) IS that position. Using
    // `shiftNumber - 1` instead used to assume shift 1 is always at index 0,
    // shift 2 at index 1, etc., which a shift deleted directly from the
    // History table (rather than via these toggles, which always remove
    // from the end) can break — e.g. only Shift 2's card remaining at index
    // 0 after Shift 1 was deleted elsewhere, where `shiftNumber - 1` (1)
    // would activate a tab that doesn't exist.
    setActiveShiftIndex(cards.length)
    setCards((prev) => [...prev, emptyShiftEntry(pumpKey, date, shiftNumber, fuelRates)])
  }

  // Resolves to the actual array position of the card with this shift
  // number — never assumed to equal shiftNumber - 1 (see addShift above for
  // why that assumption doesn't hold once a shift's been removed out of
  // order). A no-op if that shift doesn't exist on this pump/day at all.
  function requestRemoveByShiftNumber(shiftNumber) {
    const index = cards.findIndex((c) => c.shiftNumber === shiftNumber)
    if (index !== -1) requestRemove(index)
  }

  function requestRemove(index) {
    if (cards[index].id) {
      setConfirmRemoveIndex(index)
    } else {
      setCards((prev) => prev.filter((_, i) => i !== index))
      setActiveShiftIndex((i) => Math.min(i, cards.length - 2))
    }
  }

  // A ref, not just the `removing` state, guards against a double-fire: the
  // Confirm button's `disabled={busy}` only takes effect once React actually
  // re-renders, which isn't synchronized with the click itself — a fast
  // double-click (or the browser queuing a second click event before that
  // render commits) could otherwise call this twice, sending a second
  // delete for an id the first call already removed and surfacing a
  // confusing error toast right on top of the real success one. A ref reads
  // as up to date the instant it's set, with no render in between.
  const removingRef = useRef(false)

  async function confirmRemove() {
    if (removingRef.current) return
    const index = confirmRemoveIndex
    if (index == null) return
    const card = cards[index]
    removingRef.current = true
    setRemoving(true)
    try {
      const wasSavedShift = Boolean(card.id)
      if (wasSavedShift) {
        await deleteFuelEntry(card.id)
        toast.success(tRoot.toastDeleted)
      }
      setCards((prev) => prev.filter((_, i) => i !== index))
      setActiveShiftIndex((i) => Math.min(i, cards.length - 2))
      setConfirmRemoveIndex(null)
      // Same "a genuine save takes you back to History" behavior as Save
      // Entry — a confirmed delete of an actually-saved shift is just as
      // final an action, and there's nothing left on this page for that
      // shift to keep editing. State is still cleaned up above FIRST (not
      // skipped) in case this component doesn't unmount perfectly in sync
      // with the route change — never leave it showing the just-deleted
      // card even for a frame. Toggling off a never-saved shift (wasSavedShift
      // false) is normal mid-edit tidying, not a reason to leave the page,
      // so that path never navigates.
      if (wasSavedShift) navigate('/fuel-entry')
    } catch (err) {
      toast.error(err.message || tRoot.toastSaveFailed)
    } finally {
      removingRef.current = false
      setRemoving(false)
    }
  }

  function buildPayload(index) {
    const effective = effectiveCards[index]
    // _editGen is local bookkeeping only (see updateCard above) — never
    // meant to leave the browser.
    const { id, localOnlyId, _editGen, ...rest } = effective
    return rest
  }

  // Final save happens once per shift (not per keystroke) — a deliberate
  // "Save Entry" click, same as removing a shift below, blocks the whole
  // page with FullPageLoader while it's in flight.
  const [savingFinalIndex, setSavingFinalIndex] = useState(null)
  // Ref guard, not just the `savingFinalIndex` state: the Save Entry
  // button's `disabled={savingFinal}` only takes effect once React
  // re-renders, which isn't synchronized with the click itself — a fast
  // double-click could otherwise fire this twice for the same shift before
  // that render lands, sending two concurrent final-saves for one entry. A
  // ref reads as up to date the instant it's set, with no render in between.
  const savingFinalRef = useRef(false)

  // Returns true once the API call genuinely succeeds, false on any
  // failure (including "already saving, this call is a no-op") — see
  // ShiftCard's handleSaveFinalClick, which folds this into its own
  // validation-then-save boolean for attemptSave/the unsaved-changes prompt.
  async function handleSaveFinal(index) {
    if (savingFinalRef.current) return false
    const payload = { ...buildPayload(index), status: 'final' }
    const card = cards[index]
    savingFinalRef.current = true
    setSavingFinalIndex(index)
    try {
      if (card.id) {
        await updateFuelEntry(card.id, payload)
        toast.success(tRoot.toastUpdated)
      } else {
        const id = await addFuelEntry(payload)
        updateCard(index, { id }, false)
        toast.success(tRoot.toastAdded)
      }
      updateCard(index, { status: 'final' }, false)
      return true
    } catch (err) {
      toast.error(err.message || tRoot.toastSaveFailed)
      return false
    } finally {
      savingFinalRef.current = false
      setSavingFinalIndex(null)
    }
  }

  // A deliberate write (finalize/remove) in flight on THIS pump blocks
  // switching/adding/removing shift tabs on this pump too, so a manager
  // can't e.g. remove Shift 2 while Shift 1's finalize is still saving. The
  // FullPageLoader rendered below already blocks the rest of the page
  // visually; this additionally guards this pump's own tab strip.
  const busy = savingFinalIndex != null || removing

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
                return (
                  <button
                    key={card.id || card.localOnlyId}
                    type="button"
                    onClick={() => requestSwitchShift(index)}
                    disabled={busy}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      index === activeShiftIndex ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {/* card.shiftNumber, not index+1 — a shift deleted directly
                        from the History table (rather than via the "2nd/3rd
                        shift" toggles below, which always remove from the
                        end) can leave a gap, e.g. only Shift 2's card
                        remaining at array position 0. Labeling by position
                        would then show that real Shift 2 data under a
                        "Shift 1" tab. */}
                    {t.shiftLabel(card.shiftNumber)}
                    {!card.id ? (
                      <span className={`h-1.5 w-1.5 rounded-full ${index === activeShiftIndex ? 'bg-white/70' : 'bg-slate-400'}`} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
          {pumpKey === 'pump2' ? (
            <button
              type="button"
              onClick={requestAddLubricant}
              title={t.addLubricantLinkHint}
              className="flex items-center gap-1.5 rounded-full border border-emerald-200 px-3.5 py-1.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <ExternalLink size={14} /> {t.addLubricantLink}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <ToggleSwitch
            checked={hasShift2}
            disabled={busy || hasShift3}
            title={hasShift3 ? t.removeThirdShiftFirst : undefined}
            label={t.secondShiftToggle}
            onChange={(on) => (on ? addShift(2) : requestRemoveByShiftNumber(2))}
          />
          {/* hasShift2 || hasShift3 (not cards.length >= 2) — if Shift 2 was
              deleted directly from the History table while Shift 3 was left
              behind, this toggle still needs to show so that now-orphaned
              Shift 3 stays visible and removable, instead of silently
              becoming unreachable through this UI. */}
          {hasShift2 || hasShift3 ? (
            <ToggleSwitch
              checked={hasShift3}
              disabled={busy}
              title={t.internalShiftHint}
              label={t.thirdShiftToggle}
              onChange={(on) => (on ? addShift(3) : requestRemoveByShiftNumber(3))}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {cards.map((card, index) => (
          <div key={card.id || card.localOnlyId} className={index === activeShiftIndex ? '' : 'hidden'}>
            <ShiftCard
              ref={(el) => {
                if (el) shiftCardRefs.current[index] = el
                else delete shiftCardRefs.current[index]
              }}
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
              onSaveFinal={() => handleSaveFinal(index)}
              savingFinal={savingFinalIndex === index}
            />
          </div>
        ))}
      </div>

      <ConfirmDialog
        isOpen={pendingShiftIndex != null}
        onClose={() => setPendingShiftIndex(null)}
        onCancelClick={handleSaveAndSwitchShift}
        onConfirm={confirmSwitchShift}
        title={tRoot.unsavedChangesTitle}
        description={tRoot.unsavedChangesDesc}
        confirmLabel={tRoot.unsavedChangesLeave}
        cancelLabel={tRoot.unsavedChangesStay}
        confirmTone="leave"
      />

      <ConfirmDialog
        isOpen={confirmLeaveForLubricant}
        onClose={() => setConfirmLeaveForLubricant(false)}
        onCancelClick={handleSaveAndGoToLubricants}
        onConfirm={confirmGoToLubricantsAnyway}
        title={tRoot.unsavedChangesTitle}
        description={tRoot.unsavedChangesDesc}
        confirmLabel={tRoot.unsavedChangesLeave}
        cancelLabel={tRoot.unsavedChangesStay}
        confirmTone="leave"
      />

      <ConfirmDialog
        isOpen={confirmRemoveIndex != null}
        onClose={() => setConfirmRemoveIndex(null)}
        onConfirm={confirmRemove}
        title={tRoot.deleteTitle}
        description={tRoot.deleteDesc}
        loading={removing}
      />

      {savingFinalIndex != null ? <FullPageLoader label={tRoot.savingChanges} /> : null}
      {removing ? <FullPageLoader label={tRoot.deleting} /> : null}
    </motion.div>
  )
})

export default PumpDayEditor
