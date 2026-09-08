const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// In-memory only, set by DataContext on login/logout — never persisted here.
let accessToken = null
let refreshToken = null
let onSessionExpired = null
// Notified whenever the silent mid-request refresh below rotates in a new
// refresh token — without this, only this in-memory copy ever learned about
// it: localStorage's copy (what a real browser refresh, or another tab,
// reads to restore the session) kept the OLD, now-server-revoked token
// forever, so the very next time anything needed to refresh from a fresh
// page load, it tried a token the server had already invalidated and got a
// 401 for what looked like no reason.
let onTokensRefreshed = null
// Several authenticated requests can 401 on the same expired access token at
// once (e.g. DataContext's employees/lubricants/creditCustomers/expenses
// loads firing in parallel) — sharing one in-flight refresh call here means
// only the first triggers POST /auth/refresh; every other 401 just awaits
// that same promise instead of each rotating in its own new refresh token.
let refreshPromise = null

export function setAuthTokens(tokens) {
  accessToken = tokens?.accessToken || null
  refreshToken = tokens?.refreshToken || null
}

export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler
}

export function setTokensRefreshedHandler(handler) {
  onTokensRefreshed = handler
}

async function rawRequest(path, { method = 'GET', body, auth = false } = {}) {
  // FormData (file uploads) must NOT get a Content-Type set here — the
  // browser fills in the multipart boundary itself only when left unset.
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' }
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { res, data }
}

async function request(path, opts = {}) {
  let { res, data } = await rawRequest(path, opts)

  // One retry: a request made with an expired access token refreshes it
  // once via the stored refresh token, then replays the original call.
  if (opts.auth && res.status === 401 && refreshToken) {
    refreshPromise ??= rawRequest('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } }).finally(() => {
      refreshPromise = null
    })
    const refreshed = await refreshPromise
    if (refreshed.res.ok) {
      const tokens = { accessToken: refreshed.data.access_token, refreshToken: refreshed.data.refresh_token }
      setAuthTokens(tokens)
      onTokensRefreshed?.(tokens)
      ;({ res, data } = await rawRequest(path, opts))
    }
  }

  if (!res.ok) {
    if (opts.auth && res.status === 401) onSessionExpired?.()
    throw new ApiError(data?.detail || 'Something went wrong. Please try again.', res.status)
  }
  return data
}

export function getMe() {
  return apiGet('/auth/me')
}

// Revokes every refresh token for the account server-side — the caller
// should log the user out right after this succeeds, matching the "Please
// log in again" response.
export function changePassword(currentPassword, newPassword) {
  return apiAuthPost('/auth/change-password', { current_password: currentPassword, new_password: newPassword })
}

export function apiPost(path, body) {
  return request(path, { method: 'POST', body })
}

function apiGet(path) {
  return request(path, { method: 'GET', auth: true })
}

function apiAuthPost(path, body) {
  return request(path, { method: 'POST', body, auth: true })
}

function apiPatch(path, body) {
  return request(path, { method: 'PATCH', body, auth: true })
}

function apiPut(path, body) {
  return request(path, { method: 'PUT', body, auth: true })
}

function apiDelete(path) {
  return request(path, { method: 'DELETE', auth: true })
}

// ---------- Employees ----------
export function getEmployees() {
  return apiGet('/employees')
}

export function createEmployee(data) {
  return apiAuthPost('/employees', data)
}

export function updateEmployee(id, data) {
  return apiPatch(`/employees/${id}`, data)
}

export function setEmployeeActive(id, active) {
  return updateEmployee(id, { active })
}

// Returns the updated employee (with its full, fresh salary_history) — no
// separate bulk salary-history endpoint exists or is needed, since
// GET /employees already eager-loads salary_history per employee.
export function addSalaryRevision(employeeId, { amount, effective_from }) {
  return apiAuthPost(`/employees/${employeeId}/salary-history`, { amount, effective_from })
}

// Employee Credits — also returned embedded in GET /employees (no separate
// bulk read endpoint needed), these three are the write side.
export function addEmployeeCredit(employeeId, data) {
  return apiAuthPost(`/employees/${employeeId}/credits`, data)
}

export function updateEmployeeCredit(employeeId, creditId, data) {
  return apiPatch(`/employees/${employeeId}/credits/${creditId}`, data)
}

export function deleteEmployeeCredit(employeeId, creditId) {
  return apiDelete(`/employees/${employeeId}/credits/${creditId}`)
}

// ---------- Lubricants ----------
export function getLubricants() {
  return apiGet('/lubricants')
}

export function createLubricant(data) {
  return apiAuthPost('/lubricants', data)
}

export function updateLubricant(id, data) {
  return apiPatch(`/lubricants/${id}`, data)
}

export function deleteLubricant(id) {
  return apiDelete(`/lubricants/${id}`)
}

export function addPriceRevision(id, { rate, effective_from }) {
  return apiAuthPost(`/lubricants/${id}/price-history`, { rate, effective_from })
}

export function recordPurchase(id, { qty, cost, date }) {
  return apiAuthPost(`/lubricants/${id}/purchases`, { qty, cost, date })
}

