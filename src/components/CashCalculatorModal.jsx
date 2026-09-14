import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import Modal from './Modal.jsx'
import { Input, SecondaryButton } from './FormControls.jsx'
import { formatCurrency } from '../utils/format.js'
import { useLanguage } from '../context/LanguageContext.jsx'
import { CASH_CALCULATOR_TEXT } from '../i18n/cashCalculator.js'

// India's actual currently-circulating denominations. ₹10 exists as both a
// note and a coin — tracked as separate rows (note-10 / coin-10) rather than
// merged, since a manager counting a cash drawer sorts them separately too.
const NOTE_DENOMINATIONS = [500, 200, 100, 50, 20, 10]
const COIN_DENOMINATIONS = [10, 5, 2, 1]

function emptyCounts() {
  const counts = {}
  NOTE_DENOMINATIONS.forEach((d) => {
    counts[`note-${d}`] = ''
  })
  COIN_DENOMINATIONS.forEach((d) => {
    counts[`coin-${d}`] = ''
  })
  return counts
}

// Pure UI utility — no save, no backend call, nothing persisted. Just a
// quick way to turn "how many of each note/coin" into a total while
// physically counting a cash drawer, reachable from anywhere via the top bar.
export default function CashCalculatorModal({ isOpen, onClose }) {
  const { language } = useLanguage()
  const t = CASH_CALCULATOR_TEXT[language]
  const [counts, setCounts] = useState(emptyCounts)

  // Resets every count back to blank the moment the modal is opened, not
  // just left over from whatever was typed in during a previous open — a
  // half-finished count from an hour ago silently resurfacing would be
  // actively misleading for a cash total.
  function handleClose() {
    setCounts(emptyCounts())
    onClose?.()
  }

  function setCount(key, raw) {
    // Digits only — this counts physical notes/coins, never negative or
    // fractional. Capped at 4 digits (9999 of one denomination is already
    // far beyond any real cash drawer) so a mis-tap can't produce a
    // meaningless total.
    const value = raw.replace(/[^0-9]/g, '').slice(0, 4)
    setCounts((prev) => ({ ...prev, [key]: value }))
  }

  const rows = useMemo(() => {
    const build = (denominations, kind) =>
      denominations.map((d) => {
        const key = `${kind}-${d}`
        const count = Number(counts[key]) || 0
        return { key, denomination: d, count, subtotal: count * d }
      })
    return { notes: build(NOTE_DENOMINATIONS, 'note'), coins: build(COIN_DENOMINATIONS, 'coin') }
  }, [counts])

  const allRows = [...rows.notes, ...rows.coins]
  const total = allRows.reduce((sum, r) => sum + r.subtotal, 0)
  const totalPieces = allRows.reduce((sum, r) => sum + r.count, 0)
  const hasAnyEntry = totalPieces > 0

  function renderRow(row) {
    return (
      <div key={row.key} className="flex items-center gap-3 py-1.5">
        <span className="w-16 shrink-0 rounded-md bg-brand-50 px-2 py-1.5 text-center text-sm font-bold text-brand-700">
          &#8377;{row.denomination}
        </span>
        <span className="shrink-0 text-sm text-slate-400">&times;</span>
        <Input
          type="text"
          inputMode="numeric"
          value={counts[row.key]}
          onChange={(e) => setCount(row.key, e.target.value)}
          placeholder={t.countPlaceholder}
          className="w-20 text-center"
          aria-label={`${row.denomination}`}
        />
        <span className="ml-auto min-w-[100px] text-right text-sm font-semibold text-slate-700">
          {formatCurrency(row.subtotal)}
        </span>
      </div>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t.title} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Single column on phones (each row gets the full width, nothing
            cramped); side-by-side once there's room (sm+) to actually use
            the wider modal instead of leaving it half-empty. */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{t.notes}</p>
            <div className="divide-y divide-slate-100">{rows.notes.map(renderRow)}</div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{t.coins}</p>
            <div className="divide-y divide-slate-100">{rows.coins.map(renderRow)}</div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-white shadow-md shadow-brand-600/30">
          <span className="text-sm font-semibold">{t.total}</span>
          <span className="text-xl font-bold">{formatCurrency(total)}</span>
        </div>

        <div className="flex justify-end pt-1">
          <SecondaryButton type="button" onClick={() => setCounts(emptyCounts())} disabled={!hasAnyEntry}>
            <RotateCcw size={14} /> {t.clear}
          </SecondaryButton>
        </div>
      </div>
    </Modal>
  )
}
