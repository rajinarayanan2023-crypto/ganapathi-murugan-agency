import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Wallet, ReceiptText, BadgeIndianRupee, Upload, Paperclip, X, StickyNote } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { CREDIT_BILLS_TEXT } from '../i18n/creditBills.js'
import { closingBalance, closingBalanceBreakdown } from '../data/mockData.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { uploadBillFile, getDownloadUrl, deleteUpload } from '../lib/apiClient.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import { CallIcon, WhatsAppIcon, openWhatsAppChat } from '../components/BrandIcons.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import CalcBreakdown from '../components/CalcBreakdown.jsx'

const customerEmptyForm = { name: '', phone: '', openingBalance: 0, notes: '' }
const creditEmptyForm = { fuelType: 'Diesel', ltr: '', rate: '100.45' }
const paymentEmptyForm = { amount: '', mode: 'Cash' }

function makeId() {
  return `b-${Math.random().toString(36).slice(2, 9)}`
}

async function downloadFileFromUrl(url, filename) {
  const res = await fetch(url)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

// WhatsApp's wa.me click-to-chat link only ever supports pre-filled text —
// there's no URL-based way to attach a file to it, and window.open() only
// counts as gesture-backed (so it isn't silently popup-blocked) if it fires
// as the very first thing inside the click handler. Triggering the bill's
// download first — even a synthetic <a download> click — consumes that same
// gesture, so a window.open() right after it gets blocked with no visible
// error. Opening WhatsApp first, then downloading the bill, keeps both
// working. `key` is the S3 key — resolved to a real (short-lived) URL right
// here, at send-time, never ahead of it.
async function sendBillFileThenOpenWhatsApp(phone, message, key, fileName) {
  openWhatsAppChat(phone, message)
  if (!key) return
  try {
    const url = await getDownloadUrl(key)
    await downloadFileFromUrl(url, fileName)
  } catch {
    // Best-effort — WhatsApp itself already opened either way.
  }
}

export default function CreditBills() {
  const {
    creditCustomers,
    creditCustomersLoading,
    creditCustomersError,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    addLedgerEntry,
    removeLedgerEntry,
    fuelRates,
    station,
  } = useData()
  const { language } = useLanguage()
  const t = CREDIT_BILLS_TEXT[language]
  const loading = creditCustomersLoading

  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [editingCustomerId, setEditingCustomerId] = useState(null)
  const [customerForm, setCustomerForm] = useState(customerEmptyForm)
  const [errors, setErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [uploadingCustomerBills, setUploadingCustomerBills] = useState(false)

  const [ledgerCustomerId, setLedgerCustomerId] = useState(null)
  // Only entries added manually (here, or from the Audit modal's "Customer
  // Credit Paid") are ever removable — a credit line created from a real
  // fuel-entry payment (tx.sourceFuelEntryId set) stays tied to that entry;
  // deleting the fuel entry itself is what cleans that one up.
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(null)
  const [creditForm, setCreditForm] = useState(creditEmptyForm)
  const [paymentForm, setPaymentForm] = useState(paymentEmptyForm)
  const [creditBillFile, setCreditBillFile] = useState(null)
  const [uploadingCreditBill, setUploadingCreditBill] = useState(false)
  const [savingCredit, setSavingCredit] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [customerBillFiles, setCustomerBillFiles] = useState([])
  const [billPickerCustomerId, setBillPickerCustomerId] = useState(null)

  const rows = useMemo(() => creditCustomers.map((c) => ({ ...c, balance: closingBalance(c) })), [creditCustomers])

  const billPickerCustomer = useMemo(
    () => (billPickerCustomerId ? rows.find((c) => c.id === billPickerCustomerId) : null),
    [billPickerCustomerId, rows],
  )

  const ledgerCustomer = useMemo(
    () => (ledgerCustomerId ? creditCustomers.find((c) => c.id === ledgerCustomerId) : null),
    [ledgerCustomerId, creditCustomers],
  )
  // Not memoized separately from ledgerCustomer above — recomputed on every
  // render straight from its live ledger, so the balance tooltip can never
  // show a stale number after a credit/payment was just added or removed.
  const balanceBreakdown = ledgerCustomer ? closingBalanceBreakdown(ledgerCustomer) : null

  function openAddCustomer() {
    setEditingCustomerId(null)
    setCustomerForm(customerEmptyForm)
    setErrors({})
    setCustomerBillFiles([])
    setCustomerModalOpen(true)
  }

  function openEditCustomer(c) {
    setEditingCustomerId(c.id)
    setCustomerForm({ name: c.name, phone: c.phone, openingBalance: c.openingBalance, notes: c.notes || '' })
    setErrors({})
    setCustomerBillFiles([])
    setCustomerModalOpen(true)
  }

  async function uploadAsBill(file) {
    const { name, key } = await uploadBillFile(file, 'credit-customer-bills')
    return { id: makeId(), name, url: key, date: todayISO() }
  }

  async function handleCustomerBillFilesChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploadingCustomerBills(true)
    try {
      const uploaded = await Promise.all(files.map(uploadAsBill))
      setCustomerBillFiles((prev) => [...prev, ...uploaded])
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setUploadingCustomerBills(false)
    }
  }

  // Staged in this modal only — the customer isn't created/updated until
  // the form submits, so nothing has told the backend this bill exists yet.
  // Deleting the S3 object directly here (rather than waiting on a save
  // that might not come) is what keeps a picked-then-unpicked file from
  // leaking in the bucket forever with no DB row to ever clean it up from.
  async function removeCustomerBillFile(id) {
    const file = customerBillFiles.find((f) => f.id === id)
    setCustomerBillFiles((prev) => prev.filter((f) => f.id !== id))
    if (file?.url) {
      try {
        await deleteUpload(file.url)
      } catch {
        // Best-effort — an orphaned object here has no DB reference that
        // could ever surface it again, but it isn't worth failing over.
      }
    }
  }

  function validateCustomer() {
    const e = {}
    if (!customerForm.name.trim()) e.name = t.errorNameRequired
    if (!customerForm.phone.trim()) e.phone = t.errorPhoneRequired
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleCustomerSubmit(ev) {
    ev.preventDefault()
    if (!validateCustomer()) return
    const payload = {
      name: customerForm.name,
      phone: customerForm.phone,
      openingBalance: Number(customerForm.openingBalance) || 0,
      notes: customerForm.notes,
    }
    const newBills = customerBillFiles.map((f) => ({ id: f.id, name: f.name, url: f.url, date: f.date }))
    setSavingCustomer(true)
    try {
      if (editingCustomerId) {
        const existing = creditCustomers.find((c) => c.id === editingCustomerId)
        if (newBills.length) payload.bills = [...(existing?.bills || []), ...newBills]
        await updateCustomer(editingCustomerId, payload)
        toast.success(t.toastCustomerUpdated)
      } else {
        await addCustomer({ ...payload, ledger: [], bills: newBills })
        toast.success(newBills.length ? t.toastCustomerAddedWithBill(newBills.length) : t.toastCustomerAdded)
      }
      setCustomerBillFiles([])
      setCustomerModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingCustomer(false)
    }
  }

  async function handleDeleteCustomer(id) {
    try {
      await deleteCustomer(id)
      toast.success(t.toastCustomerRemoved)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    }
  }

  function sendReminder(name) {
    toast.success(t.toastReminderSent(name))
  }

  // No bill attached — a plain balance reminder. Used when the customer has
  // no bills on file, or when they explicitly skip picking one in the modal.
  function sendPlainReminderWhatsApp(c) {
    const message = `Hi ${c.name}, this is a reminder from ${station.name} that you have an outstanding balance of ${formatCurrency(c.balance)}. Kindly clear it at your earliest convenience. Thank you!`
    openWhatsAppChat(c.phone, message)
    toast.success(t.toastReminderSent(c.name))
  }

  // Presigned GET URLs expire, so one is fetched fresh right when the
  // manager actually clicks to view a bill — never pre-fetched for a whole
  // list up front. `key` is the S3 key stored on the bill/ledger row.
  async function openBill(key) {
    try {
      const url = await getDownloadUrl(key)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    }
  }

  function sendBillWhatsApp(c, bill) {
    const message = `Hi ${c.name}, sharing your bill "${bill.name}" dated ${formatDate(bill.date)} from ${station.name}. Your outstanding balance is ${formatCurrency(closingBalance(c))}. Kindly clear it at your earliest convenience. Thank you!`
    sendBillFileThenOpenWhatsApp(c.phone, message, bill.url, bill.name)
    toast.success(t.toastBillDownloadedForWhatsApp(c.name))
  }

  // The quick WhatsApp action always lets the manager pick which bill (if
  // any) to send, rather than guessing — only skips straight to a plain
  // reminder when there's nothing on file to choose from.
  function openBillPicker(c) {
    if (!c.bills?.length) {
      sendPlainReminderWhatsApp(c)
      return
    }
    setBillPickerCustomerId(c.id)
  }

  function pickBillToSend(bill) {
    if (!billPickerCustomer) return
    sendBillWhatsApp(billPickerCustomer, bill)
    setBillPickerCustomerId(null)
  }

  function pickNoBill() {
    if (!billPickerCustomer) return
    sendPlainReminderWhatsApp(billPickerCustomer)
    setBillPickerCustomerId(null)
  }

  function openLedger(id) {
    setLedgerCustomerId(id)
    setCreditForm({ fuelType: 'Diesel', ltr: '', rate: String(fuelRates.diesel) })
    setPaymentForm(paymentEmptyForm)
    setCreditBillFile(null)
  }

  async function handleBillFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) {
      setCreditBillFile(null)
      return
    }
    setUploadingCreditBill(true)
    try {
      const { name, key } = await uploadBillFile(file, 'credit-customer-bills')
      setCreditBillFile({ name, url: key })
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setUploadingCreditBill(false)
    }
  }

  // Staged for the credit line being filled in — not attached to anything
  // in the database until the form submits, so clearing it here has to
  // clean up the S3 object directly (same reasoning as removeCustomerBillFile).
  async function removeStagedCreditBill() {
    const file = creditBillFile
    setCreditBillFile(null)
    if (file?.url) {
      try {
        await deleteUpload(file.url)
      } catch {
        // Best-effort, see removeCustomerBillFile.
      }
    }
  }

  async function handleUploadCustomerBills(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !ledgerCustomer) return
    setUploadingCustomerBills(true)
    try {
      const newBills = await Promise.all(files.map(uploadAsBill))
      await updateCustomer(ledgerCustomer.id, { bills: [...(ledgerCustomer.bills || []), ...newBills] })
      toast.success(newBills.length > 1 ? t.billsUploaded(newBills.length) : t.toastBillUploaded)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setUploadingCustomerBills(false)
    }
  }

  // Unlike removeCustomerBillFile/removeStagedCreditBill above, this bill is
  // already saved — updateCustomer sends the trimmed list straight to the
  // backend, whose own diff (see CreditCustomerService._bills_from) is what
  // deletes the S3 object. Calling deleteUpload here too would just be a
  // second, redundant delete of the same key.
  async function handleRemoveCustomerBill(billId) {
    if (!ledgerCustomer) return
    try {
      await updateCustomer(ledgerCustomer.id, { bills: (ledgerCustomer.bills || []).filter((b) => b.id !== billId) })
      toast.success(t.toastBillRemoved)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    }
  }

  async function handleAddCredit(ev) {
    ev.preventDefault()
    const ltr = Number(creditForm.ltr)
    const rate = Number(creditForm.rate)
    if (!ltr || !rate) {
      toast.error(t.errorQtyRate)
      return
    }
    setSavingCredit(true)
    try {
      await addLedgerEntry(ledgerCustomerId, {
        date: todayISO(),
        type: 'credit',
        fuelType: creditForm.fuelType,
        ltr,
        rate,
        amount: Math.round(ltr * rate * 100) / 100,
        mode: null,
        billUrl: creditBillFile?.url || null,
        billName: creditBillFile?.name || null,
      })
      toast.success(creditBillFile ? t.toastCreditWithBill : t.toastCreditRecorded)
      setCreditForm({ fuelType: creditForm.fuelType, ltr: '', rate: creditForm.rate })
      setCreditBillFile(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingCredit(false)
    }
  }

  async function handleAddPayment(ev) {
    ev.preventDefault()
    const amount = Number(paymentForm.amount)
    if (!amount) {
      toast.error(t.errorAmount)
      return
    }
    setSavingPayment(true)
    try {
      await addLedgerEntry(ledgerCustomerId, {
        date: todayISO(),
        type: 'payment',
        fuelType: null,
        ltr: null,
        rate: null,
        amount,
        mode: paymentForm.mode,
      })
      toast.success(t.toastPaymentRecorded)
      setPaymentForm({ amount: '', mode: paymentForm.mode })
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingPayment(false)
    }
  }

  async function handleRemoveLedgerEntry() {
    if (!confirmDeleteTx) return
    try {
      await removeLedgerEntry(confirmDeleteTx.customerId, confirmDeleteTx.entryId)
      toast.success(t.toastTransactionRemoved)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setConfirmDeleteTx(null)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colCustomer,
      sortable: true,
      filter: true,
      style: { width: '26%' },
      body: (c) => (
        <>
          <button onClick={() => openLedger(c.id)} className="text-left font-medium text-slate-800 hover:text-brand-700">
            {c.name}
          </button>
          <p className="text-xs font-medium text-slate-400">{c.phone}</p>
        </>
      ),
    },
    {
      field: 'openingBalance',
      header: t.colOpeningBalance,
      sortable: true,
      style: { width: '16%' },
      body: (c) => <span className="font-medium text-slate-600">{formatCurrency(c.openingBalance)}</span>,
    },
    {
      field: 'balance',
      header: t.colClosingBalance,
      sortable: true,
      style: { width: '16%' },
      body: (c) => (
        <span className={`font-semibold ${c.balance > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{formatCurrency(c.balance)}</span>
      ),
    },
    {
      field: 'bills',
      header: t.colBills,
      align: 'center',
      style: { width: '10%' },
      body: (c) =>
        c.bills?.length > 0 ? (
          <button
            onClick={() => openLedger(c.id)}
            title={t.billsUploaded(c.bills.length)}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
          >
            <Paperclip size={12} /> {c.bills.length}
          </button>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      field: 'notes',
      header: t.colInformation,
      style: { width: '15%' },
      body: (c) =>
        c.notes ? (
          <p title={c.notes} className="flex max-w-[200px] items-start gap-1.5 text-xs font-medium text-slate-500">
            <StickyNote size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="truncate">{c.notes}</span>
          </p>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        ),
    },
    {
      header: t.colActions,
      align: 'right',
      style: { width: '17%' },
      body: (c) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton onClick={() => openLedger(c.id)} aria-label="View ledger" title="View ledger" tone="info">
            <ReceiptText size={15} />
          </IconButton>
          <AppTooltip title={t.tooltipPhone}>
            <motion.button
              type="button"
              onClick={() => sendReminder(c.name)}
              aria-label="Send reminder"
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
              className="inline-flex items-center justify-center rounded-lg p-1"
            >
              <CallIcon size={24} />
            </motion.button>
          </AppTooltip>
          <AppTooltip title={t.tooltipWhatsApp}>
            <motion.button
              type="button"
              onClick={() => openBillPicker(c)}
              aria-label={t.tooltipWhatsApp}
              whileHover={{ scale: 1.15, rotate: [0, -8, 8, -4, 0] }}
              whileTap={{ scale: 0.9 }}
              transition={{ duration: 0.4 }}
              className="inline-flex items-center justify-center rounded-lg p-1"
            >
              <WhatsAppIcon size={24} />
            </motion.button>
          </AppTooltip>
          <IconButton onClick={() => openEditCustomer(c)} aria-label="Edit" title="Edit" tone="edit">
            <Pencil size={15} />
          </IconButton>
          <IconButton onClick={() => setConfirmDeleteId(c.id)} aria-label="Delete" title="Delete" tone="delete">
            <Trash2 size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  if (loading) {
    return <SkeletonTable rows={7} cols={5} />
  }

  if (creditCustomersError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {creditCustomersError}</div>
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Wallet} title={t.emptyTitle} description={t.emptyDesc} />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            rowKey="id"
            globalFilterFields={['name', 'phone']}
            searchPlaceholder={t.searchPlaceholder}
            defaultSortField="balance"
            defaultSortOrder={-1}
            scrollHeight="calc(100vh - 170px)"
            exportFilename="credit-customers"
            dense
            toolbarActions={
              <PrimaryButton onClick={openAddCustomer} className="px-3.5 py-2 text-xs">
                <Plus size={14} /> {t.addCustomer}
              </PrimaryButton>
            }
          />
        )}
      </motion.div>

      {/* Add / Edit customer */}
      <Modal isOpen={customerModalOpen} onClose={() => setCustomerModalOpen(false)} title={editingCustomerId ? t.editCustomer : t.addCustomer}>
        <form onSubmit={handleCustomerSubmit} className="space-y-4">
          <Field label={t.fieldCustomerName} required error={errors.name}>
            <Input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })} placeholder={t.placeholderCustomerName} error={errors.name} />
          </Field>
          <Field label={t.fieldPhone} required error={errors.phone}>
            <Input
              value={customerForm.phone}
              onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder={t.placeholderPhone}
              inputMode="numeric"
              error={errors.phone}
            />
          </Field>
          <Field label={t.fieldOpeningBalance}>
            <Input type="number" min="0" value={customerForm.openingBalance} onChange={(e) => setCustomerForm({ ...customerForm, openingBalance: e.target.value })} />
          </Field>
          <Field label={t.fieldAdditionalInfo}>
            <Textarea
              rows={3}
              value={customerForm.notes}
              onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
              placeholder={t.placeholderNotes}
            />
          </Field>
          <Field label={t.fieldUploadBill}>
            <div className="space-y-1.5">
              {customerBillFiles.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-brand-700">
                    <Paperclip size={13} className="shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <AppTooltip title={t.removeAttachment}>
                    <button
                      type="button"
                      onClick={() => removeCustomerBillFile(f.id)}
                      className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-500"
                      aria-label={t.removeAttachment}
                    >
                      <X size={13} />
                    </button>
                  </AppTooltip>
                </div>
              ))}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                <Upload size={14} />
                {t.uploadBillPrompt}
                <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleCustomerBillFilesChange} />
              </label>
            </div>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setCustomerModalOpen(false)}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={savingCustomer || uploadingCustomerBills}>
              {editingCustomerId ? t.saveChanges : t.addCustomer}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* Ledger detail */}
      <Modal isOpen={!!ledgerCustomerId} onClose={() => setLedgerCustomerId(null)} title={ledgerCustomer?.name || ''} maxWidth="max-w-2xl">
        {ledgerCustomer ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
              <div>
                <p className="text-xs text-slate-500">{t.colOpeningBalance}</p>
                <p className="text-sm font-semibold text-slate-700">{formatCurrency(ledgerCustomer.openingBalance)}</p>
              </div>
              <div className="text-right">
                <AppTooltip
                  title={
                    <CalcBreakdown
                      rows={[
                        { label: t.colOpeningBalance, value: formatCurrency(balanceBreakdown.openingBalance) },
                        { label: t.credit, value: `+ ${formatCurrency(balanceBreakdown.totalCredit)}` },
                        { label: t.payment, value: `− ${formatCurrency(balanceBreakdown.totalPayments)}` },
                      ]}
                      formula={`${formatCurrency(balanceBreakdown.openingBalance)} + ${formatCurrency(balanceBreakdown.totalCredit)} − ${formatCurrency(balanceBreakdown.totalPayments)} = ${t.colClosingBalance} (${formatCurrency(balanceBreakdown.balance)})`}
                    />
                  }
                >
                  <p className="cursor-help text-xs text-slate-500 underline decoration-dotted decoration-slate-300 underline-offset-4">{t.colClosingBalance}</p>
                </AppTooltip>
                <p className={`text-lg font-bold ${closingBalance(ledgerCustomer) > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                  {formatCurrency(closingBalance(ledgerCustomer))}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.billsAndDocuments}</h4>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">
                  <Upload size={13} /> {t.uploadBill}
                  <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleUploadCustomerBills} />
                </label>
              </div>
              {ledgerCustomer.bills?.length > 0 ? (
                <ul className="space-y-1.5">
                  {[...ledgerCustomer.bills].reverse().map((bill) => (
                    <li
                      key={bill.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => openBill(bill.url)}
                        className="flex min-w-0 items-center gap-1.5 text-slate-700 hover:text-brand-700"
                      >
                        <Paperclip size={13} className="shrink-0 text-slate-400" />
                        <span className="truncate">{bill.name}</span>
                        <span className="shrink-0 text-slate-400">&middot; {formatDate(bill.date)}</span>
                      </button>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <AppTooltip title={t.tooltipWhatsApp}>
                          <button
                            onClick={() => sendBillWhatsApp(ledgerCustomer, bill)}
                            className="rounded p-1 text-slate-400 hover:bg-white hover:text-emerald-600"
                            aria-label={t.sendBillWhatsApp}
                          >
                            <WhatsAppIcon size={15} />
                          </button>
                        </AppTooltip>
                        <AppTooltip title={t.removeBill}>
                          <button
                            onClick={() => handleRemoveCustomerBill(bill.id)}
                            className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-500"
                            aria-label={t.removeBill}
                          >
                            <X size={13} />
                          </button>
                        </AppTooltip>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">
                  {t.noBillsYet}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <form onSubmit={handleAddCredit} className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{t.recordCredit}</h4>
                <div className="space-y-3">
                  <Field label={t.fieldFuelType}>
                    <Select
                      value={creditForm.fuelType}
                      onChange={(e) => {
                        const fuelType = e.target.value
                        const rate = fuelType === 'Petrol' ? fuelRates.petrol : fuelRates.diesel
                        setCreditForm({ ...creditForm, fuelType, rate: String(rate) })
                      }}
                    >
                      <option value="Diesel">{t.fuelTypeLabel.Diesel}</option>
                      <option value="Petrol">{t.fuelTypeLabel.Petrol}</option>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t.fieldLtr}>
                      <Input type="number" min="0" value={creditForm.ltr} onChange={(e) => setCreditForm({ ...creditForm, ltr: e.target.value })} placeholder="0" />
                    </Field>
                    <Field label={t.fieldRate}>
                      <Input type="number" min="0" value={creditForm.rate} onChange={(e) => setCreditForm({ ...creditForm, rate: e.target.value })} />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">
                    {t.amountLabel}{' '}
                    <span className="font-semibold text-slate-700">
                      {formatCurrency((Number(creditForm.ltr) || 0) * (Number(creditForm.rate) || 0))}
                    </span>
                  </p>

                  <Field label={t.fieldUploadBill}>
                    {creditBillFile ? (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs">
                        <span className="flex min-w-0 items-center gap-1.5 text-brand-700">
                          <Paperclip size={13} className="shrink-0" />
                          <span className="truncate">{creditBillFile.name}</span>
                        </span>
                        <AppTooltip title={t.removeAttachment}>
                          <button
                            type="button"
                            onClick={removeStagedCreditBill}
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-500"
                            aria-label={t.removeAttachment}
                          >
                            <X size={13} />
                          </button>
                        </AppTooltip>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                        <Upload size={14} />
                        {t.uploadBillPrompt}
                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleBillFileChange} />
                      </label>
                    )}
                  </Field>

                  <PrimaryButton type="submit" className="w-full" disabled={savingCredit || uploadingCreditBill}>
                    {t.addCredit}
                  </PrimaryButton>
                </div>
              </form>

              <form onSubmit={handleAddPayment} className="rounded-xl border border-slate-200 p-4">
                <h4 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <BadgeIndianRupee size={13} /> {t.recordPayment}
                </h4>
                <div className="space-y-3">
                  <Field label={t.fieldAmount}>
                    <Input type="number" min="0" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder="0" />
                  </Field>
                  <Field label={t.fieldMode}>
                    <Select value={paymentForm.mode} onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value })}>
                      <option value="Cash">{t.modeLabel.Cash}</option>
                      <option value="Card">{t.modeLabel.Card}</option>
                      <option value="Online">{t.modeLabel.Online}</option>
                    </Select>
                  </Field>
                  <PrimaryButton type="submit" className="w-full" disabled={savingPayment}>
                    {t.recordPaymentBtn}
                  </PrimaryButton>
                </div>
              </form>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.transactionHistory}</h4>
              {ledgerCustomer.ledger.length === 0 ? (
                <EmptyState icon={ReceiptText} title={t.noTransactionsTitle} description={t.noTransactionsDesc} />
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-slate-400">
                        <th className="px-3 py-2 font-semibold">{t.thDate}</th>
                        <th className="px-3 py-2 font-semibold">{t.thType}</th>
                        <th className="px-3 py-2 font-semibold">{t.thDetails}</th>
                        <th className="px-3 py-2 font-semibold">{t.thReason}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t.thAmount}</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...ledgerCustomer.ledger].reverse().map((tx) => (
                        <tr key={tx.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-600">{formatDate(tx.date)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${tx.type === 'credit' ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-600'}`}>
                              {tx.type === 'credit' ? t.credit : t.payment}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            <span>
                              {tx.type === 'credit'
                                ? tx.ltr != null && tx.rate != null
                                  ? `${t.fuelTypeLabel[tx.fuelType] || tx.fuelType} · ${tx.ltr} L @ ${tx.rate}`
                                  : t.fromFuelEntry
                                : t.modeLabel[tx.mode] || tx.mode}
                            </span>
                            {tx.billUrl ? (
                              <button
                                type="button"
                                onClick={() => openBill(tx.billUrl)}
                                title={tx.billName || t.viewAttachedBill}
                                className="ml-1.5 inline-flex items-center gap-0.5 text-brand-600 hover:underline"
                              >
                                <Paperclip size={11} /> {t.view}
                              </button>
                            ) : null}
                          </td>
                          <td className="max-w-[180px] px-3 py-2 text-slate-500">
                            <span className="block truncate" title={tx.note || undefined}>
                              {tx.note || '—'}
                            </span>
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold ${tx.type === 'credit' ? 'text-rose-500' : 'text-emerald-600'}`}>
                            {tx.type === 'credit' ? '+' : '−'} {formatCurrency(tx.amount)}
                          </td>
                          <td className="px-3 py-2">
                            {!tx.sourceFuelEntryId ? (
                              <AppTooltip title={t.removeTransaction}>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTx({ customerId: ledgerCustomer.id, entryId: tx.id })}
                                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                                  aria-label={t.removeTransaction}
                                >
                                  <X size={13} />
                                </button>
                              </AppTooltip>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Pick which bill to send before opening WhatsApp */}
      <Modal
        isOpen={!!billPickerCustomerId}
        onClose={() => setBillPickerCustomerId(null)}
        title={billPickerCustomer ? t.selectBillTitle(billPickerCustomer.name) : ''}
      >
        {billPickerCustomer ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">{t.selectBillPrompt}</p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {[...billPickerCustomer.bills].reverse().map((bill) => (
                <li key={bill.id}>
                  <button
                    type="button"
                    onClick={() => pickBillToSend(bill)}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left text-xs transition-colors hover:border-emerald-300 hover:bg-emerald-50"
                  >
                    <Paperclip size={13} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{bill.name}</span>
                    <span className="shrink-0 text-slate-400">{formatDate(bill.date)}</span>
                    <WhatsAppIcon size={16} className="shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <SecondaryButton type="button" onClick={() => setBillPickerCustomerId(null)}>
                {t.cancel}
              </SecondaryButton>
              <SecondaryButton type="button" onClick={pickNoBill}>
                {t.sendReminderOnly}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => handleDeleteCustomer(confirmDeleteId)}
        title={t.removeCustomerTitle}
        description={t.removeCustomerDesc}
      />

      <ConfirmDialog
        isOpen={!!confirmDeleteTx}
        onClose={() => setConfirmDeleteTx(null)}
        onConfirm={handleRemoveLedgerEntry}
        title={t.removeTransactionTitle}
        description={t.removeTransactionDesc}
      />
    </div>
  )
}
