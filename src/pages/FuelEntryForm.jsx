import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ReceiptText, Fuel, TrendingUp, AlertTriangle, ClipboardCheck } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { FUEL_ENTRY_TEXT } from '../i18n/fuelEntry.js'
import { formatCurrency, todayISO } from '../utils/format.js'
import { aggregateEntries, withCarriedOpenings, sortPumpEntries } from '../utils/fuelCalc.js'
import EmptyState from '../components/EmptyState.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import CalcBreakdown from '../components/CalcBreakdown.jsx'
import PumpDayEditor from '../components/PumpDayEditor.jsx'
import AuditModal from '../components/AuditModal.jsx'

// Each shift is its own independently-saved record now (see PumpDayEditor —
// every shift card has its own Save/Save-as-Draft). This page is just the
// day-level shell around that: pick a date, switch between the two pumps,
// and see the combined totals once shifts are saved. Nothing here submits
// anything itself.
export default function FuelEntryForm() {
  const { entryId } = useParams()
  const navigate = useNavigate()
  const { fuelEntries, fuelEntriesLoading, fuelRates, employees, creditCustomers, lubricants, station, updateStation } = useData()
  const { language } = useLanguage()
  const t = FUEL_ENTRY_TEXT[language]
  const activeEmployees = useMemo(() => employees.filter((e) => e.active !== false), [employees])

  // Arriving via a History row (entryId set) jumps straight to that shift's
  // day + pump; arriving via "New Day Entry" starts on today, Pump 1.
  const linkedEntry = entryId ? fuelEntries.find((e) => e.id === entryId) : null
  const [date, setDate] = useState(() => linkedEntry?.date || todayISO())
  const [activeTab, setActiveTab] = useState(() => linkedEntry?.pumpKey || 'pump1')
  const [auditOpen, setAuditOpen] = useState(false)
  // Its own state, entirely separate from the main audit above — Shift 3's
  // report is its own thing, opened independently.
  const [shift3AuditOpen, setShift3AuditOpen] = useState(false)

  // fuelEntries now loads from the API asynchronously — a hard refresh (or a
  // bookmark) landing directly on a specific entry's URL can mount before
  // that fetch resolves, so date/activeTab above may have fallen back to
  // "today, Pump 1" even though a real entryId was given. Once loading
  // finishes, jump to the entry's actual date/pump — once only, so this
  // never fights a manager who's already switched tabs by the time it lands.
  const resyncedLinkedEntryRef = useRef(false)
  useEffect(() => {
    if (!entryId || fuelEntriesLoading || resyncedLinkedEntryRef.current) return
    resyncedLinkedEntryRef.current = true
    if (linkedEntry) {
      setDate(linkedEntry.date)
      setActiveTab(linkedEntry.pumpKey)
    }
  }, [entryId, fuelEntriesLoading, linkedEntry])

  if (entryId && !linkedEntry) {
    // Still fetching — avoid a misleading "no entries" flash before the real
    // one arrives; render nothing rather than a page-blocking spinner.
    if (fuelEntriesLoading) return null
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <EmptyState icon={ReceiptText} title={t.emptyTitle} description={t.emptyDesc} />
      </div>
    )
  }

  // Combined Pump 1 + Pump 2 totals for the viewed date, from whatever
  // shifts are currently saved — updates live as each shift card is saved.
  // Also keeps each pump's own entries/aggregate/bill count around for the
  // Audit report, which breaks the day down per pump as well as overall.
  //
  // Shift 3 is deliberately split out of every one of these totals. It's
  // used to snapshot a meter reading right when the OMC fuel price changes
  // mid-day — a real, physical shift (its opening still carries forward from
  // whatever shift ran right before it, same as any other), but its
  // litres/cash are their own thing, not "the day's sales." So it gets its
  // own combined-both-pumps total and its own audit, entirely separate from
  // the day's Shift 1 + Shift 2 total and audit.
  const dayBreakdown = useMemo(() => {
    const dayEntries = fuelEntries.filter((e) => e.date === date)
    const perPump = { pump1: [], pump2: [] }
    for (const pumpKey of ['pump1', 'pump2']) {
      // withCarriedOpenings needs every shift (1/2/3) together, in order, so
      // shift 3's opening still resolves correctly from shift 2 (or 1)'s
      // closing — only AFTER that do shift 3's entries get split out below.
      perPump[pumpKey] = withCarriedOpenings(sortPumpEntries(dayEntries.filter((e) => e.pumpKey === pumpKey)))
    }
    const mainOf = (list) => list.filter((e) => e.shiftNumber !== 3)
    const shift3Of = (list) => list.filter((e) => e.shiftNumber === 3)
    const shiftNumberOf = (list, n) => list.filter((e) => e.shiftNumber === n)

    const mainPump1 = mainOf(perPump.pump1)
    const mainPump2 = mainOf(perPump.pump2)
    const shift3Pump1 = shift3Of(perPump.pump1)
    const shift3Pump2 = shift3Of(perPump.pump2)

    const mainCombined = [...mainPump1, ...mainPump2]
    const shift3Combined = [...shift3Pump1, ...shift3Pump2]

    return {
      dayTotals: aggregateEntries(mainCombined),
      pump1: { entries: mainPump1, aggregate: aggregateEntries(mainPump1) },
      pump2: { entries: mainPump2, aggregate: aggregateEntries(mainPump2) },
      billsCount: mainCombined.reduce((sum, e) => sum + (e.bills?.length || 0), 0),
      // Both-pumps subtotal per shift number — purely for the Day Total
      // tooltip's "Shift 1 + Shift 2 = Day Total" breakdown below.
      shift1Totals: aggregateEntries([...shiftNumberOf(perPump.pump1, 1), ...shiftNumberOf(perPump.pump2, 1)]),
      shift2Totals: aggregateEntries([...shiftNumberOf(perPump.pump1, 2), ...shiftNumberOf(perPump.pump2, 2)]),

      hasShift3: shift3Combined.length > 0,
      shift3Totals: aggregateEntries(shift3Combined),
      shift3Pump1: { entries: shift3Pump1, aggregate: aggregateEntries(shift3Pump1) },
      shift3Pump2: { entries: shift3Pump2, aggregate: aggregateEntries(shift3Pump2) },
      shift3BillsCount: shift3Combined.reduce((sum, e) => sum + (e.bills?.length || 0), 0),
    }
  }, [fuelEntries, date])
  const dayTotals = dayBreakdown.dayTotals
  const shift3Totals = dayBreakdown.shift3Totals

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
        <div className="flex flex-col gap-1.5 border-b border-slate-100 pb-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/fuel-entry')}
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700"
            >
              <ArrowLeft size={15} /> {t.entryHistory}
            </button>
            <span className="hidden h-4 w-px bg-slate-200 sm:block" />
            <h2 className="text-base font-bold text-slate-800">{t.newEntry}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs font-semibold text-slate-600">{t.fieldDate}</span>
            <AppDatePicker value={date} onChange={setDate} variant="compact" className="w-[148px] shrink-0" />
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-200 transition-colors hover:bg-brand-50"
            >
              <ClipboardCheck size={13} /> {t.auditButton}
            </button>
            {dayBreakdown.hasShift3 ? (
              <button
                type="button"
                onClick={() => setShift3AuditOpen(true)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-violet-700 shadow-sm ring-1 ring-violet-200 transition-colors hover:bg-violet-50"
              >
                <ClipboardCheck size={13} /> {t.shift3AuditButton}
              </button>
            ) : null}
          </div>
        </div>

        <DayTotalBanner
          icon={ReceiptText}
          title={t.dayTotal}
          totals={dayTotals}
          t={t}
          breakdown={{
            rows: [
              { label: t.shift1BreakdownLabel, value: formatCurrency(dayBreakdown.shift1Totals.totalSaleAmount) },
              { label: t.shift2BreakdownLabel, value: formatCurrency(dayBreakdown.shift2Totals.totalSaleAmount) },
            ],
            formula: t.dayTotalFormula(
              formatCurrency(dayBreakdown.shift1Totals.totalSaleAmount),
              formatCurrency(dayBreakdown.shift2Totals.totalSaleAmount),
              formatCurrency(dayTotals.totalSaleAmount),
            ),
            note: dayBreakdown.hasShift3 ? t.shift3ExcludedNote : undefined,
          }}
        />

        {dayBreakdown.hasShift3 ? (
          <DayTotalBanner
            icon={Fuel}
            title={t.shift3DayTotal}
            totals={shift3Totals}
            t={t}
            tone="violet"
            breakdown={{
              rows: [
                { label: t.pump1, value: formatCurrency(dayBreakdown.shift3Pump1.aggregate.totalSaleAmount) },
                { label: t.pump2, value: formatCurrency(dayBreakdown.shift3Pump2.aggregate.totalSaleAmount) },
              ],
              formula: t.shift3TotalFormula(
                formatCurrency(dayBreakdown.shift3Pump1.aggregate.totalSaleAmount),
                formatCurrency(dayBreakdown.shift3Pump2.aggregate.totalSaleAmount),
                formatCurrency(shift3Totals.totalSaleAmount),
              ),
              note: t.shift3SeparateNote,
            }}
          />
        ) : null}

        <div className="flex items-center gap-2 border-b border-slate-100">
          <PumpTab active={activeTab === 'pump1'} onClick={() => setActiveTab('pump1')} label={t.pump1} accentText="text-violet-600" accentBar="bg-violet-600" />
          <PumpTab active={activeTab === 'pump2'} onClick={() => setActiveTab('pump2')} label={t.pump2} accentText="text-ocean-600" accentBar="bg-ocean-600" />
        </div>

        <div className={`pt-3 ${activeTab === 'pump1' ? '' : 'hidden'}`}>
          <PumpDayEditor
            key={`pump1-${date}`}
            pumpKey="pump1"
            label={t.pump1}
            accent="bg-violet-600"
            tint="violet"
            date={date}
            employees={activeEmployees}
            fuelRates={fuelRates}
            creditCustomers={creditCustomers}
          />
        </div>
        <div className={`pt-3 ${activeTab === 'pump2' ? '' : 'hidden'}`}>
          <PumpDayEditor
            key={`pump2-${date}`}
            pumpKey="pump2"
            label={t.pump2}
            accent="bg-ocean-600"
            tint="blue"
            date={date}
            employees={activeEmployees}
            fuelRates={fuelRates}
            creditCustomers={creditCustomers}
            lubricants={lubricants}
          />
        </div>
      </div>

      <AuditModal
        isOpen={auditOpen}
        onClose={() => setAuditOpen(false)}
        date={date}
        station={station}
        onUpdateAuditContact={(email) => updateStation({ auditContactEmail: email })}
        pump1={{ label: t.pump1, ...dayBreakdown.pump1 }}
        pump2={{ label: t.pump2, ...dayBreakdown.pump2 }}
        dayTotals={dayTotals}
        billsCount={dayBreakdown.billsCount}
        employees={employees}
        creditCustomers={creditCustomers}
        lubricants={lubricants}
      />

      {dayBreakdown.hasShift3 ? (
        <AuditModal
          isOpen={shift3AuditOpen}
          onClose={() => setShift3AuditOpen(false)}
          date={date}
          station={station}
          onUpdateAuditContact={(email) => updateStation({ auditContactEmail: email })}
          pump1={{ label: t.pump1, ...dayBreakdown.shift3Pump1 }}
          pump2={{ label: t.pump2, ...dayBreakdown.shift3Pump2 }}
          dayTotals={shift3Totals}
          billsCount={dayBreakdown.shift3BillsCount}
          employees={employees}
          creditCustomers={creditCustomers}
          lubricants={lubricants}
          variantLabel={t.shift3AuditLabel}
        />
      ) : null}
    </div>
  )
}

