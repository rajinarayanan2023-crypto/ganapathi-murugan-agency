import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Wallet, ReceiptText, BadgeIndianRupee, Upload, Paperclip, X, StickyNote, ChevronUp, ChevronDown } from 'lucide-react'
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
import { WhatsAppIcon, openWhatsAppChat } from '../components/BrandIcons.jsx'
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
    updateLedgerEntryBill,
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
  // Uploading (or clearing) a bill directly against one Transaction History
  // row — id of whichever entry has a request in flight, so only that row's
  // control shows a busy state.
  const [uploadingTxBillId, setUploadingTxBillId] = useState(null)
  const [txSort, setTxSort] = useState({ field: 'date', dir: 'desc' })

  const rows = useMemo(
    () => creditCustomers.map((c) => ({ ...c, balance: closingBalance(c), billsCount: (c.bills?.length || 0) + (c.ledger || []).filter((e) => e.billUrl).length })),
    [creditCustomers],
  )

  const ledgerCustomer = useMemo(
    () => (ledgerCustomerId ? creditCustomers.find((c) => c.id === ledgerCustomerId) : null),
    [ledgerCustomerId, creditCustomers],
  )
  // Not memoized separately from ledgerCustomer above — recomputed on every
  // render straight from its live ledger, so the balance tooltip can never
  // show a stale number after a credit/payment was just added or removed.
  const balanceBreakdown = ledgerCustomer ? closingBalanceBreakdown(ledgerCustomer) : null

  // Sortable by Date/Type/Amount (clicking the same header again flips
  // direction) — defaults to newest-first, same order the table always
  // showed before this existed (a plain .reverse() of insertion order).
  const sortedLedger = useMemo(() => {
    const list = [...(ledgerCustomer?.ledger || [])]
    const { field, dir } = txSort
    const sign = dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      const av = a[field]
      const bv = b[field]
      if (av < bv) return -1 * sign
      if (av > bv) return 1 * sign
      return 0
    })
    return list
  }, [ledgerCustomer, txSort])

  function toggleTxSort(field) {
    setTxSort((prev) => (prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'date' ? 'desc' : 'asc' }))
  }

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

  // One WhatsApp reminder per transaction row — references that specific
  // entry (and sends its bill along, if one's attached by now) rather than
  // a generic customer-level reminder, since the whole point of attaching
  // bills per-row is that different entries can be at different stages.
  function sendTransactionReminder(c, tx) {
    const detail =
      tx.type === 'credit'
        ? `a credit of ${formatCurrency(tx.amount)} recorded on ${formatDate(tx.date)}${tx.note ? ` (${tx.note})` : ''}`
        : `a payment of ${formatCurrency(tx.amount)} recorded on ${formatDate(tx.date)}`
    const message = `Hi ${c.name}, this is a reminder from ${station.name} regarding ${detail}. Your outstanding balance is ${formatCurrency(closingBalance(c))}. Kindly clear it at your earliest convenience. Thank you!`
    if (tx.billUrl) {
      sendBillFileThenOpenWhatsApp(c.phone, message, tx.billUrl, tx.billName || 'bill')
      toast.success(t.toastBillDownloadedForWhatsApp(c.name))
    } else {
      openWhatsAppChat(c.phone, message)
      toast.success(t.toastReminderSent(c.name))
    }
  }

  // Attaches a bill straight to one already-recorded transaction — this is
  // the intended path for a credit that came in through the Fuel Entry
  // screen (amount + reason only there, no bill upload) as well as one
  // recorded here without the physical bill at hand yet.
  async function handleTxBillUpload(e, tx) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !ledgerCustomer) return
    setUploadingTxBillId(tx.id)
    try {
      const { name, key } = await uploadBillFile(file, 'credit-customer-bills')
      await updateLedgerEntryBill(ledgerCustomer.id, tx.id, { billName: name, billUrl: key })
      toast.success(t.toastBillUploaded)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setUploadingTxBillId(null)
    }
  }

  async function handleRemoveTxBill(tx) {
    if (!ledgerCustomer) return
    setUploadingTxBillId(tx.id)
    try {
      await updateLedgerEntryBill(ledgerCustomer.id, tx.id, { billName: null, billUrl: null })
      toast.success(t.toastBillRemoved)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setUploadingTxBillId(null)
    }
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
        c.billsCount > 0 ? (
          <button
            onClick={() => openLedger(c.id)}
            title={t.billsUploaded(c.billsCount)}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
          >
            <Paperclip size={12} /> {c.billsCount}
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
      <Modal isOpen={!!ledgerCustomerId} onClose={() => setLedgerCustomerId(null)} title={ledgerCustomer?.name || ''} maxWidth="max-w-6xl">
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
                <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr className="text-slate-400">
                        {[
                          { field: 'date', label: t.thDate },
                          { field: 'type', label: t.thType },
                        ].map((col) => (
                          <th key={col.field} className="px-3 py-2 font-semibold">
                            <button
                              type="button"
                              onClick={() => toggleTxSort(col.field)}
                              className="inline-flex items-center gap-0.5 hover:text-slate-600"
                            >
                              {col.label}
                              {txSort.field === col.field ? (
                                txSort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                              ) : null}
                            </button>
                          </th>
                        ))}
                        <th className="px-3 py-2 font-semibold">{t.thDetails}</th>
                        <th className="px-3 py-2 font-semibold">{t.thReason}</th>
                        <th className="px-3 py-2 font-semibold">{t.thBill}</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleTxSort('amount')}
                            className="inline-flex items-center gap-0.5 hover:text-slate-600"
                          >
                            {t.thAmount}
                            {txSort.field === 'amount' ? (
                              txSort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                            ) : null}
                          </button>
                        </th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLedger.map((tx) => (
                        <tr key={tx.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-600">{formatDate(tx.date)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${tx.type === 'credit' ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-600'}`}>
                              {tx.type === 'credit' ? t.credit : t.payment}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {tx.type === 'credit'
                              ? tx.ltr != null && tx.rate != null
                                ? `${t.fuelTypeLabel[tx.fuelType] || tx.fuelType} · ${tx.ltr} L @ ${tx.rate}`
                                : t.fromFuelEntry
                              : t.modeLabel[tx.mode] || tx.mode}
                          </td>
                          <td className="max-w-[160px] px-3 py-2 text-slate-500">
                            <span className="block truncate" title={tx.note || undefined}>
                              {tx.note || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            {tx.type !== 'credit' ? (
                              <span className="text-slate-300">—</span>
                            ) : tx.billUrl ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openBill(tx.billUrl)}
                                  title={tx.billName || t.viewAttachedBill}
                                  className="flex min-w-0 items-center gap-1 text-brand-600 hover:underline"
                                >
                                  <Paperclip size={12} className="shrink-0" />
                                  <span className="max-w-[100px] truncate">{tx.billName || t.view}</span>
                                </button>
                                <AppTooltip title={t.removeBill}>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveTxBill(tx)}
                                    disabled={uploadingTxBillId === tx.id}
                                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50"
                                    aria-label={t.removeBill}
                                  >
                                    <X size={12} />
                                  </button>
                                </AppTooltip>
                              </div>
                            ) : (
                              <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                                <Upload size={11} />
                                {uploadingTxBillId === tx.id ? t.uploadingBillPrompt : t.attachBill}
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  className="hidden"
                                  disabled={uploadingTxBillId === tx.id}
                                  onChange={(e) => handleTxBillUpload(e, tx)}
                                />
                              </label>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold ${tx.type === 'credit' ? 'text-rose-500' : 'text-emerald-600'}`}>
                            {tx.type === 'credit' ? '+' : '−'} {formatCurrency(tx.amount)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-0.5">
                              <AppTooltip title={t.tooltipWhatsApp}>
                                <button
                                  type="button"
                                  onClick={() => sendTransactionReminder(ledgerCustomer, tx)}
                                  className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                                  aria-label={t.tooltipWhatsApp}
                                >
                                  <WhatsAppIcon size={15} />
                                </button>
                              </AppTooltip>
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
                            </div>
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
