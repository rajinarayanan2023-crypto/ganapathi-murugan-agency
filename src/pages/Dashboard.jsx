import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { BarChart } from '@mui/x-charts/BarChart'
import { AlertTriangle, CalendarDays, Pencil, Trash2, Fuel, Droplets, Gauge, Package, Box, IndianRupee, Receipt, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { DASHBOARD_TEXT } from '../i18n/dashboard.js'
import { trailingMonths } from '../utils/monthlyProfit.js'
import { formatCurrency, formatCompactCurrency, formatLiters, formatDate, todayISO } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import CountUp from '../components/CountUp.jsx'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import { Field, Input, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

// 'YYYY-MM' — what GET /api/v1/dashboard/summary expects and what
// DataContext's session cache is keyed by.
function monthKey(year, monthIdx) {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`
}

const EMPTY_SUMMARY = {
  petrol_litres: 0,
  diesel_litres: 0,
  oil_machine_litres: 0,
  oil_packet_units: 0,
  oil_packet_amount: 0,
  oil_cane_units: 0,
  oil_cane_amount: 0,
  commission_earned: 0,
  total_expenses: 0,
  profit: 0,
  rate_status: 'using_historical_rates',
}

// Shared shell for a "trend over the last 6 months" bar chart. No fixed
// width is ever passed to BarChart, so it always fills whatever width its
// (responsive) container div gives it — resize the window and the chart
// redraws at the new width immediately, same as the rest of the page.
function TrendChartCard({ title, subtitle, dataset, dataKey, seriesLabel, color, delay }) {
  // MUI's own auto-scaled y-domain "nice()"-rounds to a fat, round span
  // (e.g. 0 to -1,00,000) regardless of how small the actual figures are —
  // the 0 baseline then sits well above the plot's own bottom edge, leaving
  // a dead strip of empty white space below the axis/month labels before
  // the card ends. Bounding the domain tightly to the real data (plus a
  // little breathing room) keeps the 0 line pinned to the bottom whenever
  // every month is ⩾ 0, and only extends downward as far as an actual loss
  // month needs.
  const values = dataset.map((d) => Number(d[dataKey]) || 0)
  const dataMin = Math.min(0, ...values)
  const dataMax = Math.max(0, ...values)
  const span = dataMax - dataMin
  const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(dataMax) * 0.15, 100)
  const yMin = dataMin < 0 ? dataMin - pad : 0
  const yMax = dataMax > 0 ? dataMax + pad : pad

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-3.5"
    >
      <div className="mb-1">
        <h3 className="text-xs font-bold text-slate-800">{title}</h3>
        <p className="text-[11px] text-slate-400">{subtitle}</p>
      </div>
      <div className="h-40 w-full sm:h-48">
        <BarChart
          dataset={dataset}
          xAxis={[{ dataKey: 'label', scaleType: 'band', tickLabelStyle: { fontSize: 11, fill: '#94a3b8' }, height: 28 }]}
          yAxis={[
            {
              tickLabelStyle: { fontSize: 11, fill: '#94a3b8' },
              valueFormatter: (v) => formatCompactCurrency(v),
              width: 56,
              min: yMin,
              max: yMax,
            },
          ]}
          series={[{ id: dataKey, dataKey, label: seriesLabel, valueFormatter: (v) => formatCurrency(v), color }]}
          grid={{ horizontal: true }}
          margin={{ top: 10, right: 8, bottom: 2, left: 0 }}
          slotProps={{ legend: { position: { vertical: 'top', horizontal: 'end' } } }}
          sx={{
            '& .MuiChartsAxis-line, & .MuiChartsAxis-tick': { stroke: '#e2e8f0' },
            '& .MuiChartsGrid-line': { stroke: '#f1f5f9' },
            '& .MuiBarElement-root[data-value^="-"]': { fill: '#e11d48' },
            '& .MuiChartsLegend-series text': { fontSize: '11px !important' },
          }}
        />
      </div>
    </motion.div>
  )
}

export default function Dashboard() {
  const { updateCommissionRates, getCommissionRateHistory, deleteCommissionRate, getDashboardSummaryCached } = useData()
  const { language } = useLanguage()
  const t = DASHBOARD_TEXT[language]
  const now = new Date()

  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonthIdx, setViewMonthIdx] = useState(now.getMonth())
  const [ratesModalOpen, setRatesModalOpen] = useState(false)
  const [ratesForm, setRatesForm] = useState({ petrol: '', diesel: '', oil: '', oilPacket: '', oilCane: '', effectiveFrom: todayISO() })
  const [savingRates, setSavingRates] = useState(false)
  const [rateHistory, setRateHistory] = useState([])
  const [rateHistoryLoading, setRateHistoryLoading] = useState(false)
  const [deletingRateId, setDeletingRateId] = useState(null)
  const [confirmDeleteRate, setConfirmDeleteRate] = useState(null)

  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState(null)
  // Parallel to trendMonths below — one summary per trailing month, used by
  // both trend charts. Starts empty so the charts just render with zeros
  // until each month's (cached) summary resolves.
  const [trendSummaries, setTrendSummaries] = useState([])

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonthIdx === now.getMonth()
  const monthLabel = new Date(viewYear, viewMonthIdx, 1).toLocaleDateString(language === 'ta' ? 'ta-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
  })

  function goPrevMonth() {
    if (viewMonthIdx === 0) {
      setViewYear((y) => y - 1)
      setViewMonthIdx(11)
    } else {
      setViewMonthIdx((m) => m - 1)
    }
  }

  function goNextMonth() {
    if (isCurrentMonth) return
    if (viewMonthIdx === 11) {
      setViewYear((y) => y + 1)
      setViewMonthIdx(0)
    } else {
      setViewMonthIdx((m) => m + 1)
    }
  }

  const viewMonthKey = monthKey(viewYear, viewMonthIdx)

  // One call per month view — the actual aggregation (litres, historically-
  // rated commission, expenses, profit) happens server-side; this just asks
  // for it, through DataContext's session cache so revisiting an
  // already-viewed month is instant instead of refetching.
  useEffect(() => {
    let cancelled = false
    setSummaryLoading(true)
    setSummaryError(null)
    getDashboardSummaryCached(viewMonthKey)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch((err) => {
        // Stores the raw backend message (or `true` as a "use the generic
        // fallback" marker) rather than baking t.loadError in here — the
        // actual translated string is derived at render time instead (see
        // summaryErrorMessage below), so toggling language while this error
        // is showing re-localizes it immediately, and t.loadError no longer
        // has to sit in this effect's own deps just to force a re-run.
        // t.loadError being a dependency previously meant every single
        // language toggle re-ran this ENTIRE month fetch — a real network
        // request with its own brief loading flicker, for a value that
        // hadn't actually changed.
        if (!cancelled) setSummaryError(err.message || true)
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [viewMonthKey, getDashboardSummaryCached])
  const summaryErrorMessage = summaryError ? (typeof summaryError === 'string' ? summaryError : t.loadError) : null

  const commission = Number(summary.commission_earned) || 0
  const expensesTotal = Number(summary.total_expenses) || 0
  const profit = Number(summary.profit) || 0

  // Last 6 months ending at the month currently being viewed, so paging
  // the month selector also slides the trend window along with it.
  const trendMonths = useMemo(() => trailingMonths(viewYear, viewMonthIdx, 6), [viewYear, viewMonthIdx])
  const trendLabels = useMemo(
    () =>
      trendMonths.map(({ year, monthIdx }) =>
        new Date(year, monthIdx, 1).toLocaleDateString(language === 'ta' ? 'ta-IN' : 'en-IN', { month: 'short', year: '2-digit' }),
      ),
    [trendMonths, language],
  )

  useEffect(() => {
    let cancelled = false
    Promise.all(trendMonths.map(({ year, monthIdx }) => getDashboardSummaryCached(monthKey(year, monthIdx))))
      .then((results) => {
        if (!cancelled) setTrendSummaries(results)
      })
      .catch(() => {
        // The main summary fetch above already surfaces a load error banner
        // for this same request pattern — the trend charts just stay at
        // their last-known values (or zeros) rather than duplicating it.
      })
    return () => {
      cancelled = true
    }
  }, [trendMonths, getDashboardSummaryCached])

  const profitTrend = useMemo(
    () =>
      trendMonths.map((_, i) => ({
        label: trendLabels[i],
        Profit: Math.round(Number(trendSummaries[i]?.profit) || 0),
      })),
    [trendMonths, trendLabels, trendSummaries],
  )
  const expensesTrend = useMemo(
    () =>
      trendMonths.map((_, i) => ({
        label: trendLabels[i],
        Expenses: Math.round(Number(trendSummaries[i]?.total_expenses) || 0),
      })),
    [trendMonths, trendLabels, trendSummaries],
  )

  // Never pre-fills from a local/mock placeholder — either the real,
  // most-recently-effective revision on record (list_all_ascending returns
  // oldest-first, so the last row is the current one), or genuinely blank
  // fields when nothing has ever been saved. effectiveFrom still defaults
  // to today, since opening this normally means entering a NEW revision.
  async function openRatesModal() {
    setRatesModalOpen(true)
    setRateHistoryLoading(true)
    try {
      const history = await getCommissionRateHistory()
      setRateHistory(history)
      const latest = history[history.length - 1]
      setRatesForm(
        latest
          ? {
              petrol: String(latest.petrol),
              diesel: String(latest.diesel),
              oil: String(latest.oil),
              oilPacket: String(latest.oil_packet),
              oilCane: String(latest.oil_cane),
              effectiveFrom: todayISO(),
            }
          : { petrol: '', diesel: '', oil: '', oilPacket: '', oilCane: '', effectiveFrom: todayISO() },
      )
    } catch {
      setRateHistory([])
    } finally {
      setRateHistoryLoading(false)
    }
  }

  // Loads a past revision back into the form (same effective_from) so
  // correcting a typo is just: pick the row, fix the number, Save — the
  // backend replaces that exact date's row instead of adding a duplicate.
  function editHistoryRow(row) {
    setRatesForm({
      petrol: String(row.petrol),
      diesel: String(row.diesel),
      oil: String(row.oil),
      oilPacket: String(row.oil_packet),
      oilCane: String(row.oil_cane),
      effectiveFrom: row.effective_from,
    })
  }

  // Re-fetches whatever's currently on screen (the viewed month's stats and
  // the 6-month trend) after a rate add/edit/delete — the mutation already
  // invalidated the affected months in the session cache, this just pulls
  // the fresh values back in immediately instead of waiting for the next
  // navigation to notice.
  async function refreshVisibleDashboardData() {
    const [refreshedSummary, refreshedTrend] = await Promise.all([
      getDashboardSummaryCached(viewMonthKey),
      Promise.all(trendMonths.map(({ year, monthIdx }) => getDashboardSummaryCached(monthKey(year, monthIdx)))),
    ])
    setSummary(refreshedSummary)
    setTrendSummaries(refreshedTrend)
  }

  async function submitRates(e) {
    e.preventDefault()
    setSavingRates(true)
    try {
      await updateCommissionRates({
        effectiveFrom: ratesForm.effectiveFrom,
        petrol: Number(ratesForm.petrol) || 0,
        diesel: Number(ratesForm.diesel) || 0,
        oil: Number(ratesForm.oil) || 0,
        oilPacket: Number(ratesForm.oilPacket) || 0,
        oilCane: Number(ratesForm.oilCane) || 0,
      })
      await refreshVisibleDashboardData()
      toast.success(t.toastRatesUpdated)
      setRatesModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingRates(false)
    }
  }

  async function handleDeleteRate() {
    if (!confirmDeleteRate) return
    setDeletingRateId(confirmDeleteRate.id)
    try {
      await deleteCommissionRate(confirmDeleteRate.id, confirmDeleteRate.effective_from)
      setRateHistory((prev) => prev.filter((r) => r.id !== confirmDeleteRate.id))
      await refreshVisibleDashboardData()
      toast.success(t.toastRateDeleted)
      setConfirmDeleteRate(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingRateId(null)
    }
  }

  return (
    <div className="space-y-4">
      {savingRates ? <FullPageLoader label={t.savingRates} /> : null}
      <PageHeader
        description={t.description}
        action={
          <IconButton onClick={openRatesModal} aria-label={t.editRatesAction} title={t.editRatesAction} tone="brand">
            <Settings size={16} />
          </IconButton>
        }
      />

      <div className="flex items-center gap-2">
        <button
          onClick={goPrevMonth}
          aria-label="Previous month"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-[130px] text-center text-sm font-bold text-slate-800">{monthLabel}</span>
        <button
          onClick={goNextMonth}
          disabled={isCurrentMonth}
          aria-label="Next month"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
        {isCurrentMonth ? (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{t.today}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TrendChartCard
          title={t.profitTrendTitle}
          subtitle={t.profitTrendSubtitle}
          dataset={profitTrend}
          dataKey="Profit"
          seriesLabel={t.legendProfit}
          color="#059669"
          delay={0}
        />
        <TrendChartCard
          title={t.expensesTrendTitle}
          subtitle={t.expensesTrendSubtitle}
          dataset={expensesTrend}
          dataKey="Expenses"
          seriesLabel={t.legendExpenses}
          color="#e11d48"
          delay={0.05}
        />
      </div>

      {summaryErrorMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">{summaryErrorMessage}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard icon={Fuel} label={t.statPetrol} value={Number(summary.petrol_litres) || 0} formatter={formatLiters} index={0} accent="orange" dense />
        <StatCard icon={Droplets} label={t.statDiesel} value={Number(summary.diesel_litres) || 0} formatter={formatLiters} index={1} accent="blue" dense />
        <StatCard icon={Gauge} label={t.statOilMachine} value={Number(summary.oil_machine_litres) || 0} formatter={formatLiters} index={2} accent="green" dense />
        <StatCard icon={Package} label={t.statOilPacket} value={Number(summary.oil_packet_amount) || 0} formatter={formatCurrency} index={3} accent="amber" dense />
        <StatCard icon={Box} label={t.statOilCane} value={Number(summary.oil_cane_amount) || 0} formatter={formatCurrency} index={4} accent="violet" dense />
        <StatCard icon={IndianRupee} label={t.statCommission} value={commission} formatter={formatCurrency} index={5} accent="brand" dense />
        <StatCard icon={Receipt} label={t.statExpenses} value={expensesTotal} formatter={formatCurrency} index={6} accent="rose" dense />
      </div>

      {!summaryLoading && summary.rate_status === 'no_rates_configured' ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 text-xs font-medium text-amber-700">
          <AlertTriangle size={14} className="shrink-0" />
          {t.noRatesConfigured}
        </div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        whileHover={{ y: -2 }}
        className={`relative overflow-hidden rounded-xl p-4 shadow-card ${profit >= 0 ? 'bg-gradient-to-r from-emerald-600 to-emerald-800' : 'bg-gradient-to-r from-rose-600 to-rose-800'}`}
      >
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }}
        />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-white/80">
              {profit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {profit >= 0 ? t.statProfit : t.loss}
            </p>
            <p className="mt-1 text-2xl font-extrabold text-white">
              <CountUp value={Math.abs(profit)} formatter={formatCurrency} />
            </p>
            <p className="mt-1 text-xs text-white/70">{t.commissionNote}</p>
          </div>
        </div>
      </motion.div>

      <Modal isOpen={ratesModalOpen} onClose={savingRates ? () => {} : () => setRatesModalOpen(false)} title={t.editRatesTitle}>
        <form onSubmit={submitRates} className="space-y-4">
          <p className="text-xs text-slate-500">{t.editRatesHint}</p>
          <Field label={t.fieldEffectiveFrom}>
            <AppDatePicker
              value={ratesForm.effectiveFrom}
              onChange={(date) => setRatesForm({ ...ratesForm, effectiveFrom: date })}
              className="w-full"
              disabled={savingRates}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t.fieldPetrolRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.petrol}
                onChange={(e) => setRatesForm({ ...ratesForm, petrol: e.target.value })}
                disabled={savingRates}
              />
            </Field>
            <Field label={t.fieldDieselRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.diesel}
                onChange={(e) => setRatesForm({ ...ratesForm, diesel: e.target.value })}
                disabled={savingRates}
              />
            </Field>
            <Field label={t.fieldOilRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.oil}
                onChange={(e) => setRatesForm({ ...ratesForm, oil: e.target.value })}
                disabled={savingRates}
              />
            </Field>
            <Field label={t.fieldOilPacketRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.oilPacket}
                onChange={(e) => setRatesForm({ ...ratesForm, oilPacket: e.target.value })}
                disabled={savingRates}
              />
            </Field>
            <Field label={t.fieldOilCaneRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.oilCane}
                onChange={(e) => setRatesForm({ ...ratesForm, oilCane: e.target.value })}
                disabled={savingRates}
              />
            </Field>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.historyTitle}</p>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              {rateHistoryLoading ? (
                <p className="text-xs text-slate-400">…</p>
              ) : rateHistory.length ? (
                rateHistory.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <CalendarDays size={11} className="shrink-0 text-slate-400" />
                      <span className="shrink-0 font-semibold text-slate-700">{formatDate(row.effective_from)}</span>
                      <span className="truncate">
                        {t.historyEntry(row.petrol, row.diesel, row.oil, row.oil_packet, row.oil_cane)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <IconButton
                        type="button"
                        onClick={() => editHistoryRow(row)}
                        disabled={savingRates || deletingRateId != null}
                        aria-label={t.historyEditAction}
                        title={t.historyEditAction}
                        tone="edit"
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        type="button"
                        onClick={() => setConfirmDeleteRate(row)}
                        disabled={savingRates || deletingRateId != null}
                        aria-label={t.historyDeleteAction}
                        title={t.historyDeleteAction}
                        tone="delete"
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400">{t.historyEmpty}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setRatesModalOpen(false)} disabled={savingRates}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={savingRates}>
              {t.saveChanges}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteRate}
        onClose={() => setConfirmDeleteRate(null)}
        onConfirm={handleDeleteRate}
        title={t.removeRateTitle}
        description={t.removeRateDesc}
        loading={deletingRateId != null}
      />
    </div>
  )
}
