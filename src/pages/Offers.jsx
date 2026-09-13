import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Send, Users, Megaphone, Phone, CheckSquare, Square, History, MessageSquareText, Trash2 } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { OFFERS_TEXT } from '../i18n/offers.js'
import { formatDate } from '../utils/format.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DataTable from '../components/DataTable.jsx'
import { SkeletonTable } from '../components/Skeleton.jsx'
import { Field, Input, Textarea, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import { WhatsAppIcon } from '../components/BrandIcons.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

const customerEmptyForm = { name: '', phone: '' }

function buildTemplates(station) {
  const shortLocation = station.location.split(',')[0]
  const mobiles = station.mobiles.join(' / ')
  return [
    {
      id: 'tamil-bulk-1',
      label: 'Tamil · Bulk Offer (Short)',
      text: `⛽ *${station.name} – ${shortLocation}*\n\nBulk பெட்ரோல் & டீசல் வாங்கினால்\n🎁 *FREE ஆயில்* + சிறப்பு விலை!\n\n📞 ${mobiles} - தொடர்புக்கு அழைக்கவும்.`,
    },
    {
      id: 'tamil-bulk-2',
      label: 'Tamil · Bulk Offer (Detailed)',
      text: `⛽ *${station.name} – ${shortLocation}*\n\n🎉 Bulk பெட்ரோல் & டீசல் ஆர்டர்களுக்கு சிறப்பு சலுகை!\n🎁 குறிப்பிட்ட அளவு வாங்கினால் *FREE ஆயில்*.\n💰 சிறந்த விலை • 🚚 விரைவான சேவை\n\n📞 மேலும் தகவலுக்கு தொடர்பு கொள்ளுங்கள்: ${mobiles}`,
    },
    {
      id: 'english-bulk',
      label: 'English · Bulk Offer',
      text: `⛽ ${station.name}, ${shortLocation}\n\nSpecial offer on bulk Petrol & Diesel orders!\n🎁 Get FREE engine oil on qualifying purchases.\n💰 Best rates • 🚚 Fast service\n\n📞 Call us: ${mobiles}`,
    },
    {
      id: 'loyalty-credit',
      label: 'English · Loyalty / Credit Reminder',
      text: `⛽ ${station.name}\n\nThank you for being a valued customer! 🙏\nClear your outstanding balance this week and get 2% cashback on your next fill-up.\n\n📞 ${mobiles}`,
    },
  ]
}

const STATUS_STYLES = {
  sent: 'bg-emerald-50 text-emerald-600',
  failed: 'bg-rose-50 text-rose-600',
  blocked: 'bg-slate-100 text-slate-500',
  pending: 'bg-amber-50 text-amber-600',
}

export default function Offers() {
  const {
    offerCustomers,
    offerCustomersLoading,
    addOfferCustomer,
    deleteOfferCustomer,
    offerHistory,
    offerHistoryLoading,
    sendOffer,
    station,
  } = useData()
  const { language } = useLanguage()
  const t = OFFERS_TEXT[language]

  // nameWithPhoneExport mirrors the JSX `body` renderer below (name + phone
  // shown together) — the bulk "Export CSV" button pulls the raw `name`
  // field otherwise, which would silently drop the phone number from the
  // exported file even though it's visible on screen for every row.
  const activeCustomers = useMemo(
    () =>
      offerCustomers
        .filter((c) => c.active)
        .map((c) => ({ ...c, nameWithPhoneExport: c.phone ? `${c.name} (${c.phone})` : c.name })),
    [offerCustomers],
  )

  const [selectedCustomers, setSelectedCustomers] = useState([])
  const [message, setMessage] = useState('')
  const [templateUsed, setTemplateUsed] = useState(null)
  const [channel, setChannel] = useState(null)
  const [sending, setSending] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(customerEmptyForm)
  const [errors, setErrors] = useState({})
  const [savingCustomer, setSavingCustomer] = useState(false)
  // Per-row rather than one flag, so removing one customer doesn't visually
  // gray out every other row too.
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(null)
  // One combined flag covering every kind of in-flight write this page can
  // make (add customer, remove customer, send offer) — while any of them is
  // running, every OTHER action on this screen is blocked too.
  const busy = sending || savingCustomer || deletingId != null

  const templates = useMemo(() => buildTemplates(station), [station])

  function openAdd() {
    setForm(customerEmptyForm)
    setErrors({})
    setModalOpen(true)
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = t.errorNameRequired
    if (!form.phone.trim()) e.phone = t.errorPhoneRequired
    else if (!/^\d{10}$/.test(form.phone.trim())) e.phone = t.errorPhoneInvalid
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleAddCustomer(e) {
    e.preventDefault()
    if (!validate()) return
    setSavingCustomer(true)
    try {
      await addOfferCustomer({ name: form.name, phone: form.phone })
      toast.success(t.toastCustomerAdded)
      setModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.errorSendFailed)
    } finally {
      setSavingCustomer(false)
    }
  }

  // Hard delete — removes the recipient from the database entirely, not
  // just this list (see DataContext.deleteOfferCustomer), so it's behind a
  // confirmation instead of a single click.
  async function handleDeleteCustomer(customer) {
    setDeletingId(customer.id)
    try {
      await deleteOfferCustomer(customer.id)
      setSelectedCustomers((prev) => prev.filter((c) => c.id !== customer.id))
      toast.success(t.toastCustomerRemoved(customer.name))
      setConfirmDeleteCustomer(null)
    } catch (err) {
      toast.error(err.message || t.errorSendFailed)
    } finally {
      setDeletingId(null)
    }
  }

  function selectAll() {
    setSelectedCustomers(activeCustomers)
  }

  function clearSelection() {
    setSelectedCustomers([])
  }

  async function handleSendOffer() {
    if (!message.trim()) {
      toast.error(t.errorNoMessage)
      return
    }
    if (selectedCustomers.length === 0 || !channel) return

    setSending(true)
    try {
      const send = await sendOffer({
        customerIds: selectedCustomers.map((c) => c.id),
        message,
        channel,
        templateUsed,
      })
      const counts = send.statusCounts
      const parts = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([status, n]) => t.statusCount(n, status))
      toast.success(parts.length ? t.toastSentWithCounts(parts.join(', ')) : t.toastSentToMany(selectedCustomers.length))
      setSelectedCustomers([])
    } catch (err) {
      toast.error(err.message || t.errorSendFailed)
    } finally {
      setSending(false)
    }
  }

  const columns = [
    {
      field: 'name',
      exportField: 'nameWithPhoneExport',
      header: t.colCustomer,
      sortable: true,
      style: { width: '78%' },
      body: (c) => (
        <>
          <p className="font-medium text-slate-800">{c.name}</p>
          <p className="flex items-center gap-1 text-xs font-medium text-slate-400">
            <Phone size={11} /> {c.phone || '—'}
          </p>
        </>
      ),
    },
    {
      header: t.colActions,
      align: 'right',
      exportable: false,
      style: { width: '12%' },
      body: (c) => (
        <div className="flex justify-end">
          <IconButton onClick={() => setConfirmDeleteCustomer(c)} disabled={busy} aria-label={t.removeCustomer} title={t.removeCustomer} tone="delete">
            <Trash2 size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  if (offerCustomersLoading) {
    return <SkeletonTable rows={6} cols={3} />
  }

  const sendDisabled = busy || selectedCustomers.length === 0 || !channel
  const busyLabel = sending ? t.sending : savingCustomer ? t.addingCustomer : deletingId != null ? t.removingCustomer : ''

  return (
    <div className="space-y-6">
      {busy ? <FullPageLoader label={busyLabel} /> : null}
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-xl border border-slate-200 bg-white shadow-card"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Users size={15} className="text-slate-400" /> {t.recipients}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckSquare size={13} /> {t.selectAll}
              </button>
              <button
                onClick={clearSelection}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Square size={13} /> {t.clear}
              </button>
            </div>
          </div>

          {activeCustomers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Users}
                title={t.emptyTitle}
                description={t.emptyDesc}
                action={
                  <PrimaryButton onClick={openAdd} disabled={busy}>
                    <Plus size={16} /> {t.addCustomer}
                  </PrimaryButton>
                }
              />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={activeCustomers}
              rowKey="id"
              globalFilterFields={['name', 'phone']}
              searchPlaceholder={t.searchPlaceholder}
              defaultSortField="name"
              scrollHeight="calc(100vh - 390px)"
              selectable
              selection={selectedCustomers}
              onSelectionChange={setSelectedCustomers}
              exportFilename="offer-customers"
              dense
              toolbarActions={
                <PrimaryButton onClick={openAdd} disabled={busy} className="px-3.5 py-2 text-xs">
                  <Plus size={14} /> {t.addCustomer}
                </PrimaryButton>
              }
            />
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"
        >
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Megaphone size={15} className="text-slate-400" /> {t.offerContent}
          </h3>

          <div className="mb-3 flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => {
                  setMessage(tpl.text)
                  setTemplateUsed(tpl.id)
                }}
                disabled={busy}
                className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {tpl.label}
              </button>
            ))}
          </div>

          <Field label={t.fieldMessage}>
            <Textarea
              rows={9}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value)
                setTemplateUsed(null)
              }}
              placeholder={t.placeholderMessage}
              className="font-sans"
              disabled={busy}
            />
          </Field>

          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-slate-600">{t.fieldChannel}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannel('sms')}
                disabled={busy}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  channel === 'sms' ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <MessageSquareText size={16} /> {t.channelSms}
              </button>
              <button
                type="button"
                onClick={() => setChannel('whatsapp')}
                disabled={busy}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  channel === 'whatsapp' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <WhatsAppIcon size={16} /> {t.channelWhatsApp}
              </button>
            </div>
          </div>

          <AppTooltip title={sendDisabled && !sending ? t.sendDisabledHint : undefined}>
            <PrimaryButton onClick={handleSendOffer} disabled={sendDisabled} className="mt-4 w-full">
              <Send size={16} /> {sending ? t.sending : t.sendOfferTo(selectedCustomers.length || 0)}
            </PrimaryButton>
          </AppTooltip>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.15 }}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"
      >
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <History size={15} className="text-slate-400" /> {t.recentlySent}
        </h3>
        {offerHistoryLoading ? (
          <p className="text-xs text-slate-400">{t.loadingHistory}</p>
        ) : offerHistory.length === 0 ? (
          <p className="text-xs text-slate-400">{t.noHistory}</p>
        ) : (
          <ul className="space-y-2">
            {offerHistory.slice(0, 8).map((send) => (
              <li key={send.id} className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-700">
                    {formatDate(send.sentAt)} &middot;{' '}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${send.channel === 'sms' ? 'bg-brand-50 text-brand-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {send.channel === 'sms' ? t.channelSms : t.channelWhatsApp}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(send.statusCounts).map(([status, n]) => (
                      <span key={status} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
                        {t.statusCount(n, status)}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-1 truncate text-slate-500">{send.message.split('\n')[0]}</p>
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      <Modal isOpen={modalOpen} onClose={savingCustomer ? () => {} : () => setModalOpen(false)} title={t.editCustomerTitle}>
        <form onSubmit={handleAddCustomer} className="space-y-4">
          <Field label={t.fieldCustomerName} required error={errors.name}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t.placeholderCustomerName}
              error={errors.name}
              disabled={savingCustomer}
            />
          </Field>
          <Field label={t.fieldPhone} required error={errors.phone}>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              placeholder={t.placeholderPhone}
              inputMode="numeric"
              error={errors.phone}
              disabled={savingCustomer}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={savingCustomer}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={savingCustomer}>
              {t.addCustomer}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteCustomer}
        onClose={() => setConfirmDeleteCustomer(null)}
        onConfirm={() => handleDeleteCustomer(confirmDeleteCustomer)}
        title={t.removeCustomerTitle}
        description={confirmDeleteCustomer ? t.removeCustomerDesc(confirmDeleteCustomer.name) : ''}
        loading={deletingId != null}
      />
    </div>
  )
}