// Shared shell for a "Sale / Payments / Excess-Shortage" stat strip — used
// once for the day's own Shift 1 + 2 total, and again (only when Shift 3
// exists for the date) for Shift 3's own, entirely separate, both-pumps
// total. `tone` swaps the non-shortage accent color so the two are visually
// distinct at a glance; a shortfall always reads rose either way.
function DayTotalBanner({ icon: Icon, title, totals, t, tone = 'brand', breakdown }) {
  const isShortage = totals.excessShortage < 0
  const toneClasses =
    tone === 'violet'
      ? { border: 'border-violet-300', bg: 'bg-violet-100', icon: 'text-violet-700' }
      : { border: 'border-brand-300', bg: 'bg-brand-100', icon: 'text-brand-700' }
  const titleEl = (
    <div className="flex shrink-0 items-center gap-2">
      <motion.span
        animate={{ rotate: [0, -8, 8, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
      >
        <Icon size={16} className={isShortage ? 'text-rose-600' : toneClasses.icon} />
      </motion.span>
      <h4 className="cursor-help text-sm font-bold text-slate-800 underline decoration-dotted decoration-slate-300 underline-offset-4">{title}</h4>
    </div>
  )
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={`my-2 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border p-3 shadow-sm ${
        isShortage ? 'border-rose-300 bg-rose-50' : `${toneClasses.border} ${toneClasses.bg}`
      }`}
    >
      {breakdown ? (
        <AppTooltip title={<CalcBreakdown rows={breakdown.rows} formula={breakdown.formula} note={breakdown.note} />} placement="bottom-start">
          {titleEl}
        </AppTooltip>
      ) : (
        titleEl
      )}
      <dl className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <Row label={t.rowTotalSale} value={totals.totalSaleAmount} />
        <Row label={t.rowTotalPayments} value={totals.totalPayments} />
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className={`flex shrink-0 items-center gap-1 text-xs font-semibold sm:text-sm ${isShortage ? 'text-rose-500' : 'text-emerald-600'}`}>
            {isShortage ? (
              <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}>
                <AlertTriangle size={14} />
              </motion.span>
            ) : (
              <TrendingUp size={14} />
            )}
            <span className="truncate">{isShortage ? t.cashShortage : t.excessCash}</span>
          </span>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={formatCurrency(totals.excessShortage)}
              initial={{ opacity: 0, y: -6, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: [1, 1.06, 1] }}
              transition={{
                scale: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' },
                opacity: { duration: 0.25 },
                y: { duration: 0.25 },
              }}
              className={`inline-block shrink-0 text-sm font-extrabold sm:text-base ${isShortage ? 'text-rose-500' : 'text-emerald-600'}`}
            >
              {isShortage ? '' : '+'}
              {formatCurrency(totals.excessShortage)}
            </motion.span>
          </AnimatePresence>
        </div>
      </dl>
    </motion.div>
  )
}

function Row({ label, value }) {
  const formatted = formatCurrency(value)
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="truncate text-xs text-slate-500 sm:text-sm">{label}</dt>
      <dd className="shrink-0 font-bold text-slate-800">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={formatted}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, scale: [1, 1.06, 1] }}
            transition={{
              opacity: { duration: 0.22, ease: 'easeOut' },
              y: { duration: 0.22, ease: 'easeOut' },
              scale: { duration: 1.1, repeat: Infinity, ease: 'easeInOut' },
            }}
            className="inline-block text-sm sm:text-base"
          >
            {formatted}
          </motion.span>
        </AnimatePresence>
      </dd>
    </div>
  )
}

function PumpTab({ active, onClick, label, accentText, accentBar }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-3.5 py-2 text-sm font-bold transition-colors ${
        active ? accentText : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      <Fuel size={16} />
      {label}
      {active ? <span className={`absolute inset-x-0 -bottom-px h-0.5 rounded-full ${accentBar}`} /> : null}
    </button>
  )
}
