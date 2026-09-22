import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import {
  COMMISSION_RATES,
  STATION,
} from '../data/mockData.js'
import { todayISO } from '../utils/format.js'
import { currentFuelRates } from '../utils/fuelRate.js'
import {
  getEmployees,
  createEmployee as apiCreateEmployee,
  updateEmployee as apiUpdateEmployee,
  addSalaryRevision as apiAddSalaryRevision,
  deleteSalaryRevision as apiDeleteSalaryRevision,
  addEmployeeCredit as apiAddEmployeeCredit,
  updateEmployeeCredit as apiUpdateEmployeeCredit,
  deleteEmployeeCredit as apiDeleteEmployeeCredit,
  getLubricants,
  createLubricant as apiCreateLubricant,
  updateLubricant as apiUpdateLubricant,
  deleteLubricant as apiDeleteLubricant,
  addPriceRevision as apiAddPriceRevision,
  deletePriceRevision as apiDeletePriceRevision,
  recordPurchase as apiRecordPurchase,
  updatePurchase as apiUpdatePurchase,
  deletePurchase as apiDeletePurchase,
  getExpenses,
  createExpenseDay as apiCreateExpenseDay,
  updateExpenseDay as apiUpdateExpenseDay,
  deleteExpenseDay as apiDeleteExpenseDay,
  getCreditCustomers,
  createCreditCustomer as apiCreateCreditCustomer,
  updateCreditCustomer as apiUpdateCreditCustomer,
  deleteCreditCustomer as apiDeleteCreditCustomer,
  addLedgerEntry as apiAddLedgerEntry,
  deleteLedgerEntry as apiDeleteLedgerEntry,
  updateLedgerEntryBill as apiUpdateLedgerEntryBill,
  getOfferCustomers,
  createOfferCustomer as apiCreateOfferCustomer,
  updateOfferCustomer as apiUpdateOfferCustomer,
  deleteOfferCustomer as apiDeleteOfferCustomer,
  sendOffer as apiSendOffer,
  previewOfferTemplate as apiPreviewOfferTemplate,
  getOfferHistory,
  getAttendanceMonth,
  markAttendance as apiMarkAttendance,
  updateAttendance as apiUpdateAttendance,
  getFuelEntries,
  createFuelEntry as apiCreateFuelEntry,
  updateFuelEntry as apiUpdateFuelEntry,
  deleteFuelEntry as apiDeleteFuelEntry,
  setAuthTokens,
  syncRefreshToken,
  setSessionExpiredHandler,
  setTokensRefreshedHandler,
  getMe,
  apiPost,
  changePassword as apiChangePassword,
  createOrReviseCommissionRate as apiCreateOrReviseCommissionRate,
  getCommissionRateHistory as apiGetCommissionRateHistory,
  deleteCommissionRate as apiDeleteCommissionRate,
  createOrReviseFuelRate as apiCreateOrReviseFuelRate,
  getFuelRateHistory as apiGetFuelRateHistory,
  deleteFuelRateRevision as apiDeleteFuelRateRevision,
  createOrReviseFuelStockLog as apiCreateOrReviseFuelStockLog,
  getFuelStockLogs as apiGetFuelStockLogs,
  getDashboardSummary as apiGetDashboardSummary,
} from '../lib/apiClient.js'

