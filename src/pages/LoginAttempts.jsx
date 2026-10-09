import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ShieldAlert, X } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { LOGIN_ATTEMPTS_TEXT } from '../i18n/loginAttempts.js'
import { formatDateTime, toISODate } from '../utils/format.js'
import DataTable from '../components/DataTable.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'

const ACTION_BADGE = 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600'

export default function LoginAttempts() {
  const { currentUser, loginAttempts, loginAttemptsLoading, loginAttemptsError, loadLoginAttempts } = useData()
  const { language } = useLanguage()
  const t = LOGIN_ATTEMPTS_TEXT[language]

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Not auto-loaded globally (see DataContext's own comment on this) —
  // this is the one place that actually triggers the fetch, and only ever
  // mounts for an admin (nav item + this route are both gated the same way).
  useEffect(() => {
    if (currentUser?.role === 'admin') loadLoginAttempts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role])

  // A manager/staff account could still type this URL in directly — the
  // nav item being hidden for them doesn't stop that, so the page itself
  // has to refuse too, same as the backend's own require_admin already does.
  if (currentUser && currentUser.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  const dateFilteredAttempts = useMemo(() => {
    const withLabels = loginAttempts.map((a) => ({
      ...a,
      // Searched (not shown as their own columns) — `action`/`success` are
      // a raw code and a boolean, neither of which matches what the search
      // box's placeholder promises finding by the text actually on screen
      // (the translated action label, "Success"/"Failed").
      actionLabel: t.actionLabel[a.action] || a.action,
      statusLabel: a.success ? t.statusSuccess : t.statusFailed,
      reasonLabelText: a.reason ? t.reasonLabel(a.reason) : '',
    }))
    if (!dateFrom && !dateTo) return withLabels
    return withLabels.filter((a) => {
      const day = toISODate(a.createdAt)
      if (dateFrom && day < dateFrom) return false
      if (dateTo && day > dateTo) return false
      return true
    })
  }, [loginAttempts, dateFrom, dateTo, t])

  const dateFilterActive = !!(dateFrom || dateTo)

  function clearDateFilters() {
    setDateFrom('')
    setDateTo('')
  }

  const columns = [
    {
      field: 'createdAt',
      header: t.colTime,
      sortable: true,
      style: { width: '14%' },
      body: (a) => <span className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(a.createdAt)}</span>,
    },
    {
      field: 'identifier',
      header: t.colIdentifier,
      sortable: true,
      style: { width: '20%' },
      body: (a) => <span className="font-medium text-slate-800">{a.identifier}</span>,
    },
    {
      field: 'action',
      header: t.colAction,
      sortable: true,
      style: { width: '14%' },
      body: (a) => <span className={ACTION_BADGE}>{t.actionLabel[a.action] || a.action}</span>,
    },
    {
      field: 'success',
      header: t.colStatus,
      sortable: true,
      style: { width: '12%' },
      body: (a) => (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            a.success ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}
        >
          {a.success ? t.statusSuccess : t.statusFailed}
        </span>
      ),
    },
    {
      field: 'reason',
      header: t.colReason,
      style: { width: '22%' },
      body: (a) => <span className="text-xs text-slate-500">{a.reason ? t.reasonLabel(a.reason) : '—'}</span>,
    },
    {
      field: 'ipAddress',
      header: t.colIp,
      style: { width: '18%' },
      body: (a) => <span className="text-xs text-slate-400">{a.ipAddress || '—'}</span>,
    },
  ]

  if (loginAttemptsLoading && loginAttempts.length === 0) {
    return <SkeletonTable rows={8} cols={6} />
  }

  return (
    // h-full (matches Layout.jsx's lg:h-full on `main`) + fillHeight below —
    // the table now stretches to whatever vertical space the page actually
    // has, growing or shrinking with the window instead of a hand-guessed
    // `calc(100vh - Npx)` that stays wrong the moment this header's own
    // height changes (which it just did, losing 2 lines) or the browser's
    // own chrome/zoom shifts how tall 100vh really renders.
    <div className="flex h-full min-h-0 flex-col gap-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {loginAttemptsError ? (
          <p className="p-5 pb-0 text-xs text-rose-500">{loginAttemptsError}</p>
        ) : null}

        {loginAttempts.length === 0 && !loginAttemptsLoading ? (
          <div className="p-5">
            {/* No DataTable at all in this empty-state branch (see below),
                so the title/subtitle header that normally rides inside its
                toolbar — see titleBlock's own comment — has to render here
                on its own instead, so it's never just missing entirely
                when there's nothing to show yet. */}
            <div className="mb-1 flex items-center gap-2">
              <ShieldAlert size={16} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800">{t.title}</h3>
            </div>
            <p className="mb-3 text-xs text-slate-400">{t.subtitle}</p>
            <p className="text-xs text-slate-400">{t.noData}</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={dateFilteredAttempts}
            rowKey="id"
            globalFilterFields={['identifier', 'ipAddress', 'actionLabel', 'statusLabel', 'reasonLabelText']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="createdAt"
            defaultSortOrder={-1}
            fillHeight
            // A taller scroll area (fillHeight, above) showing the same old
            // 10-row page just left empty space below those 10 rows on any
            // screen tall enough to fit more — this actually puts the extra
            // room to use. Still changeable via the page-size dropdown.
            rows={25}
            exportFilename="login-attempts"
            emptyMessage={t.noMatch}
            dense
            leadingContent={
              // Title+subtitle moved in here (was its own block above the
              // table, always on its own two rows) so the title shares a
              // row with the search/filter/Export toolbar instead of
              // forcing a row of its own — only the subtitle sentence still
              // gets a line to itself, stacked right under the title within
              // this one block. max-w-[260px] keeps a long subtitle
              // wrapping inside its own column instead of elbowing the
              // date-range/Export controls off the row.
              <div className="max-w-[260px] shrink-0">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={16} className="text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-800">{t.title}</h3>
                </div>
                <p className="text-xs text-slate-400">{t.subtitle}</p>
              </div>
            }
            // This toolbar (search, count, date range, Export) is short
            // enough to always fit on one line on any real desktop width —
            // wrapping it onto a second line (DataTable's normal default,
            // meant for a longer trailingContent like Attendance's several
            // "Mark All" buttons) just left it looking broken instead.
            toolbarNowrap
            trailingContent={
              // Plain inline labels beside each picker (not Field's
              // label-above-input) — that stacking is what was pushing this
              // whole row into looking like two rows and leaving a lot of
              // dead vertical space above it; everything here now shares one
              // flex baseline, same as the date filter on Fuel Entry/
              // Attendance's own trailingContent.
              <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
                <p className="shrink-0 whitespace-nowrap text-xs text-slate-400">{t.showingCount(dateFilteredAttempts.length, loginAttempts.length)}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs font-semibold text-slate-500">{t.dateFrom}</span>
                  <AppDatePicker value={dateFrom} onChange={setDateFrom} maxDate={dateTo || undefined} clearable fixedWidth={118} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs font-semibold text-slate-500">{t.dateTo}</span>
                  <AppDatePicker value={dateTo} onChange={setDateTo} minDate={dateFrom || undefined} clearable fixedWidth={118} />
                </div>
                {dateFilterActive ? (
                  <button
                    type="button"
                    onClick={clearDateFilters}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-50"
                  >
                    <X size={13} /> {t.clearFilters}
                  </button>
                ) : null}
              </div>
            }
          />
        )}
      </motion.div>
    </div>
  )
}
