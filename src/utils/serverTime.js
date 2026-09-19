// Server-authoritative clock offset, learned passively from every API
// response's own "Date" header (see apiClient.js) — no dedicated endpoint
// needed. Business-day logic (todayISO() in format.js, and anything that
// calls serverNow() below) should never trust a device's own clock/timezone
// outright: it can be wrong, and when it is, "today" silently becomes a
// different calendar day than everyone else's, on that one device only —
// entries created there land on the wrong date, and browsing "today's"
// entries shows nothing (they're really filed under the actual date) while
// every other, correctly-clocked device looks completely normal. Recording
// the gap between the server's clock and this device's the moment any
// authenticated call succeeds means every date computed afterward is
// corrected for that device's actual clock/timezone error, transparently.
let offsetMs = 0
let synced = false

export function recordServerDate(dateHeaderValue) {
  if (!dateHeaderValue) return
  const serverMs = Date.parse(dateHeaderValue)
  if (Number.isNaN(serverMs)) return
  offsetMs = serverMs - Date.now()
  synced = true
}

// Before the very first API response has come back (a fresh page load),
// this is just `new Date()` — there's nothing to correct yet, same as today.
export function serverNow() {
  return new Date(Date.now() + offsetMs)
}

export function isServerTimeSynced() {
  return synced
}
