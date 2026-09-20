import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, Children } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, Eye, EyeOff } from 'lucide-react'
import AppTooltip from './AppTooltip.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { COMMON_TEXT } from '../i18n/common.js'

export function Field({ label, required, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label ? (
        <span className="mb-1.5 block text-xs font-semibold text-slate-600">
          {label}
          {required ? <span className="text-rose-500"> *</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-rose-500">{error}</span> : null}
    </label>
  )
}

const baseInput =
  'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100'

// Defaults `title` to the field's own value so hovering a narrow input
// (e.g. the compact reading/amount cells in the Fuel Entry form) shows the
// full number as a native tooltip — pass an explicit `title` to override.
// Never auto-fills for password fields — that would leak the value on hover.
//
// type="number" also gets: the native up/down spinner hidden (it eats into
// the width a long totalizer reading needs) and the mouse scroll-wheel
// disarmed (a focused number input silently increments/decrements on scroll
// by default — a stray scroll while reading the page would otherwise
// corrupt a reading without the manager noticing).
export function Input({ error, className = '', title, value, type, onWheel, ...props }) {
  const autoTitle = type === 'password' ? title : title ?? (value === undefined || value === null || value === '' ? undefined : String(value))
  const numberFix =
    type === 'number' ? '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none' : ''
  return (
    <input
      type={type}
      value={value}
      title={autoTitle}
      onWheel={type === 'number' ? (e) => { e.currentTarget.blur(); onWheel?.(e) } : onWheel}
      className={`${baseInput} ${numberFix} ${error ? 'border-rose-300' : 'border-slate-200'} ${className}`}
      {...props}
    />
  )
}

// Password field with a show/hide toggle — same props as Input, minus
// `type` (always starts masked). Visibility is local to each instance, so
// the New/Confirm/Current fields in a form like Change Password toggle
// independently of one another.
export function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={`pr-10 ${className}`} {...props} />
      <AppTooltip title={visible ? 'Hide password' : 'Show password'}>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 flex text-slate-400 transition-colors hover:text-brand-600"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </AppTooltip>
    </div>
  )
}

// Drop-in replacement for a native <select> — same props (value, onChange,
// <option> children) so every call site works unchanged — but every list
// gets a type-to-filter search box, which a plain <select> can't offer once
// a dropdown (employees, customers, products, ...) grows past a handful of options.
export function Select({ error, className = '', children, value, onChange, disabled, id, 'aria-label': ariaLabel, ...props }) {
  const { language } = useLanguage()
  const commonT = COMMON_TEXT[language]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuPos, setMenuPos] = useState(null)
  const containerRef = useRef(null)
  const menuRef = useRef(null)
  const searchInputRef = useRef(null)

  const options = useMemo(
    () =>
      Children.toArray(children)
        .filter((child) => child?.props)
        .map((child) => ({ value: child.props.value, label: child.props.children })),
    [children],
  )

  const selected = options.find((o) => String(o.value) === String(value ?? ''))

  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const q = query.trim().toLowerCase()
    return options.filter((o) => String(o.label).toLowerCase().includes(q))
  }, [options, query])

  // The menu is portaled to <body> (see below) so a scrollable ancestor —
  // the payments list, a modal's own scroll body, anywhere — can't clip it.
  // Since it's no longer a normal DOM child of the trigger, its position has
  // to be measured and tracked by hand instead of just `absolute` + `top-full`.
  useLayoutEffect(() => {
    if (!open) return
    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    // capture: true so this also fires for scrolling inside any nested
    // scroll container (the payments list, a modal body), not just the window.
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e) {
      if (containerRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
      setQuery('')
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) searchInputRef.current?.focus()
  }, [open])

  function pick(option) {
    onChange?.({ target: { value: option.value } })
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // A focused <button> treats Enter as "click me" (toggle the
          // menu) rather than submitting the form the way a native
          // <select> does — so once a value is already picked and the
          // menu is closed, forward Enter to the enclosing form instead.
          if (e.key === 'Enter' && !open) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
        className={`${baseInput} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
          error ? 'border-rose-300' : 'border-slate-200'
        } ${className}`}
        {...props}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>{selected ? selected.label : options[0]?.label || ''}</span>
        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              className="z-50 min-w-[10rem] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card-hover"
            >
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1.5">
                <Search size={13} className="shrink-0 text-slate-400" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={commonT.search}
                  className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
              <ul className="max-h-56 overflow-y-auto py-1 text-sm">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-slate-400">{commonT.noMatches}</li>
                ) : (
                  filtered.map((o) => {
                    const isSelected = String(o.value) === String(value ?? '')
                    return (
                      <li key={String(o.value)}>
                        <button
                          type="button"
                          onClick={() => pick(o)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-brand-50 ${
                            isSelected ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700'
                          }`}
                        >
                          <span className="truncate">{o.label}</span>
                          {isSelected ? <Check size={13} className="shrink-0 text-brand-600" /> : null}
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

// Pressing Enter in a plain text/number field should try to save, same as
// any native form's implicit submission — but that doesn't fire reliably
// for every field/browser combination in practice (this app's forms kept
// getting reported as "Enter does nothing"), so it's triggered by hand
// instead of relying on it. Attach directly to a <form>'s onKeyDown. Only
// for a plain <input> — never a <textarea> (Enter there means a new line,
// e.g. a customer's notes field) and never a <button> (which would double
// up with the browser's own Enter-triggers-click on whichever button is
// focused, e.g. a Select's trigger — see its own Enter handling above).
export function submitOnEnter(e) {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.defaultPrevented) return
  e.preventDefault()
  e.currentTarget.requestSubmit()
}

export function Textarea({ error, className = '', ...props }) {
  return (
    <textarea
      className={`${baseInput} ${error ? 'border-rose-300' : 'border-slate-200'} ${className}`}
      {...props}
    />
  )
}

// forwardRef here (and on SecondaryButton below) isn't optional decoration —
// AppTooltip (MUI's Tooltip underneath) clones its child and attaches a ref
// to it to track hover/position; a plain function component can't accept
// that ref, which silently breaks the tooltip and throws a console warning
// ("Function components cannot be given refs") wherever one of these is
// wrapped in a tooltip, as Offers.jsx's disabled-send-button hint was.
export const PrimaryButton = forwardRef(function PrimaryButton({ className = '', children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-600/30 transition-all hover:from-brand-600 hover:to-brand-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})

export const SecondaryButton = forwardRef(function SecondaryButton({ className = '', children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})

// Every tone keeps its tint visible at rest (not just on hover) so the
// action an icon performs — edit, delete, download, etc. — reads at a glance.
const ICON_BUTTON_TONES = {
  neutral: 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-600',
  edit: 'bg-amber-50 text-amber-600 hover:bg-amber-100',
  delete: 'bg-rose-50 text-rose-600 hover:bg-rose-100',
  success: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100',
  info: 'bg-violet-50 text-violet-600 hover:bg-violet-100',
  download: 'bg-ocean-50 text-ocean-700 hover:bg-ocean-100',
  brand: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
}

export function IconButton({ tone = 'neutral', className = '', type = 'button', title, children, ...props }) {
  return (
    <AppTooltip title={title}>
      <button
        type={type}
        className={`inline-flex items-center justify-center rounded-lg p-2 transition-colors active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 ${ICON_BUTTON_TONES[tone] || ICON_BUTTON_TONES.neutral} ${className}`}
        {...props}
      >
        {children}
      </button>
    </AppTooltip>
  )
}
