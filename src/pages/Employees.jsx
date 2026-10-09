import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Plus, Pencil, UserX, UserCheck, Users, Phone, CalendarPlus, StickyNote, Wallet, Briefcase } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { ROLES, EMPLOYEES_TEXT } from '../i18n/employees.js'
import { COMMON_TEXT } from '../i18n/common.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { currentSalary } from '../utils/salary.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

const _EARLIEST_SANE_JOIN_DATE = '1970-01-01'

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
  const { employees, employeesLoading, employeesError, addEmployee, updateEmployee, currentUser } = useData()
  const { language } = useLanguage()
  const t = EMPLOYEES_TEXT[language]
  const commonT = COMMON_TEXT[language]
  const loading = employeesLoading
  // Add/edit/deactivate/reactivate all hit backend routes gated to
  // require_manager_or_admin (see employee_controller.py) — a staff user
  // saw every one of these controls fully enabled and only found out they
  // weren't allowed after the request came back 403.
  const isManagerOrAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager'

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState(null)
  const [deactivating, setDeactivating] = useState(false)
  // Which row's Activate is in flight — per-row rather than one flag, so
  // reactivating one employee doesn't visually gray out every other row too.
  const [activatingId, setActivatingId] = useState(null)
  const editingEmployee = employees.find((e) => e.id === editingId)

  // Plain-text mirrors of what each row visually shows, used only for CSV
  // export (via exportField below) — the body renderers stay JSX-only and
  // some combine several fields (name + father's name + role) or compute a
  // value (current salary) that a raw row field can't represent on its own.
  const exportRows = useMemo(
    () =>
      employees.map((emp) => {
        const salary = currentSalary(emp)
        return {
          ...emp,
          nameExport: [emp.name, emp.fatherName ? `${t.sonOf} ${emp.fatherName}` : '', t.roleLabels[emp.role] || emp.role]
            .filter(Boolean)
            .join(' - '),
          // Searched (not shown) — lets a search in Tamil find a role by its
          // Tamil label, since the raw `role` field is always the English
          // value underneath (see globalFilterFields below).
          roleLabel: t.roleLabels[emp.role] || emp.role,
          joinDateExport: formatDate(emp.joinDate),
          // A genuine numeric field for the column below to sort on — the
          // column used to sort on the bare `monthlySalary` field, which no
          // employee record actually has (the real figure only exists
          // derived, via currentSalary(emp)), so every click silently sorted
          // by `undefined` on every row and did nothing.
          monthlySalarySort: salary || 0,
          monthlySalaryExport: salary ? formatCurrency(salary) : '',
          activeExport: emp.active ? t.active : t.inactive,
        }
      }),
    [employees, t],
  )
  // One combined flag covering every kind of in-flight write this page can
  // make (add/edit, deactivate, reactivate) — while any of them is running,
  // every OTHER action on this screen is blocked too, so a manager can't fire
  // a second, possibly conflicting write (e.g. deactivating the same
  // employee they're mid-edit on) before the first one has actually landed.
  const busy = saving || deactivating || activatingId != null
  // Separate from `busy` (which drives the full-page loading overlay) — a
  // staff user should still be able to just VIEW this screen, only writes
  // need to be blocked for them.
  const writeBlocked = busy || !isManagerOrAdmin

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(emp) {
    setEditingId(emp.id)
    setForm({
      // .trim() here too, not just on save — a record saved before this fix
      // existed can already carry stray leading/trailing whitespace, and
      // reopening it to edit shouldn't keep echoing that back.
      name: emp.name.trim(),
      fatherName: (emp.fatherName || '').trim(),
      role: emp.role,
      phone: emp.phone,
      joinDate: emp.joinDate,
      notes: (emp.notes || '').trim(),
      monthlySalary: '',
    })
    setErrors({})
    setModalOpen(true)
  }

  function validate() {
    const e = {}
    const name = form.name.trim()
    const fatherName = form.fatherName.trim()
    const phone = form.phone.trim()
    if (!name) e.name = t.errorNameRequired
    // Required going forward — it's also half of the (name, father's name)
    // pair that's the real uniqueness key below, and now shown alongside
    // the name in every other screen's employee-picking dropdown (see
    // formatEmployeeName), so a blank one there defeats the whole point.
    if (!fatherName) e.fatherName = t.errorFatherNameRequired
    if (!phone) e.phone = t.errorPhoneRequired
    else if (!/^\d{10}$/.test(phone)) e.phone = t.errorPhoneInvalid
    // Only required when adding — the API's starting_salary is create-only,
    // an edit's monthlySalary field is disabled/unused (see fieldMonthlySalary below).
    if (!editingId && !(Number(form.monthlySalary) > 0)) e.monthlySalary = t.errorSalaryRequired

    // Same name + father's name is how two employees who happen to share a
    // first name (common in a small crew) get told apart — matching both,
    // case/whitespace-insensitively, is what actually means "this looks
    // like the same person already on record", not just a repeated first
    // name. Excludes the employee currently being edited from the check
    // against itself.
    if (name) {
      const duplicateName = employees.some(
        (emp) =>
          emp.id !== editingId &&
          emp.name.trim().toLowerCase() === name.toLowerCase() &&
          (emp.fatherName || '').trim().toLowerCase() === fatherName.toLowerCase(),
      )
      if (duplicateName) e.name = t.errorDuplicateName
    }
    // A phone number identifies one real person — two employee records
    // sharing one would make attendance/salary/credit lookups ambiguous.
    if (phone && !e.phone) {
      const duplicatePhone = employees.some((emp) => emp.id !== editingId && emp.phone.trim() === phone)
      if (duplicatePhone) e.phone = t.errorDuplicatePhone
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving || !validate()) return
    setSaving(true)
    // validate() above already checks the TRIMMED name/father's-name/phone
    // (for required/duplicate checks) but was never what actually got
    // saved — the raw, possibly space-padded form fields were. Trimmed here,
    // once, right before the save itself: typing a trailing space mid-word
    // while composing a name still works fine, only the final saved value
    // is cleaned up.
    const cleanedForm = { ...form, name: form.name.trim(), fatherName: form.fatherName.trim(), notes: form.notes.trim() }
    try {
      if (editingId) {
        const { monthlySalary, ...rest } = cleanedForm
        await updateEmployee(editingId, rest)
        toast.success(t.toastUpdated)
      } else {
        await addEmployee({ ...cleanedForm, active: true })
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
    if (deactivating) return
    const emp = deactivateTarget
    setDeactivating(true)
    try {
      await updateEmployee(emp.id, { active: false })
      toast.success(t.toastDeactivated(emp.name))
      setDeactivateTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeactivating(false)
    }
  }

  async function reactivate(emp) {
    if (activatingId != null) return
    setActivatingId(emp.id)
    try {
      await updateEmployee(emp.id, { active: true })
      toast.success(t.toastReactivated(emp.name))
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setActivatingId(null)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colEmployee,
      sortable: true,
      style: { width: '26%' },
      exportField: 'nameExport',
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
      exportField: 'joinDateExport',
      body: (emp) => (
        <span className="flex items-center gap-1.5 font-medium text-slate-600">
          <CalendarPlus size={13} className="text-slate-400" /> {formatDate(emp.joinDate)}
        </span>
      ),
    },
    {
      field: 'monthlySalarySort',
      header: t.colMonthlySalary,
      sortable: true,
      style: { width: '12%' },
      exportField: 'monthlySalaryExport',
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
      exportField: 'activeExport',
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
          <AppTooltip title={isManagerOrAdmin ? commonT.edit : t.staffOnlyHint}>
            <span>
              <IconButton onClick={() => openEdit(emp)} disabled={writeBlocked} aria-label={commonT.edit} tone="edit">
                <Pencil size={15} />
              </IconButton>
            </span>
          </AppTooltip>
          {emp.active ? (
            <AppTooltip title={isManagerOrAdmin ? t.deactivateConfirm : t.staffOnlyHint}>
              <span>
                <IconButton onClick={() => openDeactivate(emp)} disabled={writeBlocked} aria-label={t.deactivateConfirm} tone="delete">
                  <UserX size={15} />
                </IconButton>
              </span>
            </AppTooltip>
          ) : (
            <AppTooltip title={isManagerOrAdmin ? (activatingId === emp.id ? t.activating : t.activateAction) : t.staffOnlyHint}>
              <span>
                <IconButton onClick={() => reactivate(emp)} disabled={writeBlocked} aria-label={t.activateAction} tone="success">
                  <UserCheck size={15} />
                </IconButton>
              </span>
            </AppTooltip>
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

  const busyLabel = saving ? t.saving : deactivating ? `${t.deactivateConfirm}…` : activatingId != null ? t.activating : ''

  return (
    // flex h-full so the card below can flex-fill the exact height `main`
    // has available (see Layout.jsx's lg:h-full) — the table's own
    // `fillHeight` then stretches to whatever's left after the toolbar row,
    // instead of a hand-guessed `calc(100vh - Npx)` that has to be re-tuned
    // by hand and still drifts across browsers/zoom.
    <div className="flex h-full min-h-0 flex-col gap-6">
      {busy ? <FullPageLoader label={busyLabel} /> : null}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {employees.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Users}
              title={t.emptyTitle}
              description={t.emptyDesc}
              action={
                <AppTooltip title={isManagerOrAdmin ? '' : t.staffOnlyHint}>
                  <span>
                    <PrimaryButton onClick={openAdd} disabled={writeBlocked}>
                      <Plus size={16} /> {t.addEmployee}
                    </PrimaryButton>
                  </span>
                </AppTooltip>
              }
            />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={exportRows}
            rowKey="id"
            globalFilterFields={['name', 'phone', 'role', 'roleLabel', 'fatherName', 'joinDateExport', 'monthlySalarySort', 'activeExport', 'notes']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="name"
            fillHeight
            onRowClick={busy ? undefined : openEdit}
            exportFilename="employees"
            dense
            toolbarActions={
              <AppTooltip title={isManagerOrAdmin ? '' : t.staffOnlyHint}>
                <span>
                  <PrimaryButton onClick={openAdd} disabled={writeBlocked} className="px-3.5 py-2 text-xs">
                    <Plus size={14} /> {t.addEmployee}
                  </PrimaryButton>
                </span>
              </AppTooltip>
            }
          />
        )}
      </motion.div>

      <Modal
        isOpen={modalOpen}
        onClose={saving ? () => {} : () => setModalOpen(false)}
        title={editingId ? t.editEmployee : t.addEmployee}
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.fieldFullName} required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t.placeholderName}
                error={errors.name}
                disabled={saving || !isManagerOrAdmin}
              />
            </Field>
            <Field label={t.fieldFatherName} required error={errors.fatherName}>
              <Input
                value={form.fatherName}
                onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                placeholder={t.placeholderFatherName}
                error={errors.fatherName}
                disabled={saving || !isManagerOrAdmin}
              />
            </Field>
            <Field label={t.fieldRole} required>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} disabled={saving || !isManagerOrAdmin}>
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
                disabled={saving || !isManagerOrAdmin}
              />
            </Field>
            <Field label={t.fieldJoiningDate}>
              <AppDatePicker
                value={form.joinDate}
                onChange={(joinDate) => setForm({ ...form, joinDate })}
                className="w-full"
                disabled={saving || !isManagerOrAdmin}
                minDate={_EARLIEST_SANE_JOIN_DATE}
                maxDate={todayISO()}
              />
            </Field>
            {editingId ? (
              <Field label={t.fieldMonthlySalary}>
                <div className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                  <Wallet size={14} className="shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800">{formatCurrency(currentSalary(editingEmployee || {}))}</span>
                  <Link
                    to="/salary"
                    className={`ml-auto text-xs font-semibold text-brand-600 hover:underline ${saving ? 'pointer-events-none opacity-50' : ''}`}
                    onClick={() => setModalOpen(false)}
                  >
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
                  disabled={saving || !isManagerOrAdmin}
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
              disabled={saving || !isManagerOrAdmin}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={saving}>
              {t.cancel}
            </SecondaryButton>
            <AppTooltip title={isManagerOrAdmin ? '' : t.staffOnlyHint}>
              <span>
                <PrimaryButton type="submit" disabled={saving || !isManagerOrAdmin}>
                  {editingId ? t.saveChanges : t.addEmployee}
                </PrimaryButton>
              </span>
            </AppTooltip>
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
        loading={deactivating}
      />
    </div>
  )
}
