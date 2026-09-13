// Money is never rounded to a whole rupee — reconciliation depends on exact
// paise-level figures, so every amount always shows 2 decimal digits
// (e.g. ₹2,423.23) rather than an approximated whole number.
export function formatCurrency(value) {
  const num = Number(value) || 0
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatCurrencyDecimal(value) {
  const num = Number(value) || 0
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatLiters(value) {
  const num = Number(value) || 0
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' L'
}

export function formatNumber(value) {
  const num = Number(value) || 0
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Short Indian-style axis label (₹1.2L, ₹50K, -₹3Cr) — a full formatCurrency
// figure ("₹-1,00,000.00") doesn't fit in a narrow chart axis gutter without
// getting clipped, unlike this always-short form. Only meant for tick labels;
// tooltips/series values still use the exact formatCurrency figure.
export function formatCompactCurrency(value) {
  const num = Number(value) || 0
  const sign = num < 0 ? '-' : ''
  const abs = Math.abs(num)
  if (abs >= 1_00_00_000) return `${sign}₹${trimDecimal(abs / 1_00_00_000)}Cr`
  if (abs >= 1_00_000) return `${sign}₹${trimDecimal(abs / 1_00_000)}L`
  if (abs >= 1_000) return `${sign}₹${trimDecimal(abs / 1_000)}K`
  return `${sign}₹${Math.round(abs)}`
}

function trimDecimal(value) {
  return value.toFixed(1).replace(/\.0$/, '')
}

// An employee's own uniqueness key is (name, father_name) together — see
// EmployeeService.create/update — so two active employees can genuinely
// share a first name and differ only by father's name. The Employees screen
// itself always shows both names in full, so this is only for OTHER
// screens' employee-picking dropdowns (Fuel Entry's shift/credit selects,
// Employee Credits' "add credit" select, etc.), where showing just the
// father's first initial is enough to tell two "Mari"s apart at a glance
// without cluttering the option text with a second full name.
export function formatEmployeeName(emp) {
  const father = (emp?.fatherName || '').trim()
  return father ? `${emp.name} (${father[0].toUpperCase()}.)` : emp?.name || ''
}

// Accepts a Date or ISO string, returns DD/MM/YYYY
export function formatDate(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d?.getTime?.())) return '-'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export function formatDateShort(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d?.getTime?.())) return '-'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

export function formatDayLabel(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-IN', { weekday: 'short' })
}

// Local-date (not UTC) YYYY-MM-DD — avoids the off-by-one-day shift
// toISOString() introduces for timezones ahead of UTC.
export function toISODate(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function todayISO() {
  return toISODate(new Date())
}
