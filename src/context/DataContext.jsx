import React, { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import {
  FUEL_RATES,
  FUEL_RATE_HISTORY,
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
  addEmployeeCredit as apiAddEmployeeCredit,
  updateEmployeeCredit as apiUpdateEmployeeCredit,
  deleteEmployeeCredit as apiDeleteEmployeeCredit,
  getLubricants,
  createLubricant as apiCreateLubricant,
  updateLubricant as apiUpdateLubricant,
  deleteLubricant as apiDeleteLubricant,
  addPriceRevision as apiAddPriceRevision,
  recordPurchase as apiRecordPurchase,
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
  sendOffer as apiSendOffer,
  getOfferHistory,
  getAttendanceMonth,
  markAttendance as apiMarkAttendance,
  updateAttendance as apiUpdateAttendance,
  getFuelEntries,
  createFuelEntry as apiCreateFuelEntry,
  updateFuelEntry as apiUpdateFuelEntry,
  deleteFuelEntry as apiDeleteFuelEntry,
  setAuthTokens,
  setSessionExpiredHandler,
  getMe,
  apiPost,
  changePassword as apiChangePassword,
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
  // than localStorage/mockData — every other slice here is still unwired.
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
  const [fuelRateHistory, setFuelRateHistory] = usePersistedState('fuelRateHistory', () => FUEL_RATE_HISTORY)

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
    setAuthTokens(null)
    setAccessToken(null)
    setRefreshToken(null)
    setCurrentUser(null)
    setIsAuthenticated(false)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(CACHED_USER_KEY)
  }, [])
  // A request whose token refresh also fails (e.g. the refresh token itself
  // expired) forces a real logout instead of leaving the UI stuck signed-in
  // with a backend that rejects every call.
  useEffect(() => {
    setSessionExpiredHandler(logout)
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

  // The OMC commission agreement is renegotiated rarely, so this is just a
  // flat, current figure — no history to track.
  const updateCommissionRates = useCallback((patch) => {
    setCommissionRates((prev) => ({ ...prev, ...patch }))
  }, [])

  // Adds (or replaces, if effectiveFrom matches an existing entry) a
  // petrol/diesel retail-rate revision — realistic to happen almost daily,
  // so (unlike commission) this really does need day-by-day history.
  const reviseFuelRate = useCallback((patch) => {
    const { effectiveFrom, ...rates } = patch
    setFuelRateHistory((prev) => {
      const history = (prev || []).filter((h) => h.effectiveFrom !== effectiveFrom)
      history.push({ effectiveFrom, ...rates })
      history.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      return history
    })
  }, [])

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
      salaryHistory: (e.salary_history || []).map((h) => ({ effectiveFrom: h.effective_from, amount: Number(h.amount) })),
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
  }
  const ATTENDANCE_STATUS_FROM_API = {
    one_shift: 'oneShift',
    double_shift: 'doubleShift',
    absent: 'absent',
    leave: 'leave',
    duty_off: 'dutyOff',
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
  const normalizeFuelReading = (r) => ({ opening: r?.opening ?? '', closing: r?.closing ?? '', testing: r?.testing ?? '', rate: r?.rate ?? '' })
  const normalizeFuelNozzles = (n) => (n ? { nozzle1: normalizeFuelReading(n.nozzle1), nozzle2: normalizeFuelReading(n.nozzle2) } : undefined)
  const normalizeFuelOilRow = (row) => ({ id: row.id, productId: row.product_id || '', stockCount: row.stock_count, stockRate: row.stock_rate })
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
    }),
    [],
  )

  // Frontend camelCase -> API snake_case for a write, with the '' -> 0/null
  // coercions the write schema needs (Decimal fields reject '', UUID fields
  // reject '' too).
  const toApiNum = (v) => (v === '' || v == null ? 0 : Number(v))
  const toApiReading = (r) => ({ opening: toApiNum(r?.opening), closing: toApiNum(r?.closing), testing: toApiNum(r?.testing), rate: toApiNum(r?.rate) })
  const toApiNozzles = (n) => ({ nozzle1: toApiReading(n?.nozzle1), nozzle2: toApiReading(n?.nozzle2) })
  const toApiOilRow = (row) => ({ product_id: row.productId || null, stock_count: toApiNum(row.stockCount), stock_rate: toApiNum(row.stockRate) })
  const toApiPaymentLine = (p) => ({
    label: p.label || '',
    amount: toApiNum(p.amount),
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
      cane_oil_offer: toApiNum(entry.caneOilOffer),
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

  // A finalized shift's customer-credit / employee-credit payment lines
  // create real rows straight in Postgres (see FuelEntryService
  // ._apply_credit_ledger / ._apply_employee_credit) — but creditCustomers
  // and employees are separate slices of state, each fetched once and never
  // otherwise touched by a fuel-entry save, so without this they'd keep
  // showing whatever they last had (missing the brand-new ledger/credit
  // row) until the next full login, even though the shift itself saved
  // fine. Re-fetches only whichever slice this save could plausibly have
  // changed, and only for a draft→final/final→draft/final-edit transition —
  // never on a plain draft-to-draft autosave, since those can never trigger
  // either side effect server-side.
  const refreshFuelEntrySideEffects = useCallback(
    (payments) => {
      const list = payments || []
      if (list.some((p) => p.type === 'credit' && Number(p.amount) > 0)) loadCreditCustomers()
      if (list.some((p) => p.type === 'employeeCredit' && Number(p.amount) > 0)) loadEmployees()
    },
    [loadCreditCustomers, loadEmployees],
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
          if (normalized.status === 'final') refreshFuelEntrySideEffects(normalized.payments)
          return normalized.id
        } catch (err) {
          setFuelEntries((prev) => prev.filter((f) => f.id !== tempId))
          throw err
        }
      })()
    },
    [normalizeFuelEntry, toApiFuelEntry, refreshFuelEntrySideEffects],
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
          // row server-side — checking both old and new payment lines covers
          // a credit line that existed before this save but doesn't anymore.
          if (previous?.status === 'final' || normalized.status === 'final') {
            refreshFuelEntrySideEffects([...(previous?.payments || []), ...(normalized.payments || [])])
          }
          return normalized.id
        } catch (err) {
          if (previous) setFuelEntries((prev) => prev.map((f) => (f.id === id ? previous : f)))
          throw err
        }
      })()
    },
    [normalizeFuelEntry, toApiFuelEntry, refreshFuelEntrySideEffects],
  )

  const deleteFuelEntry = useCallback((id) => {
    let previous
    setFuelEntries((prev) => {
      previous = prev.find((f) => f.id === id)
      return prev.filter((f) => f.id !== id)
    })
    return (async () => {
      try {
        await apiDeleteFuelEntry(id)
      } catch (err) {
        if (previous) setFuelEntries((prev) => [previous, ...prev])
        throw err
      }
    })()
  }, [])

  // ---------- Lubricants ----------
  const normalizeLubricant = useCallback(
    (p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      packaging: p.packaging,
      stock: Number(p.stock),
      priceHistory: (p.price_history || []).map((h) => ({ effectiveFrom: h.effective_from, rate: Number(h.rate) })),
      purchaseHistory: (p.purchase_history || []).map((h) => ({ id: h.id, date: h.date, qty: Number(h.qty), cost: Number(h.cost) })),
    }),
    [],
  )

  const loadLubricants = useCallback(async () => {
    setLubricantsLoading(true)
    setLubricantsError(null)
    try {
      const data = await getLubricants()
      setLubricants(data.map(normalizeLubricant))
    } catch (err) {
      setLubricantsError(err.message)
    } finally {
      setLubricantsLoading(false)
    }
  }, [normalizeLubricant])

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
      setLubricants((prev) => prev.map((l) => (l.id === productId ? product : l)))
      return product
    },
    [normalizeLubricant],
  )

  const deleteLubricant = useCallback(async (id) => {
    await apiDeleteLubricant(id)
    setLubricants((prev) => prev.filter((l) => l.id !== id))
  }, [])

  // Logs a restock from an outside supplier — the API increments stock
  // server-side atomically and returns the updated product.
  const addPurchase = useCallback(
    async (productId, { qty, date, cost }) => {
      const updated = await apiRecordPurchase(productId, { qty: Number(qty), date, cost: Number(cost) || 0 })
      const product = normalizeLubricant(updated)
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

  // No hard delete — deactivating just flips `active`, so it drops out of
  // the recipient list (see Offers.jsx) without losing its history on
  // already-sent offers.
  const deactivateOfferCustomer = useCallback(
    async (id) => {
      const updated = await apiUpdateOfferCustomer(id, { active: false })
      const customer = normalizeOfferCustomer(updated)
      setOfferCustomers((prev) => prev.map((c) => (c.id === id ? customer : c)))
    },
    [normalizeOfferCustomer],
  )

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
        customerId: r.offer_customer_id,
        customerName: r.customer_name,
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
    async ({ customerIds, message, channel, templateUsed }) => {
      const created = await apiSendOffer({
        customer_ids: customerIds,
        message,
        channel,
        template_used: templateUsed || null,
      })
      const send = normalizeOfferSend(created)
      setOfferHistory((prev) => [send, ...prev])
      return send
    },
    [normalizeOfferSend],
  )

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

  const addExpenseDay = useCallback(async (data) => {
    const created = await apiCreateExpenseDay({
      date: data.date,
      items: data.items.map((i) => ({ label: i.label, amount: Number(i.amount) })),
    })
    setExpenseDays((prev) => [created, ...prev])
    return created.id
  }, [])

  const updateExpenseDay = useCallback(async (id, data) => {
    const updated = await apiUpdateExpenseDay(id, {
      date: data.date,
      items: data.items.map((i) => ({ label: i.label, amount: Number(i.amount) })),
    })
    setExpenseDays((prev) => prev.map((d) => (d.id === id ? updated : d)))
    return updated
  }, [])

  const deleteExpenseDay = useCallback(async (id) => {
    await apiDeleteExpenseDay(id)
    setExpenseDays((prev) => prev.filter((d) => d.id !== id))
  }, [])

  const value = useMemo(
    () => ({
      station,
      updateStation,
      fuelRates: { ...currentFuelRates(fuelRateHistory), oil: FUEL_RATES.oil },
      fuelRateHistory,
      reviseFuelRate,
      commissionRates,
      updateCommissionRates,
      isAuthenticated,
      authRestoring,
      accessToken,
      refreshToken,
      currentUser,
      login,
      logout,
      changePassword,
      employees,
      employeesLoading,
      employeesError,
      addEmployee,
      updateEmployee,
      deleteEmployee,
      reviseSalary,
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
      addPurchase,
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
      deactivateOfferCustomer,
      offerHistory,
      offerHistoryLoading,
      offerHistoryError,
      sendOffer,
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
      reviseFuelRate,
      commissionRates,
      updateCommissionRates,
      isAuthenticated,
      authRestoring,
      accessToken,
      refreshToken,
      currentUser,
      login,
      logout,
      changePassword,
      employees,
      employeesLoading,
      employeesError,
      addEmployee,
      updateEmployee,
      deleteEmployee,
      reviseSalary,
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
      addPurchase,
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
      deactivateOfferCustomer,
      offerHistory,
      offerHistoryLoading,
      offerHistoryError,
      sendOffer,
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
