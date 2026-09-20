import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Droplet, PackageSearch, PackagePlus, Tag, Boxes, Search, CalendarDays, Package, Cylinder, History, X, Check, AlertTriangle } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { LUBRICANTS_TEXT } from '../i18n/lubricants.js'
import { formatCurrency, formatDate, todayISO } from '../utils/format.js'
import { currentRate, sortedPriceHistory, round3 } from '../utils/lubricants.js'
import { getLubricantSalesHistory } from '../lib/apiClient.js'
import Modal from '../components/Modal.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonCardGrid } from '../components/Skeleton.jsx'
import { Field, Input, Select, PrimaryButton, SecondaryButton, IconButton, submitOnEnter } from '../components/FormControls.jsx'
import AppDatePicker from '../components/AppDatePicker.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { FullPageLoader } from '../components/Loader.jsx'

// packaging defaults to 'cane' for a brand-new product — most restocks here
// are bulk (cane) purchases, not individual packets, so this saves an extra
// click on the common case. Only this initial "Add Product" default; the
// fallback used elsewhere for an EXISTING product missing packaging data
// (PACKAGING_ICONS[...] || packet, openEdit's product.packaging || 'packet')
// stays 'packet' — that's a legacy-data guess, a separate concern from what
// a fresh product should start as.
const emptyForm = { name: '', unit: 'Pcs', rate: '', stock: '', packaging: 'cane' }

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
  { border: 'border-orange-200', ring: 'ring-orange-100', icon: 'bg-orange-100 text-orange-600' },
  { border: 'border-blue-200', ring: 'ring-blue-100', icon: 'bg-blue-100 text-blue-600' },
  { border: 'border-emerald-200', ring: 'ring-emerald-100', icon: 'bg-emerald-100 text-emerald-600' },
  { border: 'border-violet-200', ring: 'ring-violet-100', icon: 'bg-violet-100 text-violet-600' },
  { border: 'border-rose-200', ring: 'ring-rose-100', icon: 'bg-rose-100 text-rose-600' },
  { border: 'border-amber-200', ring: 'ring-amber-100', icon: 'bg-amber-100 text-amber-600' },
  { border: 'border-cyan-200', ring: 'ring-cyan-100', icon: 'bg-cyan-100 text-cyan-600' },
  { border: 'border-indigo-200', ring: 'ring-indigo-100', icon: 'bg-indigo-100 text-indigo-600' },
]

const emptyPriceForm = { rate: '', effectiveFrom: todayISO() }

const INLINE_STAT_THEMES = {
  brand: { card: 'bg-brand-50/70 ring-brand-100', icon: 'bg-brand-100 text-brand-700' },
  amber: { card: 'bg-amber-50/70 ring-amber-100', icon: 'bg-amber-100 text-amber-700' },
  rose: { card: 'bg-rose-50/70 ring-rose-100', icon: 'bg-rose-100 text-rose-700' },
}

// A product at or below this count is "running low" — worth a restock
// before it hits zero and a sale can't be recorded at all.
const LOW_STOCK_THRESHOLD = 10

// Editing a purchase's qty after the fact can silently conflict with Fuel
// Entry's Pump 2 oil rows — a sale already recorded against this batch's
// stock has no idea the purchase behind it just changed size (the backend's
// negative-stock guard in update_purchase only catches a qty REDUCTION big
// enough to go negative, not a same-day quantity mismatch a manager can't
// see from here). Hidden from the UI until that's resolved; the edit flow
// itself (openEditPurchase, the inline form below, handleEditPurchaseSubmit)
// is left fully in place to re-enable by flipping this back to true.
const SHOW_EDIT_PURCHASE = false

// en-IN grouping (e.g. 12,45,268) so a large count still reads at a glance
// instead of running digits together; capped at 3 decimals to match the
// stock figures' own precision (see round3 in utils/lubricants.js) without
// ever showing float noise like 268.00000000004.
function formatCount(value) {
  return (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })
}

