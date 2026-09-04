import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet, IndianRupee, TrendingUp, Users, Pencil, ChevronLeft, ChevronRight, UserPlus, CalendarDays, Receipt, HandCoins } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { SALARY_TEXT } from '../i18n/salary.js'
import { EMPLOYEES_TEXT } from '../i18n/employees.js'
import { computeMonthlyPay, currentSalary, monthlyCreditTotal, monthlyCreditEntries, sortedSalaryHistory } from '../utils/salary.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import Modal from '../components/Modal.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import StatCard from '../components/StatCard.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { SkeletonStatCards, SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'

export default function Salary() {
  const navigate = useNavigate()
  const { employees, employeesLoading, employeesError, attendance, reviseSalary } = useData()
  const { language } = useLanguage()
  const t = SALARY_TEXT[language]
  const roleLabels = EMPLOYEES_TEXT[language].roleLabels
  const loading = employeesLoading
  const now = new Date()

  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonthIdx, setViewMonthIdx] = useState(now.getMonth())
  const [reviseTarget, setReviseTarget] = useState(null)
  const [creditTarget, setCreditTarget] = useState(null)
  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO())
  const [amountError, setAmountError] = useState('')
  const [dateError, setDateError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const activeEmployees = useMemo(() => employees.filter((e) => e.active !== false), [employees])

  const rows = useMemo(
    () =>
      activeEmployees.map((emp) => ({
        ...emp,
        pay: computeMonthlyPay(emp, attendance[emp.id], viewYear, viewMonthIdx),
        creditTotal: monthlyCreditTotal(emp, viewYear, viewMonthIdx),
      })),
    [activeEmployees, attendance, viewYear, viewMonthIdx],
  )

  const totalPayroll = useMemo(() => activeEmployees.reduce((sum, e) => sum + currentSalary(e), 0), [activeEmployees])
  const totalPayable = useMemo(() => rows.reduce((sum, r) => sum + r.pay.earnedAmount, 0), [rows])

  function openRevise(emp) {
    setReviseTarget(emp)
    setAmount(String(currentSalary(emp) || ''))
    setEffectiveFrom(todayISO())
    setAmountError('')
    setDateError('')
  }

  async function submitRevise(e) {
    e.preventDefault()
    const num = Number(amount)
    let hasError = false
    if (!amount || Number.isNaN(num) || num <= 0) {
      setAmountError(t.errorAmountInvalid)
      hasError = true
    }
    if (effectiveFrom < reviseTarget.joinDate) {
      setDateError(t.errorDateBeforeJoin)
      hasError = true
    }
    if (hasError) return
    setSaving(true)
    try {
      await reviseSalary(reviseTarget.id, { amount: num, effectiveFrom })
      toast.success(t.toastRevised(reviseTarget.name))
      setReviseTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colEmployee,
      sortable: true,
      filter: true,
      style: { width: '20%' },
      body: (row) => (
        <>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs font-medium text-slate-400">{roleLabels[row.role] || row.role}</p>
        </>
      ),
    },
    {
      field: 'currentSalary',
      header: t.colCurrentSalary,
      style: { width: '13%' },
      body: (row) => <span className="font-semibold text-slate-700">{formatCurrency(currentSalary(row))}</span>,
    },
    {
      header: t.colShifts,
      style: { width: '11%' },
      body: (row) => (
        <span className="font-medium text-slate-600">
          {row.pay.shiftUnitsCompleted}/{row.pay.expectedShiftUnits}
        </span>
      ),
    },
    {
      header: t.colStatus,
      style: { width: '11%' },
      body: (row) =>
        row.pay.expectedShiftUnits === 0 ? (
          <span className="text-xs text-slate-300">{t.statusNA}</span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              row.pay.isMatched ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${row.pay.isMatched ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {row.pay.isMatched ? t.statusMatched : t.statusShort}
          </span>
        ),
    },
    {
      header: t.colThisMonth,
      style: { width: '19%' },
      body: (row) => (
        <>
          <p className="font-semibold text-slate-800">{formatCurrency(row.pay.earnedAmount)}</p>
          <p className="text-[11px] font-medium text-slate-400">
            {row.pay.isComplete ? t.finalForMonth : t.soFarOf(formatCurrency(row.pay.fullMonthSalary))}
          </p>
        </>
      ),
    },
    {
      header: t.colCredit,
      style: { width: '12%' },
      body: (row) =>
        row.creditTotal > 0 ? (
          <button
            type="button"
            onClick={() => setCreditTarget(row)}
            className="font-semibold text-violet-600 underline decoration-dotted underline-offset-2 hover:text-violet-700"
          >
            {formatCurrency(row.creditTotal)}
          </button>
        ) : (
          <span className="text-xs text-slate-300">{formatCurrency(0)}</span>
        ),
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '8%' },
      body: (row) => (
        <div className="flex justify-end">
          <IconButton onClick={() => openRevise(row)} aria-label={t.reviseSalary} title={t.reviseSalary} tone="edit">
            <Pencil size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonStatCards count={3} />
        <SkeletonTable rows={6} cols={6} />
      </div>
    )
  }

  if (employeesError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {employeesError}</div>
  }

  // Shared between the table's own toolbar row (the common case) and the
  // empty-active-employees state below it — either way it renders once, in
  // one row, never stacked above a separate search/actions row of its own.
  const monthNav = (
    <div className="flex items-center gap-2">
      <AppTooltip title="Previous month">
        <button
          onClick={goPrevMonth}
          aria-label="Previous month"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50"
        >
          <ChevronLeft size={16} />
        </button>
      </AppTooltip>
      <span className="min-w-[130px] text-center text-sm font-bold text-slate-800">{monthLabel}</span>
      <AppTooltip title="Next month">
        <button
          onClick={goNextMonth}
          disabled={isCurrentMonth}
          aria-label="Next month"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </AppTooltip>
      {isCurrentMonth ? (
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{t.today}</span>
      ) : null}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Users} label={t.statActiveEmployees} value={activeEmployees.length} index={0} accent="blue" dense />
        <StatCard icon={Wallet} label={t.statMonthlyPayroll} value={totalPayroll} formatter={formatCurrency} index={1} accent="brand" dense />
        <StatCard icon={TrendingUp} label={t.statPayableThisMonth} value={totalPayable} formatter={formatCurrency} index={2} accent="green" dense />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {activeEmployees.length === 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              {monthNav}
            </div>
            <div className="p-5">
              <EmptyState
                icon={IndianRupee}
                title={t.emptyActiveTitle}
                description={t.emptyActiveDesc}
                action={
                  <Link
                    to="/employees"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 active:scale-[0.98]"
                  >
                    <UserPlus size={16} /> {t.goToEmployees}
                  </Link>
                }
              />
            </div>
          </>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            rowKey="id"
            globalFilterFields={['name', 'role']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="name"
            scrollHeight="calc(100vh - 320px)"
            exportFilename={`salary-${viewYear}-${viewMonthIdx + 1}`}
            dense
            leadingContent={monthNav}
            toolbarActions={
              <SecondaryButton onClick={() => navigate('/employee-credits')} className="shrink-0 px-3.5 py-2 text-xs">
                <HandCoins size={14} /> {t.employeeCreditsButton}
              </SecondaryButton>
            }
          />
        )}
      </motion.div>

      <Modal isOpen={!!reviseTarget} onClose={() => setReviseTarget(null)} title={reviseTarget ? t.modalTitle(reviseTarget.name) : ''}>
        {reviseTarget ? (
          <form onSubmit={submitRevise} className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Wallet size={14} className="text-slate-400" />
              {t.fieldCurrentSalary}: <span className="font-semibold text-slate-800">{formatCurrency(currentSalary(reviseTarget))}</span>
            </div>

            <Field label={t.fieldNewSalary} error={amountError}>
              <Input
                type="number"
                min="0"
                autoFocus
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setAmountError('')
                }}
                placeholder={t.placeholderNewSalary}
              />
            </Field>

            <Field label={t.fieldEffectiveFrom} error={dateError}>
              <AppDatePicker
                value={effectiveFrom}
                onChange={(date) => {
                  setEffectiveFrom(date)
                  setDateError('')
                }}
                minDate={reviseTarget.joinDate}
                className="w-full"
              />
              <p className="mt-1 text-xs text-slate-400">{t.effectiveFromHint}</p>
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.historyTitle}</p>
              <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                {sortedSalaryHistory(reviseTarget).length ? (
                  [...sortedSalaryHistory(reviseTarget)].reverse().map((entry) => (
                    <div key={entry.effectiveFrom} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <CalendarDays size={11} className="shrink-0 text-slate-400" />
                      {t.historyEntry(formatCurrency(entry.amount), formatDate(entry.effectiveFrom))}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">{t.historyEmpty}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton type="button" onClick={() => setReviseTarget(null)}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>
                {t.saveRevision}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal isOpen={!!creditTarget} onClose={() => setCreditTarget(null)} title={creditTarget ? t.creditModalTitle(creditTarget.name) : ''}>
        {creditTarget ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-sm">
              <span className="text-slate-600">{monthLabel}</span>
              <span className="font-bold text-violet-600">{formatCurrency(monthlyCreditTotal(creditTarget, viewYear, viewMonthIdx))}</span>
            </div>
            <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              {monthlyCreditEntries(creditTarget, viewYear, viewMonthIdx).map((entry) => (
                <div key={entry.id} className="flex items-start gap-1.5 text-xs">
                  <Receipt size={11} className="mt-0.5 shrink-0 text-violet-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">{formatDate(entry.date)}</span>
                      <span className="font-semibold text-violet-600">{formatCurrency(entry.amount)}</span>
                    </div>
                    <p className="truncate text-slate-400">{entry.note || t.creditNoteEmpty}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <SecondaryButton type="button" onClick={() => setCreditTarget(null)}>
                {t.cancel}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
