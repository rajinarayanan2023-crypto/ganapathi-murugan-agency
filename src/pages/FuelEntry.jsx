import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Download, Fuel, CheckCircle2, AlertTriangle, Paperclip, Tag, CalendarDays, Loader2 } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { FUEL_ENTRY_TEXT } from '../i18n/fuelEntry.js'
import { formatCurrency, formatDate, formatLiters, todayISO } from '../utils/format.js'
import { getDownloadUrl } from '../lib/apiClient.js'
import {
  entryFuelLiters,
  entryFuelAmount,
  readingLiters,
  readingAmount,
  shiftSaleAmount,
  shiftPaymentsTotal,
  shiftVariance,
  paymentsTotal,
  pocketOilAmount,
  caneOilRawAmount,
  caneOilAmount,
  sortPumpEntries,
  withCarriedOpenings,
  FUEL_KEYS_BY_PUMP,
  NOZZLE_KEYS,
  PUMP_KEYS,
} from '../utils/fuelCalc.js'
import { sortedFuelRateHistory, currentFuelRates, isTodayRateConfirmed } from '../utils/fuelRate.js'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import Modal from '../components/Modal.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import { PrimaryButton, IconButton, Field, Input, SecondaryButton } from '../components/FormControls.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

// "Today's Fuel Rate" — petrol/diesel change often enough (the government/
// OMC can revise pump price almost daily) that the manager needs to confirm
// or revise it right here each day, rather than it living behind a settings
// screen they'd rarely think to open.
function TodayRateCard({ fuelRateHistory, onRevise }) {
  const { language } = useLanguage()
  const t = FUEL_ENTRY_TEXT[language].todayRate
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(() => ({ ...currentFuelRates(fuelRateHistory), effectiveFrom: todayISO() }))

  const rates = currentFuelRates(fuelRateHistory)
  const confirmed = isTodayRateConfirmed(fuelRateHistory)

  function openModal() {
    setForm({ ...currentFuelRates(fuelRateHistory), effectiveFrom: todayISO() })
    setModalOpen(true)
  }

  function submit(e) {
    e.preventDefault()
    onRevise({
      petrol: Number(form.petrol) || 0,
      diesel: Number(form.diesel) || 0,
      effectiveFrom: form.effectiveFrom,
    })
    toast.success(t.toastRateUpdated)
    setModalOpen(false)
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-card ${
          confirmed ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${confirmed ? 'bg-brand-50 text-brand-600' : 'bg-amber-100 text-amber-600'}`}>
            <Tag size={16} />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-800">{t.sectionTitle}</p>
            <p className="text-xs font-medium text-slate-500">
              {t.fieldPetrolRate.replace(' (₹/L)', '')}: <span className="font-bold text-slate-700">{formatCurrency(rates.petrol)}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              {t.fieldDieselRate.replace(' (₹/L)', '')}: <span className="font-bold text-slate-700">{formatCurrency(rates.diesel)}</span>
            </p>
            {!confirmed ? <p className="mt-0.5 text-xs font-semibold text-amber-600">{t.confirmPrompt}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={openModal}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            confirmed ? 'bg-brand-50 text-brand-700 hover:bg-brand-100' : 'bg-amber-600 text-white hover:bg-amber-700'
          }`}
        >
          {confirmed ? t.reviseButton : t.confirmButton}
        </button>
      </motion.div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={t.sectionTitle}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-xs text-slate-500">{t.hint}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t.fieldPetrolRate}>
              <Input type="number" min="0" step="any" value={form.petrol} onChange={(e) => setForm({ ...form, petrol: e.target.value })} />
            </Field>
            <Field label={t.fieldDieselRate}>
              <Input type="number" min="0" step="any" value={form.diesel} onChange={(e) => setForm({ ...form, diesel: e.target.value })} />
            </Field>
          </div>
          <Field label={t.fieldEffectiveFrom}>
            <AppDatePicker value={form.effectiveFrom} onChange={(date) => setForm({ ...form, effectiveFrom: date })} className="w-full" />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.rateHistoryTitle}</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              {sortedFuelRateHistory(fuelRateHistory).length ? (
                [...sortedFuelRateHistory(fuelRateHistory)].reverse().map((entry) => (
                  <div key={entry.effectiveFrom} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <CalendarDays size={11} className="shrink-0 text-slate-400" />
                    {t.rateHistoryEntry(entry, formatDate(entry.effectiveFrom))}
                  </div>
                ))
              ) : (
                <p className="px-1 py-1 text-xs text-slate-400">{t.noRateHistory}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)}>
              {FUEL_ENTRY_TEXT[language].cancel}
            </SecondaryButton>
            <PrimaryButton type="submit">{FUEL_ENTRY_TEXT[language].saveChanges}</PrimaryButton>
          </div>
        </form>
      </Modal>
    </>
  )
}