// `onClick` is optional — when passed (the Low Stock card), this renders as
// a real <button> with hover/focus affordance instead of a plain <div>, so
// it's obvious it opens something instead of being just another readout
// like Products/Total Stock.
function InlineStat({ icon: Icon, label, value, accent, onClick }) {
  const theme = INLINE_STAT_THEMES[accent]
  const Tag = onClick ? motion.button : motion.div
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      whileHover={{ y: -2, scale: 1.03, transition: { type: 'spring', stiffness: 350, damping: 20 } }}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      className={`group flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2 shadow-card ring-1 transition-shadow duration-300 hover:shadow-card-hover ${theme.card} ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110 ${theme.icon}`}>
        <Icon size={14} strokeWidth={2} />
      </div>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm font-bold tabular-nums text-slate-900">{formatCount(value)}</span>
    </Tag>
  )
}

export default function Lubricants() {
  const {
    lubricants,
    lubricantsLoading,
    lubricantsError,
    addLubricant,
    updateLubricant,
    deleteLubricant,
    reviseLubricantPrice,
    addPurchase,
    updatePurchase,
    deletePurchase,
  } = useData()
  const { language } = useLanguage()
  const t = LUBRICANTS_TEXT[language]
  const loading = lubricantsLoading
  const [saving, setSaving] = useState(false)
  const [savingPrice, setSavingPrice] = useState(false)
  const [savingPurchase, setSavingPurchase] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const [search, setSearch] = useState('')
  // 'all' | 'packet' | 'cane' — narrows the catalog grid down to just one
  // packaging type, same distinction as the fieldPackaging select in the
  // Add/Edit modal below.
  const [packagingFilter, setPackagingFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [purchaseTarget, setPurchaseTarget] = useState(null)
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm)
  const [purchaseErrors, setPurchaseErrors] = useState({})
  // Correcting a purchase already recorded — editing happens inline in the
  // same history row rather than a separate modal, since it's a quick,
  // occasional fix (a mistyped qty/cost/date), not a full form of its own.
  const [editingPurchaseId, setEditingPurchaseId] = useState(null)
  const [editPurchaseForm, setEditPurchaseForm] = useState({ qty: '', cost: '', date: '' })
  const [editPurchaseErrors, setEditPurchaseErrors] = useState({})
  const [savingEditPurchase, setSavingEditPurchase] = useState(false)
  const [confirmDeletePurchaseId, setConfirmDeletePurchaseId] = useState(null)
  const [deletingPurchaseId, setDeletingPurchaseId] = useState(null)
  // One combined flag covering every kind of in-flight write this page can
  // make (add/edit, price revision, purchase, delete) — while any of them is
  // running, every OTHER action on this screen is blocked too.
  const busy =
    saving ||
    savingPrice ||
    savingPurchase ||
    deletingId != null ||
    savingEditPurchase ||
    deletingPurchaseId != null
  const [priceTarget, setPriceTarget] = useState(null)
  const [priceForm, setPriceForm] = useState(emptyPriceForm)
  const [priceErrors, setPriceErrors] = useState({})
  const [soldHistoryTarget, setSoldHistoryTarget] = useState(null)
  const [soldHistoryEntries, setSoldHistoryEntries] = useState([])
  const [soldHistoryLoading, setSoldHistoryLoading] = useState(false)
  const [soldHistoryErrorMsg, setSoldHistoryErrorMsg] = useState(null)
  const editingProduct = lubricants.find((p) => p.id === editingId)

  const filteredLubricants = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lubricants.filter((l) => {
      if (packagingFilter !== 'all' && (l.packaging || 'packet') !== packagingFilter) return false
      if (q && !l.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [lubricants, search, packagingFilter])

  const totalStock = useMemo(() => round3(lubricants.reduce((sum, l) => sum + (Number(l.stock) || 0), 0)), [lubricants])

  // "Products in Catalog" is meant to read as "products you can actually
  // sell right now" — a product sitting at 0 stock (e.g. Test1 above) isn't
  // available to sell until it's restocked, so counting it here overstated
  // what's really on the shelf. Still listed in the grid below either way;
  // only this headline count excludes it.
  const inStockProductCount = useMemo(() => lubricants.filter((l) => (Number(l.stock) || 0) > 0).length, [lubricants])

  // Lowest stock first — the most urgent restock need at the top of the
  // list, so the manager doesn't have to hunt for it among the ones that
  // still have plenty on hand.
  const lowStockProducts = useMemo(
    () =>
      [...lubricants]
        .filter((l) => (Number(l.stock) || 0) < LOW_STOCK_THRESHOLD)
        .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0)),
    [lubricants],
  )
  const [lowStockOpen, setLowStockOpen] = useState(false)

  // purchaseTarget is a snapshot from the moment "Record Purchase" was
  // clicked — re-derived from the live catalog on every render so an edit
  // or delete of a purchase row (below) shows its effect (stock figure,
  // history list) immediately, without needing to close and reopen this
  // modal to see it.
  const livePurchaseTarget = purchaseTarget ? lubricants.find((l) => l.id === purchaseTarget.id) || purchaseTarget : null

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
    setDeletingId(id)
    try {
      await deleteLubricant(id)
      toast.success(t.toastRemoved)
      setConfirmDeleteId(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingId(null)
    }
  }

  function openPurchase(product) {
    // Defaults to the LAST PURCHASE's cost (what was actually paid to a
    // supplier), not currentRate() — that's the customer-facing SELLING
    // price, a completely different figure (normally higher, for margin).
    // Pre-filling "Cost per Unit" with the selling rate silently overstated
    // every new restock's cost by default unless the manager remembered to
    // correct it. Left blank (forcing an explicit entry) when there's no
    // purchase history yet to go by, rather than guessing with the rate.
    const lastPurchase = lastPurchaseOf(product)
    setPurchaseTarget(product)
    setPurchaseForm({ qty: '', cost: lastPurchase ? String(lastPurchase.cost) : '', date: todayISO() })
    setPurchaseErrors({})
  }

  function openRevisePrice(product) {
    setPriceTarget(product)
    setPriceForm({ rate: String(currentRate(product) || ''), effectiveFrom: todayISO() })
    setPriceErrors({})
  }

  // Fetched on demand (not preloaded with the catalog list) — a fresh
  // request every time this opens so it can never show stale sales after a
  // fuel entry elsewhere is finalized, edited, or deleted.
  async function openSoldHistory(product) {
    setSoldHistoryTarget(product)
    setSoldHistoryEntries([])
    setSoldHistoryErrorMsg(null)
    setSoldHistoryLoading(true)
    try {
      const rows = await getLubricantSalesHistory(product.id)
      setSoldHistoryEntries(rows)
    } catch (err) {
      // `true` marks "use the generic fallback", resolved against the
      // CURRENT t.soldHistoryLoadFailed at render time (see the <p> below) —
      // baking the translated string in here instead would leave this stuck
      // in whatever language it was in if the user toggles language while
      // the modal is still open with this error showing.
      setSoldHistoryErrorMsg(err.message || true)
    } finally {
      setSoldHistoryLoading(false)
    }
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
    const qtyNum = Number(purchaseForm.qty)
    if (purchaseForm.qty === '' || qtyNum <= 0) e.qty = t.errorQtyInvalid
    else if (!Number.isInteger(qtyNum)) e.qty = t.errorQtyInteger
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

  function openEditPurchase(entry) {
    setEditingPurchaseId(entry.id)
    setEditPurchaseForm({ qty: String(entry.qty), cost: String(entry.cost), date: entry.date })
    setEditPurchaseErrors({})
  }

  function cancelEditPurchase() {
    setEditingPurchaseId(null)
    setEditPurchaseErrors({})
  }

  // Quantity must be a whole number — mirrors the backend's own `qty: int`
  // constraint (a purchase is always a whole count of units), so a decimal
  // typo is caught here instead of round-tripping to the server for the
  // same rejection.
  function validateEditPurchase() {
    const e = {}
    const qtyNum = Number(editPurchaseForm.qty)
    if (editPurchaseForm.qty === '' || qtyNum <= 0) e.qty = t.errorQtyInvalid
    else if (!Number.isInteger(qtyNum)) e.qty = t.errorQtyInteger
    // <= 0, not < 0 — matches validatePurchase's rule for a brand-new
    // purchase. This let an EDIT (only) save a purchase at ₹0 cost, purely
    // from the two checks having drifted apart, not any real reason editing
    // should allow a free purchase when creating one never could.
    if (editPurchaseForm.cost === '' || Number(editPurchaseForm.cost) <= 0) e.cost = t.errorCostInvalid
    setEditPurchaseErrors(e)
    return Object.keys(e).length === 0
  }

  // Not a <form onSubmit> — this renders inside the "Record Purchase"
  // modal's own outer <form>, and a nested <form> is invalid HTML: the
  // browser drops the inner <form> tag entirely, silently turning an inner
  // type="submit" button into a submit for the OUTER form instead (which
  // then fails ITS OWN validation on its own, unrelated, still-blank
  // fields). Triggered directly from the Save button's onClick instead.
  async function handleEditPurchaseSubmit(productId) {
    if (!validateEditPurchase()) return
    setSavingEditPurchase(true)
    try {
      // The API itself rejects (409) a qty reduction that would drive stock
      // negative — units already sold against the original, wrong quantity
      // can't just be wished away — so that specific message comes straight
      // through via err.message rather than being re-derived here.
      await updatePurchase(productId, editingPurchaseId, {
        qty: Number(editPurchaseForm.qty),
        cost: Number(editPurchaseForm.cost),
        date: editPurchaseForm.date,
      })
      toast.success(t.toastPurchaseUpdated)
      setEditingPurchaseId(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setSavingEditPurchase(false)
    }
  }

  async function handleDeletePurchase(productId, purchaseId) {
    setDeletingPurchaseId(purchaseId)
    try {
      await deletePurchase(productId, purchaseId)
      toast.success(t.toastPurchaseRemoved)
      setConfirmDeletePurchaseId(null)
    } catch (err) {
      toast.error(err.message || t.toastSaveFailed)
    } finally {
      setDeletingPurchaseId(null)
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

  const busyLabel = saving
    ? t.saving
    : savingPrice
      ? t.revisingPrice
      : savingPurchase
        ? t.purchasing
        : deletingId != null
          ? t.deleting
          : savingEditPurchase
            ? t.updatingPurchase
            : deletingPurchaseId != null
              ? t.removingPurchase
              : ''

  return (
    // Same fillHeight idea as the table pages (Employees/Attendance/Credit
    // Bills) — flex h-full on the root, and the card grid below is the one
    // flex-fill region that scrolls internally (min-h-0 flex-1
    // overflow-y-auto) instead of the whole page growing taller than `main`
    // and forcing an outer scrollbar.
    <div className="flex h-full min-h-0 flex-col gap-6">
      {busy ? <FullPageLoader label={busyLabel} /> : null}
      <div className="flex items-center gap-3">
        {/* This row scrolls horizontally on its own (min-w-0 lets it actually
            shrink instead of forcing the whole flex row wider) — Add Product
            stays a sibling outside it, so it can never end up scrolled out of
            view the way it did when it lived inside this same overflow-x-auto
            row with just an ml-auto push. */}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-3 overflow-x-auto pb-1">
          <div className="relative w-40 shrink-0 sm:w-56">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="py-2 pl-9 text-sm"
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
            {[
              { value: 'all', label: t.filterAll, icon: null },
              { value: 'packet', label: t.packagingLabel.packet, icon: Package },
              { value: 'cane', label: t.packagingLabel.cane, icon: Cylinder },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPackagingFilter(value)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  packagingFilter === value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {Icon ? <Icon size={12} /> : null}
                {label}
              </button>
            ))}
          </div>
          <InlineStat icon={Droplet} label={t.statProducts} value={inStockProductCount} accent="brand" />
          <InlineStat icon={Boxes} label={t.statTotalStock} value={totalStock} accent="amber" />
          <InlineStat
            icon={AlertTriangle}
            label={t.statLowStock}
            value={lowStockProducts.length}
            accent="rose"
            onClick={() => setLowStockOpen(true)}
          />
        </div>
        <PrimaryButton onClick={openAdd} disabled={busy} className="shrink-0">
          <Plus size={16} /> {t.addProduct}
        </PrimaryButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      {lubricants.length === 0 ? (
        <EmptyState
          icon={Droplet}
          title={t.emptyTitle}
          description={t.emptyDesc}
          action={
            <PrimaryButton onClick={openAdd} disabled={busy}>
              <Plus size={16} /> {t.addProduct}
            </PrimaryButton>
          }
        />
      ) : filteredLubricants.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={t.noMatchTitle}
          description={search.trim() ? t.noMatchDesc(search) : t.noMatchDescFilter}
        />
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
                whileHover={{ y: -6, scale: 1.02, transition: { type: 'spring', stiffness: 300, damping: 18 } }}
                whileTap={{ scale: 0.985 }}
                className={`group flex cursor-pointer flex-col rounded-xl border bg-white p-4 shadow-card ring-1 transition-shadow duration-300 hover:shadow-card-hover ${theme.border} ${theme.ring}`}
              >
                {/* Name and action icons are two separate rows now, not one
                    flex row split with justify-between — a long product name
                    used to wrap onto a second line right underneath the
                    icons, squeezing them and pushing the last one or two
                    outside the card. The name instead truncates to a single
                    line (full name still available on hover via the
                    tooltip), so the icon row below it always keeps its own
                    full width. */}
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 ${theme.icon}`}>
                    <Droplet size={15} />
                  </div>
                  <AppTooltip title={product.name}>
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug text-slate-800">{product.name}</p>
                  </AppTooltip>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  <IconButton
                    onClick={() => openRevisePrice(product)}
                    disabled={busy}
                    aria-label={t.revisePriceAction}
                    title={t.revisePriceAction}
                    tone="brand"
                  >
                    <Tag size={14} />
                  </IconButton>
                  <IconButton
                    onClick={() => openPurchase(product)}
                    disabled={busy}
                    aria-label={t.purchaseAction}
                    title={t.purchaseAction}
                    tone="success"
                  >
                    <PackagePlus size={14} />
                  </IconButton>
                  <IconButton
                    onClick={() => openSoldHistory(product)}
                    disabled={busy}
                    aria-label={t.soldHistoryAction}
                    title={t.soldHistoryAction}
                    tone="brand"
                  >
                    <History size={14} />
                  </IconButton>
                  <IconButton onClick={() => openEdit(product)} disabled={busy} aria-label="Edit" title="Edit" tone="edit">
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton
                    onClick={() => setConfirmDeleteId(product.id)}
                    disabled={busy}
                    aria-label="Delete"
                    title="Delete"
                    tone="delete"
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">
                    {t.rate} <span className="font-semibold text-slate-700">{formatCurrency(currentRate(product))} / {product.unit}</span>
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
                <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                  <History size={11} className="shrink-0" />
                  {t.lastSold}: {product.lastSoldDate ? formatDate(product.lastSoldDate) : t.notSoldYet}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={saving ? () => {} : () => setModalOpen(false)}
        title={editingId ? t.editProduct : t.addProduct}
      >
        <form onSubmit={handleSubmit} onKeyDown={submitOnEnter} className="space-y-4">
          <Field label={t.fieldProductName} required error={errors.name}>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t.placeholderName}
              error={errors.name}
              disabled={saving}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.fieldUnit}>
              <Input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder={t.placeholderUnit}
                disabled={saving}
              />
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
                    disabled={saving}
                    className="ml-auto text-xs font-semibold text-brand-600 hover:underline disabled:pointer-events-none disabled:opacity-50"
                  >
                    {t.revisePriceLink}
                  </button>
                </div>
              </Field>
            ) : (
              <Field label={t.fieldRate} required error={errors.rate}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="0.00"
                  error={errors.rate}
                  disabled={saving}
                />
              </Field>
            )}
          </div>
          <Field label={t.fieldPackaging}>
            <Select value={form.packaging} onChange={(e) => setForm({ ...form, packaging: e.target.value })} disabled={saving}>
              <option value="packet">{t.packagingLabel.packet}</option>
              <option value="cane">{t.packagingLabel.cane}</option>
            </Select>
          </Field>
          {!editingId ? (
            <Field label={t.fieldOpeningStock}>
              <Input
                type="number"
                min="0"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                placeholder={t.placeholderOpeningStock}
                disabled={saving}
              />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setModalOpen(false)} disabled={saving}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={saving}>
              {editingId ? t.saveChanges : t.addProduct}
            </PrimaryButton>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!purchaseTarget}
        onClose={
          busy
            ? () => {}
            : () => {
                setPurchaseTarget(null)
                cancelEditPurchase()
              }
        }
        title={purchaseTarget ? t.purchaseTitle(purchaseTarget.name) : ''}
      >
        {livePurchaseTarget ? (
          <form onSubmit={handlePurchaseSubmit} onKeyDown={submitOnEnter} className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Boxes size={14} className="text-slate-400" />
              {t.stockLabel}: <span className="font-semibold text-slate-800">{round3(livePurchaseTarget.stock ?? 0)} {livePurchaseTarget.unit}</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label={t.fieldPurchaseQty} required error={purchaseErrors.qty}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  autoFocus
                  value={purchaseForm.qty}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, qty: e.target.value })}
                  placeholder="0"
                  error={purchaseErrors.qty}
                  disabled={savingPurchase}
                />
              </Field>
              <Field label={t.fieldCostPerUnit} required error={purchaseErrors.cost}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchaseForm.cost}
                  onChange={(e) => setPurchaseForm({ ...purchaseForm, cost: e.target.value })}
                  placeholder="0.00"
                  error={purchaseErrors.cost}
                  disabled={savingPurchase}
                />
              </Field>
              <Field label={t.fieldPurchaseDate}>
                <AppDatePicker
                  value={purchaseForm.date}
                  onChange={(date) => setPurchaseForm({ ...purchaseForm, date })}
                  maxDate={todayISO()}
                  className="w-full"
                  disabled={savingPurchase}
                />
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600">{t.historyTitle}</p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                {(livePurchaseTarget.purchaseHistory || []).length ? (
                  [...livePurchaseTarget.purchaseHistory].reverse().map((entry) =>
                    editingPurchaseId === entry.id ? (
                      // A plain <div>, deliberately not a <form> — this
                      // renders inside the modal's own outer <form>, and a
                      // nested <form> is invalid HTML (the browser drops the
                      // inner tag, so an inner type="submit" would actually
                      // submit the OUTER Add-Purchase form instead). Enter
                      // still submits, via onKeyDown on each input below.
                      <div
                        key={entry.id}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleEditPurchaseSubmit(livePurchaseTarget.id)
                          }
                        }}
                        className="flex flex-wrap items-end gap-1.5 rounded-lg bg-white p-1.5 ring-1 ring-brand-100"
                      >
                        <div className="min-w-0 flex-1 basis-0">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            autoFocus
                            value={editPurchaseForm.qty}
                            onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, qty: e.target.value })}
                            error={editPurchaseErrors.qty}
                            disabled={savingEditPurchase}
                            className="!py-1 text-xs"
                          />
                        </div>
                        <div className="min-w-0 flex-1 basis-0">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editPurchaseForm.cost}
                            onChange={(e) => setEditPurchaseForm({ ...editPurchaseForm, cost: e.target.value })}
                            error={editPurchaseErrors.cost}
                            disabled={savingEditPurchase}
                            className="!py-1 text-xs"
                          />
                        </div>
                        <div className="min-w-0 flex-1 basis-0">
                          <AppDatePicker
                            value={editPurchaseForm.date}
                            onChange={(date) => setEditPurchaseForm({ ...editPurchaseForm, date })}
                            maxDate={todayISO()}
                            className="w-full !py-1 text-xs"
                            disabled={savingEditPurchase}
                          />
                        </div>
                        <div className="ml-auto flex shrink-0 gap-1">
                          <IconButton
                            type="button"
                            onClick={() => handleEditPurchaseSubmit(livePurchaseTarget.id)}
                            disabled={savingEditPurchase}
                            aria-label={t.saveEditPurchase}
                            title={t.saveEditPurchase}
                            tone="success"
                          >
                            <Check size={13} />
                          </IconButton>
                          <IconButton
                            type="button"
                            onClick={cancelEditPurchase}
                            disabled={savingEditPurchase}
                            aria-label={t.cancel}
                            title={t.cancel}
                          >
                            <X size={13} />
                          </IconButton>
                        </div>
                        {(editPurchaseErrors.qty || editPurchaseErrors.cost) ? (
                          <p className="w-full text-[11px] font-medium text-rose-500">{editPurchaseErrors.qty || editPurchaseErrors.cost}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div key={entry.id} className="flex items-center gap-1.5 text-xs text-slate-500">
                        <CalendarDays size={11} className="shrink-0 text-slate-400" />
                        <span className="flex-1">{t.historyEntry(entry.qty, livePurchaseTarget.unit, entry.cost, formatDate(entry.date))}</span>
                        {SHOW_EDIT_PURCHASE ? (
                          <IconButton
                            type="button"
                            onClick={() => openEditPurchase(entry)}
                            disabled={busy}
                            aria-label={t.editPurchaseTooltip}
                            title={t.editPurchaseTooltip}
                            tone="edit"
                            className="shrink-0"
                          >
                            <Pencil size={11} />
                          </IconButton>
                        ) : null}
                        <IconButton
                          type="button"
                          onClick={() => setConfirmDeletePurchaseId(entry.id)}
                          disabled={busy}
                          aria-label={t.removePurchaseTooltip}
                          title={t.removePurchaseTooltip}
                          tone="delete"
                          className="shrink-0"
                        >
                          <Trash2 size={11} />
                        </IconButton>
                      </div>
                    ),
                  )
                ) : (
                  <p className="text-xs text-slate-400">{t.historyEmpty}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <SecondaryButton
                type="button"
                onClick={() => {
                  setPurchaseTarget(null)
                  cancelEditPurchase()
                }}
                disabled={savingPurchase}
              >
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={savingPurchase}>
                {t.savePurchase}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeletePurchaseId}
        onClose={() => setConfirmDeletePurchaseId(null)}
        onConfirm={() => handleDeletePurchase(livePurchaseTarget?.id, confirmDeletePurchaseId)}
        title={t.removePurchaseTitle}
        description={t.removePurchaseDesc}
        loading={deletingPurchaseId != null}
      />

      <Modal
        isOpen={!!priceTarget}
        onClose={savingPrice ? () => {} : () => setPriceTarget(null)}
        title={priceTarget ? t.revisePriceTitle(priceTarget.name) : ''}
      >
        {priceTarget ? (
          <form onSubmit={handlePriceSubmit} onKeyDown={submitOnEnter} className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Tag size={14} className="text-slate-400" />
              {t.fieldCurrentRate}: <span className="font-semibold text-slate-800">{formatCurrency(currentRate(priceTarget))}</span>
            </div>

            <Field label={t.fieldNewRate} error={priceErrors.rate}>
              <Input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={priceForm.rate}
                onChange={(e) => setPriceForm({ ...priceForm, rate: e.target.value })}
                placeholder="0.00"
                error={priceErrors.rate}
                disabled={savingPrice}
              />
            </Field>

            <Field label={t.fieldEffectiveFrom}>
              <AppDatePicker
                value={priceForm.effectiveFrom}
                onChange={(date) => setPriceForm({ ...priceForm, effectiveFrom: date })}
                className="w-full"
                disabled={savingPrice}
              />
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
              <SecondaryButton type="button" onClick={() => setPriceTarget(null)} disabled={savingPrice}>
                {t.cancel}
              </SecondaryButton>
              <PrimaryButton type="submit" disabled={savingPrice}>
                {t.saveRevision}
              </PrimaryButton>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        isOpen={!!soldHistoryTarget}
        onClose={() => setSoldHistoryTarget(null)}
        title={soldHistoryTarget ? t.soldHistoryTitle(soldHistoryTarget.name) : ''}
      >
        {soldHistoryTarget ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Boxes size={14} className="text-slate-400" />
              {t.stockLabel}: <span className="font-semibold text-slate-800">{round3(soldHistoryTarget.stock ?? 0)} {soldHistoryTarget.unit}</span>
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              {soldHistoryLoading ? (
                <p className="text-xs text-slate-400">{t.soldHistoryLoading}</p>
              ) : soldHistoryErrorMsg ? (
                <p className="text-xs text-rose-500">
                  {soldHistoryErrorMsg === true ? t.soldHistoryLoadFailed : soldHistoryErrorMsg}
                </p>
              ) : soldHistoryEntries.length ? (
                soldHistoryEntries.map((entry) => (
                  <div key={entry.fuel_entry_id + entry.row_type} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays size={11} className="shrink-0 text-slate-400" />
                      {/* entry.qty comes back from the API as a DECIMAL column, serialized
                          as a fixed-scale string like "54.000" — Number() drops the padded
                          zeros so a whole-count sale reads as "54", not "54.000", while a
                          genuinely fractional (cane/bulk) qty like "12.500" still shows its
                          real decimals ("12.5") instead of being truncated. */}
                      {t.soldHistoryEntry(Number(entry.qty), soldHistoryTarget.unit, entry.rate, formatDate(entry.date))}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {t.soldHistoryPumpShift(entry.pump_key === 'pump1' ? 1 : 2, entry.shift_number)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400">{t.soldHistoryEmpty}</p>
              )}
            </div>
            <div className="flex justify-end pt-1">
              <SecondaryButton type="button" onClick={() => setSoldHistoryTarget(null)}>
                {t.cancel}
              </SecondaryButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={lowStockOpen} onClose={() => setLowStockOpen(false)} title={t.lowStockTitle}>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">{t.lowStockDesc(LOW_STOCK_THRESHOLD)}</p>
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {lowStockProducts.length ? (
              lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      {t.stockLabel}: <span className="font-bold text-rose-600">{round3(product.stock ?? 0)} {product.unit}</span>
                    </p>
                  </div>
                  <SecondaryButton
                    type="button"
                    onClick={() => {
                      setLowStockOpen(false)
                      openPurchase(product)
                    }}
                    className="shrink-0"
                  >
                    <PackagePlus size={14} /> {t.purchaseAction}
                  </SecondaryButton>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400">{t.lowStockEmpty}</p>
            )}
          </div>
          <div className="flex justify-end pt-1">
            <SecondaryButton type="button" onClick={() => setLowStockOpen(false)}>
              {t.cancel}
            </SecondaryButton>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => handleDelete(confirmDeleteId)}
        title={t.removeTitle}
        description={t.removeDesc}
        loading={deletingId != null}
      />
    </div>
  )
}
