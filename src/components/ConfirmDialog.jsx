import { useState } from 'react'
import Modal from './Modal.jsx'
import Loader from './Loader.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { COMMON_TEXT } from '../i18n/common.js'

// `loading` is opt-in and undefined by default — omitting it keeps every
// existing call site's original behavior exactly (fire onConfirm, close
// immediately). A caller that passes `loading` (even as `false`) is telling
// this component "I manage my own async state": the Confirm/Cancel buttons
// disable and the dialog stops closing itself the instant Confirm is
// clicked (backdrop click and Escape too, via the guarded onClose passed to
// Modal) — the caller is then responsible for closing once its own request
// actually finishes, succeeding or failing, so a slow request can't be
// double-fired and a failed one no longer silently closes as if it worked.
// 'danger' (default) is every destructive confirm (delete, logout, discard)
// — Confirm is the bold red action, Cancel stays a plain outline. 'leave' is
// for an unsaved-changes prompt, where the SAFE choice (going back to save)
// should read as the prominent one and the riskier "leave anyway" should
// read as the muted, de-emphasized one — the reverse of 'danger'.
const CONFIRM_TONE_STYLES = {
  danger: {
    cancel: 'rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
    confirm:
      'inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
  },
  leave: {
    cancel:
      'rounded-lg bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-600/30 transition-all hover:from-brand-600 hover:to-brand-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
    confirm:
      'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
  },
  // For a real, consequential-but-not-destructive action (e.g. sending an
  // actual WhatsApp message to a customer) — 'danger' reads as alarming for
  // this ("delete"-red Send button), and 'leave' inverts the wrong pair
  // (it's built for "stay vs. discard unsaved changes"). Confirm gets the
  // same bold brand-gradient styling PrimaryButton uses everywhere else;
  // Cancel stays the same plain outline as 'danger'.
  brand: {
    cancel:
      'rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
    confirm:
      'inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-600/30 transition-all hover:from-brand-600 hover:to-brand-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
  },
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmTone = 'danger',
  // Optional: gives the Cancel/left-slot button its own action instead of
  // just dismissing (used by the unsaved-changes prompt's "Save" button, to
  // actually save before closing) — X/backdrop/Escape still just call
  // onClose, unaffected. Managed with its own internal busy state (below)
  // since, unlike `loading`, none of this component's callers need to
  // track that themselves.
  onCancelClick,
  loading,
}) {
  const { language } = useLanguage()
  const commonT = COMMON_TEXT[language]
  // Almost every call site only ever overrides `description` — title and
  // both button labels are left at their defaults, so those defaults have
  // to come from the current language too, not a hardcoded English string,
  // or a Tamil-mode dialog reads as translated everywhere except its own
  // buttons. An explicit override (any call site that DOES pass one, e.g. a
  // more specific "Discard" or "Deactivate" label) always wins.
  const resolvedTitle = title ?? commonT.areYouSure
  const resolvedConfirmLabel = confirmLabel ?? commonT.delete
  const resolvedCancelLabel = cancelLabel ?? commonT.cancel

  const [cancelBusy, setCancelBusy] = useState(false)
  const controlled = loading !== undefined
  const busy = (controlled && loading) || cancelBusy
  const styles = CONFIRM_TONE_STYLES[confirmTone] || CONFIRM_TONE_STYLES.danger

  async function handleCancelClick() {
    if (!onCancelClick) {
      onClose()
      return
    }
    setCancelBusy(true)
    try {
      await onCancelClick()
    } finally {
      setCancelBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => {} : onClose} title={resolvedTitle} maxWidth="max-w-sm">
      <p className="text-sm text-slate-600">{description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={handleCancelClick} disabled={busy} className={styles.cancel}>
          {cancelBusy ? (
            <>
              <Loader className={confirmTone === 'leave' ? 'text-white' : undefined} /> {resolvedCancelLabel}…
            </>
          ) : (
            resolvedCancelLabel
          )}
        </button>
        <button
          onClick={() => {
            onConfirm()
            if (!controlled) onClose()
          }}
          disabled={busy}
          className={styles.confirm}
        >
          {busy && !cancelBusy ? (
            <>
              <Loader className={confirmTone === 'leave' ? undefined : 'text-white'} /> {resolvedConfirmLabel}…
            </>
          ) : (
            resolvedConfirmLabel
          )}
        </button>
      </div>
    </Modal>
  )
}
