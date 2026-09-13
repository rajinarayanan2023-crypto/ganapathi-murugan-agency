import { toISODate } from './format.js'

// Attendance day record shape:
// { status: 'oneShift' | 'doubleShift' | 'absent' | 'leave' | 'dutyOff' | 'companyOff' }
//
// - oneShift    -> worked a single 12hr shift (1 shift unit)
// - doubleShift -> worked both shifts back-to-back, a 24hr day (2 shift units) —
//                  choosing this for a date auto-suggests 'dutyOff' for the next day
// - absent      -> did not show up, unexcused
// - leave       -> requested leave
// - dutyOff     -> scheduled rest day (not attendance — not paid, not a leave)
// - companyOff  -> a company-declared off day (holiday/closure) — unlike dutyOff,
//                  this one DOES count as a paid day worked (1 shift unit) and is
//                  never treated as an absence/leave, so the employee still shows
//                  as assignable elsewhere (see FuelEntryForm's unavailableEmployeeIds)

export const STATUS_OPTIONS = ['oneShift', 'doubleShift', 'absent', 'leave', 'dutyOff', 'companyOff']

export function shiftUnits(record) {
  if (record?.status === 'oneShift') return 1
  if (record?.status === 'doubleShift') return 2
  // A company off day still counts as one full paid day, same as a single shift —
  // it's a day the company declared off, not one the employee took unpaid.
  if (record?.status === 'companyOff') return 1
  return 0
}

export function isPresentRecord(record) {
  return record?.status === 'oneShift' || record?.status === 'doubleShift' || record?.status === 'companyOff'
}

export function nextDateISO(dateISO) {
  return toISODate(new Date(new Date(dateISO).getTime() + 86400000))
}
