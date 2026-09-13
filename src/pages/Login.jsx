import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Fuel, Mail, Lock, Eye, EyeOff, ArrowLeft, CheckCircle2, Sparkles, Loader2 } from 'lucide-react'
import { useData } from '../context/DataContext.jsx'
import AppTooltip from '../components/AppTooltip.jsx'
import { apiPost } from '../lib/apiClient.js'

// Fires on every successful login (previously just the first one per
// browser — deliberately made unconditional since a "sometimes" welcome felt
// broken rather than special). Replaces the brief "Login Successful" card
// and itself navigates to /dashboard when done — never shown pre-login.
const WELCOME_DURATION_MS = 2600

// Mirrors the backend's OTP_EXPIRE_MINUTES (app/core/otp_store.py) — purely
// a countdown display here, the backend is still the one actually
// rejecting an expired code; keep these two in sync if either changes.
// Resend is gated on this SAME countdown (not a separate, shorter one) —
// showing "Resend OTP" while the current code still works just invites an
// accidental click that throws away a perfectly good code.
const OTP_VALIDITY_SECONDS = 90

const inputBase =
  'w-full rounded-[10px] border-[1.5px] bg-white py-3 text-sm text-slate-800 outline-none transition-all placeholder:text-slate-400'
const inputNormal = 'border-slate-200 focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(201,145,28,0.15)]'
const inputError = 'border-rose-400 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.15)]'

