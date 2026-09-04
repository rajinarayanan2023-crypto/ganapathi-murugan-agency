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
