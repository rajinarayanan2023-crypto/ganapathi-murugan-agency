import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Receipt, X } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { EXPENSES_TEXT } from '../i18n/expenses.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, PrimaryButton, SecondaryButton, IconButton, submitOnEnter } from '../components/FormControls.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

function makeItemId() {
  return `item-${Math.random().toString(36).slice(2, 9)}`
}

function emptyItem() {
  return { id: makeItemId(), label: '', amount: '' }
}

export default function Expenses() {
  const { expenseDays, expensesLoading, expensesError, addExpenseDay, updateExpenseDay, deleteExpenseDay } = useData()
  const { language } = useLanguage()
  const t = EXPENSES_TEXT[language]
  const loading = expensesLoading

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [date, setDate] = useState(todayISO())
  const [items, setItems] = useState([emptyItem()])
  const [errors, setErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // One combined flag covering every kind of in-flight write this page can
  // make (add/edit, delete) — while any of them is running, every OTHER
  // action on this screen is blocked too.
  const busy = saving || deleting

  const rows = useMemo(
    () =>
      expenseDays.map((d) => ({
        ...d,
        total: d.items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
        // Plain-text mirror of the `items` chips rendered by the Items
        // column's `body` — the raw `items` field is an array of objects,
        // which the CSV export can't render, and the on-screen chips only
        // show the first 3 anyway, so this lists every item for the export.
        itemsExport: d.items.map((i) => `${i.label}: ${formatCurrency(i.amount)}`).join('; '),
      })),
    [expenseDays],
  )

  function openAdd() {
    setEditingId(null)
    setDate(todayISO())
    setItems([emptyItem()])
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(day) {
    setEditingId(day.id)
    setDate(day.date)
    setItems(day.items.length ? day.items.map((i) => ({ ...i })) : [emptyItem()])
    setErrors({})
    setModalOpen(true)
  }

  function updateItem(id, field, value) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)))
  }

  function addItemRow() {
    setItems((prev) => [...prev, emptyItem()])
  }

  function removeItemRow(id) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== id) : prev))
  }

  const total = useMemo(() => items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0), [items])

  async function handleSubmit(e) {
    e.preventDefault()
    const validItems = items
      .filter((i) => i.label.trim() && Number(i.amount) > 0)
      .map((i) => ({ id: i.id, label: i.label.trim(), amount: Number(i.amount) }))

    const errs = {}
    if (!date) errs.date = t.errorDateRequired
    else if (!editingId && expenseDays.some((d) => d.date === date)) errs.date = t.errorDateExists
    if (validItems.length === 0) errs.items = t.errorItemsRequired
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setSaving(true)
    try {
      if (editingId) {
        await updateExpenseDay(editingId, { date, items: validItems })
        toast.success(t.toastUpdated)
      } else {
        await addExpenseDay({ date, items: validItems })
        toast.success(t.toastAdded)
      }
      setModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteExpenseDay(confirmDeleteId)
      toast.success(t.toastDeleted)
      setConfirmDeleteId(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeleting(false)
    }
  }

  const columns = [
    {
      field: 'date',
      header: t.colDate,
      sortable: true,
      style: { width: '16%' },
      body: (d) => <span className="font-medium text-slate-800">{formatDate(d.date)}</span>,
    },
    {
      field: 'items',
      exportField: 'itemsExport',
      header: t.colItems,
      style: { width: '52%' },
      body: (d) => (
        <div className="flex flex-wrap gap-1.5">
          {d.items.slice(0, 3).map((i) => (
            <span key={i.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              {i.label} <span className="font-semibold text-slate-800">{formatCurrency(i.amount)}</span>
            </span>
          ))}
          {d.items.length > 3 ? (
            <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400">
              {t.moreItems(d.items.length - 3)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      field: 'total',
      header: t.colTotal,
      sortable: true,
      align: 'right',
      style: { width: '16%' },
      body: (d) => <span className="font-semibold text-rose-600">{formatCurrency(d.total)}</span>,
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '16%' },
      body: (d) => (
        <div className="flex justify-end gap-1">
          <IconButton onClick={() => openEdit(d)} disabled={busy} aria-label="Edit" title="Edit" tone="edit">
            <Pencil size={15} />
          </IconButton>
          <IconButton onClick={() => setConfirmDeleteId(d.id)} disabled={busy} aria-label="Delete" title="Delete" tone="delete">
            <Trash2 size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  if (loading) {
    return <SkeletonTable rows={6} cols={4} />
  }

  if (expensesError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {expensesError}</div>
  }

  const busyLabel = saving ? t.saving : deleting ? t.deleting : ''

  return (
    <div className="space-y-6">
      {busy ? <FullPageLoader label={busyLabel} /> : null}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Receipt}
              title={t.emptyTitle}
              description={t.emptyDesc}
              action={
                <PrimaryButton onClick={openAdd} disabled={busy}>
                  <Plus size={16} /> {t.addExpenseDay}
                </PrimaryButton>
              }
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            rowKey="id"
            defaultSortField="date"
            defaultSortOrder={-1}
            exportFilename="expenses"
            dense
            toolbarActions={
              <PrimaryButton onClick={openAdd} disabled={busy} className="px-3.5 py-2 text-xs">
                <Plus size={14} /> {t.addExpenseDay}
              </PrimaryButton>
            }
          />
        )}
      </motion.div>

      <Modal
        isOpen={modalOpen}
        onClose={saving ? () => {} : () => setModalOpen(false)}
        title={editingId ? t.editExpenseDay : t.addExpenseDay}
      >
        <form onSubmit={handleSubmit} onKeyDown={submitOnEnter} className="space-y-4">
          <Field label={t.fieldDate} required error={errors.date} className="max-w-xs">
            <AppDatePicker value={date} onChange={setDate} className="w-full" disabled={saving} />
          </Field>

          <Field label={t.itemsLabel} error={errors.items}>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-1.5">
                  <Input
                    value={item.label}
                    onChange={(e) => updateItem(item.id, 'label', e.target.value)}
                    placeholder={t.placeholderItemLabel}
                    className="flex-1"
                    disabled={saving}
                  />
                  <div className="w-28 shrink-0">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={item.amount}
                      onChange={(e) => updateItem(item.id, 'amount', e.target.value)}
                      placeholder={t.placeholderItemAmount}
                      disabled={saving}
                    />
                  </div>
                  <IconButton
                    type="button"
                    onClick={() => removeItemRow(item.id)}
                    aria-label={t.removeItem}
                    title={t.removeItem}
                    tone="delete"
                    disabled={items.length === 1 || saving}
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addItemRow}
              disabled={saving}
              className="mt-2 flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-100 disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus size={13} /> {t.addItem}
            </button>
          </Field>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <span className="font-semibold text-slate-600">{t.totalLabel}</span>
            <span className="font-bold text-slate-800">{formatCurrency(total)}</span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={saving}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {editingId ? t.saveChanges : t.saveEntry}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title={t.deleteTitle}
        description={t.deleteDesc}
        loading={deleting}
      />
    </div>
  )
}
