import { createPortal } from 'react-dom'

// 8-spoke spinner — the one shared loading icon used everywhere a busy
// state needs a visual cue: inline next to a label ("Saving…") inside a
// button or a ConfirmDialog, or as the centerpiece of the full-page block
// below. Color follows `currentColor` (set it via a text-color class on
// `className`, same as any other icon in this app); size via `style` or a
// `width`/`height` prop passed through `...props`.
function Spokes({ className = '', style, strokeWidth = 3, ...props }) {
  return (
    <>
      <style>{`
        @keyframes loading-ui-spokes-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{
          animationName: 'loading-ui-spokes-spin',
          animationDuration: 'var(--duration, 1s)',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          ...style,
        }}
        {...props}
      >
        <path
          d="M12 2V6M16.2 7.8L19.1 4.9M18 12H22M16.2 16.2L19.1 19.1M12 18V22M4.9 19.1L7.8 16.2M2 12H6M4.9 4.9L7.8 7.8"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </>
  )
}

// Used for every create/update/delete/upload busy state across the app —
// inline in a button/ConfirmDialog ("Saving…"), or as the FullPageLoader
// centerpiece below. `size` sets both svg dimensions; `className` sets the
// color via `currentColor` (e.g. the same text color class the label next
// to it already uses).
export default function Loader({ size = 18, className = '', strokeWidth = 3 }) {
  return (
    <Spokes className={`inline-block ${className}`} style={{ width: size, height: size }} strokeWidth={strokeWidth} aria-hidden="true" />
  )
}

// Covers whatever it's placed inside (give the parent `className="relative"`)
// with a translucent blocking layer + spinner — for a card/section/table
// that's mid-save and shouldn't be interacted with at all, rather than
// disabling every control inside it one by one.
export function LoaderOverlay({ label, className = '' }) {
  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-[inherit] bg-white/70 backdrop-blur-[1px] ${className}`}
    >
      <Loader size={22} className="text-brand-700" />
      {label ? <span className="text-sm font-semibold text-slate-600">{label}</span> : null}
    </div>
  )
}

// Blocks the WHOLE page — portaled straight to <body> at a higher z-index
// than Modal (z-50), so it sits on top even of an open Add/Edit or confirm
// dialog, not just the page behind them. Use this (instead of a
// per-button/per-row spinner) when nothing anywhere on the page should be
// clickable while a save is in flight, not just the control that started it.
export function FullPageLoader({ label }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm">
      <Loader size={40} className="text-brand-700" />
      {label ? <p className="text-sm font-semibold text-slate-600">{label}</p> : null}
    </div>,
    document.body,
  )
}
