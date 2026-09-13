import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, HandCoins, StickyNote, Lock, ArrowLeft } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { EMPLOYEE_CREDITS_TEXT } from '../i18n/employeeCredits.js'
import { formatCurrency, formatDate, formatEmployeeName, todayISO } from '../utils/format.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

const emptyForm = { employeeId: '', date: todayISO(), amount: '', note: '' }

export default function EmployeeCredits() {
  const { employees, employeesLoading, employeesError, addEmployeeCredit, updateEmployeeCredit, deleteEmployeeCredit } = useData()
  const { language } = useLanguage()
  const t = EMPLOYEE_CREDITS_TEXT[language]
  const loading = employeesLoading
  const navigate = useNavigate()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingRow, setEditingRow] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  // One combined flag covering every in-flight write this page can make
  // (add/edit, delete) — while any of them is running, every other action
  // on this screen is blocked too, same pattern as Employees.jsx.
  const busy = saving || deleting

  // Employee Credits has no table of its own to fetch — every row here is
  // already embedded per employee (see DataContext's normalizeEmployee), so
  // this is just a flattened view across the whole roster.
  const rows = useMemo(
    () =>
      employees.flatMap((emp) =>
        (emp.credits || []).map((c) => ({ ...c, employeeId: emp.id, employeeName: emp.name })),
      ),
    [employees],
  )

  function openAdd() {
    setEditingRow(null)
    setForm({ ...emptyForm, employeeId: employees[0]?.id || '' })
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(row) {
    if (row.sourceFuelEntryId) return
    setEditingRow(row)
    setForm({ employeeId: row.employeeId, date: row.date, amount: String(row.amount), note: row.note || '' })
    setErrors({})
    setModalOpen(true)
  }

  function validate() {
    const e = {}
    if (!editingRow && !form.employeeId) e.employeeId = t.errorEmployeeRequired
    if (!(Number(form.amount) > 0)) e.amount = t.errorAmountInvalid
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev) {
    ev.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      if (editingRow) {
        await updateEmployeeCredit(editingRow.employeeId, editingRow.id, { date: form.date, amount: form.amount, note: form.note })
        toast.success(t.toastUpdated)
      } else {
        await addEmployeeCredit(form.employeeId, { date: form.date, amount: form.amount, note: form.note })
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
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteEmployeeCredit(deleteTarget.employeeId, deleteTarget.id)
      toast.success(t.toastDeleted)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeleting(false)
    }
  }

  const columns = [
    {
      field: 'employeeName',
      header: t.colEmployee,
      sortable: true,
      style: { width: '24%' },
      body: (row) => <p className="font-medium text-slate-800">{row.employeeName}</p>,
    },
    {
      field: 'date',
      header: t.colDate,
      sortable: true,
      style: { width: '14%' },
      body: (row) => <span className="font-medium text-slate-600">{formatDate(row.date)}</span>,
    },
    {
      field: 'amount',
      header: t.colAmount,
      sortable: true,
      style: { width: '14%' },
      body: (row) => <span className="font-semibold text-rose-500">{formatCurrency(row.amount)}</span>,
    },
    {
      field: 'note',
      header: t.colNotes,
      style: { width: '30%' },
      body: (row) =>
        row.sourceFuelEntryId ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            <Lock size={11} /> {t.fromFuelEntry}
          </span>
        ) : row.note ? (
          <p title={row.note} className="flex max-w-[260px] items-start gap-1.5 text-xs font-medium text-slate-500">
            <StickyNote size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="truncate">{row.note}</span>
          </p>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '10%' },
      exportable: false,
      body: (row) =>
        row.sourceFuelEntryId ? null : (
          <div className="flex justify-end gap-1">
            <IconButton onClick={() => openEdit(row)} disabled={busy} aria-label="Edit" title="Edit" tone="edit">
              <Pencil size={15} />
            </IconButton>
            <IconButton onClick={() => setDeleteTarget(row)} disabled={busy} aria-label="Delete" title="Delete" tone="delete">
              <Trash2 size={15} />
            </IconButton>
          </div>
        ),
    },
  ]

  if (loading) {
    return <SkeletonTable rows={6} cols={5} />
  }

  if (employeesError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {employeesError}</div>
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
              icon={HandCoins}
              title={t.emptyTitle}
              description={t.emptyDesc}
              action={
                <div className="flex items-center gap-2">
                  <SecondaryButton onClick={() => navigate('/salary')} disabled={busy}>
                    <ArrowLeft size={15} /> {t.backToSalary}
                  </SecondaryButton>
                  <PrimaryButton onClick={openAdd} disabled={busy}>
                    <Plus size={16} /> {t.addCredit}
                  </PrimaryButton>
                </div>
              }
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            rowKey="id"
            globalFilterFields={['employeeName', 'note']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="date"
            defaultSortOrder={-1}
            scrollHeight="calc(100vh - 170px)"
            exportFilename="employee-credits"
            dense
            toolbarActions={
              <>
                <SecondaryButton onClick={() => navigate('/salary')} disabled={busy} className="px-3.5 py-2 text-xs">
                  <ArrowLeft size={14} /> {t.backToSalary}
                </SecondaryButton>
                <PrimaryButton onClick={openAdd} disabled={busy} className="px-3.5 py-2 text-xs">
                  <Plus size={14} /> {t.addCredit}
                </PrimaryButton>
              </>
            }
          />
        )}
      </motion.div>

      <Modal
        isOpen={modalOpen}
        onClose={saving ? () => {} : () => setModalOpen(false)}
        title={editingRow ? t.editCredit : t.addCredit}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {editingRow ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">{editingRow.employeeName}</div>
          ) : (
            <Field label={t.fieldEmployee} required error={errors.employeeId}>
              <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} disabled={saving}>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {formatEmployeeName(emp)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t.fieldDate}>
            <AppDatePicker
              value={form.date}
              onChange={(date) => setForm({ ...form, date })}
              maxDate={todayISO()}
              className="w-full"
              disabled={saving}
            />
          </Field>
          <Field label={t.fieldAmount} required error={errors.amount}>
            <Input
              type="number"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder={t.placeholderAmount}
              error={errors.amount}
              disabled={saving}
            />
          </Field>
          <Field label={t.fieldNotes}>
            <Textarea
              rows={3}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t.placeholderNotes}
              disabled={saving}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={saving}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {editingRow ? t.saveChanges : t.addCredit}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t.removeTitle}
        description={t.removeDesc}
        confirmLabel={t.removeConfirm}
        loading={deleting}
      />
    </div>
  )
}
