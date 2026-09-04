import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Droplet, PackageSearch, PackagePlus, Tag, Boxes, Search, CalendarDays, Package, Cylinder } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { LUBRICANTS_TEXT } from '../i18n/lubricants.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { currentRate, sortedPriceHistory, round3 } from '../utils/lubricants.js'
import PageHeader from '../components/PageHeader.jsx'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonCardGrid } from '../components/Skeleton.jsx'
import { Field, Input, Select, PrimaryButton, SecondaryButton, IconButton } from '../components/FormControls.jsx'
import StatCard from '../components/StatCard.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'

const emptyForm = { name: '', unit: 'Pcs', rate: '', stock: '', packaging: 'packet' }

// Packet = small individual sachets/bottles; Cane = bulk tins/drums. Fuel
// Entry's Pump 2 oil section uses this to keep the two product pickers apart.
const PACKAGING_ICONS = { packet: Package, cane: Cylinder }
const emptyPurchaseForm = { qty: '', cost: '', date: todayISO() }

function lastPurchaseOf(product) {
  const history = product.purchaseHistory || []
  if (!history.length) return null
  return [...history].sort((a, b) => b.date.localeCompare(a.date))[0]
}

const CARD_THEMES = [
  { ring: 'ring-orange-100', icon: 'bg-orange-50 text-orange-600' },
  { ring: 'ring-blue-100', icon: 'bg-blue-50 text-blue-600' },
  { ring: 'ring-emerald-100', icon: 'bg-emerald-50 text-emerald-600' },
  { ring: 'ring-violet-100', icon: 'bg-violet-50 text-violet-600' },
  { ring: 'ring-rose-100', icon: 'bg-rose-50 text-rose-600' },
  { ring: 'ring-amber-100', icon: 'bg-amber-50 text-amber-600' },
  { ring: 'ring-cyan-100', icon: 'bg-cyan-50 text-cyan-600' },
  { ring: 'ring-indigo-100', icon: 'bg-indigo-50 text-indigo-600' },
]

const emptyPriceForm = { rate: '', effectiveFrom: todayISO() }

