import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, CalendarCheck, Fuel, Droplet, Wallet, IndianRupee, Megaphone, Receipt, LogOut, Languages, KeyRound, ChevronLeft, ChevronRight, Calculator } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { LAYOUT_TEXT } from '../i18n/layout.js'
import toast from 'react-hot-toast'
import ErrorBoundary from './ErrorBoundary.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import Modal from './Modal.jsx'
import { Field, PasswordInput, PrimaryButton, SecondaryButton } from './FormControls.jsx'
import AppTooltip from './AppTooltip.jsx'
import { FullPageLoader } from './Loader.jsx'
import CashCalculatorModal from './CashCalculatorModal.jsx'
import useIdleLogout from '../hooks/useIdleLogout.js'
import { CASH_CALCULATOR_TEXT } from '../i18n/cashCalculator.js'

// Matches the backend's own IDLE_TIMEOUT_MINUTES (app/core/config.py /
// .env's idle_timeout_minutes) — that one force-expires the refresh token
// server-side at the same mark. Keeping both at 4 hours means this
// client-side timer is what a user actually sees fire; if the two ever
// drift apart, whichever is SHORTER wins in practice.
const IDLE_LOGOUT_MS = 4 * 60 * 60 * 1000

const NAV_ITEMS = [
  { to: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { to: '/employees', key: 'employees', icon: Users },
  { to: '/attendance', key: 'attendance', icon: CalendarCheck },
  { to: '/salary', key: 'salary', icon: IndianRupee },
  { to: '/fuel-entry', key: 'fuelEntry', icon: Fuel },
  { to: '/lubricants', key: 'lubricants', icon: Droplet },
  { to: '/credit-bills', key: 'creditBills', icon: Wallet },
  { to: '/expenses', key: 'expenses', icon: Receipt },
  { to: '/offers', key: 'offers', icon: Megaphone },
]

// Reachable only via the button on the Salary page, not the sidebar/bottom
// nav (see NAV_ITEMS above) — kept separate so it doesn't render as its own
// tab there, but still needs an entry here so the header title below
// resolves to "Employee Credits" instead of falling back to "Dashboard".
const EXTRA_TITLE_ROUTES = [{ to: '/employee-credits', key: 'employeeCredits' }]

export default function Layout() {
  const { station, logout, changePassword, currentUser, hasUnsavedChanges, saveUnsavedChangesHandler } = useData()
  const { language, toggleLanguage } = useLanguage()
  const t = LAYOUT_TEXT[language]
  const cashCalcT = CASH_CALCULATOR_TEXT[language]
  const [cashCalcOpen, setCashCalcOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  // Set by whichever page currently has unsaved work (see DataContext) — a
  // sidebar/bottom-nav click while that's true is intercepted here instead
  // of navigating straight away, same prompt either nav renders through.
  const [pendingNavTo, setPendingNavTo] = useState(null)
  function handleNavClick(e, to) {
    if (!hasUnsavedChanges) return
    e.preventDefault()
    setPendingNavTo(to)
  }
  function confirmNav() {
    const to = pendingNavTo
    setPendingNavTo(null)
    if (to) navigate(to)
  }
  // "Save" in this prompt: ask whichever page registered a save handler
  // (see DataContext) to actually save its dirty work, and only navigate
  // once that's genuinely succeeded — a failed/blocked save leaves the
  // manager on the current page, right where the error is.
  async function handleSaveAndNav() {
    const to = pendingNavTo
    const ok = saveUnsavedChangesHandler ? await saveUnsavedChangesHandler() : true
    setPendingNavTo(null)
    if (ok && to) navigate(to)
  }
  // Covers what a click-through NavLink guard above can't: closing the tab,
  // a real page refresh, typing a new URL, or the browser's own back/
  // forward buttons. Only the browser's own generic prompt text is possible
  // here (no custom modal can run during unload) — a firm, if plain, second
  // line of defense under the nicer custom one above.
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined
    function onBeforeUnload(e) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedChanges])
  const [collapsed, setCollapsed] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState({})
  const [savingPassword, setSavingPassword] = useState(false)
  const mobileNavRef = useRef(null)

  // Navigating to a page (via a sidebar icon) auto-collapses the sidebar to
  // its icon-only rail, so the page gets the full width. Only reacts to an
  // actual route change, not the initial mount.
  const prevPathRef = useRef(location.pathname)
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setCollapsed(true)
      prevPathRef.current = location.pathname
    }
  }, [location.pathname])

  // Keep the active bottom-nav tab visible when it's scrolled off to the
  // side — e.g. landing on Offers (the last tab) shouldn't leave the user
  // staring at Dashboard/Employees with no clue the bar even scrolls.
  useEffect(() => {
    const activeEl = mobileNavRef.current?.querySelector('[data-active="true"]')
    activeEl?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [location.pathname])

  function confirmLogout() {
    logout()
    toast.success(t.toastLoggedOut)
    navigate('/')
  }

  // Auto sign-out after IDLE_LOGOUT_MS of no mouse/keyboard/touch/scroll
  // activity anywhere on the page — independent of (and much shorter than,
  // for now — see the constant above) the backend's own idle_timeout_minutes
  // enforced on /auth/refresh. This one runs client-side, doesn't require a
  // network round-trip to notice, and fires even if the access token hasn't
  // actually expired yet.
  useIdleLogout(IDLE_LOGOUT_MS, () => {
    logout()
    toast.error(t.toastLoggedOutIdle)
    navigate('/')
  })

  function openPasswordModal() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordErrors({})
    setPasswordModalOpen(true)
  }

  // Mirrors the backend's own validate_password_strength (app/schemas/user.py,
  // PasswordChange's 8-character minimum) so an obviously-too-weak password
  // is caught here instead of round-tripping to the server just to get the
  // same rejection back.
  function passwordStrengthError(password) {
    if (password.length < 8) return t.errorPasswordTooShort
    if (!/[A-Z]/.test(password)) return t.errorPasswordNeedsUppercase
    if (!/[a-z]/.test(password)) return t.errorPasswordNeedsLowercase
    if (!/\d/.test(password)) return t.errorPasswordNeedsDigit
    return null
  }

  async function submitPasswordChange(e) {
    e.preventDefault()
    const errors = {}
    if (!currentPassword) errors.currentPassword = t.errorCurrentPasswordRequired
    const strengthError = passwordStrengthError(newPassword)
    if (strengthError) errors.newPassword = strengthError
    if (confirmPassword !== newPassword) errors.confirmPassword = t.errorPasswordMismatch
    setPasswordErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSavingPassword(true)
    try {
      await changePassword(currentPassword, newPassword)
    } catch (err) {
      setSavingPassword(false)
      // The one error this endpoint actually returns for a bad request is a
      // wrong current password — surface it right on that field rather than
      // a generic toast, so it reads as "that's wrong" not "something broke".
      // Stores `true` as a "use the generic fallback" marker instead of
      // baking t.errorCurrentPasswordWrong in here — the actual translated
      // text is resolved at render time (see the Field below), so toggling
      // language while this error is still showing re-localizes it
      // immediately instead of leaving it stuck in whatever language it was
      // originally shown in.
      setPasswordErrors({ currentPassword: err.message || true })
      return
    }
    setSavingPassword(false)
    setPasswordModalOpen(false)
    // The API just revoked every refresh token for this account (including
    // the one this session is using), so the current session is dead too —
    // sign out immediately rather than leaving the UI in a state that looks
    // logged in but will fail the next silent token refresh.
    toast.success(t.toastPasswordChanged)
    logout()
    navigate('/')
  }

  const currentKey = [...NAV_ITEMS, ...EXTRA_TITLE_ROUTES].find((n) => location.pathname.startsWith(n.to))?.key || 'dashboard'
  const currentLabel = t.nav[currentKey]

  return (
    <div className="min-h-screen lg:flex lg:h-screen lg:overflow-hidden">
      {/* Desktop sidebar — collapsible icon rail on lg+; phones and tablets
          get the bottom tab bar below instead, so this never needs its own
          mobile/tablet layout. */}
      <aside
        className={`relative hidden shrink-0 border-r border-brand-100 bg-brand-50 shadow-card-hover transition-[width] duration-300 lg:sticky lg:top-0 lg:z-20 lg:flex lg:h-screen lg:flex-col ${
          collapsed ? 'w-[76px]' : 'w-64'
        }`}
      >
        <AppTooltip title={collapsed ? t.expandSidebar : t.collapseSidebar}>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
            className="absolute -right-3 top-6 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-brand-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </AppTooltip>

        <div className={`flex items-center border-b border-brand-100 ${collapsed ? 'justify-center py-3' : 'gap-2.5 px-5 py-4'}`}>
          <div className={`flex shrink-0 items-center justify-center ${collapsed ? 'h-8 w-8' : 'h-10 w-14'}`}>
            <img src={station.logo} alt={station.name} className="h-full w-full object-contain" />
          </div>
          {collapsed ? null : (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight text-slate-900">{station.name}</p>
              <p className="text-xs font-medium text-slate-500">{station.dealerType}</p>
            </div>
          )}
        </div>

        <nav className={`flex-1 overflow-y-auto overflow-x-hidden ${collapsed ? 'space-y-2 px-4 py-3' : 'space-y-1 px-3 py-3'}`}>
          {NAV_ITEMS.map((item) => (
            <AppTooltip key={item.to} title={collapsed ? t.nav[item.key] : ''} placement="right">
              {/* MUI Tooltip clones its child to attach hover/ref handlers, which
                  can't merge with NavLink's function-style `className` prop (it
                  gets silently dropped, losing all sizing). Give it a plain
                  span to clone instead and keep NavLink untouched inside. */}
              <span className="block">
                <NavLink
                  to={item.to}
                  onClick={(e) => handleNavClick(e, item.to)}
                  className={({ isActive }) =>
                    collapsed
                      ? `mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                          isActive ? 'bg-white text-brand-700 shadow-sm' : 'bg-white/40 text-slate-600 hover:bg-white/80 hover:text-slate-900'
                        }`
                      : `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                          isActive ? 'bg-white font-bold text-brand-700 shadow-sm' : 'font-semibold text-slate-600 hover:bg-white/60 hover:text-slate-900'
                        }`
                  }
                >
                  <item.icon size={19} strokeWidth={2} />
                  {collapsed ? null : t.nav[item.key]}
                </NavLink>
              </span>
            </AppTooltip>
          ))}
        </nav>

        <div className={`border-t border-brand-100 py-3 ${collapsed ? 'space-y-2 px-4' : 'space-y-1 px-3'}`}>
          <AppTooltip title={collapsed ? t.changePassword : ''} placement="right">
            <button
              onClick={openPasswordModal}
              className={
                collapsed
                  ? 'mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white/40 text-slate-600 transition-colors hover:bg-white/80 hover:text-slate-900 active:scale-[0.98]'
                  : 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-white/60 hover:text-slate-900 active:scale-[0.98]'
              }
            >
              <KeyRound size={18} />
              {collapsed ? null : t.changePassword}
            </button>
          </AppTooltip>
          <AppTooltip title={collapsed ? t.logout : ''} placement="right">
            <button
              onClick={() => setLogoutConfirmOpen(true)}
              className={
                collapsed
                  ? 'mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white/40 text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]'
                  : 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]'
              }
            >
              <LogOut size={18} />
              {collapsed ? null : t.logout}
            </button>
          </AppTooltip>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-brand-100 bg-brand-50 px-4 py-3.5 shadow-card-hover backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-12 shrink-0 items-center justify-center">
              <img src={station.logo} alt={station.name} className="h-full w-full object-contain" />
            </div>
            <span className="text-sm font-bold text-slate-900">{station.name}</span>
          </div>
          <h1 className="hidden text-base font-semibold text-slate-800 lg:block">{currentLabel}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLanguage}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 active:scale-95"
            >
              <Languages size={14} />
              {language === 'en' ? 'தமிழ்' : 'English'}
            </button>
            {/* Money-green + a bigger icon on purpose — every other header
                button (language, admin avatar) shares the same gold/slate
                tones, so this one is deliberately a different color to
                stand out at a glance instead of blending in as "just
                another small circle". */}
            <AppTooltip title={cashCalcT.cashCalculator}>
              <button
                onClick={() => setCashCalcOpen(true)}
                aria-label={cashCalcT.cashCalculator}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md shadow-emerald-600/40 transition-transform hover:scale-110 hover:shadow-lg active:scale-95"
              >
                <Calculator size={19} strokeWidth={2.3} />
              </button>
            </AppTooltip>
            {/* Name is the prominent line (up to ~10 characters comfortably,
                on one line via whitespace-nowrap — this sits in a flexible
                trailing group, not a fixed-width box, so it can't clip a
                longer one either) with the role as a small caption below it,
                not the other way around. */}
            <div className="hidden text-right sm:block">
              <p className="whitespace-nowrap text-sm font-bold text-slate-900">{currentUser?.name || station.dealerName}</p>
              <p className="whitespace-nowrap text-[11px] font-semibold text-brand-700">{t.admin}</p>
            </div>
            <AppTooltip title={t.changePassword}>
              <button
                onClick={openPasswordModal}
                aria-label={t.changePassword}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 transition-transform hover:scale-105 active:scale-95"
              >
                AD
              </button>
            </AppTooltip>
            <AppTooltip title={t.logout}>
              <button
                onClick={() => setLogoutConfirmOpen(true)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 lg:hidden"
                aria-label={t.logout}
              >
                <LogOut size={18} />
              </button>
            </AppTooltip>
          </div>
        </header>

        <main className="relative flex-1 px-4 pb-24 pt-5 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:px-8 lg:pb-8">
          <AnimatePresence mode="wait">
            {/* lg:h-full (not unprefixed h-full) — below the lg breakpoint
                `main` has no definite height of its own (mobile/tablet pages
                just scroll the whole page normally, on purpose), so an
                unconditional h-full would resolve against nothing. At lg+,
                `main` IS definitely sized (flex-1 inside the lg:h-screen
                shell above), so this gives a page that opts in (see
                Employees.jsx) a real height to flex-fill instead of relying
                on a guessed `calc(100vh - Npx)` pixel offset that drifts out
                of sync the moment that page's own header content changes. */}
            <motion.div
              key={language}
              className="lg:h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
            >
              <ErrorBoundary resetKey={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom nav — 9 items is too many to evenly divide a phone's
          width without squeezing labels into overlapping mush, so each item
          keeps a fixed, readable min-width and the bar scrolls horizontally
          instead (the active tab auto-scrolls into view on route change). */}
      <nav
        ref={mobileNavRef}
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-slate-200 bg-white/95 backdrop-blur [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            data-active={location.pathname.startsWith(item.to) || undefined}
            to={item.to}
            onClick={(e) => handleNavClick(e, item.to)}
            className={({ isActive }) =>
              `flex min-w-[72px] shrink-0 flex-col items-center gap-0.5 px-1.5 py-2.5 text-center text-[11px] font-medium leading-tight transition-colors ${
                isActive ? 'text-brand-600' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={20} strokeWidth={isActive ? 2.4 : 2} />
                {t.navShort[item.key]}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <ConfirmDialog
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={confirmLogout}
        title={t.logoutTitle}
        description={t.logoutDesc}
        confirmLabel={t.logout}
      />

      <ConfirmDialog
        isOpen={!!pendingNavTo}
        onClose={() => setPendingNavTo(null)}
        onCancelClick={handleSaveAndNav}
        onConfirm={confirmNav}
        title={t.unsavedChangesTitle}
        description={t.unsavedChangesDesc}
        confirmLabel={t.unsavedChangesLeave}
        cancelLabel={t.unsavedChangesStay}
        confirmTone="leave"
      />

      {savingPassword ? <FullPageLoader label={t.savingPassword} /> : null}

      <CashCalculatorModal isOpen={cashCalcOpen} onClose={() => setCashCalcOpen(false)} />

      <Modal
        isOpen={passwordModalOpen}
        onClose={savingPassword ? () => {} : () => setPasswordModalOpen(false)}
        title={t.changePassword}
      >
        <form onSubmit={submitPasswordChange} className="space-y-4">
          <Field
            label={t.fieldCurrentPassword}
            required
            error={passwordErrors.currentPassword === true ? t.errorCurrentPasswordWrong : passwordErrors.currentPassword}
          >
            <PasswordInput
              autoFocus
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label={t.fieldNewPassword} required error={passwordErrors.newPassword}>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs text-slate-400">{t.newPasswordHint}</p>
          </Field>
          <Field label={t.fieldConfirmPassword} required error={passwordErrors.confirmPassword}>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <SecondaryButton type="button" onClick={() => setPasswordModalOpen(false)} disabled={savingPassword}>
              {t.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={savingPassword}>
              {t.savePassword}
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  )
}
