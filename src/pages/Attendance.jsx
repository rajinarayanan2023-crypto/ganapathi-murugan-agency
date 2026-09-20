import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Users, Phone, CalendarDays, UserPlus, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { ATTENDANCE_TEXT } from '../i18n/attendance.js'
import { EMPLOYEES_TEXT } from '../i18n/employees.js'
import { STATUS_OPTIONS, nextDateISO } from '../utils/attendance.js'
import { formatDate, formatDayLabel, todayISO, toISODate } from '../utils/format.js'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import Modal from '../components/Modal.jsx'
import { Field, PrimaryButton, SecondaryButton, IconButton, submitOnEnter } from '../components/FormControls.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTimePicker from '../components/AppTimePicker.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

const STATUS_STYLES = {
  oneShift: 'bg-emerald-500',
  doubleShift: 'bg-blue-500',
  absent: 'bg-rose-500',
  leave: 'bg-amber-400',
  dutyOff: 'bg-slate-300',
  companyOff: 'bg-violet-500',
}
const DEFAULT_START_TIME = '08:00'

// Adds `hours` to a "HH:MM" (24hr) time string, wrapping past midnight — used
// to show the shift's end time from its chosen start time (12hr for a single
// shift, 24hr — i.e. the same clock time the next day — for a double shift).
function addHoursToTime(time, hours) {
  const [h, m] = time.split(':').map(Number)
  const totalMinutes = h * 60 + m + hours * 60
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const endH = Math.floor(wrapped / 60)
  const endM = wrapped % 60
  const rolledOver = totalMinutes >= 24 * 60
  return { end: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`, rolledOver }
}

// Formats a stored "HH:MM" (24hr) time string as 12hr AM/PM for display.
function formatTime12h(time) {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

export default function Attendance() {
  const { employees, employeesLoading, attendance, attendanceLoading, attendanceError, setAttendanceDay, loadAttendanceMonth } = useData()
  const { language } = useLanguage()
  const t = ATTENDANCE_TEXT[language]
  const roleLabels = EMPLOYEES_TEXT[language].roleLabels
  const loading = employeesLoading || attendanceLoading
  const today = todayISO()
  const now = new Date()
  const [selectedDate, setSelectedDate] = useState(today)
  const [activeTab, setActiveTab] = useState('mark')
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonthIdx, setViewMonthIdx] = useState(now.getMonth())
  const [editTarget, setEditTarget] = useState(null)
  const [modalStatus, setModalStatus] = useState('oneShift')
  const [modalStartTime, setModalStartTime] = useState(DEFAULT_START_TIME)
  // Covers both markAll (mark-all-staff buttons) and saveEditAttendance (the
  // per-employee edit modal) — whichever is in flight, every other control
  // on this screen is blocked too via `busy` below.
  const [saving, setSaving] = useState(false)
  const busy = saving

  // History tab browses a different month than "today" — load whichever
  // month is actually being viewed/marked; loadAttendanceMonth no-ops if
  // that month's already in state.
  useEffect(() => {
    loadAttendanceMonth(viewYear, viewMonthIdx)
  }, [viewYear, viewMonthIdx, loadAttendanceMonth])

  useEffect(() => {
    const d = new Date(selectedDate)
    loadAttendanceMonth(d.getFullYear(), d.getMonth())
  }, [selectedDate, loadAttendanceMonth])

  const activeEmployees = useMemo(() => employees.filter((e) => e.active !== false), [employees])

  // An employee's joinDate is the earliest date attendance can exist for
  // them — marking (say) "Absent" for a week before they even joined is
  // meaningless, not just wrong. Employees with no joinDate on file at all
  // are never restricted (older records predate this field being required).
  function hasNotJoinedYet(emp, date) {
    return !!emp.joinDate && date < emp.joinDate
  }

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonthIdx === now.getMonth()

  const monthDays = useMemo(() => {
    const daysInMonth = new Date(viewYear, viewMonthIdx + 1, 0).getDate()
    const days = []
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(toISODate(new Date(viewYear, viewMonthIdx, day)))
    }
    return days
  }, [viewYear, viewMonthIdx])

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

  async function markAll(status) {
    const eligible = activeEmployees.filter((emp) => !hasNotJoinedYet(emp, selectedDate))
    const skipped = activeEmployees.length - eligible.length
    setSaving(true)
    try {
      await Promise.all(eligible.map((emp) => setAttendanceDay(emp.id, selectedDate, { status })))
      toast.success(t.toastMarkedAll(t.statusLabel[status], formatDate(selectedDate)))
      if (skipped > 0) toast.error(t.toastSkippedNotJoined(skipped))
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  function openEditAttendance(emp) {
    const record = attendance[emp.id]?.[selectedDate]
    setEditTarget(emp)
    setModalStatus(record?.status || 'oneShift')
    setModalStartTime(record?.startTime || DEFAULT_START_TIME)
  }

  async function saveEditAttendance(e) {
    e?.preventDefault()
    if (!editTarget) return
    // Defensive re-check, in case the date changed underneath an already-open
    // modal — the edit button itself is disabled for this case (see the
    // status column body below), so this should only ever catch that edge.
    if (hasNotJoinedYet(editTarget, selectedDate)) {
      toast.error(t.errorNotYetJoined(formatDate(editTarget.joinDate)))
      return
    }
    const isShiftDay = modalStatus === 'oneShift' || modalStatus === 'doubleShift'
    const patch = { status: modalStatus, ...(isShiftDay ? { startTime: modalStartTime } : {}) }
    setSaving(true)
    try {
      await setAttendanceDay(editTarget.id, selectedDate, patch)
      if (modalStatus === 'doubleShift') {
        const nextDate = nextDateISO(selectedDate)
        if (!attendance[editTarget.id]?.[nextDate]) {
          await setAttendanceDay(editTarget.id, nextDate, { status: 'dutyOff' })
        }
      }
      toast.success(t.toastSaved(editTarget.name))
      setEditTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  // PrimeReact's DataTable diffs each row's own data to decide whether a cell
  // needs to re-render — the attendance status has to live ON the row object
  // (not just be read from the `attendance` map via closure in the column's
  // `body`) or a save that only changes `attendance` state leaves the table
  // showing the pre-save status until something else forces a full remount
  // (e.g. a page refresh).
  const selectedDateData = useMemo(
    () =>
      activeEmployees.map((emp) => {
        const record = attendance[emp.id]?.[selectedDate] || null
        const status = record?.status
        const isShiftDay = status === 'oneShift' || status === 'doubleShift'
        // Plain-text mirrors of what's visually shown, used only for CSV
        // export (via exportField below) — the name cell's body renders
        // father's name and role alongside the name, and the status cell has
        // no `field` at all (it's derived from `attendanceRecord`, not a flat
        // row property), so without these the export would drop them.
        return {
          ...emp,
          attendanceRecord: record,
          nameExport: [emp.name, emp.fatherName ? `${t.sonOf} ${emp.fatherName}` : '', roleLabels[emp.role] || emp.role]
            .filter(Boolean)
            .join(' - '),
          attendanceExport: status
            ? `${t.statusLabel[status]}${isShiftDay ? ` (${formatTime12h(record?.startTime || DEFAULT_START_TIME)})` : ''}`
            : t.noRecord,
        }
      }),
    [activeEmployees, attendance, selectedDate, t, roleLabels],
  )

  const columns = [
    {
      field: 'name',
      header: t.colEmployee,
      sortable: true,
      style: { width: '20%' },
      exportField: 'nameExport',
      body: (emp) => (
        <>
          <p className="font-medium text-slate-800">{emp.name}</p>
          {emp.fatherName ? (
            <p className="text-xs font-medium text-slate-500">
              {t.sonOf} {emp.fatherName}
            </p>
          ) : null}
        </>
      ),
    },
    {
      field: 'phone',
      header: t.colPhone,
      sortable: true,
      style: { width: '13%' },
      body: (emp) => (
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          <Phone size={12} className="text-slate-400" /> {emp.phone}
        </span>
      ),
    },
    {
      // A truthy `field` is required for this column to be exported at all —
      // PrimeReact's own exportCSV only ever reads `exportField` for a
      // column that ALSO has `field` set (`exportable !== false && field`,
      // checked before exportField is ever consulted). Without this, the
      // status column silently vanished from the downloaded file even
      // though attendanceExport was already computed correctly and
      // exportField named it right — exportable: true alone can't
      // substitute for a missing field.
      field: 'attendanceExport',
      header: t.colStatus,
      style: { width: '40%', minWidth: '220px' },
      exportField: 'attendanceExport',
      body: (emp) => {
        const record = emp.attendanceRecord
        const status = record?.status
        const isShiftDay = status === 'oneShift' || status === 'doubleShift'
        const startTime = record?.startTime || DEFAULT_START_TIME
        const { end, rolledOver } = isShiftDay ? addHoursToTime(startTime, status === 'doubleShift' ? 24 : 12) : {}
        const notYetJoined = hasNotJoinedYet(emp, selectedDate)
        return (
          <div className="flex items-center justify-between gap-2 py-1">
            <div>
              {status ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm ${STATUS_STYLES[status]}`}
                >
                  {t.statusLabel[status]}
                </span>
              ) : (
                <AppTooltip title={notYetJoined ? t.notYetJoinedTooltip(formatDate(emp.joinDate)) : undefined}>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-400">
                    {notYetJoined ? t.notYetJoinedBadge : t.noRecord}
                  </span>
                </AppTooltip>
              )}
              {isShiftDay ? (
                <p className="mt-1 text-[10px] font-medium text-slate-400">{t.shiftWindow(formatTime12h(startTime), formatTime12h(end), rolledOver)}</p>
              ) : null}
            </div>
            <AppTooltip title={notYetJoined ? t.notYetJoinedTooltip(formatDate(emp.joinDate)) : undefined}>
              <IconButton
                onClick={() => openEditAttendance(emp)}
                disabled={busy || notYetJoined}
                aria-label={t.editAttendance}
                title={notYetJoined ? undefined : t.editAttendance}
                tone="edit"
              >
                <Pencil size={15} />
              </IconButton>
            </AppTooltip>
          </div>
        )
      },
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonTable rows={6} cols={6} />
      </div>
    )
  }

  if (attendanceError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {attendanceError}</div>
  }

  // Shared between the standalone header below (history tab, or the mark
  // tab's empty state — neither renders a DataTable of its own to carry
  // this) and the mark tab's DataTable leadingContent (merged into its own
  // toolbar row so the tabs, date, Mark All buttons, search box, and Export
  // CSV button all end up on the exact same row instead of two stacked ones).
  const tabsNav = (
    <div className="flex items-center gap-1">
      {[
        { key: 'mark', label: t.tabMark },
        { key: 'history', label: t.tabHistory },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveTab(tab.key)}
          disabled={busy}
          className={`relative px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            activeTab === tab.key ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {tab.label}
          {activeTab === tab.key ? (
            <motion.span layoutId="attendanceTabUnderline" className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-600" />
          ) : null}
        </button>
      ))}
    </div>
  )
  const showOwnHeader = activeTab === 'history' || activeEmployees.length === 0

  return (
    // Same fillHeight pattern as Employees.jsx — flex h-full lets the card
    // below (and, inside it, whichever tab is active) stretch to exactly
    // fill whatever height `main` actually has, instead of a hand-guessed
    // `calc(100vh - Npx)` that has to be re-tuned by hand and still drifts
    // across browsers/zoom.
    <div className="flex h-full min-h-0 flex-col gap-6">
      {busy ? <FullPageLoader label={t.saving} /> : null}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {showOwnHeader ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
            {tabsNav}

            {activeTab === 'history' ? (
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
              </div>
            ) : null}
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          {activeTab === 'mark' ? (
            <motion.div
              key="mark"
              className="flex min-h-0 flex-1 flex-col"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {activeEmployees.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={Users}
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
              ) : (
                <DataTable
                  columns={columns}
                  data={selectedDateData}
                  rowKey="id"
                  globalFilterFields={['name', 'phone', 'role', 'fatherName']}
                  searchPlaceholder={t.searchPlaceholder}
                  defaultSortField="name"
                  fillHeight
                  exportFilename={`attendance-${selectedDate}`}
                  dense
                  leadingContent={tabsNav}
                  trailingContent={
                    <>
                      <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 py-1 pl-1 pr-2 ring-1 ring-slate-200">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white">
                          <CalendarDays size={13} />
                        </div>
                        <AppDatePicker value={selectedDate} onChange={setSelectedDate} maxDate={today} variant="inline" className="w-[140px]" />
                        {selectedDate === today ? (
                          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">{t.today}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => markAll('oneShift')}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-100 hover:shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t.markAllOneShift}
                        </button>
                        <button
                          onClick={() => markAll('absent')}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600 transition-all hover:bg-rose-100 hover:shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t.markAllAbsent}
                        </button>
                        <button
                          onClick={() => markAll('leave')}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-all hover:bg-amber-100 hover:shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t.markAllLeave}
                        </button>
                      </div>
                    </>
                  }
                />
              )}
            </motion.div>
          ) : (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-1 flex-col p-5"
            >
              {activeEmployees.length === 0 ? (
                <EmptyState icon={CalendarDays} title={t.emptyHistoryTitle} description={t.emptyHistoryDesc} />
              ) : (
                <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-white ring-1 ring-slate-100">
                  <table className="w-full border-separate border-spacing-y-1 text-left text-xs">
                    <thead>
                      <tr>
                        <th className="sticky left-0 top-0 z-20 min-w-[140px] bg-brand-50 px-2 pb-1 pt-1 text-xs font-semibold text-brand-700">
                          {t.colEmployee}
                        </th>
                        {monthDays.map((d) => (
                          <th key={d} className="sticky top-0 z-10 min-w-[30px] bg-brand-50 px-1 pb-1 pt-1 text-center font-medium text-brand-700">
                            <div>{new Date(d).getDate()}</div>
                            <div className="text-[9px] font-normal text-brand-400">{formatDayLabel(d)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeEmployees.map((emp) => (
                        <tr key={emp.id} className="bg-white">
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1 font-medium text-slate-700">{emp.name}</td>
                          {monthDays.map((d) => {
                            const record = attendance[emp.id]?.[d]
                            const status = record?.status
                            return (
                              <td key={d} className="px-1 py-1 text-center">
                                <div
                                  title={
                                    status
                                      ? `${t.statusLabel[status]}${record?.startTime ? ` · ${record.startTime}` : ''}`
                                      : t.noRecord
                                  }
                                  className="mx-auto flex h-5 w-5 items-center justify-center"
                                >
                                  {!status ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
                                  ) : status === 'dutyOff' ? (
                                    <span className="text-[8px] font-bold text-slate-300">{t.offShort}</span>
                                  ) : (
                                    <span
                                      className={`rounded-full ${STATUS_STYLES[status]} ${
                                        status === 'doubleShift' ? 'h-4 w-4 ring-2 ring-blue-200' : 'h-3 w-3'
                                      }`}
                                    />
                                  )}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                {STATUS_OPTIONS.map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[s]}`} /> {t.statusLabel[s]}
                  </span>
                ))}
                <span className="text-slate-400">{t.legendDoubleShift}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <Modal
        isOpen={!!editTarget}
        onClose={saving ? () => {} : () => setEditTarget(null)}
        title={editTarget ? t.editAttendanceTitle(editTarget.name) : ''}
      >
        {editTarget ? (
          <form onSubmit={saveEditAttendance} onKeyDown={submitOnEnter} className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setModalStatus(s)}
                  disabled={saving}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                    modalStatus === s ? `${STATUS_STYLES[s]} text-white shadow-sm` : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {t.statusLabel[s]}
                </button>
              ))}
            </div>

            {modalStatus === 'oneShift' || modalStatus === 'doubleShift' ? (
              <Field label={t.startTime}>
                <AppTimePicker value={modalStartTime} onChange={setModalStartTime} className="w-full" disabled={saving} />
                <p className="mt-1 text-xs text-slate-400">
                  {t.shiftWindow(
                    formatTime12h(modalStartTime),
                    formatTime12h(addHoursToTime(modalStartTime, modalStatus === 'doubleShift' ? 24 : 12).end),
                    addHoursToTime(modalStartTime, modalStatus === 'doubleShift' ? 24 : 12).rolledOver,
                  )}
                </p>
              </Field>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton type="button" onClick={() => setEditTarget(null)} disabled={saving}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={saving}>
                {t.saveAttendance}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )
}
