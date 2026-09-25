import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Wallet, ReceiptText, BadgeIndianRupee, Upload, Paperclip, X, StickyNote, ChevronUp, ChevronDown, Search, Loader2 } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { CREDIT_BILLS_TEXT } from '../i18n/creditBills.js'
import { closingBalance, closingBalanceBreakdown } from '../data/mockData.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { uploadBillFile, getDownloadUrl, deleteUpload, sendCreditReminder, sendLedgerEntryReminder } from '../lib/apiClient.js'
import { prepareBillFile } from '../utils/fileValidation.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, Select, Textarea, PrimaryButton, SecondaryButton, IconButton, submitOnEnter } from '../components/FormControls.jsx'
import { WhatsAppIcon } from '../components/BrandIcons.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import CalcBreakdown from '../components/CalcBreakdown.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

const customerEmptyForm = { name: '', phone: '', notes: '' }
const creditEmptyForm = { fuelType: 'Diesel', ltr: '', rate: '100.45' }
const paymentEmptyForm = { amount: '', mode: 'Cash' }

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
  } = useData()
  const { language } = useLanguage()
  const t = CREDIT_BILLS_TEXT[language]
  const loading = creditCustomersLoading

  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [editingCustomerId, setEditingCustomerId] = useState(null)
  const [customerForm, setCustomerForm] = useState(customerEmptyForm)
  const [errors, setErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deletingCustomer, setDeletingCustomer] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)

  const [ledgerCustomerId, setLedgerCustomerId] = useState(null)
  // Only entries added manually (here, or from the Audit modal's "Customer
  // Credit Paid") are ever removable — a credit line created from a real
  // fuel-entry payment (tx.sourceFuelEntryId set) stays tied to that entry;
  // deleting the fuel entry itself is what cleans that one up.
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(null)
  const [deletingTx, setDeletingTx] = useState(false)
  const [creditForm, setCreditForm] = useState(creditEmptyForm)
  const [paymentForm, setPaymentForm] = useState(paymentEmptyForm)
  const [creditBillFile, setCreditBillFile] = useState(null)
  const [uploadingCreditBill, setUploadingCreditBill] = useState(false)
  const [savingCredit, setSavingCredit] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  // Uploading (or clearing) a bill directly against one Transaction History
  // row — id of whichever entry has a request in flight, so only that row's
  // control shows a busy state. Two separate flags (rather than one shared
  // id) so the FullPageLoader below can label a removal "Removing file…"
  // instead of reusing the upload prompt.
  const [uploadingTxBillId, setUploadingTxBillId] = useState(null)
  const [removingTxBillId, setRemovingTxBillId] = useState(null)
  // Removal is a real, permanent S3 delete (not just clearing the field), so
  // it's gated behind a confirmation — same reasoning for the staged
  // (not-yet-submitted) credit bill just below.
  const [confirmRemoveTxBill, setConfirmRemoveTxBill] = useState(null)
  const [confirmRemoveStagedCreditBill, setConfirmRemoveStagedCreditBill] = useState(false)
  const [txSort, setTxSort] = useState({ field: 'date', dir: 'desc' })
  const [txSearch, setTxSearch] = useState('')
  // id of whichever customer has a reminder send in flight — same
  // single-id-at-a-time pattern as uploadingTxBillId/removingTxBillId above.
  const [sendingReminderId, setSendingReminderId] = useState(null)
  // Same, but for the per-transaction WhatsApp button inside the ledger
  // modal — keyed by ledger entry id, not customer id, since a customer-
  // level send and a specific-row send are two different requests.
  const [sendingTxReminderId, setSendingTxReminderId] = useState(null)
  // Both WhatsApp buttons below open a confirmation instead of sending
  // straight away — this is a real message to a real customer (and, with a
  // bill attached, a real document send), not a reversible local edit, so an
  // accidental click on the icon shouldn't fire it immediately.
  const [confirmSendReminder, setConfirmSendReminder] = useState(null)
  const [confirmSendTxReminder, setConfirmSendTxReminder] = useState(null)

  // One combined flag covering every kind of in-flight write this page can
  // make — while any of them is running, every OTHER action on this screen
  // is blocked too via the FullPageLoader below, same pattern as Employees.
  const busy =
    savingCustomer ||
    uploadingCreditBill ||
    savingCredit ||
    savingPayment ||
    uploadingTxBillId != null ||
    removingTxBillId != null ||
    deletingCustomer ||
    deletingTx ||
    sendingReminderId != null ||
    sendingTxReminderId != null
  const busyLabel = deletingCustomer
    ? t.removingCustomer
    : deletingTx
      ? t.removingTransaction
      : removingTxBillId != null
        ? t.removingBillPrompt
        : uploadingTxBillId != null || uploadingCreditBill
          ? t.uploadingBillPrompt
          : sendingReminderId != null || sendingTxReminderId != null
            ? t.sendingReminder
            : t.saving

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

  // Same "Details" text the table itself renders for a row — shared so the
  // search below can never match against wording the manager doesn't
  // actually see on screen.
  function txDetailsText(tx) {
    return tx.type === 'credit'
      ? tx.ltr != null && tx.rate != null
        ? `${t.fuelTypeLabel[tx.fuelType] || tx.fuelType} · ${tx.ltr} L @ ${tx.rate}`
        : t.fromFuelEntry
      : t.modeLabel[tx.mode] || tx.mode
  }

  // Free-text search across every column actually shown in the table below
  // (date, type, details, reason/note, amount) — a manager remembering "the
  // diesel credit from last Tuesday" or "that ₹5000 payment" can find it
  // without knowing which column it'd sort under.
  const filteredLedger = useMemo(() => {
    const q = txSearch.trim().toLowerCase()
    if (!q) return sortedLedger
    return sortedLedger.filter((tx) => {
      const haystack = [
        formatDate(tx.date),
        tx.type === 'credit' ? t.credit : t.payment,
        txDetailsText(tx),
        tx.note || '',
        formatCurrency(tx.amount),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedLedger, txSearch])

  function toggleTxSort(field) {
    setTxSort((prev) => (prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'date' ? 'desc' : 'asc' }))
  }

  function openAddCustomer() {
    setEditingCustomerId(null)
    setCustomerForm(customerEmptyForm)
    setErrors({})
    setCustomerModalOpen(true)
  }

  function openEditCustomer(c) {
    setEditingCustomerId(c.id)
    setCustomerForm({ name: c.name, phone: c.phone, notes: c.notes || '' })
    setErrors({})
    setCustomerModalOpen(true)
  }

  function validateCustomer() {
    const e = {}
    const name = customerForm.name.trim()
    const phone = customerForm.phone.trim()
    if (!name) e.name = t.errorNameRequired
    if (!phone) e.phone = t.errorPhoneRequired
    else if (!/^\d{10}$/.test(phone)) e.phone = t.errorPhoneInvalid

    // Name and phone are each checked separately — two different customers
    // sharing a name (or, more tellingly, two "different" customers sharing
    // one phone number) are exactly the mix-ups this needs to catch, not
    // just the narrower "re-added the exact same customer" case matching
    // both at once used to require. Whitespace/case-insensitive, and
    // excludes the customer currently being edited from the check against
    // itself.
    if (name) {
      const duplicateName = creditCustomers.some(
        (c) => c.id !== editingCustomerId && c.name.trim().toLowerCase() === name.toLowerCase(),
      )
      if (duplicateName) e.name = t.errorDuplicateCustomerName
    }
    if (phone && !e.phone) {
      const duplicatePhone = creditCustomers.some((c) => c.id !== editingCustomerId && (c.phone || '').trim() === phone)
      if (duplicatePhone) e.phone = t.errorDuplicateCustomerPhone
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleCustomerSubmit(ev) {
    ev.preventDefault()
    if (!validateCustomer()) return
    const payload = {
      name: customerForm.name,
      phone: customerForm.phone,
      notes: customerForm.notes,
    }
    setSavingCustomer(true)
    try {
      if (editingCustomerId) {
        await updateCustomer(editingCustomerId, payload)
        toast.success(t.toastCustomerUpdated)
      } else {
        await addCustomer({ ...payload, ledger: [], bills: [] })
        toast.success(t.toastCustomerAdded)
      }
      setCustomerModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingCustomer(false)
    }
  }

  async function handleDeleteCustomer() {
    const id = confirmDeleteId
    setDeletingCustomer(true)
    try {
      await deleteCustomer(id)
      toast.success(t.toastCustomerRemoved)
      setConfirmDeleteId(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingCustomer(false)
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

  // Customer-level reminder — outstanding balance + their most recent bill
  // (from either source: general Bills & Documents or a ledger-entry
  // attachment), sent for real server-side via MetaWhatsAppProvider. Fully
  // automatic: no wa.me link, no manual download, single request in/out.
  async function handleSendReminder(c) {
    setSendingReminderId(c.id)
    try {
      await sendCreditReminder(c.id)
      toast.success(t.toastReminderSent(c.name))
      setConfirmSendReminder(null)
    } catch (err) {
      toast.error(err.message || t.errorReminderFailed)
    } finally {
      setSendingReminderId(null)
    }
  }

  // One WhatsApp reminder per transaction row — same real server-side send
  // as handleSendReminder above, but the attachment (if any) is always
  // THIS specific row's own bill, never "most recent overall" — the whole
  // point of attaching a bill per-row is that different entries can be at
  // different stages. Fully automatic: no wa.me link, no manual download.
  async function sendTransactionReminder(c, tx) {
    setSendingTxReminderId(tx.id)
    try {
      await sendLedgerEntryReminder(c.id, tx.id)
      toast.success(t.toastReminderSent(c.name))
      setConfirmSendTxReminder(null)
    } catch (err) {
      toast.error(err.message || t.errorReminderFailed)
    } finally {
      setSendingTxReminderId(null)
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
      const { file: preparedFile, error } = await prepareBillFile(file)
      if (error) {
        toast.error(error === 'size' ? t.errorBillTooLarge : t.errorBillFileType)
        return
      }
      const { name, key } = await uploadBillFile(preparedFile, 'credit-customer-bills')
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
    setRemovingTxBillId(tx.id)
    try {
      await updateLedgerEntryBill(ledgerCustomer.id, tx.id, { billName: null, billUrl: null })
      toast.success(t.toastBillRemoved)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setRemovingTxBillId(null)
    }
  }

  function openLedger(id) {
    setLedgerCustomerId(id)
    setCreditForm({ fuelType: 'Diesel', ltr: '', rate: String(fuelRates.diesel) })
    setPaymentForm(paymentEmptyForm)
    setCreditBillFile(null)
    setTxSearch('')
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
      const { file: preparedFile, error } = await prepareBillFile(file)
      if (error) {
        toast.error(error === 'size' ? t.errorBillTooLarge : t.errorBillFileType)
        return
      }
      const { name, key } = await uploadBillFile(preparedFile, 'credit-customer-bills')
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
    setDeletingTx(true)
    try {
      await removeLedgerEntry(confirmDeleteTx.customerId, confirmDeleteTx.entryId)
      toast.success(t.toastTransactionRemoved)
      setConfirmDeleteTx(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingTx(false)
    }
  }

  const columns = [
    {
      field: 'name',
      header: t.colCustomer,
      sortable: true,
      style: { width: '34%' },
      body: (c) => (
        <>
          <button onClick={() => openLedger(c.id)} disabled={busy} className="text-left font-medium text-slate-800 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
            {c.name}
          </button>
          <p className="text-xs font-medium text-slate-400">{c.phone}</p>
        </>
      ),
    },
    {
      field: 'balance',
      header: t.colBalance,
      sortable: true,
      style: { width: '20%' },
      body: (c) => (
        <span className={`font-semibold ${c.balance > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{formatCurrency(c.balance)}</span>
      ),
    },
    {
      field: 'bills',
      exportField: 'billsCount',
      header: t.colBills,
      align: 'center',
      style: { width: '10%' },
      body: (c) =>
        c.billsCount > 0 ? (
          <button
            onClick={() => openLedger(c.id)}
            disabled={busy}
            title={t.billsUploaded(c.billsCount)}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          <IconButton
            onClick={() => setConfirmSendReminder(c)}
            disabled={busy || !c.phone}
            aria-label={t.tooltipSendReminder}
            title={c.phone ? t.tooltipSendReminder : t.tooltipPhone}
            tone="success"
          >
            {sendingReminderId === c.id ? <Loader2 size={15} className="animate-spin" /> : <WhatsAppIcon size={15} />}
          </IconButton>
          <IconButton onClick={() => openLedger(c.id)} disabled={busy} aria-label="View ledger" title="View ledger" tone="info">
            <ReceiptText size={15} />
          </IconButton>
          <IconButton onClick={() => openEditCustomer(c)} disabled={busy} aria-label="Edit" title="Edit" tone="edit">
            <Pencil size={15} />
          </IconButton>
          <IconButton onClick={() => setConfirmDeleteId(c.id)} disabled={busy} aria-label="Delete" title="Delete" tone="delete">
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
    // Same fillHeight pattern as Employees.jsx/Attendance.jsx — flex h-full
    // lets the card below stretch to exactly fill whatever height `main`
    // actually has, instead of a hand-guessed `calc(100vh - Npx)`.
    <div className="flex h-full min-h-0 flex-col gap-6">
      {busy ? <FullPageLoader label={busyLabel} /> : null}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card"
      >
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Wallet}
              title={t.emptyTitle}
              description={t.emptyDesc}
              action={
                <PrimaryButton onClick={openAddCustomer} disabled={busy}>
                  <Plus size={16} /> {t.addCustomer}
                </PrimaryButton>
              }
            />
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
            fillHeight
            exportFilename="credit-customers"
            dense
            toolbarActions={
              <PrimaryButton onClick={openAddCustomer} disabled={busy} className="px-3.5 py-2 text-xs">
                <Plus size={14} /> {t.addCustomer}
              </PrimaryButton>
            }
          />
        )}
      </motion.div>

      {/* Add / Edit customer */}
      <Modal
        isOpen={customerModalOpen}
        onClose={savingCustomer ? () => {} : () => setCustomerModalOpen(false)}
        title={editingCustomerId ? t.editCustomer : t.addCustomer}
      >
        <form onSubmit={handleCustomerSubmit} onKeyDown={submitOnEnter} className="space-y-4">
          <Field label={t.fieldCustomerName} required error={errors.name}>
            <Input
              value={customerForm.name}
              onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
              placeholder={t.placeholderCustomerName}
              error={errors.name}
              disabled={savingCustomer}
            />
          </Field>
          <Field label={t.fieldPhone} required error={errors.phone}>
            <Input
              value={customerForm.phone}
              onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder={t.placeholderPhone}
              inputMode="numeric"
              error={errors.phone}
              disabled={savingCustomer}
            />
          </Field>
          <Field label={t.fieldAdditionalInfo}>
            <Textarea
              rows={3}
              value={customerForm.notes}
              onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
              placeholder={t.placeholderNotes}
              disabled={savingCustomer}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setCustomerModalOpen(false)} disabled={savingCustomer}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={savingCustomer}>
              {editingCustomerId ? t.saveChanges : t.addCustomer}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      {/* Ledger detail */}
      <Modal
        isOpen={!!ledgerCustomerId}
        onClose={busy ? () => {} : () => setLedgerCustomerId(null)}
        title={ledgerCustomer?.name || ''}
        maxWidth="max-w-6xl"
        headerExtra={
          ledgerCustomer ? (
            <AppTooltip
              title={
                <CalcBreakdown
                  rows={[
                    { label: t.credit, value: `+ ${formatCurrency(balanceBreakdown.totalCredit)}` },
                    { label: t.payment, value: `− ${formatCurrency(balanceBreakdown.totalPayments)}` },
                  ]}
                  formula={`${formatCurrency(balanceBreakdown.totalCredit)} − ${formatCurrency(balanceBreakdown.totalPayments)} = ${t.colBalance} (${formatCurrency(balanceBreakdown.balance)})`}
                />
              }
            >
              <span className="flex cursor-help items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-xs font-medium text-slate-500 underline decoration-dotted decoration-slate-300 underline-offset-4">{t.colBalance}</span>
                <span className={`text-base font-bold ${closingBalance(ledgerCustomer) > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                  {formatCurrency(closingBalance(ledgerCustomer))}
                </span>
              </span>
            </AppTooltip>
          ) : null
        }
      >
        {ledgerCustomer ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <form onSubmit={handleAddCredit} onKeyDown={submitOnEnter} className="rounded-xl border border-slate-200 p-3">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.recordCredit}</h4>
                <div className="space-y-2">
                  <Field label={t.fieldFuelType}>
                    <Select
                      value={creditForm.fuelType}
                      onChange={(e) => {
                        const fuelType = e.target.value
                        const rate = fuelType === 'Petrol' ? fuelRates.petrol : fuelRates.diesel
                        setCreditForm({ ...creditForm, fuelType, rate: String(rate) })
                      }}
                      disabled={savingCredit || uploadingCreditBill}
                    >
                      <option value="Diesel">{t.fuelTypeLabel.Diesel}</option>
                      <option value="Petrol">{t.fuelTypeLabel.Petrol}</option>
                    </Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t.fieldLtr}>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={creditForm.ltr}
                        onChange={(e) => setCreditForm({ ...creditForm, ltr: e.target.value })}
                        placeholder="0"
                        disabled={savingCredit || uploadingCreditBill}
                      />
                    </Field>
                    <Field label={t.fieldRate}>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={creditForm.rate}
                        onChange={(e) => setCreditForm({ ...creditForm, rate: e.target.value })}
                        disabled={savingCredit || uploadingCreditBill}
                      />
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
                            onClick={() => setConfirmRemoveStagedCreditBill(true)}
                            disabled={savingCredit || uploadingCreditBill}
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={t.removeAttachment}
                          >
                            <X size={13} />
                          </button>
                        </AppTooltip>
                      </div>
                    ) : (
                      <label
                        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 ${
                          savingCredit || uploadingCreditBill ? 'pointer-events-none opacity-50' : ''
                        }`}
                      >
                        <Upload size={14} />
                        {t.uploadBillPrompt}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          disabled={savingCredit || uploadingCreditBill}
                          onChange={handleBillFileChange}
                        />
                      </label>
                    )}
                  </Field>

                  <PrimaryButton type="submit" className="w-full" disabled={savingCredit || uploadingCreditBill}>
                    {t.addCredit}
                  </PrimaryButton>
                </div>
              </form>

              <form onSubmit={handleAddPayment} onKeyDown={submitOnEnter} className="rounded-xl border border-slate-200 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <BadgeIndianRupee size={13} /> {t.recordPayment}
                </h4>
                <div className="space-y-2">
                  <Field label={t.fieldAmount}>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                      placeholder="0"
                      disabled={savingPayment}
                    />
                  </Field>
                  <Field label={t.fieldMode}>
                    <Select value={paymentForm.mode} onChange={(e) => setPaymentForm({ ...paymentForm, mode: e.target.value })} disabled={savingPayment}>
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.transactionHistory}</h4>
                {ledgerCustomer.ledger.length > 0 ? (
                  <div className="relative w-full sm:w-64">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={txSearch}
                      onChange={(e) => setTxSearch(e.target.value)}
                      placeholder={t.searchTransactionsPlaceholder}
                      className="py-1.5 pl-8 text-xs"
                    />
                  </div>
                ) : null}
              </div>
              {ledgerCustomer.ledger.length === 0 ? (
                <EmptyState icon={ReceiptText} title={t.noTransactionsTitle} description={t.noTransactionsDesc} />
              ) : filteredLedger.length === 0 ? (
                <EmptyState icon={Search} title={t.noMatchingTransactionsTitle} description={t.noMatchingTransactionsDesc} />
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
                      {filteredLedger.map((tx) => (
                        <tr key={tx.id} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-600">{formatDate(tx.date)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 font-semibold ${tx.type === 'credit' ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-600'}`}>
                              {tx.type === 'credit' ? t.credit : t.payment}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-500">{txDetailsText(tx)}</td>
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
                                  disabled={busy}
                                  title={tx.billName || t.viewAttachedBill}
                                  className="flex min-w-0 items-center gap-1 text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Paperclip size={12} className="shrink-0" />
                                  <span className="max-w-[100px] truncate">{tx.billName || t.view}</span>
                                </button>
                                <AppTooltip title={t.removeBill}>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveTxBill(tx)}
                                    disabled={busy}
                                    className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50"
                                    aria-label={t.removeBill}
                                  >
                                    <X size={12} />
                                  </button>
                                </AppTooltip>
                              </div>
                            ) : (
                              <label
                                className={`inline-flex cursor-pointer items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 ${
                                  busy ? 'pointer-events-none opacity-50' : ''
                                }`}
                              >
                                <Upload size={11} />
                                {uploadingTxBillId === tx.id ? t.uploadingBillPrompt : t.attachBill}
                                <input
                                  type="file"
                                  accept="image/*,application/pdf"
                                  className="hidden"
                                  disabled={busy}
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
                                  onClick={() => setConfirmSendTxReminder({ customer: ledgerCustomer, tx })}
                                  disabled={busy}
                                  className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label={t.tooltipWhatsApp}
                                >
                                  {sendingTxReminderId === tx.id ? <Loader2 size={15} className="animate-spin" /> : <WhatsAppIcon size={15} />}
                                </button>
                              </AppTooltip>
                              {!tx.sourceFuelEntryId ? (
                                <AppTooltip title={t.removeTransaction}>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteTx({ customerId: ledgerCustomer.id, entryId: tx.id })}
                                    disabled={busy}
                                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
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
        onConfirm={handleDeleteCustomer}
        title={t.removeCustomerTitle}
        description={t.removeCustomerDesc}
        loading={deletingCustomer}
      />

      <ConfirmDialog
        isOpen={!!confirmDeleteTx}
        onClose={() => setConfirmDeleteTx(null)}
        onConfirm={handleRemoveLedgerEntry}
        title={t.removeTransactionTitle}
        description={t.removeTransactionDesc}
        loading={deletingTx}
      />

      <ConfirmDialog
        isOpen={!!confirmRemoveTxBill}
        onClose={() => setConfirmRemoveTxBill(null)}
        onConfirm={() => handleRemoveTxBill(confirmRemoveTxBill)}
        title={t.removeBillTitle}
        description={t.removeBillDesc}
        confirmLabel={t.removeBill}
      />

      <ConfirmDialog
        isOpen={confirmRemoveStagedCreditBill}
        onClose={() => setConfirmRemoveStagedCreditBill(false)}
        onConfirm={removeStagedCreditBill}
        title={t.removeAttachmentTitle}
        description={t.removeAttachmentDesc}
        confirmLabel={t.removeAttachment}
      />

      <ConfirmDialog
        isOpen={!!confirmSendReminder}
        onClose={() => setConfirmSendReminder(null)}
        onConfirm={() => handleSendReminder(confirmSendReminder)}
        title={t.confirmSendReminderTitle}
        description={confirmSendReminder ? t.confirmSendReminderDesc(confirmSendReminder.name) : ''}
        confirmLabel={t.confirmSendReminderButton}
        confirmTone="brand"
        loading={sendingReminderId != null}
      />

      <ConfirmDialog
        isOpen={!!confirmSendTxReminder}
        onClose={() => setConfirmSendTxReminder(null)}
        onConfirm={() => sendTransactionReminder(confirmSendTxReminder.customer, confirmSendTxReminder.tx)}
        title={t.confirmSendReminderTitle}
        description={confirmSendTxReminder ? t.confirmSendTxReminderDesc(confirmSendTxReminder.customer.name) : ''}
        confirmLabel={t.confirmSendReminderButton}
        confirmTone="brand"
        loading={sendingTxReminderId != null}
      />
    </div>
  )
}