const DataContext = createContext(null)

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`
}

// Every mutable slice of app data (fuel entries — including drafts — plus
// everything a fuel entry's side effects touch) round-trips through
// localStorage, keyed by slice name, so a real browser refresh or a closed
// tab never loses an in-progress shift: the manager never has to remember
// to save before navigating away, it's just always already saved.
const STORAGE_PREFIX = 'ga-fuel-pump:'

function loadPersisted(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : fallback()
  } catch {
    return fallback()
  }
}

function usePersistedState(key, fallback) {
  const [value, setValue] = useState(() => loadPersisted(key, fallback))
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
    } catch {
      // Storage full or unavailable (e.g. private browsing) — the app still
      // works for this session, it just won't survive a refresh.
    }
  }, [key, value])
  return [value, setValue]
}

export function DataProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // In-memory only — never persisted, so a refresh of the tab always
  // requires signing in again until a real "remember me" flow exists.
  const [accessToken, setAccessToken] = useState(null)
  const [refreshToken, setRefreshToken] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)

  // Employees now comes from the real API (see loadEmployees below) rather
  // than localStorage/mockData — same as every other slice below it now too.
  const [employees, setEmployees] = useState([])
  const [employeesLoading, setEmployeesLoading] = useState(false)
  const [employeesError, setEmployeesError] = useState(null)
  // Attendance now comes from the real API too (see loadAttendanceMonth
  // below) — fetched a month at a time and merged into this same
  // { [employeeId]: { [date]: {status, startTime} } } shape mockData used.
  const [attendance, setAttendanceState] = useState({})
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceError, setAttendanceError] = useState(null)
  // Fuel Entries now comes from the real API (see loadFuelEntries below)
  // rather than localStorage/mockData — the backend is the single source of
  // truth for the attendance/credit-ledger/employee-credit/stock cascade a
  // final save triggers (see addFuelEntry/updateFuelEntry/deleteFuelEntry).
  const [fuelEntries, setFuelEntries] = useState([])
  const [fuelEntriesLoading, setFuelEntriesLoading] = useState(false)
  const [fuelEntriesError, setFuelEntriesError] = useState(null)
  // Lubricants and Expenses now come from the real API (see loadLubricants/
  // loadExpenses below) rather than localStorage/mockData.
  const [lubricants, setLubricants] = useState([])
  const [lubricantsLoading, setLubricantsLoading] = useState(false)
  const [lubricantsError, setLubricantsError] = useState(null)
  // Credit Customers now comes from the real API (see loadCreditCustomers below).
  const [creditCustomers, setCreditCustomers] = useState([])
  const [creditCustomersLoading, setCreditCustomersLoading] = useState(false)
  const [creditCustomersError, setCreditCustomersError] = useState(null)
  const [expenseDays, setExpenseDays] = useState([])
  const [expensesLoading, setExpensesLoading] = useState(false)
  const [expensesError, setExpensesError] = useState(null)
  // Offers' own standalone recipient list — separate from Employees/Credit
  // Customers (see loadOfferCustomers below).
  const [offerCustomers, setOfferCustomers] = useState([])
  const [offerCustomersLoading, setOfferCustomersLoading] = useState(false)
  const [offerCustomersError, setOfferCustomersError] = useState(null)
  const [offerHistory, setOfferHistory] = useState([])
  const [offerHistoryLoading, setOfferHistoryLoading] = useState(false)
  const [offerHistoryError, setOfferHistoryError] = useState(null)
  const [station, setStation] = usePersistedState('station', () => STATION)
  const [commissionRates, setCommissionRates] = usePersistedState('commissionRates', () => COMMISSION_RATES)
  // Fuel Rate History (retail petrol/diesel/2T oil) now comes from the real
  // API (see loadFuelRateHistory below) rather than this browser's own
  // localStorage — a revision is now visible from any device/tablet and
  // survives clearing browser storage, and 2T oil is now a real dated
  // revision here too instead of the flat FUEL_RATES.oil constant it used
  // to always read as (see fuelRates in the context value below).
  const [fuelRateHistory, setFuelRateHistory] = useState([])
  const [fuelRateHistoryLoading, setFuelRateHistoryLoading] = useState(false)
  const [fuelRateHistoryError, setFuelRateHistoryError] = useState(null)
  // Fuel Stock Log — one row per date, the two figures the Audit modal's
  // Fuel Stock section can't get from anywhere else (Opening Stock, Stock
  // Received). See app/models/fuel_stock_log.py for why Sold/Current Stock
  // are never stored here.
  const [fuelStockLogs, setFuelStockLogs] = useState([])
  const [fuelStockLogsLoading, setFuelStockLogsLoading] = useState(false)
  const [fuelStockLogsError, setFuelStockLogsError] = useState(null)

  // ---------- Auth ----------
  // The refresh token AND a snapshot of the logged-in user are the two
  // things from auth persisted to localStorage — the token is what lets a
  // real browser refresh silently restore the session below instead of
  // bouncing back to /login every time; the cached user is what lets that
  // restore skip waiting on a second network round trip (GET /auth/me) just
  // to redraw the same name/role that was already known a moment ago.
  const REFRESH_TOKEN_KEY = STORAGE_PREFIX + 'refreshToken'
  const CACHED_USER_KEY = STORAGE_PREFIX + 'currentUser'
  const login = useCallback(({ accessToken, refreshToken, user }) => {
    setAuthTokens({ accessToken, refreshToken })
    setAccessToken(accessToken)
    setRefreshToken(refreshToken)
    setCurrentUser(user)
    setIsAuthenticated(true)
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user))
  }, [])
  const logout = useCallback(() => {
    // Best-effort server-side revoke of this session's refresh token, fired
    // before anything below clears it from memory. Without this, "logout"
    // was purely a client-side illusion — the token itself stayed valid on
    // the server (see AuthService.logout/refresh_tokens.revoked) until it
    // naturally expired days later, so anyone who'd captured it before this
    // moment could keep using it. Never awaited and never allowed to throw:
    // logout must complete locally even if the network is down or this call
    // itself fails, and there's nothing useful to do differently either way.
    if (refreshToken) apiPost('/auth/logout', { refresh_token: refreshToken }).catch(() => {})
    setAuthTokens(null)
    setAccessToken(null)
    setRefreshToken(null)
    setCurrentUser(null)
    setIsAuthenticated(false)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(CACHED_USER_KEY)
    // Every fetched data slice (fuelEntries, employees, attendance,
    // lubricants, credit customers, expenses, offers...) already resets to
    // [] on its own the instant isAuthenticated flips false — each has its
    // own `if (!isAuthenticated) { setX([]); return }` guard in its load
    // effect below. station/commissionRates/fuelRateHistory are
    // deliberately left alone: they're shared business config for this one
    // station (name, address, rates), not anything specific to whoever's
    // currently logged in, so there's nothing to hide from the next login.
    // PumpDayEditor no longer persists any per-shift draft to localStorage
    // either (removed entirely — nothing is kept anywhere until a
    // deliberate Save Entry click), so there's nothing left behind there
    // for a shared till/tablet's next login to accidentally see.
  }, [refreshToken])
  // A request whose token refresh also fails (e.g. the refresh token itself
  // expired) forces a real logout instead of leaving the UI stuck signed-in
  // with a backend that rejects every call.
  useEffect(() => {
    setSessionExpiredHandler(logout)
  }, [logout])

  // apiClient's own silent mid-request refresh (a 401 on an expired access
  // token, retried transparently — see request() there) rotates in a new
  // refresh token same as login() does, but only ever knew how to update
  // its own in-memory copy. Mirror that rotation into React state AND
  // localStorage here too, or the very next refresh (from this tab after a
  // reload, or another tab) presents the OLD, now-server-revoked token and
  // gets a 401 that looks like it came from nowhere.
  useEffect(() => {
    setTokensRefreshedHandler(({ accessToken, refreshToken }) => {
      setAccessToken(accessToken)
      setRefreshToken(refreshToken)
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    })
  }, [])

  // Cross-tab counterpart of the rotation handler right above: the refresh
  // token is single-use, so the instant ANY tab rotates it, every OTHER
  // open tab's own in-memory copy (in apiClient.js) is already stale —
  // silently so, until that tab eventually tries to use it and gets
  // rejected as invalid, which looks like a random, unexplained logout.
  // `storage` only ever fires in tabs OTHER than the one that made the
  // write, so this can never loop back on the tab that just rotated its
  // own token. Removed (another tab explicitly logged out) is treated the
  // same way a manager would expect on a shared station terminal: signed
  // out here too, rather than silently left in a stale "still logged in"
  // UI that would only fail later on its next request.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== REFRESH_TOKEN_KEY) return
      if (e.newValue) {
        syncRefreshToken(e.newValue)
        setRefreshToken(e.newValue)
      } else {
        logout()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [logout])

  // On first load (a real browser refresh, or a freshly opened tab), silently
  // trade a saved refresh token for a new session instead of forcing a
  // re-login — ProtectedRoute (see App.jsx) waits on authRestoring so it
  // never flashes to /login while this is still in flight. Signs back in
  // using the cached user immediately once the token itself comes back —
  // GET /auth/me then just reconciles that snapshot in the background
  // (a role/name change elsewhere shows up a moment later) instead of
  // blocking the whole page behind a second sequential round trip.
  const [authRestoring, setAuthRestoring] = useState(true)
  // Guards against React StrictMode's dev-only double-invocation of this
  // mount effect — without it, two overlapping restore attempts would each
  // rotate the same saved refresh token into its own new row (the same
  // duplicate-row bug fixed elsewhere, just from this call site instead).
  const restoreStarted = useRef(false)
  useEffect(() => {
    if (restoreStarted.current) return
    restoreStarted.current = true
    const saved = localStorage.getItem(REFRESH_TOKEN_KEY)
    if (!saved) {
      setAuthRestoring(false)
      return
    }
    const cachedUser = JSON.parse(localStorage.getItem(CACHED_USER_KEY) || 'null')
    ;(async () => {
      try {
        const tokens = await apiPost('/auth/refresh', { refresh_token: saved })
        login({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, user: cachedUser })
        setAuthRestoring(false)
        if (!cachedUser) setCurrentUser(await getMe())
        else getMe().then(setCurrentUser).catch(() => {})
      } catch {
        localStorage.removeItem(REFRESH_TOKEN_KEY)
        localStorage.removeItem(CACHED_USER_KEY)
        setAuthRestoring(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Set by whichever page currently has genuinely unsaved work the manager
  // could lose by navigating away (right now, only Fuel Entry — see
  // FuelEntryForm/PumpDayEditor) — Layout's sidebar/bottom nav read this to
  // confirm before leaving instead of navigating straight away. Deliberately
  // NOT scoped to a specific page here: this is a small, generic "is it safe
  // to navigate away right now" flag any page can opt into later, the same
  // way isAuthenticated is a generic flag Login/ProtectedRoute both read.
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  // The same page registers a way to actually SAVE that unsaved work — so a
  // "Save" button offered from entirely outside that page (Layout's
  // sidebar/bottom-nav prompt) can trigger a real save instead of just
  // dismissing the prompt. Stored as `() => fn` (not `fn` directly): passing
  // a plain function straight to a useState setter is indistinguishable
  // from a functional state UPDATE, which would call it immediately instead
  // of storing it.
  const [saveUnsavedChangesHandler, setSaveUnsavedChangesHandlerState] = useState(null)
  const setSaveUnsavedChangesHandler = useCallback((fn) => {
    setSaveUnsavedChangesHandlerState(() => fn)
  }, [])

  // Revokes every refresh token for the account server-side on success (see
  // apiClient's changePassword) — the caller is responsible for logging the
  // user out right after this resolves, since their current session is
  // about to stop working anyway.
  const changePassword = useCallback(
    (currentPassword, newPassword) => apiChangePassword(currentPassword, newPassword),
    [],
  )

  const updateStation = useCallback((patch) => {
    setStation((prev) => ({ ...prev, ...patch }))
  }, [])

  // ---------- Dashboard summary (session-lifetime cache) ----------
  // Kept in refs, not React state — callers store the resolved value in
  // their own render state, so this cache exists purely to skip a redundant
  // network round-trip for a month asked for again shortly after, not to
  // drive a re-render by itself. Cleared on browser refresh/new session by
  // design (not localStorage) — dashboard figures should reflect the
  // backend's current truth each session, not stale numbers from days ago.
  const DASHBOARD_FRESHNESS_MS = 2 * 60 * 1000
  const dashboardCacheRef = useRef({}) // { [month]: { data, fetchedAt } }
  const dashboardInFlightRef = useRef({}) // { [month]: Promise } — dedupes concurrent requests for the same month (e.g. the trend chart's 6 months and the current-month stat cards asking at once)

  const getDashboardSummaryCached = useCallback(async (month) => {
    const cached = dashboardCacheRef.current[month]
    if (cached && Date.now() - cached.fetchedAt < DASHBOARD_FRESHNESS_MS) {
      return cached.data
    }
    if (dashboardInFlightRef.current[month]) {
      return dashboardInFlightRef.current[month]
    }
    const promise = apiGetDashboardSummary(month)
      .then((data) => {
        dashboardCacheRef.current[month] = { data, fetchedAt: Date.now() }
        return data
      })
      .finally(() => {
        delete dashboardInFlightRef.current[month]
      })
    dashboardInFlightRef.current[month] = promise
    return promise
  }, [])

  const invalidateDashboardSummariesFrom = useCallback((month) => {
    for (const key of Object.keys(dashboardCacheRef.current)) {
      if (key >= month) delete dashboardCacheRef.current[key]
    }
  }, [])

  // Writes a real dated revision to Commission_Rate_History — effective on
  // patch.effectiveFrom (defaults to today if the caller omits it) — so the
  // dashboard summary's server-side, historically-correct commission
  // calculation actually has real data to use. Same effective_from
  // create-or-revise semantics as salary/price history: submitting a date
  // that already has a row replaces it, which is also how a wrongly-typed
  // past revision gets corrected (pick that same date again and resave).
  // The local copy below still exists only to pre-fill the "Edit Commission
  // Rates" modal's form with sensible current values.
  const updateCommissionRates = useCallback(
    async (patch) => {
      const effectiveFrom = patch.effectiveFrom || todayISO()
      const saved = await apiCreateOrReviseCommissionRate({
        effective_from: effectiveFrom,
        petrol: Number(patch.petrol) || 0,
        diesel: Number(patch.diesel) || 0,
        oil: Number(patch.oil) || 0,
        oil_packet: Number(patch.oilPacket) || 0,
        oil_cane: Number(patch.oilCane) || 0,
      })
      setCommissionRates((prev) => ({ ...prev, ...patch }))
      invalidateDashboardSummariesFrom(effectiveFrom.slice(0, 7))
      return saved
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // On-demand read (no session cache — the modal fetches it fresh each time
  // it opens, and the list is small since rate changes are rare).
  const getCommissionRateHistory = useCallback(() => apiGetCommissionRateHistory(), [])

  const deleteCommissionRate = useCallback(async (id, effectiveFrom) => {
    await apiDeleteCommissionRate(id)
    // Same reasoning as updateCommissionRates: removing a revision changes
    // the applicable rate for its month and every later one.
    invalidateDashboardSummariesFrom(effectiveFrom.slice(0, 7))
  }, [])

  // API <-> UI field names differ (snake_case) — normalized here once, same
  // reasoning as every other normalize* helper in this file.
  const normalizeFuelRate = useCallback(
    (r) => ({ id: r.id, effectiveFrom: r.effective_from, petrol: Number(r.petrol), diesel: Number(r.diesel), oil: Number(r.oil) }),
    [],
  )

  const loadFuelRateHistory = useCallback(async () => {
    setFuelRateHistoryLoading(true)
    setFuelRateHistoryError(null)
    try {
      const data = await apiGetFuelRateHistory()
      setFuelRateHistory(data.map(normalizeFuelRate))
    } catch (err) {
      setFuelRateHistoryError(err.message)
    } finally {
      setFuelRateHistoryLoading(false)
    }
  }, [normalizeFuelRate])

  useEffect(() => {
    if (!isAuthenticated) {
      setFuelRateHistory([])
      return
    }
    loadFuelRateHistory()
  }, [isAuthenticated, loadFuelRateHistory])

  // Adds (or replaces, if effectiveFrom matches an existing entry — the API
  // upserts by date server-side) a petrol/diesel/2T-oil retail-rate
  // revision — realistic to happen almost daily, so (unlike commission)
  // this really does need day-by-day history. A real backend record now
  // (see app/models/fuel_rate.py) instead of this browser's own
  // localStorage, so a revision is visible from any device and 2T oil can
  // now be revised over time too instead of staying a flat constant.
  const reviseFuelRate = useCallback(
    async (patch) => {
      const effectiveFrom = patch.effectiveFrom || todayISO()
      const saved = await apiCreateOrReviseFuelRate({
        effective_from: effectiveFrom,
        petrol: Number(patch.petrol) || 0,
        diesel: Number(patch.diesel) || 0,
        oil: Number(patch.oil) || 0,
      })
      const rate = normalizeFuelRate(saved)
      setFuelRateHistory((prev) => {
        const history = prev.filter((h) => h.effectiveFrom !== rate.effectiveFrom)
        history.push(rate)
        history.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
        return history
      })
      return rate
    },
    [normalizeFuelRate],
  )

  const deleteFuelRateRevision = useCallback(async (id, effectiveFrom) => {
    await apiDeleteFuelRateRevision(id)
    setFuelRateHistory((prev) => prev.filter((h) => h.effectiveFrom !== effectiveFrom))
  }, [])

  // ---------- Fuel Stock Log ----------
  // One row per date — Opening Stock / Stock Received for petrol/diesel,
  // the two figures the Audit modal's Fuel Stock section can't derive from
  // anywhere else (see app/models/fuel_stock_log.py). Sold Today/Current
  // Stock are computed live from fuelEntries wherever they're shown, never
  // stored here — so correcting a meter reading after the fact can never
  // leave a stale stock figure behind.
  const normalizeFuelStockLog = useCallback(
    (l) => ({
      id: l.id,
      logDate: l.log_date,
      isShift3: l.is_shift3,
      petrolOpeningStock: Number(l.petrol_opening_stock),
      petrolStockReceived: Number(l.petrol_stock_received),
      dieselOpeningStock: Number(l.diesel_opening_stock),
      dieselStockReceived: Number(l.diesel_stock_received),
    }),
    [],
  )

  const loadFuelStockLogs = useCallback(async () => {
    setFuelStockLogsLoading(true)
    setFuelStockLogsError(null)
    try {
      const data = await apiGetFuelStockLogs()
      setFuelStockLogs(data.map(normalizeFuelStockLog))
    } catch (err) {
      setFuelStockLogsError(err.message)
    } finally {
      setFuelStockLogsLoading(false)
    }
  }, [normalizeFuelStockLog])

  useEffect(() => {
    if (!isAuthenticated) {
      setFuelStockLogs([])
      return
    }
    loadFuelStockLogs()
  }, [isAuthenticated, loadFuelStockLogs])

  // Saves (or replaces, if logDate matches a row already on record — the API
  // upserts by date server-side) one date's Opening Stock/Stock Received
  // figures — called from the Audit modal's own explicit "Save Stock"
  // action, never automatically, so a manager always knows exactly when
  // this was actually written to the database.
  const saveFuelStockLog = useCallback(
    async (logDate, { isShift3 = false, petrolOpeningStock, petrolStockReceived, dieselOpeningStock, dieselStockReceived }) => {
      const saved = await apiCreateOrReviseFuelStockLog({
        log_date: logDate,
        is_shift3: isShift3,
        petrol_opening_stock: Number(petrolOpeningStock) || 0,
        petrol_stock_received: Number(petrolStockReceived) || 0,
        diesel_opening_stock: Number(dieselOpeningStock) || 0,
        diesel_stock_received: Number(dieselStockReceived) || 0,
      })
      const log = normalizeFuelStockLog(saved)
      setFuelStockLogs((prev) => {
        const logs = prev.filter((l) => !(l.logDate === log.logDate && l.isShift3 === log.isShift3))
        logs.push(log)
        logs.sort((a, b) => a.logDate.localeCompare(b.logDate))
        return logs
      })
      return log
    },
    [normalizeFuelStockLog],
  )

  // ---------- Employees & Attendance ----------
  // API <-> UI field names differ (snake_case, and history/credit rows keyed
  // differently) — normalized here once so every page below (Salary,
  // Attendance, ...) keeps reading the same camelCase shape mockData used.
  const normalizeEmployee = useCallback(
    (e) => ({
      id: e.id,
      name: e.name,
      fatherName: e.father_name || '',
      role: e.role,
      phone: e.phone || '',
      joinDate: e.join_date,
      active: e.active,
      notes: e.notes || '',
      salaryHistory: (e.salary_history || []).map((h) => ({ id: h.id, effectiveFrom: h.effective_from, amount: Number(h.amount) })),
      credits: (e.credits || []).map((c) => ({
        id: c.id,
        date: c.date,
        amount: Number(c.amount),
        note: c.note || '',
        sourceFuelEntryId: c.source_fuel_entry_id,
      })),
    }),
    [],
  )

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true)
    setEmployeesError(null)
    try {
      const data = await getEmployees()
      setEmployees(data.map(normalizeEmployee))
    } catch (err) {
      setEmployeesError(err.message)
    } finally {
      setEmployeesLoading(false)
    }
  }, [normalizeEmployee])

  // Employees is an authenticated endpoint — only fetch once signed in, and
  // clear the stale list back out on logout.
  useEffect(() => {
    if (!isAuthenticated) {
      setEmployees([])
      return
    }
    loadEmployees()
  }, [isAuthenticated, loadEmployees])

  const addEmployee = useCallback(
    async (data) => {
      const { monthlySalary, ...rest } = data
      const created = await apiCreateEmployee({
        name: rest.name,
        father_name: rest.fatherName || null,
        role: rest.role,
        phone: rest.phone || null,
        join_date: rest.joinDate || todayISO(),
        notes: rest.notes || null,
        active: rest.active ?? true,
        starting_salary: Number(monthlySalary) || 0,
      })
      const employee = normalizeEmployee(created)
      setEmployees((prev) => [...prev, employee])
      setAttendanceState((prev) => ({ ...prev, [employee.id]: {} }))
      return employee.id
    },
    [normalizeEmployee],
  )

  const updateEmployee = useCallback(
    async (id, data) => {
      const payload = {}
      if ('name' in data) payload.name = data.name
      if ('fatherName' in data) payload.father_name = data.fatherName || null
      if ('role' in data) payload.role = data.role
      if ('phone' in data) payload.phone = data.phone || null
      if ('joinDate' in data) payload.join_date = data.joinDate
      if ('notes' in data) payload.notes = data.notes || null
      if ('active' in data) payload.active = data.active

      const updated = await apiUpdateEmployee(id, payload)
      const employee = normalizeEmployee(updated)
      setEmployees((prev) => prev.map((e) => (e.id === id ? employee : e)))
      return employee
    },
    [normalizeEmployee],
  )

  // Adds (or replaces, if effectiveFrom matches an existing entry — the API
  // upserts by date server-side) a salary history entry. The response comes
  // back with the employee's full, fresh salary_history, so that's what
  // local state is updated from — not an optimistic local splice.
  const reviseSalary = useCallback(
    async (employeeId, { amount, effectiveFrom }) => {
      const updated = await apiAddSalaryRevision(employeeId, { amount: Number(amount), effective_from: effectiveFrom })
      const employee = normalizeEmployee(updated)
      setEmployees((prev) => prev.map((e) => (e.id === employeeId ? employee : e)))
      return employee
    },
    [normalizeEmployee],
  )

  // Removes a wrongly-added salary revision outright — the one way to fix a
  // revision that has the WRONG effective-from date too (reviseSalary above
  // can only correct the amount, by resubmitting the same date). The API
  // refuses to delete an employee's last remaining revision (there must
  // always be one to derive "current pay" from) and returns the employee's
  // full, fresh salary_history, same response-updates-local-state pattern
  // as reviseSalary.
  const deleteSalaryRevision = useCallback(
    async (employeeId, revisionId) => {
      const updated = await apiDeleteSalaryRevision(employeeId, revisionId)
      const employee = normalizeEmployee(updated)
      setEmployees((prev) => prev.map((e) => (e.id === employeeId ? employee : e)))
      return employee
    },
    [normalizeEmployee],
  )

  // Employee Credits — advances taken against pay, managed from their own
  // standalone screen. Same response-updates-local-state pattern as
  // reviseSalary above: the API returns the whole employee, re-normalized.
  const addEmployeeCredit = useCallback(
    async (employeeId, { date, amount, note }) => {
      const updated = await apiAddEmployeeCredit(employeeId, { date, amount: Number(amount), note: note || null })
      const employee = normalizeEmployee(updated)
      setEmployees((prev) => prev.map((e) => (e.id === employeeId ? employee : e)))
      return employee
    },
    [normalizeEmployee],
  )

  const updateEmployeeCredit = useCallback(
    async (employeeId, creditId, { date, amount, note }) => {
      const payload = {}
      if (date !== undefined) payload.date = date
      if (amount !== undefined) payload.amount = Number(amount)
      if (note !== undefined) payload.note = note || null
      const updated = await apiUpdateEmployeeCredit(employeeId, creditId, payload)
      const employee = normalizeEmployee(updated)
      setEmployees((prev) => prev.map((e) => (e.id === employeeId ? employee : e)))
      return employee
    },
    [normalizeEmployee],
  )

  // No updated employee comes back from a delete (just a confirmation
  // message), so this splices the removed credit out of local state
  // directly rather than re-normalizing a fresh fetch.
  const deleteEmployeeCredit = useCallback(async (employeeId, creditId) => {
    await apiDeleteEmployeeCredit(employeeId, creditId)
    setEmployees((prev) =>
      prev.map((e) => (e.id === employeeId ? { ...e, credits: e.credits.filter((c) => c.id !== creditId) } : e)),
    )
  }, [])

  const deleteEmployee = useCallback((id) => {
    setEmployees((prev) => prev.filter((e) => e.id !== id))
    setAttendanceState((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const ATTENDANCE_STATUS_TO_API = {
    oneShift: 'one_shift',
    doubleShift: 'double_shift',
    absent: 'absent',
    leave: 'leave',
    dutyOff: 'duty_off',
    companyOff: 'company_off',
  }
  const ATTENDANCE_STATUS_FROM_API = {
    one_shift: 'oneShift',
    double_shift: 'doubleShift',
    absent: 'absent',
    leave: 'leave',
    duty_off: 'dutyOff',
    company_off: 'companyOff',
  }
  const normalizeAttendanceRecord = (r) => ({
    status: ATTENDANCE_STATUS_FROM_API[r.status] || r.status,
    startTime: r.start_time ? r.start_time.slice(0, 5) : undefined,
  })

  // Already-fetched "YYYY-M" months, so switching tabs/months repeatedly
  // doesn't refetch data that's already in `attendance` state.
  const loadedAttendanceMonthsRef = useRef(new Set())

  const loadAttendanceMonth = useCallback(async (year, monthIdx) => {
    const key = `${year}-${monthIdx}`
    if (loadedAttendanceMonthsRef.current.has(key)) return
    loadedAttendanceMonthsRef.current.add(key)
    setAttendanceLoading(true)
    setAttendanceError(null)
    try {
      const records = await getAttendanceMonth(year, monthIdx + 1)
      setAttendanceState((prev) => {
        const next = { ...prev }
        for (const r of records) {
          next[r.employee_id] = { ...next[r.employee_id], [r.date]: normalizeAttendanceRecord(r) }
        }
        return next
      })
    } catch (err) {
      loadedAttendanceMonthsRef.current.delete(key)
      setAttendanceError(err.message)
    } finally {
      setAttendanceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      setAttendanceState({})
      loadedAttendanceMonthsRef.current.clear()
      return
    }
    const now = new Date()
    loadAttendanceMonth(now.getFullYear(), now.getMonth())
  }, [isAuthenticated, loadAttendanceMonth])

  // One row per employee per day server-side: POST creates, PATCH updates.
  // Editing an already-marked day is the common case, and that day's month
  // is necessarily already loaded into `attendance` (you can't be editing a
  // day you can't see) — so check local state first and call PATCH directly
  // for it, instead of a POST that's guaranteed to 409 first. POST is only
  // tried first when local state says there's nothing there yet; the 409
  // fallback stays as a safety net for that path alone (e.g. local state
  // stale from a race), so it costs nothing in the common edit case.
  const setAttendanceDay = useCallback(async (employeeId, date, patch) => {
    const status = patch.status
    const isShiftDay = status === 'oneShift' || status === 'doubleShift'
    const body = {
      status: ATTENDANCE_STATUS_TO_API[status] || status,
      start_time: isShiftDay ? patch.startTime || '08:00' : null,
    }
    const existsLocally = Boolean(attendance[employeeId]?.[date])
    let record
    if (existsLocally) {
      record = await apiUpdateAttendance(employeeId, date, body)
    } else {
      try {
        record = await apiMarkAttendance({ employee_id: employeeId, date, ...body })
      } catch (err) {
        if (err.status === 409) {
          record = await apiUpdateAttendance(employeeId, date, body)
        } else {
          throw err
        }
      }
    }
    const normalized = normalizeAttendanceRecord(record)
    setAttendanceState((prev) => ({
      ...prev,
      [employeeId]: { ...prev[employeeId], [date]: normalized },
    }))
  }, [attendance])

  // ---------- Fuel Entries ----------
  // The backend is now the single source of truth for the whole cascade a
  // final save triggers — attendance auto-marking, a credit-customer ledger
  // row per 'credit' payment line, an Employee_Credits row per
  // 'employee_credit' line, and Pump 2 lubricant stock decrements — all
  // applied (and, on edit/delete, reversed) server-side. Nothing here
  // re-derives or re-applies any of that locally anymore.
  //
  // Field names/shapes differ from the API's (snake_case, plus
  // 'employeeCredit' <-> 'employee_credit') — normalized here once so
  // PumpDayEditor/FuelEntryForm/FuelEntry keep reading the exact camelCase
  // shape utils/fuelCalc.js already expects. Server-computed fields
  // (employee_name, total_sale_amount, total_payments, excess_shortage,
  // audit columns) are deliberately NOT copied onto the normalized entry —
  // utils/fuelCalc.js stays the sole source of live totals, never the
  // server's authoritative-but-not-live figures.
  // Same Decimal-comes-back-as-a-JSON-string gotcha as normalizeFuelOilRow
  // below (FuelReadingOut's opening/closing/testing/rate are plain Decimal
  // too) — left un-Number()'d here, a saved "500.000" would still DISPLAY
  // fine as a string, but anything doing a strict/type-sensitive comparison
  // against it downstream wouldn't see a plain number. Number()'d the same
  // way for consistency with every other Decimal field this file normalizes.
  const normalizeFuelReading = (r) => ({
    opening: r?.opening != null ? Number(r.opening) : '',
    closing: r?.closing != null ? Number(r.closing) : '',
    testing: r?.testing != null ? Number(r.testing) : '',
    rate: r?.rate != null ? Number(r.rate) : '',
  })
  const normalizeFuelNozzles = (n) => (n ? { nozzle1: normalizeFuelReading(n.nozzle1), nozzle2: normalizeFuelReading(n.nozzle2) } : undefined)
  // stock_count/stock_rate are Decimal on the backend, which Pydantic
  // serializes as JSON STRINGS (e.g. "10.00") to avoid float precision loss
  // — every other Decimal field coming through this file gets Number()'d on
  // the way in for exactly that reason (see normalizeLubricant's rate,
  // normalizeCreditCustomer's amount, etc.), but this one didn't. The custom
  // Select in FormControls.jsx matches its bound value against each
  // <option>'s value via String(value) === String(optionValue) — "10.00"
  // never equals "10", so a saved oil row's Rate dropdown silently fell back
  // to showing "Select rate..." even though the real number (used correctly
  // everywhere the amount/available math reads this same field) was right
  // all along.
  const normalizeFuelOilRow = (row) => ({ id: row.id, productId: row.product_id || '', stockCount: Number(row.stock_count), stockRate: Number(row.stock_rate) })
  const normalizeFuelPaymentLine = (p) => ({
    id: p.id,
    label: p.label || '',
    amount: p.amount,
    type: p.type === 'employee_credit' ? 'employeeCredit' : p.type,
    customerId: p.customer_id || '',
    employeeId: p.employee_id || '',
    note: p.note || '',
    denominations: p.denominations || undefined,
  })
  const normalizeFuelEntry = useCallback(
    (e) => ({
      id: e.id,
      date: e.date,
      pumpKey: e.pump_key,
      shiftNumber: e.shift_number,
      internalOnly: e.internal_only,
      employeeId: e.employee_id || '',
      status: e.status,
      petrol: normalizeFuelNozzles(e.petrol),
      diesel: normalizeFuelNozzles(e.diesel),
      oil: normalizeFuelNozzles(e.oil),
      oilRows: (e.oil_rows || []).map(normalizeFuelOilRow),
      caneOilRows: (e.cane_oil_rows || []).map(normalizeFuelOilRow),
      caneOilOffer: e.cane_oil_offer ?? '',
      payments: (e.payments || []).map(normalizeFuelPaymentLine),
      bills: (e.bills || []).map((b) => ({ id: b.id, name: b.file_name, url: b.file_url, date: b.uploaded_date })),
      notes: e.notes || '',
      // Audit trail only — never used for any figure/total (those still
      // come solely from utils/fuelCalc.js, per the note above), just to
      // show "created by X on Y" on the shift card itself.
      createdAt: e.created_at,
      createdByName: e.created_by_name || null,
    }),
    [],
  )

  // Frontend camelCase -> API snake_case for a write, with the '' -> 0/null
  // coercions the write schema needs (Decimal fields reject '', UUID fields
  // reject '' too).
  // The API's Decimal fields cap precision (3dp for readings/quantities, 2dp
  // for money — see FuelReadingIn/PaymentLineIn in the backend schema), but
  // every number input here uses step="any" with no matching client-side
  // cap, so nothing ever turns red for a value typed/pasted with one extra
  // digit of precision. Left unrounded, that value sails through every
  // on-screen check and then 422s the moment it's actually saved, surfacing
  // as a bare "Validation error." toast with no field highlighted — rounding
  // here to the same precision the API accepts closes that gap the same way
  // a cash register rounds a fraction of a paisa, rather than rejecting it.
  const toApiNum = (v, decimals = 3) => {
    const n = v === '' || v == null ? 0 : Number(v)
    return Number.isFinite(n) ? Number(n.toFixed(decimals)) : 0
  }
  const toApiReading = (r) => ({ opening: toApiNum(r?.opening), closing: toApiNum(r?.closing), testing: toApiNum(r?.testing), rate: toApiNum(r?.rate) })
  const toApiNozzles = (n) => ({ nozzle1: toApiReading(n?.nozzle1), nozzle2: toApiReading(n?.nozzle2) })
  const toApiOilRow = (row) => ({ product_id: row.productId || null, stock_count: toApiNum(row.stockCount), stock_rate: toApiNum(row.stockRate, 2) })
  const toApiPaymentLine = (p) => ({
    label: p.label || '',
    amount: toApiNum(p.amount, 2),
    type: p.type === 'employeeCredit' ? 'employee_credit' : p.type,
    customer_id: p.customerId || null,
    employee_id: p.employeeId || null,
    note: p.note || null,
    denominations: p.denominations || null,
  })
  const toApiFuelEntry = useCallback(
    (entry) => ({
      date: entry.date,
      pump_key: entry.pumpKey,
      shift_number: entry.shiftNumber,
      internal_only: !!entry.internalOnly,
      employee_id: entry.employeeId || null,
      status: entry.status || 'draft',
      petrol: toApiNozzles(entry.petrol),
      diesel: toApiNozzles(entry.diesel),
      oil: entry.oil ? toApiNozzles(entry.oil) : null,
      oil_rows: (entry.oilRows || []).map(toApiOilRow),
      cane_oil_rows: (entry.caneOilRows || []).map(toApiOilRow),
      cane_oil_offer: toApiNum(entry.caneOilOffer, 2),
      payments: (entry.payments || []).map(toApiPaymentLine),
      bills: (entry.bills || []).map((b) => ({ file_name: b.name, file_url: b.url, uploaded_date: b.date })),
      notes: entry.notes || null,
    }),
    [],
  )

  const loadFuelEntries = useCallback(async () => {
    setFuelEntriesLoading(true)
    setFuelEntriesError(null)
    try {
      const data = await getFuelEntries({ limit: 2000 })
      setFuelEntries(data.map(normalizeFuelEntry))
    } catch (err) {
      setFuelEntriesError(err.message)
    } finally {
      setFuelEntriesLoading(false)
    }
  }, [normalizeFuelEntry])

  useEffect(() => {
    if (!isAuthenticated) {
      setFuelEntries([])
      return
    }
    loadFuelEntries()
  }, [isAuthenticated, loadFuelEntries])

  // bills[].url / ledger[].billUrl are kept as the RAW S3 key here — resolve
  // to a real, short-lived URL with apiClient's getDownloadUrl(key) at the
  // point of use (rendering a link, fetching for download), never baked
  // into stored state, since a presigned URL expires. Declared up here
  // (rather than down in the "Credit Customers" section below, where the
  // rest of that section's functions live) only because
  // refreshFuelEntrySideEffects, right below, needs loadCreditCustomers
  // already initialized — useCallback's dependency array is evaluated
  // immediately at render time, so a later `const` would still be in its
  // temporal dead zone here.
  const normalizeCreditCustomer = useCallback(
    (c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      openingBalance: Number(c.opening_balance),
      notes: c.notes || '',
      ledger: (c.ledger_entries || []).map((e) => ({
        id: e.id,
        date: e.date,
        type: e.type,
        fuelType: e.fuel_type ? e.fuel_type[0].toUpperCase() + e.fuel_type.slice(1) : null,
        ltr: e.litres != null ? Number(e.litres) : null,
        rate: e.rate != null ? Number(e.rate) : null,
        amount: Number(e.amount),
        mode: e.mode,
        note: e.note || '',
        sourceFuelEntryId: e.source_fuel_entry_id,
        billUrl: e.bill_file_url || null,
        billName: e.bill_file_name || null,
      })),
      bills: (c.bills || []).map((b) => ({ id: b.id, name: b.file_name, url: b.file_url, date: b.uploaded_date })),
    }),
    [],
  )

  const loadCreditCustomers = useCallback(async () => {
    setCreditCustomersLoading(true)
    setCreditCustomersError(null)
    try {
      const data = await getCreditCustomers()
      setCreditCustomers(data.map(normalizeCreditCustomer))
    } catch (err) {
      setCreditCustomersError(err.message)
    } finally {
      setCreditCustomersLoading(false)
    }
  }, [normalizeCreditCustomer])

  // Declared up here (rather than down in the "Lubricants" section below,
  // where the rest of that section's functions live) only because
  // refreshFuelEntrySideEffects, right below, needs loadLubricants already
  // initialized — same reason normalizeCreditCustomer/loadCreditCustomers
  // above were moved up from the "Credit Customers" section.
  const normalizeLubricant = useCallback(
    (p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      packaging: p.packaging,
      stock: Number(p.stock),
      priceHistory: (p.price_history || []).map((h) => ({ id: h.id, effectiveFrom: h.effective_from, rate: Number(h.rate) })),
      purchaseHistory: (p.purchase_history || []).map((h) => ({ id: h.id, date: h.date, qty: Number(h.qty), cost: Number(h.cost) })),
      lastSoldDate: p.last_sold_date || null,
      totalSold: Number(p.total_sold) || 0,
    }),
    [],
  )

  // Guards against a plain GET (this function, or the Pump-2-oil-sale
  // refresh below) landing AFTER a mutation that started later but resolved
  // first — a real race, not just a theoretical one: this fetch can take a
  // while, and a manager recording a purchase (or any other lubricant edit)
  // while it's still in flight used to have that GET's now-stale response
  // silently overwrite their just-saved change the moment it finally
  // resolved, making it look like the save "didn't show up" until a full
  // page reload (which no longer had anything left in flight to race).
  // Bumped by every successful lubricants write below, GET or mutation
  // alike, so whichever one actually finishes LAST always wins.
  const lubricantsVersionRef = useRef(0)

  const loadLubricants = useCallback(async () => {
    setLubricantsLoading(true)
    setLubricantsError(null)
    const versionAtStart = lubricantsVersionRef.current
    try {
      const data = await getLubricants()
      if (lubricantsVersionRef.current !== versionAtStart) return
      lubricantsVersionRef.current += 1
      setLubricants(data.map(normalizeLubricant))
    } catch (err) {
      setLubricantsError(err.message)
    } finally {
      setLubricantsLoading(false)
    }
  }, [normalizeLubricant])

  // A finalized shift's customer-credit / employee-credit payment lines
  // create real rows straight in Postgres (see FuelEntryService
  // ._apply_credit_ledger / ._apply_employee_credit), and a finalized Pump 2
  // shift's pocket/cane oil rows decrement a real Lubricant product's stock
  // (._apply_oil_stock) — but creditCustomers/employees/lubricants are each
  // a separate slice of state, fetched once and never otherwise touched by
  // a fuel-entry save, so without this they'd keep showing whatever they
  // last had (missing the brand-new ledger/credit row, or the reduced
  // stock) until the next full login, even though the shift itself saved
  // fine. Re-fetches only whichever slice this save could plausibly have
  // changed, and only for a draft→final/final→draft/final-edit transition —
  // never on a plain draft-to-draft autosave, since those can never trigger
  // any of these side effects server-side.
  const refreshFuelEntrySideEffects = useCallback(
    (entry) => {
      const payments = entry?.payments || []
      if (payments.some((p) => p.type === 'credit' && Number(p.amount) > 0)) loadCreditCustomers()
      if (payments.some((p) => p.type === 'employeeCredit' && Number(p.amount) > 0)) loadEmployees()
      if (entry?.pumpKey === 'pump2' && [...(entry?.oilRows || []), ...(entry?.caneOilRows || [])].some((r) => r.productId && Number(r.stockCount) > 0)) {
        loadLubricants()
      }
    },
    [loadCreditCustomers, loadEmployees, loadLubricants],
  )

  // Optimistic-first, always awaitable: local state updates immediately (a
  // temp id stands in for the not-yet-assigned real one), so PumpDayEditor's
  // debounced draft autosave — which calls this WITHOUT awaiting it — never
  // waits on the network to reflect what was just typed. The API call runs
  // in the background and the temp row is swapped for the real one on
  // response; on failure the optimistic row is rolled back and the error
  // rethrown so an awaiting caller (final save) can show it. A caller that
  // needs the real id (final save) just awaits the returned promise.
  const addFuelEntry = useCallback(
    (entry) => {
      const tempId = makeId('f')
      setFuelEntries((prev) => [{ ...entry, id: tempId }, ...prev])
      return (async () => {
        try {
          const created = await apiCreateFuelEntry(toApiFuelEntry(entry))
          const normalized = normalizeFuelEntry(created)
          setFuelEntries((prev) => prev.map((f) => (f.id === tempId ? normalized : f)))
          if (normalized.status === 'final') {
            refreshFuelEntrySideEffects(normalized)
            // Dashboard's litres/commission/expenses/profit figures are all
            // computed server-side from FINAL entries — without this, the
            // Dashboard kept showing whatever it last fetched (up to
            // DASHBOARD_FRESHNESS_MS stale) until a full page reload forced a
            // fresh request, same bug as the one this fixed for Expenses.
            invalidateDashboardSummariesFrom(normalized.date.slice(0, 7))
          }
          return normalized.id
        } catch (err) {
          setFuelEntries((prev) => prev.filter((f) => f.id !== tempId))
          throw err
        }
      })()
    },
    [normalizeFuelEntry, toApiFuelEntry, refreshFuelEntrySideEffects, invalidateDashboardSummariesFrom],
  )

  const updateFuelEntry = useCallback(
    (id, entry) => {
      let previous
      setFuelEntries((prev) => {
        previous = prev.find((f) => f.id === id)
        return prev.map((f) => (f.id === id ? { ...entry, id } : f))
      })
      return (async () => {
        try {
          const updated = await apiUpdateFuelEntry(id, toApiFuelEntry(entry))
          const normalized = normalizeFuelEntry(updated)
          setFuelEntries((prev) => prev.map((f) => (f.id === id ? normalized : f)))
          // Either side of the transition (just finalized, just un-finalized,
          // or edited while already final) can add/remove a ledger/credit
          // row or a stock adjustment server-side — checking both the old
          // and new payment lines/oil rows covers one that existed before
          // this save but doesn't anymore.
          if (previous?.status === 'final' || normalized.status === 'final') {
            refreshFuelEntrySideEffects({
              pumpKey: normalized.pumpKey,
              payments: [...(previous?.payments || []), ...(normalized.payments || [])],
              oilRows: [...(previous?.oilRows || []), ...(normalized.oilRows || [])],
              caneOilRows: [...(previous?.caneOilRows || []), ...(normalized.caneOilRows || [])],
            })
            // Same staleness fix as addFuelEntry above — the date field is
            // disabled while editing an existing entry, so previous/normalized
            // always share one date; only one month ever needs invalidating.
            invalidateDashboardSummariesFrom(normalized.date.slice(0, 7))
          }
          return normalized.id
        } catch (err) {
          if (previous) setFuelEntries((prev) => prev.map((f) => (f.id === id ? previous : f)))
          throw err
        }
      })()
    },
    [normalizeFuelEntry, toApiFuelEntry, refreshFuelEntrySideEffects, invalidateDashboardSummariesFrom],
  )

  const deleteFuelEntry = useCallback(
    (id) => {
      let previous
      setFuelEntries((prev) => {
        previous = prev.find((f) => f.id === id)
        return prev.filter((f) => f.id !== id)
      })
      return (async () => {
        try {
          await apiDeleteFuelEntry(id)
          // Deleting a FINAL entry reverses the same credit-ledger/employee-
          // credit/oil-stock cascade its own save originally applied (see
          // FuelEntryService.delete) — creditCustomers/employees/lubricants
          // need the same post-save refresh addFuelEntry/updateFuelEntry
          // already trigger, or they keep showing the now-reversed figures
          // until the next full reload.
          if (previous?.status === 'final') {
            refreshFuelEntrySideEffects(previous)
            invalidateDashboardSummariesFrom(previous.date.slice(0, 7))
          }
        } catch (err) {
          if (previous) setFuelEntries((prev) => [previous, ...prev])
          throw err
        }
      })()
    },
    [refreshFuelEntrySideEffects, invalidateDashboardSummariesFrom],
  )

  // ---------- Lubricants ----------
  // (normalizeLubricant/loadLubricants themselves are declared earlier,
  // above addFuelEntry/updateFuelEntry — same reason as
  // normalizeCreditCustomer/loadCreditCustomers above.)
  useEffect(() => {
    if (!isAuthenticated) {
      setLubricants([])
      return
    }
    loadLubricants()
  }, [isAuthenticated, loadLubricants])

  const addLubricant = useCallback(
    async (data) => {
      const { rate, stock, purchaseHistory: _ignored, ...rest } = data
      const created = await apiCreateLubricant({
        name: rest.name,
        unit: rest.unit,
        packaging: rest.packaging,
        opening_rate: Number(rate) || 0,
        opening_stock: Number(stock) || 0,
      })
      const product = normalizeLubricant(created)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => [...prev, product])
      return product.id
    },
    [normalizeLubricant],
  )

  const updateLubricant = useCallback(
    async (id, data) => {
      const payload = {}
      if ('name' in data) payload.name = data.name
      if ('unit' in data) payload.unit = data.unit
      if ('packaging' in data) payload.packaging = data.packaging
      const updated = await apiUpdateLubricant(id, payload)
      const product = normalizeLubricant(updated)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => prev.map((l) => (l.id === id ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  // Adds (or replaces, if effectiveFrom matches an existing entry — the API
  // upserts by date server-side) a price history entry. Local state is
  // updated from the response's full, fresh price_history.
  const reviseLubricantPrice = useCallback(
    async (productId, { rate, effectiveFrom }) => {
      const updated = await apiAddPriceRevision(productId, { rate: Number(rate), effective_from: effectiveFrom })
      const product = normalizeLubricant(updated)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => prev.map((l) => (l.id === productId ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  // Same "at least one on record" guard as deleteSalaryRevision — the API
  // rejects (409, surfaced via ApiError.message) deleting a product's last
  // remaining price.
  const deletePriceRevision = useCallback(
    async (productId, revisionId) => {
      const updated = await apiDeletePriceRevision(productId, revisionId)
      const product = normalizeLubricant(updated)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => prev.map((l) => (l.id === productId ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  const deleteLubricant = useCallback(async (id) => {
    await apiDeleteLubricant(id)
    lubricantsVersionRef.current += 1
    setLubricants((prev) => prev.filter((l) => l.id !== id))
  }, [])

  // Logs a restock from an outside supplier — the API increments stock
  // server-side atomically and returns the updated product.
  const addPurchase = useCallback(
    async (productId, { qty, date, cost }) => {
      const updated = await apiRecordPurchase(productId, { qty: Number(qty), date, cost: Number(cost) || 0 })
      const product = normalizeLubricant(updated)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => prev.map((l) => (l.id === productId ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  // Corrects a mis-entered purchase (wrong qty/cost/date) — only fields the
  // caller actually passes are sent, so this doubles as both "just fix the
  // date" and "fix everything" without a separate partial-update helper.
  // The API rejects (409, surfaced via ApiError.message) a qty change that
  // would leave stock negative — units already sold against the ORIGINAL
  // wrong quantity can't just be wished away, so that's blocked server-side
  // rather than silently corrupting the running stock count here.
  const updatePurchase = useCallback(
    async (productId, purchaseId, { qty, date, cost } = {}) => {
      const payload = {}
      if (qty !== undefined) payload.qty = Number(qty)
      if (date !== undefined) payload.date = date
      if (cost !== undefined) payload.cost = Number(cost)
      const updated = await apiUpdatePurchase(productId, purchaseId, payload)
      const product = normalizeLubricant(updated)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => prev.map((l) => (l.id === productId ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  // Same negative-stock guard as updatePurchase above, applied as a full
  // removal instead of a partial correction.
  const deletePurchase = useCallback(
    async (productId, purchaseId) => {
      const updated = await apiDeletePurchase(productId, purchaseId)
      const product = normalizeLubricant(updated)
      lubricantsVersionRef.current += 1
      setLubricants((prev) => prev.map((l) => (l.id === productId ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  // ---------- Credit Customers ----------
  // (normalizeCreditCustomer/loadCreditCustomers themselves are declared
  // earlier, above addFuelEntry/updateFuelEntry — refreshFuelEntrySideEffects
  // needs loadCreditCustomers already initialized, and useCallback's
  // dependency array is evaluated immediately at render time, not lazily,
  // so it can't come later in the same component than something that
  // references it.)
  useEffect(() => {
    if (!isAuthenticated) {
      setCreditCustomers([])
      return
    }
    loadCreditCustomers()
  }, [isAuthenticated, loadCreditCustomers])

  const addCustomer = useCallback(
    async (data) => {
      const created = await apiCreateCreditCustomer({
        name: data.name,
        phone: data.phone || null,
        opening_balance: Number(data.openingBalance) || 0,
        notes: data.notes || null,
        bills: (data.bills || []).map((b) => ({ file_name: b.name, file_url: b.url, uploaded_date: b.date })),
      })
      const customer = normalizeCreditCustomer(created)
      setCreditCustomers((prev) => [...prev, customer])
      return customer.id
    },
    [normalizeCreditCustomer],
  )

  const updateCustomer = useCallback(
    async (id, data) => {
      const payload = {}
      if ('name' in data) payload.name = data.name
      if ('phone' in data) payload.phone = data.phone || null
      if ('openingBalance' in data) payload.opening_balance = Number(data.openingBalance) || 0
      if ('notes' in data) payload.notes = data.notes || null
      if ('bills' in data) {
        payload.bills = (data.bills || []).map((b) => ({ file_name: b.name, file_url: b.url, uploaded_date: b.date }))
      }
      const updated = await apiUpdateCreditCustomer(id, payload)
      const customer = normalizeCreditCustomer(updated)
      setCreditCustomers((prev) => prev.map((c) => (c.id === id ? customer : c)))
      return customer
    },
    [normalizeCreditCustomer],
  )

  const deleteCustomer = useCallback(async (id) => {
    await apiDeleteCreditCustomer(id)
    setCreditCustomers((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const addLedgerEntry = useCallback(
    async (customerId, entry) => {
      const updated = await apiAddLedgerEntry(customerId, {
        date: entry.date,
        type: entry.type,
        fuel_type: entry.fuelType ? entry.fuelType.toLowerCase() : null,
        litres: entry.ltr != null ? Number(entry.ltr) : null,
        rate: entry.rate != null ? Number(entry.rate) : null,
        amount: Number(entry.amount),
        mode: entry.mode || null,
        note: entry.note || null,
        bill_file_name: entry.billName || null,
        bill_file_url: entry.billUrl || null,
      })
      const customer = normalizeCreditCustomer(updated)
      setCreditCustomers((prev) => prev.map((c) => (c.id === customerId ? customer : c)))
      return customer
    },
    [normalizeCreditCustomer],
  )

  // Attaches/replaces the bill on an already-recorded ledger entry — the
  // entry itself is immutable, only its bill can change. Pass billName:
  // null, billUrl: null to clear it. Chiefly for a credit entered from the
  // Fuel Entry screen (amount + reason only, no bill upload there), so the
  // manager can come back here once the physical bill is in hand.
  const updateLedgerEntryBill = useCallback(
    async (customerId, entryId, { billName, billUrl }) => {
      const updated = await apiUpdateLedgerEntryBill(customerId, entryId, {
        bill_file_name: billName || null,
        bill_file_url: billUrl || null,
      })
      const customer = normalizeCreditCustomer(updated)
      setCreditCustomers((prev) => prev.map((c) => (c.id === customerId ? customer : c)))
      return customer
    },
    [normalizeCreditCustomer],
  )

  // Undo for a mistaken ledger entry (wrong customer/amount typed in Credit
  // Bills or in the Audit modal's "Customer Credit Paid" section) — the API
  // rejects this for entries created from a real Fuel Entry (sourceFuelEntryId
  // set), matching the UI's own rule of only ever showing the button for
  // manually-added rows.
  const removeLedgerEntry = useCallback(async (customerId, entryId) => {
    await apiDeleteLedgerEntry(customerId, entryId)
    setCreditCustomers((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, ledger: c.ledger.filter((l) => l.id !== entryId) } : c)),
    )
  }, [])

  // ---------- Offer Customers ----------
  // Deliberately its own list — NOT Employees, NOT Credit Customers. A
  // credit customer is someone with a running fuel account; an offer
  // recipient is just a phone number worth marketing to, and the two sets
  // don't have to overlap.
  const normalizeOfferCustomer = useCallback(
    (c) => ({ id: c.id, name: c.name, phone: c.phone || '', active: c.active }),
    [],
  )

  const loadOfferCustomers = useCallback(async () => {
    setOfferCustomersLoading(true)
    setOfferCustomersError(null)
    try {
      const data = await getOfferCustomers()
      setOfferCustomers(data.map(normalizeOfferCustomer))
    } catch (err) {
      setOfferCustomersError(err.message)
    } finally {
      setOfferCustomersLoading(false)
    }
  }, [normalizeOfferCustomer])

  useEffect(() => {
    if (!isAuthenticated) {
      setOfferCustomers([])
      return
    }
    loadOfferCustomers()
  }, [isAuthenticated, loadOfferCustomers])

  const addOfferCustomer = useCallback(
    async (data) => {
      const created = await apiCreateOfferCustomer({ name: data.name, phone: data.phone || null })
      const customer = normalizeOfferCustomer(created)
      setOfferCustomers((prev) => [...prev, customer])
      return customer.id
    },
    [normalizeOfferCustomer],
  )

  // Hard delete — the Offers screen removes a recipient outright rather
  // than soft-deactivating it (see apiClient.deleteOfferCustomer).
  const deleteOfferCustomer = useCallback(async (id) => {
    await apiDeleteOfferCustomer(id)
    setOfferCustomers((prev) => prev.filter((c) => c.id !== id))
  }, [])

  // ---------- Offers ----------
  const normalizeOfferSend = useCallback(
    (s) => ({
      id: s.id,
      message: s.message,
      channel: s.channel,
      templateUsed: s.template_used || null,
      sentAt: s.sent_at,
      sentByName: s.created_by_name || null,
      statusCounts: s.status_counts || {},
      recipients: (s.recipients || []).map((r) => ({
        customerName: r.customer_name,
        customerPhone: r.customer_phone || null,
        status: r.status,
        providerResponse: r.provider_response || null,
        sentAt: r.sent_at || null,
      })),
    }),
    [],
  )

  const loadOfferHistory = useCallback(async () => {
    setOfferHistoryLoading(true)
    setOfferHistoryError(null)
    try {
      const data = await getOfferHistory()
      setOfferHistory(data.map(normalizeOfferSend))
    } catch (err) {
      setOfferHistoryError(err.message)
    } finally {
      setOfferHistoryLoading(false)
    }
  }, [normalizeOfferSend])

  useEffect(() => {
    if (!isAuthenticated) {
      setOfferHistory([])
      return
    }
    loadOfferHistory()
  }, [isAuthenticated, loadOfferHistory])

  const sendOffer = useCallback(
    async ({ customerIds, templateUsed, offerVariable }) => {
      const created = await apiSendOffer({
        customer_ids: customerIds,
        template_used: templateUsed,
        offer_variable: offerVariable,
      })
      const send = normalizeOfferSend(created)
      setOfferHistory((prev) => [send, ...prev])
      return send
    },
    [normalizeOfferSend],
  )

  // Stateless — no context state to update, just forwards to the backend
  // (which fetches the real approved template body live from Meta) so
  // Offers.jsx can show exactly what a customer will receive before sending.
  const previewOfferTemplate = useCallback((templateId, offerVariable) => apiPreviewOfferTemplate(templateId, offerVariable), [])

  // ---------- Expenses ----------
  // One record per day, holding however many line items ({id, label, amount})
  // the manager logged that day — API shape already matches the UI's exactly
  // (no snake_case fields here), so no normalization is needed.
  const loadExpenses = useCallback(async () => {
    setExpensesLoading(true)
    setExpensesError(null)
    try {
      const data = await getExpenses()
      setExpenseDays(data)
    } catch (err) {
      setExpensesError(err.message)
    } finally {
      setExpensesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      setExpenseDays([])
      return
    }
    loadExpenses()
  }, [isAuthenticated, loadExpenses])

  const addExpenseDay = useCallback(
    async (data) => {
      const created = await apiCreateExpenseDay({
        date: data.date,
        items: data.items.map((i) => ({ label: i.label, amount: Number(i.amount) })),
      })
      setExpenseDays((prev) => [created, ...prev])
      // Dashboard's total_expenses/profit figures are computed server-side
      // and cached for DASHBOARD_FRESHNESS_MS — without this, a just-added
      // expense day kept showing the pre-add total until that cache expired
      // or the page was reloaded.
      invalidateDashboardSummariesFrom(created.date.slice(0, 7))
      return created.id
    },
    [invalidateDashboardSummariesFrom],
  )

  const updateExpenseDay = useCallback(
    async (id, data) => {
      const updated = await apiUpdateExpenseDay(id, {
        date: data.date,
        items: data.items.map((i) => ({ label: i.label, amount: Number(i.amount) })),
      })
      setExpenseDays((prev) => {
        // Caught via the functional updater (not a dependency) so this can
        // still see the pre-update row without going stale itself — an
        // edit that also moves the date needs the OLD month invalidated
        // too, not just the new one, or that month keeps showing a total
        // that still includes an expense day no longer filed under it.
        const previous = prev.find((d) => d.id === id)
        if (previous && previous.date !== updated.date) invalidateDashboardSummariesFrom(previous.date.slice(0, 7))
        return prev.map((d) => (d.id === id ? updated : d))
      })
      invalidateDashboardSummariesFrom(updated.date.slice(0, 7))
      return updated
    },
    [invalidateDashboardSummariesFrom],
  )

  const deleteExpenseDay = useCallback(
    async (id) => {
      await apiDeleteExpenseDay(id)
      setExpenseDays((prev) => {
        const removed = prev.find((d) => d.id === id)
        if (removed) invalidateDashboardSummariesFrom(removed.date.slice(0, 7))
        return prev.filter((d) => d.id !== id)
      })
    },
    [invalidateDashboardSummariesFrom],
  )

  const value = useMemo(
    () => ({
      station,
      updateStation,
      fuelRates: currentFuelRates(fuelRateHistory),
      fuelRateHistory,
      fuelRateHistoryLoading,
      fuelRateHistoryError,
      reviseFuelRate,
      deleteFuelRateRevision,
      fuelStockLogs,
      fuelStockLogsLoading,
      fuelStockLogsError,
      saveFuelStockLog,
      commissionRates,
      updateCommissionRates,
      getCommissionRateHistory,
      deleteCommissionRate,
      getDashboardSummaryCached,
      isAuthenticated,
      authRestoring,
      accessToken,
      refreshToken,
      currentUser,
      login,
      hasUnsavedChanges,
      setHasUnsavedChanges,
      saveUnsavedChangesHandler,
      setSaveUnsavedChangesHandler,
      logout,
      changePassword,
      employees,
      employeesLoading,
      employeesError,
      addEmployee,
      updateEmployee,
      deleteEmployee,
      reviseSalary,
      deleteSalaryRevision,
      addEmployeeCredit,
      updateEmployeeCredit,
      deleteEmployeeCredit,
      attendance,
      attendanceLoading,
      attendanceError,
      setAttendanceDay,
      loadAttendanceMonth,
      fuelEntries,
      fuelEntriesLoading,
      fuelEntriesError,
      addFuelEntry,
      updateFuelEntry,
      deleteFuelEntry,
      lubricants,
      lubricantsLoading,
      lubricantsError,
      addLubricant,
      updateLubricant,
      deleteLubricant,
      reviseLubricantPrice,
      deletePriceRevision,
      addPurchase,
      updatePurchase,
      deletePurchase,
      creditCustomers,
      creditCustomersLoading,
      creditCustomersError,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      addLedgerEntry,
      updateLedgerEntryBill,
      removeLedgerEntry,
      offerCustomers,
      offerCustomersLoading,
      offerCustomersError,
      addOfferCustomer,
      deleteOfferCustomer,
      offerHistory,
      offerHistoryLoading,
      offerHistoryError,
      sendOffer,
      previewOfferTemplate,
      expenseDays,
      expensesLoading,
      expensesError,
      addExpenseDay,
      updateExpenseDay,
      deleteExpenseDay,
    }),
    [
      station,
      updateStation,
      fuelRateHistory,
      fuelRateHistoryLoading,
      fuelRateHistoryError,
      reviseFuelRate,
      deleteFuelRateRevision,
      fuelStockLogs,
      fuelStockLogsLoading,
      fuelStockLogsError,
      saveFuelStockLog,
      commissionRates,
      updateCommissionRates,
      getCommissionRateHistory,
      deleteCommissionRate,
      getDashboardSummaryCached,
      isAuthenticated,
      authRestoring,
      accessToken,
      refreshToken,
      currentUser,
      login,
      hasUnsavedChanges,
      setHasUnsavedChanges,
      saveUnsavedChangesHandler,
      setSaveUnsavedChangesHandler,
      logout,
      changePassword,
      employees,
      employeesLoading,
      employeesError,
      addEmployee,
      updateEmployee,
      deleteEmployee,
      reviseSalary,
      deleteSalaryRevision,
      addEmployeeCredit,
      updateEmployeeCredit,
      deleteEmployeeCredit,
      attendance,
      attendanceLoading,
      attendanceError,
      setAttendanceDay,
      loadAttendanceMonth,
      fuelEntries,
      fuelEntriesLoading,
      fuelEntriesError,
      addFuelEntry,
      updateFuelEntry,
      deleteFuelEntry,
      lubricants,
      lubricantsLoading,
      lubricantsError,
      addLubricant,
      updateLubricant,
      deleteLubricant,
      reviseLubricantPrice,
      deletePriceRevision,
      addPurchase,
      updatePurchase,
      deletePurchase,
      creditCustomers,
      creditCustomersLoading,
      creditCustomersError,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      addLedgerEntry,
      updateLedgerEntryBill,
      removeLedgerEntry,
      offerCustomers,
      offerCustomersLoading,
      offerCustomersError,
      addOfferCustomer,
      deleteOfferCustomer,
      offerHistory,
      offerHistoryLoading,
      offerHistoryError,
      sendOffer,
      previewOfferTemplate,
      expenseDays,
      expensesLoading,
      expensesError,
      addExpenseDay,
      updateExpenseDay,
      deleteExpenseDay,
    ],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