export default function Lubricants() {
  const { lubricants, lubricantsLoading, lubricantsError, addLubricant, updateLubricant, deleteLubricant, reviseLubricantPrice, addPurchase } =
    useData()
  const { language } = useLanguage()
  const t = LUBRICANTS_TEXT[language]
  const loading = lubricantsLoading
  const [saving, setSaving] = useState(false)
  const [savingPrice, setSavingPrice] = useState(false)
  const [savingPurchase, setSavingPurchase] = useState(false)

  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [purchaseTarget, setPurchaseTarget] = useState(null)
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm)
  const [purchaseErrors, setPurchaseErrors] = useState({})
  const [priceTarget, setPriceTarget] = useState(null)
  const [priceForm, setPriceForm] = useState(emptyPriceForm)
  const [priceErrors, setPriceErrors] = useState({})
  const editingProduct = lubricants.find((p) => p.id === editingId)

  const filteredLubricants = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return lubricants
    return lubricants.filter((l) => l.name.toLowerCase().includes(q))
  }, [lubricants, search])

  const totalStock = useMemo(() => lubricants.reduce((sum, l) => sum + (Number(l.stock) || 0), 0), [lubricants])

  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(product) {
    setEditingId(product.id)
    setForm({ name: product.name, unit: product.unit, rate: '', stock: '', packaging: product.packaging || 'packet' })
    setErrors({})
    setModalOpen(true)
  }

  function validate() {
    const e = {}
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      e.name = t.errorNameRequired
    } else if (lubricants.some((l) => l.id !== editingId && l.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      e.name = t.errorNameDuplicate
    }
    if (!editingId && (form.rate === '' || Number(form.rate) <= 0)) e.rate = t.errorRateInvalid
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev) {
    ev.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      if (editingId) {
        await updateLubricant(editingId, { name: form.name, unit: form.unit, packaging: form.packaging })
        toast.success(t.toastUpdated)
      } else {
        await addLubricant({
          name: form.name,
          unit: form.unit,
          packaging: form.packaging,
          rate: Number(form.rate),
          stock: Number(form.stock) || 0,
          purchaseHistory: [],
        })
        toast.success(t.toastAdded)
      }
      setModalOpen(false)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteLubricant(id)
      toast.success(t.toastRemoved)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    }
  }

  function openPurchase(product) {
    const rate = currentRate(product)
    setPurchaseTarget(product)
    setPurchaseForm({ qty: '', cost: rate ? String(rate) : '', date: todayISO() })
    setPurchaseErrors({})
  }

  function openRevisePrice(product) {
    setPriceTarget(product)
    setPriceForm({ rate: String(currentRate(product) || ''), effectiveFrom: todayISO() })
    setPriceErrors({})
  }

  function validatePrice() {
    const e = {}
    if (priceForm.rate === '' || Number(priceForm.rate) <= 0) e.rate = t.errorRateInvalid
    setPriceErrors(e)
    return Object.keys(e).length === 0
  }

  async function handlePriceSubmit(ev) {
    ev.preventDefault()
    if (!validatePrice()) return
    setSavingPrice(true)
    try {
      await reviseLubricantPrice(priceTarget.id, { rate: Number(priceForm.rate), effectiveFrom: priceForm.effectiveFrom })
      toast.success(t.toastPriceRevised(priceTarget.name))
      setPriceTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingPrice(false)
    }
  }

  function validatePurchase() {
    const e = {}
    if (purchaseForm.qty === '' || Number(purchaseForm.qty) <= 0) e.qty = t.errorQtyInvalid
    if (purchaseForm.cost === '' || Number(purchaseForm.cost) <= 0) e.cost = t.errorCostInvalid
    setPurchaseErrors(e)
    return Object.keys(e).length === 0
  }

  async function handlePurchaseSubmit(ev) {
    ev.preventDefault()
    if (!validatePurchase()) return
    setSavingPurchase(true)
    try {
      await addPurchase(purchaseTarget.id, { qty: Number(purchaseForm.qty), cost: Number(purchaseForm.cost), date: purchaseForm.date })
      toast.success(t.toastPurchased(purchaseTarget.name))
      setPurchaseTarget(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingPurchase(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCardGrid count={4} />
        <SkeletonCardGrid count={8} />
      </div>
    )
  }

  if (lubricantsError) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">{t.loadError}: {lubricantsError}</div>
  }

  return (
    <div className="space-y-6">
      <PageHeader
        description={
          <div className="relative w-full sm:w-56">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="py-2 pl-9 text-sm"
            />
          </div>
        }
        action={
          <PrimaryButton onClick={openAdd}>
            <Plus size={16} /> {t.addProduct}
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard index={0} icon={Droplet} label={t.statProducts} value={lubricants.length} accent="brand" />
        <StatCard index={1} icon={Boxes} label={t.statTotalStock} value={totalStock} accent="amber" />
      </div>

      {lubricants.length === 0 ? (
        <EmptyState
          icon={Droplet}
          title={t.emptyTitle}
          description={t.emptyDesc}
          action={
            <PrimaryButton onClick={openAdd}>
              <Plus size={16} /> {t.addProduct}
            </PrimaryButton>
          }
        />
      ) : filteredLubricants.length === 0 ? (
        <EmptyState icon={PackageSearch} title={t.noMatchTitle} description={t.noMatchDesc(search)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filteredLubricants.map((product, i) => {
            const theme = CARD_THEMES[i % CARD_THEMES.length]
            const lastPurchase = lastPurchaseOf(product)
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}
                whileHover={{ y: -2 }}
                className={`flex cursor-pointer flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card ring-1 ${theme.ring} transition-shadow hover:shadow-card-hover`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${theme.icon}`}>
                      <Droplet size={15} />
                    </div>
                    <p className="text-sm font-semibold leading-snug text-slate-800">{product.name}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton onClick={() => openRevisePrice(product)} aria-label={t.revisePriceAction} title={t.revisePriceAction} tone="brand">
                      <Tag size={14} />
                    </IconButton>
                    <IconButton onClick={() => openPurchase(product)} aria-label={t.purchaseAction} title={t.purchaseAction} tone="success">
                      <PackagePlus size={14} />
                    </IconButton>
                    <IconButton onClick={() => openEdit(product)} aria-label="Edit" title="Edit" tone="edit">
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton onClick={() => setConfirmDeleteId(product.id)} aria-label="Delete" title="Delete" tone="delete">
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    {t.rate} {formatCurrency(currentRate(product))} / {product.unit}
                  </p>
                  {(() => {
                    const PackagingIcon = PACKAGING_ICONS[product.packaging] || PACKAGING_ICONS.packet
                    return (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        <PackagingIcon size={11} />
                        {t.packagingLabel[product.packaging] || t.packagingLabel.packet}
                      </span>
                    )
                  })()}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-500">{t.stockLabel}</span>
                  <span className={`text-sm font-bold ${theme.icon.split(' ')[1]}`}>
                    {round3(product.stock ?? 0)} {product.unit}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
                  <CalendarDays size={11} className="shrink-0" />
                  {t.lastPurchased}: {lastPurchase ? formatDate(lastPurchase.date) : t.noPurchases}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? t.editProduct : t.addProduct}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={t.fieldProductName} required error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t.placeholderName} error={errors.name} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.fieldUnit}>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder={t.placeholderUnit} />
            </Field>
            {editingId ? (
              <Field label={t.fieldRate}>
                <div className="flex h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                  <Tag size={14} className="shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800">{formatCurrency(currentRate(editingProduct || {}))}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setModalOpen(false)
                      openRevisePrice(editingProduct)
                    }}
                    className="ml-auto text-xs font-semibold text-brand-600 hover:underline"
                  >
                    {t.revisePriceLink}
                  </button>
                </div>
              </Field>
            ) : (
              <Field label={t.fieldRate} required error={errors.rate}>
                <Input type="number" min="0" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0.00" error={errors.rate} />
              </Field>
            )}
          </div>
          <Field label={t.fieldPackaging}>
            <Select value={form.packaging} onChange={(e) => setForm({ ...form, packaging: e.target.value })}>
              <option value="packet">{t.packagingLabel.packet}</option>
              <option value="cane">{t.packagingLabel.cane}</option>
            </Select>
          </Field>
          {!editingId ? (
            <Field label={t.fieldOpeningStock}>
              <Input type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} placeholder={t.placeholderOpeningStock} />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {editingId ? t.saveChanges : t.addProduct}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!purchaseTarget} onClose={() => setPurchaseTarget(null)} title={purchaseTarget ? t.purchaseTitle(purchaseTarget.name) : ''}>
        {purchaseTarget ? (
          <form onSubmit={handlePurchaseSubmit} className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Boxes size={14} className="text-slate-400" />
              {t.stockLabel}: <span className="font-semibold text-slate-800">{purchaseTarget.stock ?? 0} {purchaseTarget.unit}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t.fieldPurchaseQty} required error={purchaseErrors.qty}>
                <Input
                  type="number"
                  min="0"
                  autoFocus
                  value={purchaseForm.qty}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, qty: e.target.value })}
                  placeholder="0"
                  error={purchaseErrors.qty}
                />
              </Field>
              <Field label={t.fieldCostPerUnit} required error={purchaseErrors.cost}>
                <Input
                  type="number"
                  min="0"
                  value={purchaseForm.cost}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, cost: e.target.value })}
                  placeholder="0.00"
                  error={purchaseErrors.cost}
                />
              </Field>
            </div>

            <Field label={t.fieldPurchaseDate}>
              <AppDatePicker value={purchaseForm.date} onChange={(date) => setPurchaseForm({ ...purchaseForm, date })} maxDate={todayISO()} className="w-full" />
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.historyTitle}</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                {(purchaseTarget.purchaseHistory || []).length ? (
                  [...purchaseTarget.purchaseHistory].reverse().map((entry) => (
                    <div key={entry.id} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <CalendarDays size={11} className="shrink-0 text-slate-400" />
                      {t.historyEntry(entry.qty, purchaseTarget.unit, entry.cost, formatDate(entry.date))}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">{t.historyEmpty}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton type="button" onClick={() => setPurchaseTarget(null)}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={savingPurchase}>
                {t.savePurchase}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal isOpen={!!priceTarget} onClose={() => setPriceTarget(null)} title={priceTarget ? t.revisePriceTitle(priceTarget.name) : ''}>
        {priceTarget ? (
          <form onSubmit={handlePriceSubmit} className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Tag size={14} className="text-slate-400" />
              {t.fieldCurrentRate}: <span className="font-semibold text-slate-800">{formatCurrency(currentRate(priceTarget))}</span>
            </div>

            <Field label={t.fieldNewRate} error={priceErrors.rate}>
              <Input
                type="number"
                min="0"
                autoFocus
                value={priceForm.rate}
                onChange={(e) => setPriceForm({ ...priceForm, rate: e.target.value })}
                placeholder="0.00"
                error={priceErrors.rate}
              />
            </Field>

            <Field label={t.fieldEffectiveFrom}>
              <AppDatePicker value={priceForm.effectiveFrom} onChange={(date) => setPriceForm({ ...priceForm, effectiveFrom: date })} className="w-full" />
            </Field>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.priceHistoryTitle}</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                {sortedPriceHistory(priceTarget).length ? (
                  [...sortedPriceHistory(priceTarget)].reverse().map((entry) => (
                    <div key={entry.effectiveFrom} className="flex items-center gap-1.5 text-xs text-slate-500">
                      <CalendarDays size={11} className="shrink-0 text-slate-400" />
                      {t.priceHistoryEntry(entry.rate, formatDate(entry.effectiveFrom))}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">{t.priceHistoryEmpty}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton type="button" onClick={() => setPriceTarget(null)}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={savingPrice}>
                {t.saveRevision}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => handleDelete(confirmDeleteId)}
        title={t.removeTitle}
        description={t.removeDesc}
      />
    </div>
  )
}
