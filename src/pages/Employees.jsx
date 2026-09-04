import { useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Plus, Pencil, UserX, UserCheck, Users, Phone, CalendarPlus, StickyNote, Wallet, Briefcase } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { ROLES, EMPLOYEES_TEXT } from '../i18n/employees.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { currentSalary } from '../utils/salary.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'

const emptyForm = {
  name: '',
  fatherName: '',
  role: ROLES[0],
  phone: '',
  joinDate: todayISO(),
  notes: '',
  monthlySalary: '',
}

export default function Employees() {
  const { employees, employeesLoading, employeesError, addEmployee, updateEmployee } = useData()
  const { language } = useLanguage()
  const t = EMPLOYEES_TEXT[language]
  const loading = employeesLoading

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const editingEmployee = employees.find((e) => e.id === editingId)

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(emp) {
    setEditingId(emp.id)
    setForm({
      name: emp.name,
      fatherName: emp.fatherName || '',
      role: emp.role,
      phone: emp.phone,
      joinDate: emp.joinDate,
      notes: emp.notes || '',
      monthlySalary: '',
    })
    setErrors({})
    setModalOpen(true)
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = t.errorNameRequired
    if (!form.phone.trim()) e.phone = t.errorPhoneRequired
    else if (!/^\d{10}$/.test(form.phone.trim())) e.phone = t.errorPhoneInvalid
    // Only required when adding — the API's starting_salary is create-only,
    // an edit's monthlySalary field is disabled/unused (see fieldMonthlySalary below).
    if (!editingId && !(Number(form.monthlySalary) > 0)) e.monthlySalary = t.errorSalaryRequired
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      if (editingId) {
        const { monthlySalary, ...rest } = form
        await updateEmployee(editingId, rest)
        toast.success(t.toastUpdated)
      } else {
        await addEmployee({ ...form, active: true })
        toast.success(t.toastAdded)
      }
      setModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  function openDeactivate(emp) {
    setDeactivateTarget(emp)
  }

  async function confirmDeactivate() {
    const emp = deactivateTarget
    try {
      await updateEmployee(emp.id, { active: false })
      toast.success(t.toastDeactivated(emp.name))
      setDeactivateTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    }
  }

  async function reactivate(emp) {
    try {
      await updateEmployee(emp.id, { active: true })
      toast.success(t.toastReactivated(emp.name))
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colEmployee,
      sortable: true,
      filter: true,
      style: { width: '26%' },
      body: (emp) => (
        <>
          <p className="font-medium text-slate-800">{emp.name}</p>
          {emp.fatherName ? (
            <p className="text-xs font-medium text-slate-500">
              {t.sonOf} {emp.fatherName}
            </p>
          ) : null}
          <p className="flex items-center gap-1 text-xs font-medium text-slate-400">
            <Briefcase size={11} /> {t.roleLabels[emp.role] || emp.role}
          </p>
        </>
      ),
    },
    {
      field: 'phone',
      header: t.colPhone,
      sortable: true,
      filter: true,
      style: { width: '13%' },
      body: (emp) => (
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          <Phone size={12} className="text-slate-400" /> {emp.phone}
        </span>
      ),
    },
    {
      field: 'joinDate',
      header: t.colJoined,
      sortable: true,
      style: { width: '12%' },
      body: (emp) => (
        <span className="flex items-center gap-1.5 font-medium text-slate-600">
          <CalendarPlus size={13} className="text-slate-400" /> {formatDate(emp.joinDate)}
        </span>
      ),
    },
    {
      field: 'monthlySalary',
      header: t.colMonthlySalary,
      sortable: true,
      style: { width: '12%' },
      body: (emp) => {
        const salary = currentSalary(emp)
        return <span className="font-medium text-slate-600">{salary ? formatCurrency(salary) : '—'}</span>
      },
    },
    {
      field: 'active',
      header: t.colActive,
      sortable: true,
      style: { width: '9%' },
      body: (emp) => (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
            emp.active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${emp.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {emp.active ? t.active : t.inactive}
        </span>
      ),
    },
    {
      field: 'notes',
      header: t.colInformation,
      style: { width: '18%' },
      body: (emp) =>
        emp.notes ? (
          <p title={emp.notes} className="flex max-w-[220px] items-start gap-1.5 text-xs font-medium text-slate-500">
            <StickyNote size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="truncate">{emp.notes.split('\n').slice(-1)[0]}</span>
          </p>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '10%' },
      body: (emp) => (
        <div className="flex justify-end gap-1">
          <IconButton onClick={() => openEdit(emp)} aria-label="Edit" title="Edit" tone="edit">
            <Pencil size={15} />
          </IconButton>
          {emp.active ? (
            <IconButton onClick={() => openDeactivate(emp)} aria-label="Deactivate" title="Deactivate" tone="delete">
              <UserX size={15} />
            </IconButton>
          ) : (
            <IconButton onClick={() => reactivate(emp)} aria-label="Activate" title="Activate" tone="success">
              <UserCheck size={15} />
            </IconButton>
          )}
        </div>
      ),
    },
  ]

  if (loading) {
    return <SkeletonTable rows={6} cols={6} />
  }

  if (employeesError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {employeesError}</div>
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {employees.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Users}
              title={t.emptyTitle}
              description={t.emptyDesc}
              action={
                <PrimaryButton onClick={openAdd}>
                  <Plus size={16} /> {t.addEmployee}
                </PrimaryButton>
              }
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={employees}
            rowKey="id"
            globalFilterFields={['name', 'phone', 'role', 'fatherName']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="name"
            scrollHeight="calc(100vh - 170px)"
            onRowClick={openEdit}
            exportFilename="employees"
            dense
            toolbarActions={
              <PrimaryButton onClick={openAdd} className="px-3.5 py-2 text-xs">
                <Plus size={14} /> {t.addEmployee}
              </PrimaryButton>
            }
          />
        )}
      </motion.div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? t.editEmployee : t.addEmployee}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.fieldFullName} required error={errors.name}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t.placeholderName} error={errors.name} />
            </Field>
            <Field label={t.fieldFatherName}>
              <Input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} placeholder={t.placeholderFatherName} />
            </Field>
            <Field label={t.fieldRole} required>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.roleLabels[r] || r}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.fieldPhone} required error={errors.phone}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                placeholder={t.placeholderPhone}
                inputMode="numeric"
                error={errors.phone}
              />
            </Field>
            <Field label={t.fieldJoiningDate}>
              <AppDatePicker value={form.joinDate} onChange={(joinDate) => setForm({ ...form, joinDate })} className="w-full" />
            </Field>
            {editingId ? (
              <Field label={t.fieldMonthlySalary}>
                <div className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                  <Wallet size={14} className="shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800">{formatCurrency(currentSalary(editingEmployee || {}))}</span>
                  <Link to="/salary" className="ml-auto text-xs font-semibold text-brand-600 hover:underline" onClick={() => setModalOpen(false)}>
                    {t.reviseSalaryLink}
                  </Link>
                </div>
              </Field>
            ) : (
              <Field label={t.fieldMonthlySalary} required error={errors.monthlySalary}>
                <Input
                  type="number"
                  min="0"
                  value={form.monthlySalary}
                  onChange={(e) => setForm({ ...form, monthlySalary: e.target.value })}
                  placeholder={t.placeholderMonthlySalary}
                  error={errors.monthlySalary}
                />
              </Field>
            )}
          </div>
          <Field label={t.fieldInformation}>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t.placeholderNotes}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {editingId ? t.saveChanges : t.addEmployee}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title={t.deactivateTitle}
        description={t.deactivateDesc(deactivateTarget?.name || '')}
        confirmLabel={t.deactivateConfirm}
      />
    </div>
  )
}