// ---------- Expenses ----------
export function getExpenses() {
  return apiGet('/expenses')
}

export function createExpenseDay(data) {
  return apiAuthPost('/expenses', data)
}

export function updateExpenseDay(id, data) {
  return apiPatch(`/expenses/${id}`, data)
}

export function deleteExpenseDay(id) {
  return apiDelete(`/expenses/${id}`)
}

// ---------- Credit Customers ----------
export function getCreditCustomers() {
  return apiGet('/credit-customers')
}

export function createCreditCustomer(data) {
  return apiAuthPost('/credit-customers', data)
}

export function updateCreditCustomer(id, data) {
  return apiPatch(`/credit-customers/${id}`, data)
}

export function deleteCreditCustomer(id) {
  return apiDelete(`/credit-customers/${id}`)
}

export function addLedgerEntry(customerId, data) {
  return apiAuthPost(`/credit-customers/${customerId}/ledger`, data)
}

export function deleteLedgerEntry(customerId, entryId) {
  return apiDelete(`/credit-customers/${customerId}/ledger/${entryId}`)
}

// Attaches/replaces (or, passing both fields null, clears) the bill on an
// already-recorded ledger entry — for a credit entered from the Fuel Entry
// screen (amount + reason only, no bill upload there) or one recorded here
// without a bill at hand, so the manager can come back and attach it once
// the physical bill is in.
export function updateLedgerEntryBill(customerId, entryId, data) {
  return apiPatch(`/credit-customers/${customerId}/ledger/${entryId}/bill`, data)
}

// ---------- Offer Customers ----------
// Standalone recipient list for Offers — deliberately separate from
// Employees/Credit Customers (see app/models/offer.py on the backend).
export function getOfferCustomers() {
  return apiGet('/offer-customers')
}

export function createOfferCustomer(data) {
  return apiAuthPost('/offer-customers', data)
}

// No hard delete — "removing" a recipient is done by soft-deactivating
// (active: false) via this same generic update.
export function updateOfferCustomer(id, data) {
  return apiPatch(`/offer-customers/${id}`, data)
}

// ---------- Offers ----------
export function sendOffer(data) {
  return apiAuthPost('/offers/send', data)
}

export function getOfferHistory() {
  return apiGet('/offers/history')
}

// ---------- Uploads (S3, presigned) ----------
// Direct-to-S3 flow: this asks the backend for a short-lived PUT URL, the
// browser then PUTs the file bytes straight to S3 (never touching this
// backend), and only the resulting key is what ever gets saved anywhere.
export function getUploadPresignedUrl(filename, contentType, category) {
  return apiAuthPost('/uploads/presigned-upload', { filename, content_type: contentType, category })
}

// A presigned GET URL, generated fresh on every call — only ever call this
// at the moment a specific bill is actually opened/downloaded, never ahead
// of time for a whole list: it expires in an hour, and generating one for
// every bill nobody looks at is pure wasted work.
export function getDownloadUrl(key) {
  return apiGet(`/uploads/${key}/download-url`).then((d) => d.download_url)
}

export function deleteUpload(key) {
  return apiDelete(`/uploads/${key}`)
}

// Combines the two steps every bill upload needs (ask for a presigned URL,
// then PUT the file straight to S3) so callers never duplicate the raw PUT.
export async function uploadBillFile(file, category) {
  const { upload_url, key } = await getUploadPresignedUrl(file.name, file.type, category)
  const res = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
  if (!res.ok) throw new ApiError('Upload failed. Please try again.', res.status)
  return { name: file.name, key }
}

// ---------- Attendance ----------
// One row per employee per day — no bulk endpoint per employee, so this is
// every employee's attendance for one month in a single call (avoids N+1).
export function getAttendanceMonth(year, month) {
  return apiGet(`/attendance?year=${year}&month=${month}`)
}

export function markAttendance(data) {
  return apiAuthPost('/attendance', data)
}

export function updateAttendance(employeeId, day, data) {
  return apiPatch(`/attendance/${employeeId}/${day}`, data)
}

// ---------- Fuel Entries ----------
// pump_key/date/before let a caller ask for exactly the rows it needs
// (e.g. "this pump, most recent entry before X" for opening carry-forward)
// instead of pulling the whole table.
export function getFuelEntries({ pumpKey, date, before, limit, offset } = {}) {
  const params = new URLSearchParams()
  if (pumpKey) params.set('pump_key', pumpKey)
  if (date) params.set('date', date)
  if (before) params.set('before', before)
  if (limit != null) params.set('limit', limit)
  if (offset != null) params.set('offset', offset)
  const qs = params.toString()
  return apiGet(`/fuel-entries${qs ? `?${qs}` : ''}`)
}

export function getFuelEntry(id) {
  return apiGet(`/fuel-entries/${id}`)
}

export function createFuelEntry(data) {
  return apiAuthPost('/fuel-entries', data)
}

export function updateFuelEntry(id, data) {
  return apiPut(`/fuel-entries/${id}`, data)
}

export function deleteFuelEntry(id) {
  return apiDelete(`/fuel-entries/${id}`)
}