export default function Login() {
  const { login, station } = useData()
  const navigate = useNavigate()

  // Only ever set to true after a successful login (see handleVerifyOtp) —
  // never on page load, so it can't appear before the user has signed in.
  const [showWelcome, setShowWelcome] = useState(false)

  const [step, setStep] = useState('credentials') // 'credentials' | 'otp' | 'success'
  const [userId, setUserId] = useState(null)

  // ---------- Step 1: credentials ----------
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [userError, setUserError] = useState('')
  const [passError, setPassError] = useState('')
  const [userShakeKey, setUserShakeKey] = useState(0)
  const [passShakeKey, setPassShakeKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  function triggerFieldError(which, message) {
    if (which === 'user') {
      setUserError(message)
      setUserShakeKey((k) => k + 1)
    } else {
      setPassError(message)
      setPassShakeKey((k) => k + 1)
    }
  }

  async function requestOtp() {
    const data = await apiPost('/auth/login', { identifier: username.trim(), password })
    setUserId(data.user_id)
    return data
  }

  async function handleCredentialsSubmit(e) {
    e.preventDefault()
    let valid = true

    if (!username.trim()) {
      triggerFieldError('user', 'Please enter your username or email.')
      valid = false
    } else {
      setUserError('')
    }

    if (password.length < 6) {
      triggerFieldError('pass', 'Password must be at least 6 characters.')
      valid = false
    } else {
      setPassError('')
    }

    if (!valid) return

    setSubmitting(true)
    try {
      const data = await requestOtp()
      // TESTING BYPASS — the backend's /auth/login currently returns real
      // tokens directly (see auth_controller.py) instead of sending an OTP
      // email, while Railway's outbound-SMTP block is worked around. Detect
      // that shape and skip straight to the dashboard. This block is safe to
      // leave in place even after the backend reverts: data.access_token
      // simply won't be present, and the OTP step below runs as before.
      if (data.access_token) {
        login({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user })
        setStep('success')
        setShowWelcome(true)
        setTimeout(() => navigate('/dashboard'), WELCOME_DURATION_MS)
        return
      }
      setStep('otp')
    } catch (err) {
      triggerFieldError('user', err.message)
      triggerFieldError('pass', err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- Step 2: OTP ----------
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [otpError, setOtpError] = useState('')
  const [otpShakeKey, setOtpShakeKey] = useState(0)
  const [poppingIndex, setPoppingIndex] = useState(-1)
  // Counts down the OTP's own validity window — also what gates the Resend
  // OTP button below (see the render further down): it only appears once
  // this hits 0, i.e. once the current code has actually stopped working.
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(OTP_VALIDITY_SECONDS)
  const [verifying, setVerifying] = useState(false)
  // Resend hits the real /auth/login endpoint again, which now sends an
  // email (a synchronous SMTP round-trip — a couple of seconds, not
  // instant) instead of the old SMS — without this, the button gave zero
  // feedback while that was in flight and felt broken/unresponsive.
  const [resending, setResending] = useState(false)
  const otpRefs = useRef([])

  useEffect(() => {
    if (step !== 'otp' || otpSecondsLeft <= 0) return
    const t = setTimeout(() => setOtpSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [step, otpSecondsLeft])

  useEffect(() => {
    if (step === 'otp') {
      setOtpSecondsLeft(OTP_VALIDITY_SECONDS)
      otpRefs.current[0]?.focus()
    }
  }, [step])

  function handleOtpChange(index, rawValue) {
    const value = rawValue.replace(/[^0-9]/g, '').slice(-1)
    setOtp((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
    setOtpError('')
    if (value) {
      setPoppingIndex(index)
      setTimeout(() => setPoppingIndex(-1), 250)
      if (index < 5) otpRefs.current[index + 1]?.focus()
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  function handleOtpPaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6)
    if (!text) return
    const digits = text.split('')
    setOtp((prev) => {
      const next = [...prev]
      digits.forEach((d, i) => {
        next[i] = d
      })
      return next
    })
    const lastIndex = Math.min(digits.length, 6) - 1
    if (lastIndex >= 0) otpRefs.current[lastIndex]?.focus()
  }

  async function handleVerifyOtp() {
    const entered = otp.join('')
    if (entered.length < 6) {
      setOtpError('Enter the full 6-digit OTP.')
      setOtpShakeKey((k) => k + 1)
      return
    }

    setVerifying(true)
    try {
      const data = await apiPost('/auth/verify-otp', { user_id: userId, otp: entered })
      login({ accessToken: data.access_token, refreshToken: data.refresh_token, user: data.user })
      setStep('success')
      setShowWelcome(true)
      setTimeout(() => navigate('/dashboard'), WELCOME_DURATION_MS)
    } catch (err) {
      setOtpError(err.message)
      setOtpShakeKey((k) => k + 1)
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (otpSecondsLeft > 0 || resending) return
    setResending(true)
    setOtp(['', '', '', '', '', ''])
    setOtpError('')
    otpRefs.current[0]?.focus()
    try {
      await requestOtp()
      setOtpSecondsLeft(OTP_VALIDITY_SECONDS)
    } catch (err) {
      setOtpError(err.message)
    } finally {
      setResending(false)
    }
  }

  function formatMmSs(totalSeconds) {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen items-center justify-center overflow-hidden bg-brand-50 px-4 py-4">
        <div className="relative w-full max-w-[420px]">
          <div className="relative overflow-hidden rounded-2xl p-[2.5px] shadow-[0_20px_45px_-12px_rgba(0,0,0,0.2)]">
            <motion.div
              className="absolute inset-[-150%]"
              style={{
                background:
                  step === 'success'
                    ? 'conic-gradient(from 0deg, transparent 0deg, transparent 260deg, #43A047 300deg, #7be3a0 320deg, #43A047 340deg, transparent 360deg)'
                    : 'conic-gradient(from 0deg, transparent 0deg, transparent 260deg, #c46f36 300deg, #f1c5a0 320deg, #c46f36 340deg, transparent 360deg)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
            />

            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="relative overflow-hidden rounded-[14px] bg-white px-8 py-9"
            >
            <div className="mb-7 flex flex-col items-center text-center">
              <div className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950">
                <Fuel size={24} className="text-brand-400" />
              </div>
              <h1 className="font-cinzel bg-gradient-to-r from-slate-900 to-brand-600 bg-clip-text text-lg font-bold uppercase tracking-[2px] text-transparent">
                {station.name}
              </h1>
              <p className="mt-1.5 text-xs text-slate-500">
                {station.dealerType} &middot; SAP No: {station.sapNo}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {step === 'credentials' && (
                <motion.form
                  key="credentials"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.35 }}
                  onSubmit={handleCredentialsSubmit}
                >
                  <div className="mb-[18px]">
                    <label className="mb-[7px] block text-[12.5px] font-semibold text-slate-600">Username / Email</label>
                    <motion.div key={userShakeKey} animate={userError ? { x: [0, -8, 8, -5, 5, 0] } : {}} transition={{ duration: 0.45 }}>
                      <div className="relative flex items-center">
                        <Mail size={17} className="pointer-events-none absolute left-[13px] text-slate-400" />
                        <input
                          type="text"
                          value={username}
                          onChange={(e) => {
                            setUsername(e.target.value)
                            setUserError('')
                          }}
                          placeholder="admin"
                          autoComplete="username"
                          className={`${inputBase} pl-10 pr-3.5 ${userError ? inputError : inputNormal}`}
                        />
                      </div>
                    </motion.div>
                    {userError ? <p className="mt-1.5 text-xs text-rose-500">{userError}</p> : null}
                  </div>

                  <div className="mb-[18px]">
                    <label className="mb-[7px] block text-[12.5px] font-semibold text-slate-600">Password</label>
                    <motion.div key={passShakeKey} animate={passError ? { x: [0, -8, 8, -5, 5, 0] } : {}} transition={{ duration: 0.45 }}>
                      <div className="relative flex items-center">
                        <Lock size={17} className="pointer-events-none absolute left-[13px] text-slate-400" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value)
                            setPassError('')
                          }}
                          placeholder="admin123"
                          autoComplete="current-password"
                          className={`${inputBase} pl-10 pr-11 ${passError ? inputError : inputNormal}`}
                        />
                        <AppTooltip title={showPassword ? 'Hide password' : 'Show password'}>
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-3 flex text-slate-400 transition-all hover:scale-110 hover:text-brand-600"
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </AppTooltip>
                      </div>
                    </motion.div>
                    {passError ? <p className="mt-1.5 text-xs text-rose-500">{passError}</p> : null}
                  </div>

                  <GoldButton type="submit" disabled={submitting}>
                    {submitting ? 'Signing In…' : 'Sign In'}
                  </GoldButton>
                </motion.form>
              )}

              {step === 'otp' && (
                <motion.form
                  key="otp"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.35 }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleVerifyOtp()
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setStep('credentials')}
                    className="mb-[18px] inline-flex items-center gap-1 text-[13px] text-slate-500 transition-colors hover:text-brand-700"
                  >
                    <ArrowLeft size={15} /> Back
                  </button>

                  <h2 className="mb-2 text-lg font-bold text-slate-900">Verify Your Identity</h2>
                  <p className="mb-[22px] text-[13px] leading-relaxed text-slate-500">
                    Enter the 6-digit OTP sent to your registered email
                  </p>

                  <motion.div
                    key={otpShakeKey}
                    animate={otpError ? { x: [0, -8, 8, -5, 5, 0] } : {}}
                    transition={{ duration: 0.45 }}
                    className="mb-2 flex justify-center gap-2"
                  >
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => (otpRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        onPaste={handleOtpPaste}
                        className={`h-14 w-12 rounded-[10px] border-[1.5px] bg-white text-center text-xl font-bold text-slate-800 outline-none transition-transform ${
                          otpError ? inputError : inputNormal
                        } ${poppingIndex === i ? 'animate-pop' : ''}`}
                      />
                    ))}
                  </motion.div>
                  {otpError ? <p className="mb-[18px] text-center text-[12.5px] text-rose-500">{otpError}</p> : <div className="mb-[18px]" />}

                  <div className="mb-[22px] text-center text-[13px]">
                    {otpSecondsLeft > 0 ? (
                      <span className="font-bold text-slate-700">Expires in {formatMmSs(otpSecondsLeft)}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resending}
                        className="inline-flex items-center gap-1.5 font-semibold text-brand-700 transition-colors hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                      >
                        {resending ? (
                          <>
                            <Loader2 size={13} className="animate-spin" /> Sending…
                          </>
                        ) : (
                          'Code expired — Resend OTP'
                        )}
                      </button>
                    )}
                  </div>

                  <GoldButton type="submit" disabled={verifying}>
                    {verifying ? 'Verifying…' : 'Verify OTP'}
                  </GoldButton>
                </motion.form>
              )}

              {step === 'success' && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center py-1 text-center"
                >
                  <div className="mb-[18px] flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50">
                    <CheckCircle2 size={30} className="text-emerald-600" />
                  </div>
                  <h3 className="font-cinzel mb-2 bg-gradient-to-r from-slate-900 to-brand-600 bg-clip-text text-[19px] tracking-wide text-transparent">
                    Login Successful!
                  </h3>
                  <p className="text-[13.5px] text-slate-500">Redirecting to your dashboard&hellip;</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          </div>

          {/* <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
            Sri Vinayagar Thunai &middot; {station.mobiles.join(' / ')}
          </p> */}
        </div>
      </div>

      <AnimatePresence>
        {showWelcome ? <WelcomeOverlay station={station} onSkip={() => navigate('/dashboard')} /> : null}
      </AnimatePresence>
    </MotionConfig>
  )
}

// Shown over the "Login Successful" card every time OTP verification
// succeeds. Navigation to /dashboard is driven by the caller (a timer, or
// immediately on tap-to-skip) — this component is purely
// the animation itself.
function WelcomeOverlay({ station, onSkip }) {
  const words = station.name.split(' ')
  const wordsDoneDelay = 0.35 + words.length * 0.12

  return (
    <motion.div
      onClick={onSkip}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-brand-950 to-slate-950 px-6 text-center"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeInOut' } }}
    >
      <motion.div
        className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-ocean-500/20 blur-3xl"
        animate={{ scale: [1, 1.25, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:56px_56px]" />

      <motion.div
        initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.1 }}
        className="relative mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 shadow-[0_0_60px_rgba(245,168,0,0.5)]"
      >
        <Fuel size={40} className="text-white" />
        <motion.div
          className="absolute inset-0 rounded-full border-2 border-brand-300/60"
          animate={{ scale: [1, 1.4, 1.4], opacity: [0.8, 0, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      </motion.div>

      <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2.5">
        {words.map((word, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 + i * 0.12, ease: 'easeOut' }}
            className="font-cinzel text-2xl font-bold uppercase tracking-[2px] text-white sm:text-3xl"
          >
            {word}
          </motion.span>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: wordsDoneDelay + 0.15 }}
        className="mb-8 flex items-center gap-1.5 text-sm font-medium text-brand-200"
      >
        <Sparkles size={14} /> Welcome — your dashboard awaits
      </motion.p>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: WELCOME_DURATION_MS / 1000, ease: 'linear' }}
        style={{ originX: 0 }}
        className="h-[3px] w-40 rounded-full bg-gradient-to-r from-brand-400 to-brand-200"
      />
      <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-white/40">Tap anywhere to continue</p>
    </motion.div>
  )
}

function GoldButton({ children, className = '', ...props }) {
  return (
    <button
      className={`group relative w-full overflow-hidden rounded-[10px] bg-gradient-to-r from-brand-500 to-brand-700 py-[13px] text-[15px] font-bold text-white shadow-md shadow-brand-600/30 transition-all hover:-translate-y-0.5 hover:from-brand-600 hover:to-brand-800 hover:shadow-lg active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      <span className="pointer-events-none absolute inset-y-0 -left-3/4 w-1/2 -skew-x-[20deg] bg-gradient-to-r from-transparent via-white/30 to-transparent transition-all duration-500 group-hover:left-full" />
      {children}
    </button>
  )
}