const PUMP_LABELS = { pump1: 'Pump 1', pump2: 'Pump 2' }

// Rounded to 2 decimal places, never to whole rupees — export should carry
// the same precision as the live reconciliation figures.
function round2(n) {
  return Math.round(n * 100) / 100
}

// ExcelJS can only embed jpeg/png/gif inline — webp/heic (both accepted at
// upload) and PDFs are listed as plain filenames in the sheet instead,
// since there's no way to render them as a picture in a cell.
const EMBEDDABLE_EXT = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif' }
function embeddableExtension(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase()
  return EMBEDDABLE_EXT[ext] || null
}

// Same note values the cash-counting popover on the shift editor offers
// (PumpDayEditor.jsx) — kept in sync manually since that one isn't exported.
const NOTE_VALUES = [500, 200, 100, 50, 20, 10]
function denominationTotal(denominations) {
  const notesTotal = NOTE_VALUES.reduce((sum, note) => sum + note * (Number(denominations?.[note]) || 0), 0)
  return notesTotal + (Number(denominations?.coins) || 0)
}

export default function FuelEntry() {
  const { fuelEntries, fuelEntriesLoading, deleteFuelEntry, employees, fuelRateHistory, reviseFuelRate, lubricants, creditCustomers } = useData()
  const { language } = useLanguage()
  const t = FUEL_ENTRY_TEXT[language]
  // fuelEntries loads from the real API now — this used to be a fixed
  // useSimulatedLoading(650) timer from the mock-data era, which meant the
  // skeleton always disappeared after exactly 650ms regardless of whether
  // the real fetch had actually finished. On a slower connection that let
  // "No fuel entries recorded" flash for real before the genuine data
  // arrived a moment later — using the real loading flag instead means the
  // skeleton now stays up for exactly as long as the fetch is actually in
  // flight.
  const loading = fuelEntriesLoading
  const navigate = useNavigate()

  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  // Only the row actually being deleted/exported shows a disabled+spinner
  // state — a delete/export request taking a moment shouldn't freeze every
  // OTHER row's Download/Edit/Delete buttons too (that used to disable the
  // whole Actions column via a single page-wide flag, which looked like the
  // entire table had gone unresponsive over one row's delete).
  const [deletingId, setDeletingId] = useState(null)
  const [exportingId, setExportingId] = useState(null)
  // Still page-wide on purpose: unlike a row's own action icons, "New Entry"
  // and clicking a row to open it aren't tied to any specific row's request.
  const busy = deletingId != null || exportingId != null

  async function handleDelete(id) {
    setDeletingId(id)
    try {
      await deleteFuelEntry(id)
      toast.success(t.toastDeleted)
      setConfirmDeleteId(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingId(null)
    }
  }

  function employeeName(id) {
    return employees.find((e) => e.id === id)?.name || ''
  }

  function customerName(id) {
    return (creditCustomers || []).find((c) => c.id === id)?.name || ''
  }

  function lubricantName(id) {
    return (lubricants || []).find((p) => p.id === id)?.name || ''
  }

  // Every shift entry is independent, but its opening reading is still
  // carried forward live from whichever shift (same pump, possibly an
  // earlier day) came right before it — see fuelCalc.js. Recompute that
  // once per pump so every row's liters/amount reflect the real chain.
  const effectiveById = useMemo(() => {
    const map = new Map()
    for (const pumpKey of PUMP_KEYS) {
      const withOpenings = withCarriedOpenings(sortPumpEntries(fuelEntries.filter((e) => e.pumpKey === pumpKey)))
      for (const e of withOpenings) map.set(e.id, e)
    }
    return map
  }, [fuelEntries])

  // Every section a shift's own form can hold — meter readings, pocket/cane
  // oil (Pump 2), every payment line (cash/card/QR, customer credit,
  // employee credit, expense), bills, and notes — so nothing typed on this
  // shift is left out of its own downloaded record. A real .xlsx (not CSV)
  // specifically so bill photos can be embedded as actual pictures in the
  // sheet, not just listed by filename.
  async function exportEntry(entry) {
    const effective = effectiveById.get(entry.id) || entry
    const fuelKeys = FUEL_KEYS_BY_PUMP[entry.pumpKey]
    const fuelLabels = t.pumpEditor.fuelLabels
    const rows = [
      ['Date', formatDate(entry.date)],
      ['Pump', PUMP_LABELS[entry.pumpKey]],
      [`Shift ${entry.shiftNumber}`, employeeName(entry.employeeId) || '—'],
      [],
      ['Fuel', 'Nozzle', 'Opening', 'Closing', 'Testing', 'Rate', 'Liters', 'Amount'],
    ]
    fuelKeys.forEach((fuelKey) => {
      NOZZLE_KEYS.forEach((nozzleKey, nozzleIdx) => {
        const reading = effective[fuelKey]?.[nozzleKey]
        rows.push([
          fuelLabels[fuelKey] || fuelKey,
          `Nozzle ${nozzleIdx + 1}`,
          reading?.opening,
          reading?.closing,
          reading?.testing,
          reading?.rate,
          round2(readingLiters(reading)),
          round2(readingAmount(reading)),
        ])
      })
      rows.push([`${fuelLabels[fuelKey] || fuelKey} Total`, '', '', '', '', '', round2(entryFuelLiters(effective, fuelKey)), round2(entryFuelAmount(effective, fuelKey))])
    })

    if (entry.pumpKey === 'pump2') {
      rows.push([])
      rows.push([t.pumpEditor.pocketOilLabel])
      rows.push(['Product', 'Count', 'Rate', 'Amount'])
      if ((entry.oilRows || []).length) {
        entry.oilRows.forEach((row) => {
          const qty = Number(row.stockCount) || 0
          const rate = Number(row.stockRate) || 0
          rows.push([lubricantName(row.productId) || '—', qty, rate, round2(qty * rate)])
        })
      } else {
        rows.push(['—', '', '', 0])
      }
      rows.push([`${t.pumpEditor.pocketOilLabel} Total`, '', '', round2(pocketOilAmount(entry))])

      rows.push([])
      rows.push([t.pumpEditor.caneOilLabel])
      rows.push(['Product', 'Count', 'Rate', 'Amount'])
      if ((entry.caneOilRows || []).length) {
        entry.caneOilRows.forEach((row) => {
          const qty = Number(row.stockCount) || 0
          const rate = Number(row.stockRate) || 0
          rows.push([lubricantName(row.productId) || '—', qty, rate, round2(qty * rate)])
        })
      } else {
        rows.push(['—', '', '', 0])
      }
      const caneOfferApplied = Math.min(Number(entry.caneOilOffer) || 0, caneOilRawAmount(entry))
      rows.push([`${t.pumpEditor.caneOilLabel} Raw Total`, '', '', round2(caneOilRawAmount(entry))])
      if (caneOfferApplied > 0) rows.push(['Offer / Discount Applied', '', '', round2(caneOfferApplied)])
      rows.push([`${t.pumpEditor.caneOilLabel} Total`, '', '', round2(caneOilAmount(entry))])
    }

    rows.push([])
    rows.push(['Payments Received'])
    rows.push(['Type', 'Label / Party', 'Note', 'Amount'])
    if ((entry.payments || []).length) {
      entry.payments.forEach((p) => {
        const type =
          p.type === 'credit' ? t.pumpEditor.creditLabel : p.type === 'employeeCredit' ? t.pumpEditor.employeeCreditLabel : p.type === 'expense' ? t.pumpEditor.expenseLabel : 'Cash / Card / QR'
        const label = p.type === 'credit' ? customerName(p.customerId) : p.type === 'employeeCredit' ? employeeName(p.employeeId) : p.label
        rows.push([type, label || '—', p.note || '', round2(Number(p.amount) || 0)])
        // Cash note-count breakdown (the "Count Cash" popover on the shift
        // editor) — only shown here when the manager actually counted this
        // line, same as on screen where the breakdown only appears once
        // denominations have been entered.
        if ((!p.type || p.type === 'cash') && p.denominations && denominationTotal(p.denominations) > 0) {
          NOTE_VALUES.filter((note) => Number(p.denominations?.[note]) > 0).forEach((note) => {
            const count = Number(p.denominations[note])
            rows.push(['', `₹${note} × ${count}`, '', round2(note * count)])
          })
          if (Number(p.denominations?.coins) > 0) {
            rows.push(['', 'Coins', '', round2(Number(p.denominations.coins))])
          }
          rows.push(['', 'Cash Count Total', '', round2(denominationTotal(p.denominations))])
        }
      })
    } else {
      rows.push(['—', '—', '', 0])
    }
    rows.push(['Payments Collected Total', '', '', round2(paymentsTotal(entry.payments))])

    const bills = entry.bills || []
    rows.push([])
    rows.push(['Bills & Documents'])
    if (bills.length) {
      rows.push(['Name', 'Date'])
      bills.forEach((bill) => rows.push([bill.name, formatDate(bill.date), embeddableExtension(bill.name) ? '(picture below)' : '(open original — not embeddable)']))
    } else {
      rows.push(['No bills uploaded'])
    }

    rows.push([])
    rows.push(['Additional Information', entry.notes || ''])

    rows.push([])
    rows.push(['Sale Amount (meters + pocket/cane oil)', round2(shiftSaleAmount(effective))])
    rows.push(['Payments Collected', round2(paymentsTotal(entry.payments))])
    rows.push(['Excess / Shortage', round2(shiftVariance(effective))])

    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Fuel Pump Manager'
    const sheet = workbook.addWorksheet('Fuel Entry')
    rows.forEach((row) => sheet.addRow(row))
    sheet.columns.forEach((col) => { col.width = 22 })

    // Bill photos are fetched and embedded as real pictures, one below the
    // other beneath the sheet's text content — a presigned download URL is
    // asked for fresh, right here, same as clicking "view" on a bill would.
    // A bill that fails to fetch (network hiccup, an old pre-R2 record) is
    // skipped rather than failing the whole export — the filename/date row
    // above already accounts for it either way.
    let imageRow = sheet.rowCount + 2
    for (const bill of bills) {
      const extension = embeddableExtension(bill.name)
      if (!extension) continue
      try {
        const downloadUrl = await getDownloadUrl(bill.url)
        const res = await fetch(downloadUrl)
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
        const buffer = await res.arrayBuffer()
        const imageId = workbook.addImage({ buffer, extension })
        sheet.getCell(imageRow, 1).value = bill.name
        sheet.addImage(imageId, { tl: { col: 0, row: imageRow }, ext: { width: 240, height: 180 } })
        imageRow += 11 // ~180px tall image + a little breathing room before the next one
      } catch {
        // Skipped — see comment above.
      }
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fuel-entry-${entry.date}-${entry.pumpKey}-shift${entry.shiftNumber}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExportEntry(entry) {
    setExportingId(entry.id)
    try {
      await exportEntry(entry)
      toast.success(t.toastExported)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setExportingId(null)
    }
  }

  // dateDisplay/pumpLabel are extra plain-text fields just for the search
  // box below to match against (typing "28/08" or "Pump 1" wouldn't hit
  // anything searching the raw ISO date / pumpKey values directly).
  //
  // Drafts are deliberately left out of this table — they aren't finished,
  // real records yet (no attendance/stock/credit effects until finalized),
  // so they shouldn't sit in the history table alongside settled entries.
  // The draft itself is untouched in storage: opening "New Day Entry" (or
  // just setting the Date/Pump back to wherever it was) still finds and
  // resumes it exactly as before, via the same pumpKey+date lookup the form
  // already does — only its row here is hidden.
  const rows = useMemo(
    () =>
      fuelEntries
        .filter((entry) => entry.status !== 'draft')
        .map((entry) => {
        const effective = effectiveById.get(entry.id) || entry
        const fuelKeys = FUEL_KEYS_BY_PUMP[entry.pumpKey]
        const fuelBreakdown = fuelKeys.map((fuelKey) => ({
          fuelKey,
          ltr: entryFuelLiters(effective, fuelKey),
          amount: entryFuelAmount(effective, fuelKey),
        }))
        const pumpLabel = `${entry.pumpKey === 'pump1' ? t.pump1 : t.pump2} ${t.pumpEditor.shiftLabel(entry.shiftNumber)}`
        const employee = employeeName(entry.employeeId)
        // Plain-text mirrors of the JSX `body` renderers above, used only as
        // the CSV export value for that column (via Column `exportField`) —
        // the bulk "Export CSV" button pulls raw field values, so a column
        // whose visible content is built by `body` (not a plain field) would
        // otherwise export blank or a raw code like "pump1" instead of what's
        // actually shown on screen.
        const pumpShiftEmployeeExport = employee ? `${pumpLabel} (${employee})` : pumpLabel
        const fuelSummaryExport =
          fuelBreakdown
            .filter((f) => f.ltr > 0 || f.amount > 0)
            .map((f) => `${t.pumpEditor.fuelLabels[f.fuelKey]}: ${formatLiters(f.ltr)} / ${formatCurrency(f.amount)}`)
            .join('; ') || '—'
        return {
          id: entry.id,
          date: entry.date,
          dateDisplay: formatDate(entry.date),
          pumpKey: entry.pumpKey,
          shiftNumber: entry.shiftNumber,
          pumpLabel,
          pumpShiftEmployeeExport,
          fuelSummaryExport,
          employeeName: employee,
          status: entry.status,
          fuelBreakdown,
          totalSaleAmount: round2(shiftSaleAmount(effective)),
          excessShortage: round2(shiftVariance(effective)),
          billsCount: entry.bills?.length || 0,
          _entry: entry,
        }
      }),
    [fuelEntries, effectiveById, employees, t],
  )

  const historyColumns = [
    {
      field: 'date',
      header: t.colDate,
      sortable: true,
      style: { width: '12%' },
      body: (row) => <span className="font-medium text-slate-700">{formatDate(row.date)}</span>,
    },
    {
      field: 'pumpKey',
      exportField: 'pumpShiftEmployeeExport',
      header: t.colPump,
      sortable: true,
      style: { width: '16%' },
      body: (row) => (
        <>
          <p className={`font-semibold ${row.pumpKey === 'pump1' ? 'text-violet-600' : 'text-ocean-600'}`}>
            {row.pumpKey === 'pump1' ? t.pump1 : t.pump2} — {t.pumpEditor.shiftLabel(row.shiftNumber)}
          </p>
          <p className="text-xs font-medium text-slate-400">{row.employeeName || '—'}</p>
        </>
      ),
    },
    {
      field: 'fuelSummaryExport',
      header: t.colFuel,
      style: { width: '26%' },
      body: (row) => (
        <span className="font-medium text-slate-600">
          {row.fuelBreakdown
            .filter((f) => f.ltr > 0 || f.amount > 0)
            .map((f) => `${t.pumpEditor.fuelLabels[f.fuelKey]}: ${formatLiters(f.ltr)} · ${formatCurrency(f.amount)}`)
            .join('  ·  ') || '—'}
        </span>
      ),
    },
    {
      field: 'totalSaleAmount',
      header: t.colTotalAmount,
      sortable: true,
      style: { width: '14%' },
      body: (row) => <span className="font-semibold text-slate-800">{formatCurrency(row.totalSaleAmount)}</span>,
    },
    {
      field: 'excessShortage',
      header: t.colExcessShortage,
      sortable: true,
      style: { width: '14%' },
      body: (row) => (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
            row.excessShortage >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
          }`}
        >
          {row.excessShortage >= 0 ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
          {row.excessShortage >= 0 ? '+' : ''}
          {formatCurrency(row.excessShortage)}
        </span>
      ),
    },
    {
      field: 'bills',
      exportField: 'billsCount',
      header: t.colBills,
      align: 'center',
      style: { width: '8%' },
      body: (row) =>
        row.billsCount > 0 ? (
          <span
            title={t.billsUploaded(row.billsCount)}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700"
          >
            <Paperclip size={12} /> {row.billsCount}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      header: t.colActions,
      align: 'right',
      exportable: false,
      style: { width: '10%' },
      body: (row) => {
        // Scoped to THIS row only — deleting/exporting one entry shouldn't
        // freeze every other row's icons too (see deletingId/exportingId
        // above).
        const rowBusy = deletingId === row.id || exportingId === row.id
        return (
        <div className="flex justify-end gap-1">
          <IconButton
            onClick={(e) => {
              e.stopPropagation()
              handleExportEntry(row._entry)
            }}
            disabled={rowBusy}
            aria-label="Export"
            title="Export"
            tone="download"
          >
            {exportingId === row.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          </IconButton>
          <IconButton
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/fuel-entry/${row.id}/edit`)
            }}
            disabled={rowBusy}
            aria-label="Edit"
            title="Edit"
            tone="edit"
          >
            <Pencil size={15} />
          </IconButton>
          <IconButton
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDeleteId(row.id)
            }}
            disabled={rowBusy}
            aria-label="Delete"
            title="Delete"
            tone="delete"
          >
            {deletingId === row.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </IconButton>
        </div>
        )
      },
    },
  ]

  if (loading) {
    return <SkeletonTable rows={6} cols={6} />
  }

  return (
    // Same fillHeight pattern as Employees/Attendance/Credit Bills — flex
    // h-full lets the card below stretch to exactly fill whatever height
    // `main` actually has, instead of a hand-guessed `calc(100vh - Npx)`.
    <div className="flex h-full min-h-0 flex-col gap-6">
      {/* Same entire-page loader used elsewhere in this app (e.g. AuditModal's
          email send) for both writes this screen can trigger — clearly
          communicates "in progress" instead of just leaving a row's icons
          quietly disabled. */}
      {deletingId != null ? (
        <FullPageLoader label={t.deleting} />
      ) : exportingId != null ? (
        <FullPageLoader label={t.exporting} />
      ) : null}
      {/* TodayRateCard removed for now — <TodayRateCard fuelRateHistory={fuelRateHistory} onRevise={reviseFuelRate} /> */}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
      >
        <div className="border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-800">{t.entryHistory}</h3>
        </div>
        {fuelEntries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Fuel}
              title={t.emptyTitle}
              description={t.emptyDesc}
              action={
                <PrimaryButton onClick={() => navigate('/fuel-entry/new')} disabled={busy} className="px-3.5 py-2 text-xs">
                  <Plus size={14} /> {t.newDayEntry}
                </PrimaryButton>
              }
            />
          </div>
        ) : (
          <DataTable
            columns={historyColumns}
            data={rows}
            rowKey="id"
            globalFilterFields={['dateDisplay', 'pumpLabel', 'employeeName']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="date"
            defaultSortOrder={-1}
            fillHeight
            exportFilename="fuel-entries"
            dense
            onRowClick={busy ? undefined : (row) => navigate(`/fuel-entry/${row.id}/edit`)}
            toolbarActions={
              <PrimaryButton onClick={() => navigate('/fuel-entry/new')} disabled={busy} className="px-3.5 py-2 text-xs">
                <Plus size={14} /> {t.newDayEntry}
              </PrimaryButton>
            }
          />
        )}
      </motion.div>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => handleDelete(confirmDeleteId)}
        title={t.deleteTitle}
        description={t.deleteDesc}
        loading={deletingId != null}
      />
    </div>
  )
}
