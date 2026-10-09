import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet, IndianRupee, TrendingUp, Users, Pencil, ChevronLeft, ChevronRight, UserPlus, CalendarDays, Receipt, HandCoins, Trash2, Banknote, Lock, LockOpen, Info } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { SALARY_TEXT } from '../i18n/salary.js'
import { EMPLOYEES_TEXT } from '../i18n/employees.js'
import { COMMON_TEXT } from '../i18n/common.js'
import {
  computeMonthlyPay,
  currentSalary,
  monthlyCreditTotal,
  monthlyCreditEntries,
  monthlyPaymentTotal,
  monthlyPaymentEntries,
  carryForwardBalance,
  sortedSalaryHistory,
} from '../utils/salary.js'
import { formatCurrency, formatDate, formatDateTime, formatEmployeeName, todayISO } from '../utils/format.js'
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
  const {
    employees,
    employeesLoading,
    employeesError,
    attendance,
    reviseSalary,
    deleteSalaryRevision,
    addSalaryPayment,
    deleteSalaryPayment,
    currentUser,
    salaryPeriodClosures,
    closeSalaryPeriod,
    reopenSalaryPeriod,
    loadAttendanceMonth,
  } = useData()
  const { language } = useLanguage()
  const t = SALARY_TEXT[language]
  const roleLabels = EMPLOYEES_TEXT[language].roleLabels
  const commonT = COMMON_TEXT[language]
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
  const [paymentTarget, setPaymentTarget] = useState(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayISO())
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentAmountError, setPaymentAmountError] = useState('')
  const [savingPayment, setSavingPayment] = useState(false)
  // { employeeId, paymentId } of a payment pending removal.
  const [confirmDeletePayment, setConfirmDeletePayment] = useState(null)
  const [deletingPayment, setDeletingPayment] = useState(false)
  const [confirmCloseMonth, setConfirmCloseMonth] = useState(false)
  const [closingMonth, setClosingMonth] = useState(false)
  const [confirmReopenMonth, setConfirmReopenMonth] = useState(false)
  const [reopeningMonth, setReopeningMonth] = useState(false)
  // One combined flag covering every in-flight write this page can make —
  // while it's running every other action on this screen is blocked too,
  // same pattern as Employees.jsx.
  const busy = saving || deletingRevision || savingPayment || deletingPayment || closingMonth || reopeningMonth

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonthIdx === now.getMonth()
  const monthLabel = new Date(viewYear, viewMonthIdx, 1).toLocaleDateString(language === 'ta' ? 'ta-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
  })

  const currentClosure = useMemo(
    () => salaryPeriodClosures.find((c) => c.periodYear === viewYear && c.periodMonth === viewMonthIdx + 1),
    [salaryPeriodClosures, viewYear, viewMonthIdx],
  )
  const isPeriodClosed = currentClosure?.status === 'closed'
  const isAdmin = currentUser?.role === 'admin'

  async function handleCloseMonth() {
    setClosingMonth(true)
    try {
      await closeSalaryPeriod(viewYear, viewMonthIdx + 1)
      toast.success(t.toastMonthClosed(monthLabel))
      setConfirmCloseMonth(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setClosingMonth(false)
    }
  }

  async function handleReopenMonth() {
    setReopeningMonth(true)
    try {
      await reopenSalaryPeriod(viewYear, viewMonthIdx + 1)
      toast.success(t.toastMonthReopened(monthLabel))
      setConfirmReopenMonth(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setReopeningMonth(false)
    }
  }

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

  // Brought-forward carries a running balance from an employee's own join
  // month, so it needs every month's attendance in between actually loaded —
  // not just the one currently being viewed (attendance otherwise only
  // auto-loads the real current month; see DataContext's loadAttendanceMonth).
  // One fetch per distinct calendar month covers every employee at once
  // (the API returns all employees' records for that month together), and
  // loadAttendanceMonth no-ops for a month already cached this session.
  useEffect(() => {
    if (!activeEmployees.length) return
    const earliestJoin = activeEmployees.reduce((min, e) => (e.joinDate < min ? e.joinDate : min), activeEmployees[0].joinDate)
    const [startY, startM] = earliestJoin.split('-').map(Number)
    const target = viewYear * 12 + viewMonthIdx
    let y = startY
    let m = startM - 1
    // Same backstop as carryForwardBalance's own cap — a bad join_date
    // shouldn't be able to fire a thousand-plus fetches on every page load.
    const earliestAllowedTotal = target - 1200
    if (y * 12 + m < earliestAllowedTotal) {
      y = Math.floor(earliestAllowedTotal / 12)
      m = earliestAllowedTotal - y * 12
    }
    while (y * 12 + m <= target) {
      loadAttendanceMonth(y, m)
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
    }
  }, [activeEmployees, viewYear, viewMonthIdx, loadAttendanceMonth])

  const rows = useMemo(
    () =>
      activeEmployees.map((emp) => {
        const pay = computeMonthlyPay(emp, attendance[emp.id], viewYear, viewMonthIdx)
        const creditTotal = monthlyCreditTotal(emp, viewYear, viewMonthIdx)
        const paymentTotal = monthlyPaymentTotal(emp, viewYear, viewMonthIdx)
        const carryForward = carryForwardBalance(emp, attendance[emp.id], viewYear, viewMonthIdx)
        // What's still owed to the employee — this month's earnings so far,
        // minus whatever credit (fuel/oil taken against pay) they've already
        // drawn, minus whatever's already been physically paid out for this
        // same month, plus/minus whatever balance carried forward from every
        // earlier month since they joined (see carryForwardBalance — an
        // unpaid or overdrawn balance doesn't reset when the month changes).
        // Left un-clamped (can go negative) rather than floored at 0: an
        // employee who's drawn/been paid MORE than they've earned so far
        // genuinely owes that back, and hiding that behind a flat ₹0.00
        // would look like they simply have nothing outstanding either way,
        // when the two cases mean opposite things. Before salary payments
        // (and carry-forward) existed, this was just earnedAmount −
        // creditTotal — for any employee with no payment rows and nothing
        // carried forward, the figure is unchanged from before.
        const netPayable = pay.earnedAmount - creditTotal - paymentTotal + carryForward
        return {
          ...emp,
          pay,
          creditTotal,
          paymentTotal,
          carryForward,
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
          paidExport: formatCurrency(paymentTotal),
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

  // Suggests the row's own currently-computed Payable figure as the amount
  // to pay — just a starting point, not enforced; the manager can always
  // type a different (e.g. partial) amount.
  function openPayment(row) {
    setPaymentTarget(row)
    setPaymentAmount(row.netPayable > 0 ? String(Math.round(row.netPayable * 100) / 100) : '')
    setPaymentDate(todayISO())
    setPaymentNote('')
    setPaymentAmountError('')
  }

  async function submitPayment(e) {
    e.preventDefault()
    const num = Number(paymentAmount)
    if (!paymentAmount || Number.isNaN(num) || num <= 0) {
      setPaymentAmountError(t.errorPaymentAmountInvalid)
      return
    }
    setSavingPayment(true)
    try {
      // period is always the currently-viewed month — a payment is recorded
      // for whatever month the manager has the table open to, same as the
      // Credit modal's own monthly scoping. payableSnapshot freezes what
      // this row's Payable figure showed at the moment of payment (see
      // SalaryPayment's backend docstring) — purely informational, it's
      // never read back into any calculation here.
      await addSalaryPayment(paymentTarget.id, {
        periodYear: viewYear,
        periodMonth: viewMonthIdx + 1,
        amountPaid: num,
        payableSnapshot: paymentTarget.netPayable,
        paidDate: paymentDate,
        note: paymentNote.trim(),
      })
      toast.success(t.toastPaymentRecorded(paymentTarget.name))
      setPaymentTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingPayment(false)
    }
  }

  // Keeps the modal open afterward (unlike a successful save, which closes
  // it), same pattern as handleDeleteRevision — splices the removed payment
  // out of paymentTarget directly rather than re-fetching, since
  // deleteSalaryPayment (no body in the API's delete response) already does
  // the same splice on the shared employees list.
  async function handleDeletePayment() {
    if (!confirmDeletePayment) return
    setDeletingPayment(true)
    try {
      await deleteSalaryPayment(confirmDeletePayment.employeeId, confirmDeletePayment.paymentId)
      setPaymentTarget((prev) =>
        prev && prev.id === confirmDeletePayment.employeeId
          ? { ...prev, payments: prev.payments.filter((p) => p.id !== confirmDeletePayment.paymentId) }
          : prev,
      )
      toast.success(t.toastPaymentRemoved)
      setConfirmDeletePayment(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingPayment(false)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colEmployee,
      sortable: true,
      style: { width: '18%' },
      exportField: 'nameExport',
      body: (row) => (
        <>
          <p className="font-medium text-slate-800">{formatEmployeeName(row)}</p>
          <p className="text-xs font-medium text-slate-400">{roleLabels[row.role] || row.role}</p>
        </>
      ),
    },
    {
      field: 'currentSalary',
      header: t.colCurrentSalary,
      style: { width: '11%' },
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
      style: { width: '10%' },
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
      style: { width: '9%' },
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
      style: { width: '13%' },
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
      style: { width: '9%' },
      exportField: 'creditExport',
      body: (row) =>
        row.creditTotal > 0 ? (
          <button
            type="button"
            onClick={() => setCreditTarget(row)}
            // max-w-full+break-words: this column's 9% share of a
            // dense/fixed-layout table is only wide enough for a few digits
            // — without max-w-full, this inline-block button sizes itself
            // to its content's natural (shrink-to-fit) width regardless of
            // the cell, so a big (lakhs-range) value with no spaces to
            // break at just spills past the cell into the next column
            // instead of wrapping onto a second line.
            className="max-w-full break-words font-semibold text-violet-600 underline decoration-dotted underline-offset-2 hover:text-violet-700"
          >
            {formatCurrency(row.creditTotal)}
          </button>
        ) : (
          <span className="text-xs text-slate-300">{formatCurrency(0)}</span>
        ),
    },
    {
      field: 'paidExport',
      header: t.colPaid,
      style: { width: '9%' },
      exportField: 'paidExport',
      body: (row) =>
        row.paymentTotal > 0 ? (
          <button
            type="button"
            onClick={() => openPayment(row)}
            className="max-w-full break-words font-semibold text-sky-600 underline decoration-dotted underline-offset-2 hover:text-sky-700"
          >
            {formatCurrency(row.paymentTotal)}
          </button>
        ) : (
          <span className="text-xs text-slate-300">{formatCurrency(0)}</span>
        ),
    },
    {
      field: 'payableExport',
      header: t.colPayable,
      style: { width: '12%' },
      exportField: 'payableExport',
      body: (row) => {
        const isOverdrawn = row.netPayable < 0
        const hasCarryForward = row.carryForward !== 0
        const baseFormula = t.payableFormula(
          formatCurrency(row.pay.earnedAmount),
          formatCurrency(row.creditTotal),
          formatCurrency(row.paymentTotal),
        )
        return (
          <AppTooltip
            title={
              <CalcBreakdown
                rows={[
                  { label: t.colThisMonth, value: formatCurrency(row.pay.earnedAmount) },
                  { label: t.colCredit, value: formatCurrency(row.creditTotal) },
                  { label: t.colPaid, value: formatCurrency(row.paymentTotal) },
                  ...(hasCarryForward ? [{ label: t.colBroughtForward, value: formatCurrency(row.carryForward) }] : []),
                ]}
                formula={
                  hasCarryForward
                    ? `${baseFormula} ${row.carryForward > 0 ? '+' : '−'} ${formatCurrency(Math.abs(row.carryForward))} ${t.broughtForwardWord}`
                    : baseFormula
                }
                note={isOverdrawn ? t.payableOverdrawnNote : undefined}
              />
            }
          >
            <span className={`cursor-help break-words font-bold ${isOverdrawn ? 'text-rose-600' : 'text-emerald-700'}`}>
              {formatCurrency(row.netPayable)}
            </span>
          </AppTooltip>
        )
      },
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '9%' },
      body: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.createdByName ? (
            <AppTooltip title={t.employeeCreatedByLabel(row.createdByName, formatDateTime(row.createdAt))}>
              <Info size={11} className="shrink-0 cursor-help text-slate-300 hover:text-slate-400" />
            </AppTooltip>
          ) : null}
          <IconButton onClick={() => openRevise(row)} disabled={busy} aria-label={t.reviseSalary} title={t.reviseSalary} tone="edit">
            <Pencil size={15} />
          </IconButton>
          <IconButton onClick={() => openPayment(row)} disabled={busy} aria-label={t.recordPayment} title={t.recordPayment} tone="success">
            <Banknote size={15} />
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
      <AppTooltip title={commonT.previousMonth}>
        <button
          onClick={goPrevMonth}
          disabled={busy}
          aria-label={commonT.previousMonth}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
      </AppTooltip>
      <span className="min-w-[130px] text-center text-sm font-bold text-slate-800">{monthLabel}</span>
      <AppTooltip title={commonT.nextMonth}>
        <button
          onClick={goNextMonth}
          disabled={isCurrentMonth || busy}
          aria-label={commonT.nextMonth}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </AppTooltip>
      {isCurrentMonth ? (
        <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{t.today}</span>
      ) : null}
      {isPeriodClosed ? (
        <>
          <AppTooltip
            title={
              currentClosure?.closedByName
                ? t.closedByLine(currentClosure.closedByName, formatDate(currentClosure.closedAt))
                : t.monthClosedBadge
            }
          >
            <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
              <Lock size={10} /> {t.monthClosedBadge}
            </span>
          </AppTooltip>
          <AppTooltip title={isAdmin ? t.reopenMonth : t.reopenAdminOnlyHint}>
            <span>
              <SecondaryButton
                onClick={() => setConfirmReopenMonth(true)}
                disabled={busy || !isAdmin}
                className="shrink-0 px-3 py-1.5 text-xs"
              >
                <LockOpen size={13} /> {t.reopenMonth}
              </SecondaryButton>
            </span>
          </AppTooltip>
        </>
      ) : (
        <SecondaryButton
          onClick={() => setConfirmCloseMonth(true)}
          disabled={busy}
          className="shrink-0 px-3 py-1.5 text-xs"
        >
          <Lock size={13} /> {t.closeMonth}
        </SecondaryButton>
      )}
    </div>
  )

  const monthClosedBanner = isPeriodClosed ? (
    <div className="flex animate-banner-blink items-center gap-2 border-b border-rose-100 bg-rose-50/70 px-4 py-2 text-xs font-medium text-rose-700">
      <Lock size={13} className="shrink-0" />
      <span>{t.monthClosedBanner(monthLabel)}</span>
    </div>
  ) : null

  const busyLabel = deletingRevision
    ? t.removingRevision
    : saving
      ? t.saving
      : deletingPayment
        ? t.removingPayment
        : savingPayment
          ? t.saving
          : ''

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
            {monthClosedBanner}
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
          <>
            {monthClosedBanner}
            <DataTable
              columns={columns}
              data={rows}
              rowKey="id"
              globalFilterFields={[
                'nameExport',
                'role',
                'currentSalaryExport',
                'shiftsExport',
                'statusExport',
                'thisMonthExport',
                'creditExport',
                'paidExport',
                'payableExport',
              ]}
              searchPlaceholder={t.searchPlaceholder}
              defaultSortField="name"
              scrollHeight="calc(100svh - 320px)"
              exportFilename={`salary-${viewYear}-${viewMonthIdx + 1}`}
              dense
              leadingContent={monthNav}
              toolbarActions={
                // PrimaryButton (not Secondary) on purpose — unlike the rest of
                // this toolbar, this one navigates clean away to its own full
                // screen (Employee Credits), not an in-place action on this
                // table, so it needs to actually read as "go somewhere else"
                // rather than blend in with same-page controls.
                <PrimaryButton onClick={() => navigate('/employee-credits')} disabled={busy} className="shrink-0 px-3.5 py-2 text-xs">
                  <HandCoins size={14} /> {t.employeeCreditsButton}
                </PrimaryButton>
              }
            />
          </>
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
                step="0.01"
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
                          {entry.updatedByName ? (
                            <AppTooltip title={t.revisedByLine(entry.updatedByName, formatDateTime(entry.updatedAt))}>
                              <span className="flex shrink-0 cursor-help items-center text-slate-300 hover:text-slate-500">
                                <Info size={12} />
                              </span>
                            </AppTooltip>
                          ) : null}
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
              {monthlyCreditEntries(creditTarget, viewYear, viewMonthIdx).map((entry) => {
                const isRepayment = entry.type === 'repayment'
                const isExcess = entry.type === 'excess'
                const subtracts = isRepayment || isExcess
                return (
                  <div key={entry.id} className="flex items-start gap-1.5 text-xs">
                    {isRepayment ? (
                      <HandCoins size={11} className="mt-0.5 shrink-0 text-emerald-400" />
                    ) : isExcess ? (
                      <Banknote size={11} className="mt-0.5 shrink-0 text-sky-400" />
                    ) : (
                      <Receipt size={11} className="mt-0.5 shrink-0 text-violet-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">
                          {formatDate(entry.date)}
                          {isRepayment ? (
                            <span className="ml-1.5 text-[10px] font-semibold text-emerald-500">{t.repaymentBadge}</span>
                          ) : isExcess ? (
                            <span className="ml-1.5 text-[10px] font-semibold text-sky-500">{t.excessBadge}</span>
                          ) : null}
                        </span>
                        <span className={`font-semibold ${isRepayment ? 'text-emerald-600' : isExcess ? 'text-sky-600' : 'text-violet-600'}`}>
                          {subtracts ? '−' : ''}{formatCurrency(entry.amount)}
                        </span>
                      </div>
                      <p className="truncate text-slate-400">{entry.note || t.creditNoteEmpty}</p>
                    </div>
                  </div>
                )
              })}
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

      <Modal
        isOpen={!!paymentTarget}
        onClose={busy ? () => {} : () => setPaymentTarget(null)}
        title={paymentTarget ? t.paymentModalTitle(paymentTarget.name) : ''}
        scroll={false}
      >
        {paymentTarget ? (
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-sm">
              <span className="text-slate-600">{monthLabel}</span>
              <span className={`font-bold ${paymentTarget.netPayable < 0 ? 'text-rose-600' : 'text-sky-700'}`}>
                {t.colPayable}: {formatCurrency(paymentTarget.netPayable)}
              </span>
            </div>

            {isPeriodClosed ? (
              <div className="flex animate-banner-blink items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                <Lock size={13} className="shrink-0" />
                <span>{t.monthClosedBanner(monthLabel)}</span>
              </div>
            ) : null}

            <Field label={t.fieldPaymentAmount} error={paymentAmountError}>
              <Input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={paymentAmount}
                onChange={(e) => {
                  setPaymentAmount(e.target.value)
                  setPaymentAmountError('')
                }}
                placeholder={t.placeholderPaymentAmount}
                disabled={busy || isPeriodClosed}
              />
            </Field>

            <Field label={t.fieldPaymentDate}>
              <AppDatePicker
                value={paymentDate}
                onChange={setPaymentDate}
                maxDate={todayISO()}
                className="w-full"
                disabled={busy || isPeriodClosed}
              />
            </Field>

            <Field label={t.fieldPaymentNote}>
              <Input
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder={t.placeholderPaymentNote}
                disabled={busy || isPeriodClosed}
              />
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.paymentHistoryTitle}</p>
              <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                {monthlyPaymentEntries(paymentTarget, viewYear, viewMonthIdx).length ? (
                  monthlyPaymentEntries(paymentTarget, viewYear, viewMonthIdx).map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-1.5 text-xs text-slate-500">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Banknote size={11} className="shrink-0 text-slate-400" />
                        <span className="truncate">
                          <span className="font-semibold text-emerald-600">{formatCurrency(entry.amountPaid)}</span>{' '}
                          {t.paymentEntryDate(formatDate(entry.paidDate))}
                        </span>
                      </span>
                      <AppTooltip title={t.removePayment}>
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePayment({ employeeId: paymentTarget.id, paymentId: entry.id })}
                          disabled={busy || isPeriodClosed}
                          className="shrink-0 rounded p-0.5 text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={t.removePayment}
                        >
                          <Trash2 size={12} />
                        </button>
                      </AppTooltip>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">{t.paymentHistoryEmpty}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton type="button" onClick={() => setPaymentTarget(null)} disabled={busy}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={busy || isPeriodClosed}>
                {t.savePayment}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeletePayment}
        onClose={() => setConfirmDeletePayment(null)}
        onConfirm={handleDeletePayment}
        title={t.removePaymentTitle}
        description={t.removePaymentDesc}
        loading={deletingPayment}
      />

      <ConfirmDialog
        isOpen={confirmCloseMonth}
        onClose={() => setConfirmCloseMonth(false)}
        onConfirm={handleCloseMonth}
        title={t.closeMonthTitle(monthLabel)}
        description={t.closeMonthDesc}
        confirmLabel={t.closeMonth}
        confirmTone="brand"
        loading={closingMonth}
      />

      <ConfirmDialog
        isOpen={confirmReopenMonth}
        onClose={() => setConfirmReopenMonth(false)}
        onConfirm={handleReopenMonth}
        title={t.reopenMonthTitle(monthLabel)}
        description={t.reopenMonthDesc}
        confirmLabel={t.reopenMonth}
        confirmTone="brand"
        loading={reopeningMonth}
      />
    </div>
  )
}
