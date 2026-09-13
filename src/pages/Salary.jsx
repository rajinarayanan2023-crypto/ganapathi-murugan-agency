import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet, IndianRupee, TrendingUp, Users, Pencil, ChevronLeft, ChevronRight, UserPlus, CalendarDays, Receipt, HandCoins, Trash2 } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { SALARY_TEXT } from '../i18n/salary.js'
import { EMPLOYEES_TEXT } from '../i18n/employees.js'
import { computeMonthlyPay, currentSalary, monthlyCreditTotal, monthlyCreditEntries, sortedSalaryHistory } from '../utils/salary.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import StatCard from '../components/StatCard.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { SkeletonStatCards, SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import { FullPageLoader } from '../components/Loader.jsx'
import CalcBreakdown from '../components/CalcBreakdown.jsx'

export default function Salary() {
  const navigate = useNavigate()
  const { employees, employeesLoading, employeesError, attendance, reviseSalary, deleteSalaryRevision } = useData()
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
  // { employeeId, revisionId } of a history entry pending removal — set by
  // clicking its trash icon, cleared once confirmed/cancelled.
  const [confirmDeleteRevision, setConfirmDeleteRevision] = useState(null)
  const [deletingRevision, setDeletingRevision] = useState(false)
  // One combined flag covering every in-flight write this page can make
  // (currently just revising a salary) — while it's running every other
  // action on this screen is blocked too, same pattern as Employees.jsx.
  const busy = saving || deletingRevision

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
      activeEmployees.map((emp) => {
        const pay = computeMonthlyPay(emp, attendance[emp.id], viewYear, viewMonthIdx)
        const creditTotal = monthlyCreditTotal(emp, viewYear, viewMonthIdx)
        // What actually gets handed to the employee — this month's earnings
        // so far, minus whatever credit (fuel/oil taken against pay) they've
        // already drawn this month. Left un-clamped (can go negative) rather
        // than floored at 0: an employee who's drawn MORE credit than
        // they've earned so far genuinely owes that back, and hiding that
        // behind a flat ₹0.00 would look like they simply have nothing
        // outstanding either way, when the two cases mean opposite things.
        const netPayable = pay.earnedAmount - creditTotal
        return {
          ...emp,
          pay,
          creditTotal,
          netPayable,
          // Plain-text/number mirrors of what's visually shown, used only for
          // CSV export (via exportField below) — several columns below have
          // no `field` at all (their value is computed from `pay`/`creditTotal`
          // which aren't flat row properties), so without these the export
          // would leave those columns out entirely or blank.
          nameExport: [emp.name, roleLabels[emp.role] || emp.role].filter(Boolean).join(' - '),
          currentSalaryExport: formatCurrency(currentSalary(emp)),
          shiftsExport: `${pay.shiftUnitsCompleted}/${pay.expectedShiftUnits}`,
          statusExport: pay.expectedShiftUnits === 0 ? t.statusNA : pay.isMatched ? t.statusMatched : t.statusShort,
          thisMonthExport: pay.isComplete
            ? formatCurrency(pay.earnedAmount)
            : `${formatCurrency(pay.earnedAmount)} (${t.soFarOf(formatCurrency(pay.fullMonthSalary))})`,
          creditExport: formatCurrency(creditTotal),
          payableExport: formatCurrency(netPayable),
        }
      }),
    [activeEmployees, attendance, viewYear, viewMonthIdx, roleLabels, t],
  )

  const totalPayroll = useMemo(() => activeEmployees.reduce((sum, e) => sum + currentSalary(e), 0), [activeEmployees])
  // The dealer's own actual cash-out total, unlike each row's own signed
  // netPayable above — an employee who's overdrawn their credit owes THAT
  // back rather than reducing what's actually due to everyone else, so each
  // employee's own contribution to this total is floored at ₹0 here, even
  // though their row still shows the real (negative) figure.
  const totalPayable = useMemo(() => rows.reduce((sum, r) => sum + Math.max(0, r.netPayable), 0), [rows])

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

  // Removes a wrongly-added revision outright — the API refuses to delete
  // an employee's last remaining one (there must always be at least one to
  // derive "current pay" from). Keeps the modal open afterward (unlike a
  // successful revise, which closes it) and refreshes reviseTarget from the
  // response so the history list right below immediately reflects the
  // removal, in case there's another mistake to clean up in the same pass.
  async function handleDeleteRevision() {
    if (!confirmDeleteRevision) return
    setDeletingRevision(true)
    try {
      const updated = await deleteSalaryRevision(confirmDeleteRevision.employeeId, confirmDeleteRevision.revisionId)
      setReviseTarget((prev) => (prev && prev.id === updated.id ? updated : prev))
      toast.success(t.toastRevisionDeleted)
      setConfirmDeleteRevision(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingRevision(false)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colEmployee,
      sortable: true,
      style: { width: '20%' },
      exportField: 'nameExport',
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
      style: { width: '12%' },
      exportField: 'currentSalaryExport',
      body: (row) => <span className="font-semibold text-slate-700">{formatCurrency(currentSalary(row))}</span>,
    },
    {
      // A truthy `field` is required for a column to be exported at all —
      // PrimeReact's own exportCSV only ever reads `exportField` for a
      // column that ALSO has `field` set, checked before exportField is
      // ever consulted (same gap already found and fixed on Attendance.jsx's
      // Status column). Every column below it in this table had the same
      // gap — exportable: true and a real exportField were never enough on
      // their own, so the exported file silently only ever had Employee and
      // Current Salary in it.
      field: 'shiftsExport',
      header: t.colShifts,
      style: { width: '11%' },
      exportField: 'shiftsExport',
      body: (row) => (
        <span className="font-medium text-slate-600">
          {row.pay.shiftUnitsCompleted}/{row.pay.expectedShiftUnits}
        </span>
      ),
    },
    {
      field: 'statusExport',
      header: t.colStatus,
      style: { width: '11%' },
      exportField: 'statusExport',
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
      field: 'thisMonthExport',
      header: t.colThisMonth,
      style: { width: '15%' },
      exportField: 'thisMonthExport',
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
      field: 'creditExport',
      header: t.colCredit,
      style: { width: '10%' },
      exportField: 'creditExport',
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
      field: 'payableExport',
      header: t.colPayable,
      style: { width: '13%' },
      exportField: 'payableExport',
      body: (row) => {
        const isOverdrawn = row.netPayable < 0
        return (
          <AppTooltip
            title={
              <CalcBreakdown
                rows={[
                  { label: t.colThisMonth, value: formatCurrency(row.pay.earnedAmount) },
                  { label: t.colCredit, value: formatCurrency(row.creditTotal) },
                ]}
                formula={t.payableFormula(formatCurrency(row.pay.earnedAmount), formatCurrency(row.creditTotal))}
                note={isOverdrawn ? t.payableOverdrawnNote : undefined}
              />
            }
          >
            <span className={`cursor-help font-bold ${isOverdrawn ? 'text-rose-600' : 'text-emerald-700'}`}>
              {formatCurrency(row.netPayable)}
            </span>
          </AppTooltip>
        )
      },
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '8%' },
      body: (row) => (
        <div className="flex justify-end">
          <IconButton onClick={() => openRevise(row)} disabled={busy} aria-label={t.reviseSalary} title={t.reviseSalary} tone="edit">
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
          disabled={busy}
          aria-label="Previous month"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
      </AppTooltip>
      <span className="min-w-[130px] text-center text-sm font-bold text-slate-800">{monthLabel}</span>
      <AppTooltip title="Next month">
        <button
          onClick={goNextMonth}
          disabled={isCurrentMonth || busy}
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

  const busyLabel = deletingRevision ? t.removingRevision : saving ? t.saving : ''

  return (
    <div className="space-y-6">
      {busy ? <FullPageLoader label={busyLabel} /> : null}
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
              <SecondaryButton onClick={() => navigate('/employee-credits')} disabled={busy} className="shrink-0 px-3.5 py-2 text-xs">
                <HandCoins size={14} /> {t.employeeCreditsButton}
              </SecondaryButton>
            }
          />
        )}
      </motion.div>

      <Modal
        isOpen={!!reviseTarget}
        onClose={busy ? () => {} : () => setReviseTarget(null)}
        title={reviseTarget ? t.modalTitle(reviseTarget.name) : ''}
      >
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
                disabled={busy}
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
                disabled={busy}
              />
              <p className="mt-1 text-xs text-slate-400">{t.effectiveFromHint}</p>
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.historyTitle}</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                {sortedSalaryHistory(reviseTarget).length ? (
                  (() => {
                    const history = [...sortedSalaryHistory(reviseTarget)].reverse()
                    const onlyOneLeft = history.length <= 1
                    return history.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-1.5 text-xs text-slate-500">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CalendarDays size={11} className="shrink-0 text-slate-400" />
                          <span className="truncate">{t.historyEntry(formatCurrency(entry.amount), formatDate(entry.effectiveFrom))}</span>
                        </span>
                        <AppTooltip title={onlyOneLeft ? t.removeRevisionDisabledHint : t.removeRevision}>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteRevision({ employeeId: reviseTarget.id, revisionId: entry.id })}
                            disabled={busy || onlyOneLeft}
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={t.removeRevision}
                          >
                            <Trash2 size={12} />
                          </button>
                        </AppTooltip>
                      </div>
                    ))
                  })()
                ) : (
                  <p className="text-xs text-slate-400">{t.historyEmpty}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton type="button" onClick={() => setReviseTarget(null)} disabled={busy}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={busy}>
                {t.saveRevision}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        isOpen={!!creditTarget}
        onClose={busy ? () => {} : () => setCreditTarget(null)}
        title={creditTarget ? t.creditModalTitle(creditTarget.name) : ''}
      >
        {creditTarget ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-sm">
              <span className="text-slate-600">{monthLabel}</span>
              <span className="font-bold text-violet-600">{formatCurrency(monthlyCreditTotal(creditTarget, viewYear, viewMonthIdx))}</span>
            </div>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
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
              <SecondaryButton type="button" onClick={() => setCreditTarget(null)} disabled={busy}>
                {t.cancel}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteRevision}
        onClose={() => setConfirmDeleteRevision(null)}
        onConfirm={handleDeleteRevision}
        title={t.removeRevisionTitle}
        description={t.removeRevisionDesc}
        loading={deletingRevision}
      />
    </div>
  )
}
