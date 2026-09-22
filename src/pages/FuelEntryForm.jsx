import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ReceiptText, Fuel, TrendingUp, AlertTriangle, ClipboardCheck } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { FUEL_ENTRY_TEXT } from '../i18n/fuelEntry.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { aggregateEntries, withCarriedOpenings, sortPumpEntries } from '../utils/fuelCalc.js'
import EmptyState from '../components/EmptyState.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import CalcBreakdown from '../components/CalcBreakdown.jsx'
import PumpDayEditor from '../components/PumpDayEditor.jsx'
import AuditModal from '../components/AuditModal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import Modal from '../components/Modal.jsx'
import { PrimaryButton, SecondaryButton } from '../components/FormControls.jsx'

// Each shift is its own independently-saved record now (see PumpDayEditor —
// every shift card has its own Save Entry, with no draft/autosave of any
// kind). This page is just the day-level shell around that: pick a date,
// switch between the two pumps, and see the combined totals once shifts are
// saved. Nothing here submits anything itself.
export default function FuelEntryForm() {
  const { entryId } = useParams()
  const navigate = useNavigate()
  const {
    fuelEntries,
    fuelEntriesLoading,
    fuelRates,
    employees,
    creditCustomers,
    lubricants,
    station,
    updateStation,
    attendance,
    loadAttendanceMonth,
    setHasUnsavedChanges,
    setSaveUnsavedChangesHandler,
  } = useData()
  const { language } = useLanguage()
  const t = FUEL_ENTRY_TEXT[language]
  // Employee dropdown lists every active employee regardless of that date's
  // attendance — deliberately NOT restricted to who's marked present, since
  // attendance is often marked after the shift is entered, not before, and a
  // hard restriction was blocking the manager from assigning someone whose
  // attendance just hadn't been marked yet.
  const activeEmployees = useMemo(() => employees.filter((e) => e.active !== false), [employees])

  // Each PumpDayEditor reports its own dirty state up here (see its
  // onDirtyChange prop) — neither pump's shift cards ever actually unmount
  // just from switching tabs (both stay mounted, only hidden via CSS), so
  // nothing is technically at risk there, but the manager asked for the
  // reminder anyway: it's easy to switch away from a half-finished shift and
  // forget to come back and click Save Entry. Changing the date, or leaving
  // this page/screen entirely, DOES throw the unsaved state away for real
  // (see PumpDayEditor's `key` prop below and its own localStorage restore).
  const [pump1Dirty, setPump1Dirty] = useState(false)
  const [pump2Dirty, setPump2Dirty] = useState(false)
  const anyDirty = pump1Dirty || pump2Dirty
  const pump1Ref = useRef(null)
  const pump2Ref = useRef(null)

  // Saves whatever's currently dirty on EITHER pump — used by every "Save"
  // button below (this page's own prompts, and Layout's sidebar/bottom-nav
  // prompt, via setSaveUnsavedChangesHandler). Returns true only once
  // everything dirty has genuinely saved; a validation failure or a failed
  // request on any one shift (already surfaced right on that shift's own
  // card) means the caller should not proceed with the navigation it was
  // about to do.
  async function attemptSaveAllDirty() {
    const results = await Promise.all([
      pump1Ref.current?.attemptSaveDirtyShifts() ?? true,
      pump2Ref.current?.attemptSaveDirtyShifts() ?? true,
    ])
    return results.every(Boolean)
  }

  useEffect(() => {
    setHasUnsavedChanges(anyDirty)
  }, [anyDirty, setHasUnsavedChanges])
  // Only the true unmount (leaving this page) should ever clear the global
  // flag — not a dependency-change cleanup, which would otherwise flip it
  // false-then-true again on every single dirty/clean transition.
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges])

  // Lets Layout's sidebar/bottom-nav unsaved-changes prompt's "Save" button
  // reach this page's own save logic — that prompt fires from entirely
  // outside this component tree.
  useEffect(() => {
    setSaveUnsavedChangesHandler(attemptSaveAllDirty)
    return () => setSaveUnsavedChangesHandler(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSaveUnsavedChangesHandler])

  // Holds whatever the manager just clicked (switch pump tab, change date,
  // leave the page) until they confirm they really want to — a plain
  // function to run on confirm, or null while no prompt is open.
  const [pendingLeaveAction, setPendingLeaveAction] = useState(null)
  function guardedRun(hasUnsaved, action) {
    if (hasUnsaved) {
      setPendingLeaveAction(() => action)
      return
    }
    action()
  }
  function confirmLeave() {
    pendingLeaveAction?.()
    setPendingLeaveAction(null)
  }
  // "Save" in this page's own prompts (switch pump, change date, back to
  // history): save first, and only actually proceed once that's genuinely
  // succeeded.
  async function handleSaveAndLeave() {
    const action = pendingLeaveAction
    const ok = await attemptSaveAllDirty()
    setPendingLeaveAction(null)
    if (ok) action?.()
  }

  // Arriving via a History row (entryId set) jumps straight to that shift's
  // day + pump; arriving via "New Day Entry" starts on today, Pump 1 — or,
  // if a ?date= is already in the address bar (see the sync effect below),
  // whatever date that names.
  const linkedEntry = entryId ? fuelEntries.find((e) => e.id === entryId) : null
  const [searchParams, setSearchParams] = useSearchParams()
  const [date, setDate] = useState(() => {
    if (linkedEntry) return linkedEntry.date
    const fromUrl = searchParams.get('date')
    return /^\d{4}-\d{2}-\d{2}$/.test(fromUrl || '') ? fromUrl : todayISO()
  })

  // New Entry only — keeps the address bar in sync with whichever date is
  // currently picked here. Nothing else remembers it: this page (unlike
  // PumpDayEditor, which was deliberately stripped of all draft/localStorage
  // persistence) never kept its own selected-date state anywhere either, so
  // a plain refresh had no way to know a different date had been chosen and
  // always silently reopened on today — surprising after deliberately
  // switching away from it. The URL is not "local storage": it's the one
  // place a refresh (or a shared/bookmarked link) is SUPPOSED to read state
  // back from. Never touches the URL while editing an existing entry — that
  // route already carries its own entryId, and the date there is fixed to
  // whatever that entry's date is, never independently chosen.
  useEffect(() => {
    if (entryId) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('date', date)
        return next
      },
      { replace: true },
    )
  }, [entryId, date, setSearchParams])

  // Attendance only auto-loads the real-world current month by default (see
  // DataContext) — Fuel Entry can view any date, so make sure whichever
  // month is actually being viewed is loaded too (a no-op if it already is).
  useEffect(() => {
    const [year, month] = date.split('-').map(Number)
    loadAttendanceMonth(year, month - 1)
  }, [date, loadAttendanceMonth])

  const [activeTab, setActiveTab] = useState(() => linkedEntry?.pumpKey || 'pump1')

  // New Entry only, and only ever checked once per visit to this page — a
  // heads-up, not a hard block (today deliberately stays selectable even
  // with existing entries, see datesWithEntries below, since adding another
  // shift for today is completely normal). Waits for fuelEntries to finish
  // loading so a fast-arriving page load doesn't miss real data that just
  // hasn't landed yet; the ref then latches so saving a shift here during
  // this same visit (which adds to fuelEntries) never re-triggers it.
  // Holds the id of whichever today's-entry was found (there's no "continue
  // here" choice — only the exact record found, to jump straight into
  // editing it), or null while nothing's been found/the prompt is closed.
  const [todayEntryExistsPrompt, setTodayEntryExistsPrompt] = useState(null)
  const checkedTodayEntryRef = useRef(false)
  useEffect(() => {
    if (entryId) return
    if (fuelEntriesLoading || checkedTodayEntryRef.current) return
    checkedTodayEntryRef.current = true
    const todaysEntry = fuelEntries.find((e) => e.date === todayISO())
    if (todaysEntry) setTodayEntryExistsPrompt(todaysEntry.id)
  }, [entryId, fuelEntriesLoading, fuelEntries])

  const [auditOpen, setAuditOpen] = useState(false)
  // Its own state, entirely separate from the main audit above — Shift 3's
  // report is its own thing, opened independently.
  const [shift3AuditOpen, setShift3AuditOpen] = useState(false)

  // fuelEntries now loads from the API asynchronously — a hard refresh (or a
  // bookmark) landing directly on a specific entry's URL mounts this well
  // before that fetch (and the auth-restore silent refresh ahead of it) ever
  // resolves, so date/activeTab above fall back to "today, Pump 1" at first,
  // even though a real entryId was given. Once linkedEntry actually becomes
  // available, jump to its real date/pump.
  //
  // This USED to gate on fuelEntriesLoading turning false, on the
  // assumption that only ever happens once, after a real fetch — but
  // fuelEntriesLoading starts false (its plain useState default) and only
  // ever flips true once DataContext's own effect notices isAuthenticated
  // and calls loadFuelEntries(). Before auth restore resolves,
  // isAuthenticated is still false, so that effect hasn't fired yet either —
  // fuelEntriesLoading reads as false not because loading finished, but
  // because it hasn't started. This effect used to run right then, see
  // linkedEntry still unresolved (fuelEntries is still `[]`), and — because
  // the guard was a one-shot boolean — permanently mark itself "done"
  // without ever having actually synced anything. The real fetch would
  // still complete moments later with the correct entry, but nothing was
  // listening anymore: the page silently stayed on "today, Pump 1" for
  // good, with no error and no visual difference from a genuinely blank
  // new entry — exactly the kind of confusing state a manager could start
  // editing without ever noticing it was the wrong day/pump.
  //
  // Keying the guard on entryId itself (rather than a boolean) instead
  // fires the moment linkedEntry is genuinely found, however many renders
  // that takes, and still fires again correctly if entryId itself ever
  // changes under this same mounted instance (e.g. editing entry A, then
  // entry B, without the route unmounting in between — React Router
  // doesn't remount on a param-only change against the same route).
  const resyncedForEntryIdRef = useRef(null)
  useEffect(() => {
    if (!entryId || !linkedEntry || resyncedForEntryIdRef.current === entryId) return
    resyncedForEntryIdRef.current = entryId
    setDate(linkedEntry.date)
    setActiveTab(linkedEntry.pumpKey)
  }, [entryId, linkedEntry])

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
  //
  // Kept ABOVE the entryId-not-found early return below — this is a hook, and
  // hooks can never come after a conditional return or their call order
  // changes between "still loading" and "loaded" renders, which is exactly
  // what threw "Rendered more hooks than during the previous render" here.
  // The audit report reads straight off whatever's actually saved for this
  // date (dayBreakdown below, built from this same fuelEntries filter) — a
  // brand new, still-unsaved add has nothing for it to summarize yet, so the
  // button stays disabled (with a hint) until the first draft/final save for
  // this date lands, rather than opening to a report that's all zeros.
  const hasSavedEntryForDate = useMemo(() => fuelEntries.some((e) => e.date === date), [fuelEntries, date])

  // New-entry only (see the AppDatePicker below) — every date that already
  // has at least one fuel entry (any pump, any shift, draft or final)
  // becomes unselectable in the calendar, so a manager can't accidentally
  // pick a day that's already been started here instead of opening it via
  // Entry History's Edit action. Doesn't scope by pump/shift the way the
  // backend's own uq_fuel_entries_date_pump_shift constraint does — this is
  // a coarser "this day already has activity, go edit it instead" guard, on
  // purpose, matching how "New Daily Fuel Entry" itself represents a whole
  // day, not a single pump+shift slot. Today is deliberately EXCLUDED from
  // this set (see shouldDisableDate below) — adding another shift/pump for
  // the current day, later the same day, is completely normal and the most
  // common reason to reopen "New Entry" at all; only an already-used PAST
  // (or future) date is the actual mistake this guards against.
  const datesWithEntries = useMemo(
    () => new Set(fuelEntries.filter((e) => e.date !== todayISO()).map((e) => e.date)),
    [fuelEntries],
  )

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

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-1.5 sm:flex-row sm:items-center sm:gap-3">
          {/* min-w-0 + truncate on the title is what keeps the sm:+ single
              row from overflowing: a flex child won't shrink below its
              content's natural width by default (min-width: auto), so
              without this, a long title alone was enough to push Audit past
              the right edge on a wide screen — genuinely too wide to fit
              both groups side by side, not just a spacing tweak. Truncating
              the title (never Audit/Date, which must always stay fully
              visible) is what buys the room back on desktop.
              Below sm, this whole row stacks instead (flex-col above) —
              forcing everything onto one rigid row is exactly what caused
              the mobile alignment issue: Audit/Shift-3-Audit/Date together
              have a real minimum width of their own that a phone screen
              often can't fit next to the title, even fully truncated. */}
          <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:gap-3">
            <button
              type="button"
              onClick={() => guardedRun(anyDirty, () => navigate('/fuel-entry'))}
              className="flex shrink-0 items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700"
            >
              <ArrowLeft size={15} /> {t.entryHistory}
            </button>
            <span className="hidden h-4 w-px shrink-0 bg-slate-200 sm:block" />
            <h2 className="truncate text-base font-bold text-slate-800">{entryId ? t.editEntry : t.newEntry}</h2>
          </div>
          {/* On its own row below sm (flex-wrap, so even Audit+Shift3Audit+
              Date together can drop to a second line rather than overflow on
              a very narrow phone); sm:+ this becomes the same rigid,
              non-wrapping, always-fully-visible row as before — Audit still
              comes before Date on purpose. */}
          <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:shrink-0">
            <button
              type="button"
              onClick={() => setAuditOpen(true)}
              disabled={!hasSavedEntryForDate}
              title={hasSavedEntryForDate ? undefined : t.auditDisabledHint}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-200 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            >
              <ClipboardCheck size={13} /> {t.auditButton}
            </button>
            {dayBreakdown.hasShift3 ? (
              <button
                type="button"
                onClick={() => setShift3AuditOpen(true)}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-violet-700 shadow-sm ring-1 ring-violet-200 transition-colors hover:bg-violet-50"
              >
                <ClipboardCheck size={13} /> {t.shift3AuditButton}
              </button>
            ) : null}
            <span className="shrink-0 text-xs font-semibold text-slate-600">{t.fieldDate}</span>
            {/* Locked once editing an existing entry — changing the date on
                an already-saved shift is exactly the kind of edit that leaves
                things in a confusing/broken state (a saved entry now sitting
                under a date it doesn't match everywhere else it's
                referenced), so it's only ever settable while still creating
                a brand new entry. Wrapped in a span (not the DatePicker
                itself) so the hover hint still works — MUI's own disabled
                state on the field can otherwise block pointer events from
                ever reaching the tooltip trigger. */}
            <AppTooltip title={entryId ? t.dateDisabledEditHint : undefined}>
              <span>
                <AppDatePicker
                  value={date}
                  onChange={(next) => guardedRun(anyDirty, () => setDate(next))}
                  variant="compact"
                  className="shrink-0"
                  disabled={Boolean(entryId)}
                  // New entry only — a shift can't be recorded for a day that
                  // hasn't happened yet. Not applied while editing: entryId
                  // already disables the field entirely above.
                  maxDate={entryId ? undefined : todayISO()}
                  shouldDisableDate={entryId ? undefined : (iso) => datesWithEntries.has(iso)}
                />
              </span>
            </AppTooltip>
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
          <PumpTab
            active={activeTab === 'pump1'}
            onClick={() => guardedRun(activeTab === 'pump2' && pump2Dirty, () => setActiveTab('pump1'))}
            label={t.pump1}
            accentText="text-violet-600"
            accentBar="bg-violet-600"
          />
          <PumpTab
            active={activeTab === 'pump2'}
            onClick={() => guardedRun(activeTab === 'pump1' && pump1Dirty, () => setActiveTab('pump2'))}
            label={t.pump2}
            accentText="text-ocean-600"
            accentBar="bg-ocean-600"
          />
        </div>

        <div className={`pt-3 ${activeTab === 'pump1' ? '' : 'hidden'}`}>
          <PumpDayEditor
            ref={pump1Ref}
            key={`pump1-${date}`}
            pumpKey="pump1"
            label={t.pump1}
            accent="bg-violet-600"
            tint="violet"
            date={date}
            employees={activeEmployees}
            fuelRates={fuelRates}
            creditCustomers={creditCustomers}
            onDirtyChange={setPump1Dirty}
          />
        </div>
        <div className={`pt-3 ${activeTab === 'pump2' ? '' : 'hidden'}`}>
          <PumpDayEditor
            ref={pump2Ref}
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
            onDirtyChange={setPump2Dirty}
          />
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!pendingLeaveAction}
        onClose={() => setPendingLeaveAction(null)}
        onCancelClick={handleSaveAndLeave}
        onConfirm={confirmLeave}
        title={t.unsavedChangesTitle}
        description={t.unsavedChangesDesc}
        confirmLabel={t.unsavedChangesLeave}
        cancelLabel={t.unsavedChangesStay}
        confirmTone="leave"
      />

      {/* Deliberately not dismissible by the usual X / backdrop / Escape (a
          no-op onClose, and the X hidden entirely) — this needs an explicit
          choice, not an easy way to click past it and forget it was ever
          shown. */}
      <Modal isOpen={todayEntryExistsPrompt != null} onClose={() => {}} hideCloseButton title={t.todayEntryExistsTitle} maxWidth="max-w-lg">
        <p className="text-sm text-slate-600">{t.todayEntryExistsDesc}</p>
        {/* Row 1: choose a different date. Row 2: the two "leave this page
            entirely" actions — kept visually separate (its own row, not
            just more buttons tacked onto the date row) since it's a
            different kind of choice. Both rows stack on narrow screens
            (label above the field; buttons full-width, one per line)
            instead of squeezing everything onto one cramped line — the
            longer button/label text this modal uses needs the room. */}
        <div className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xs font-semibold text-slate-600">{t.todayEntryExistsChooseAnotherDateForNewEntry}</span>
          {/* Same rules as the main Date field above (see AppDatePicker
              there): no future dates, and no date that already has an
              entry — today is excluded from that second rule, but today is
              exactly the date this whole modal exists because of, so
              picking it again here would just be a no-op back to where the
              manager already is. */}
          <AppDatePicker
            value={date}
            onChange={(next) => {
              setDate(next)
              setTodayEntryExistsPrompt(null)
            }}
            variant="compact"
            maxDate={todayISO()}
            shouldDisableDate={(iso) => iso === todayISO() || datesWithEntries.has(iso)}
          />
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <SecondaryButton
            onClick={() => {
              setTodayEntryExistsPrompt(null)
              navigate('/fuel-entry')
            }}
            className="w-full px-4 py-2 text-sm sm:w-auto"
          >
            {t.todayEntryExistsBackToHistoryTable}
          </SecondaryButton>
          <PrimaryButton
            onClick={() => {
              const targetId = todayEntryExistsPrompt
              // Explicitly closed here rather than left to the route change
              // to unmount it — this component (FuelEntryForm) renders both
              // /fuel-entry/new and /fuel-entry/:entryId/edit, so depending
              // on exactly how/when that transition lands, the modal could
              // otherwise still be sitting open (or mid animated-close) for
              // a beat after the click, reading as "nothing happened."
              setTodayEntryExistsPrompt(null)
              navigate(`/fuel-entry/${targetId}/edit`)
            }}
            className="w-full px-4 py-2 text-sm sm:w-auto"
          >
            {t.todayEntryExistsEdit(formatDate(todayISO()))}
          </PrimaryButton>
        </div>
      </Modal>

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
        hasShift3={dayBreakdown.hasShift3}
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
