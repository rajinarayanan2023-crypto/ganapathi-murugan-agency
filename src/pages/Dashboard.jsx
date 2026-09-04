import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { BarChart } from '@mui/x-charts/BarChart'
import { Fuel, Droplets, Gauge, Package, Box, IndianRupee, Receipt, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Settings } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { DASHBOARD_TEXT } from '../i18n/dashboard.js'
import { monthlyFuelTotals, monthlyExpensesTotal, commissionEarned, monthlyProfit, trailingMonths } from '../utils/monthlyProfit.js'
import { formatCurrency, formatLiters } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import StatCard from '../components/StatCard.jsx'
import Modal from '../components/Modal.jsx'
import { Field, Input, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'

// Shared shell for a "trend over the last 6 months" bar chart. No fixed
// width is ever passed to BarChart, so it always fills whatever width its
// (responsive) container div gives it — resize the window and the chart
// redraws at the new width immediately, same as the rest of the page.
function TrendChartCard({ title, subtitle, dataset, dataKey, seriesLabel, color, delay }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5"
    >
      <div className="mb-1">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      <div className="h-52 w-full sm:h-64">
        <BarChart
          dataset={dataset}
          xAxis={[{ dataKey: 'label', scaleType: 'band', tickLabelStyle: { fontSize: 11, fill: '#94a3b8' } }]}
          yAxis={[{ tickLabelStyle: { fontSize: 11, fill: '#94a3b8' }, width: 52 }]}
          series={[{ id: dataKey, dataKey, label: seriesLabel, valueFormatter: (v) => formatCurrency(v), color }]}
          grid={{ horizontal: true }}
          margin={{ top: 10, right: 8, bottom: 26, left: 0 }}
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
  const { fuelEntries, expenseDays, commissionRates, updateCommissionRates } = useData()
  const { language } = useLanguage()
  const t = DASHBOARD_TEXT[language]
  const now = new Date()

  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonthIdx, setViewMonthIdx] = useState(now.getMonth())
  const [ratesModalOpen, setRatesModalOpen] = useState(false)
  const [ratesForm, setRatesForm] = useState(commissionRates)

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

  const fuelTotals = useMemo(() => monthlyFuelTotals(fuelEntries, viewYear, viewMonthIdx), [fuelEntries, viewYear, viewMonthIdx])
  const expensesTotal = useMemo(() => monthlyExpensesTotal(expenseDays, viewYear, viewMonthIdx), [expenseDays, viewYear, viewMonthIdx])
  const commission = useMemo(() => commissionEarned(fuelTotals, commissionRates), [fuelTotals, commissionRates])
  const profit = commission - expensesTotal

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
  const profitTrend = useMemo(
    () =>
      trendMonths.map(({ year, monthIdx }, i) => ({
        label: trendLabels[i],
        Profit: Math.round(monthlyProfit(fuelEntries, expenseDays, commissionRates, year, monthIdx)),
      })),
    [trendMonths, trendLabels, fuelEntries, expenseDays, commissionRates],
  )
  const expensesTrend = useMemo(
    () =>
      trendMonths.map(({ year, monthIdx }, i) => ({
        label: trendLabels[i],
        Expenses: Math.round(monthlyExpensesTotal(expenseDays, year, monthIdx)),
      })),
    [trendMonths, trendLabels, expenseDays],
  )

  function openRatesModal() {
    setRatesForm(commissionRates)
    setRatesModalOpen(true)
  }

  function submitRates(e) {
    e.preventDefault()
    updateCommissionRates({
      petrol: Number(ratesForm.petrol) || 0,
      diesel: Number(ratesForm.diesel) || 0,
      oil: Number(ratesForm.oil) || 0,
      oilPacket: Number(ratesForm.oilPacket) || 0,
      oilCane: Number(ratesForm.oilCane) || 0,
    })
    toast.success(t.toastRatesUpdated)
    setRatesModalOpen(false)
  }

  return (
    <div className="space-y-6">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard icon={Fuel} label={t.statPetrol} value={fuelTotals.petrolLtr} formatter={formatLiters} index={0} accent="orange" />
        <StatCard icon={Droplets} label={t.statDiesel} value={fuelTotals.dieselLtr} formatter={formatLiters} index={1} accent="blue" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Gauge} label={t.statOilMachine} value={fuelTotals.oilLtr} formatter={formatLiters} index={2} accent="green" />
        <StatCard icon={Package} label={t.statOilPacket} value={fuelTotals.pocketOilTotal} formatter={formatCurrency} index={3} accent="amber" />
        <StatCard icon={Box} label={t.statOilCane} value={fuelTotals.caneOilTotal} formatter={formatCurrency} index={4} accent="violet" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard icon={IndianRupee} label={t.statCommission} value={commission} formatter={formatCurrency} index={5} accent="brand" />
        <StatCard icon={Receipt} label={t.statExpenses} value={expensesTotal} formatter={formatCurrency} index={6} accent="rose" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
        className={`rounded-xl p-5 shadow-card ${profit >= 0 ? 'bg-gradient-to-r from-emerald-600 to-emerald-800' : 'bg-gradient-to-r from-rose-600 to-rose-800'}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-white/80">
              {profit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {profit >= 0 ? t.statProfit : t.loss}
            </p>
            <p className="mt-1 text-3xl font-extrabold text-white">{formatCurrency(Math.abs(profit))}</p>
            <p className="mt-1 text-xs text-white/70">{t.commissionNote}</p>
          </div>
        </div>
      </motion.div>

      <Modal isOpen={ratesModalOpen} onClose={() => setRatesModalOpen(false)} title={t.editRatesTitle}>
        <form onSubmit={submitRates} className="space-y-4">
          <p className="text-xs text-slate-500">{t.editRatesHint}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t.fieldPetrolRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.petrol}
                onChange={(e) => setRatesForm({ ...ratesForm, petrol: e.target.value })}
              />
            </Field>
            <Field label={t.fieldDieselRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.diesel}
                onChange={(e) => setRatesForm({ ...ratesForm, diesel: e.target.value })}
              />
            </Field>
            <Field label={t.fieldOilRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.oil}
                onChange={(e) => setRatesForm({ ...ratesForm, oil: e.target.value })}
              />
            </Field>
            <Field label={t.fieldOilPacketRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.oilPacket}
                onChange={(e) => setRatesForm({ ...ratesForm, oilPacket: e.target.value })}
              />
            </Field>
            <Field label={t.fieldOilCaneRate}>
              <Input
                type="number"
                min="0"
                step="any"
                value={ratesForm.oilCane}
                onChange={(e) => setRatesForm({ ...ratesForm, oilCane: e.target.value })}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setRatesModalOpen(false)}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit">{t.saveChanges}</PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  )
}
