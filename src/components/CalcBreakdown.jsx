// The content rendered inside an AppTooltip for any calculated figure in the
// app — a small "show your work" breakdown so a manager (or a developer
// chasing a mismatch during a demo) can see exactly which inputs produced a
// number without leaving the screen. Every caller builds `rows`/`formula`
// from the SAME live values already used to render the figure itself (never
// a separately-memoized copy), so this can never show a stale number that
// disagrees with what's on screen.
export default function CalcBreakdown({ rows, formula, note }) {
  return (
    <div className="min-w-[180px] max-w-full space-y-1">
      {rows.map((row, i) => (
        // Deliberately NOT whitespace-nowrap (it used to be) — a long
        // label + value pair (e.g. "Pump 1 · Nozzle 1 (Shift 1 opening →
        // Shift 3 closing)" next to "1,122,413 → 1,123,491 = 1,077 L")
        // easily exceeds a phone screen's width. AppTooltip already caps
        // the tooltip itself at 92vw, but nowrap text doesn't respect a
        // container's max-width — it just overflows past it instead of
        // wrapping, which is what made these unreadable/cut off on mobile.
        // min-w-0 on both spans is required for the wrap to actually take
        // effect inside a flex row — without it, a flex item won't shrink
        // below its own unwrapped content width no matter what whitespace
        // rule is set.
        <div key={i} className="flex items-start justify-between gap-3 text-[0.7rem]">
          <span className="min-w-0 text-white/75">{row.label}</span>
          <span className="min-w-0 text-right font-bold">{row.value}</span>
        </div>
      ))}
      {formula ? <div className="mt-1 border-t border-white/20 pt-1 text-[0.65rem] leading-snug text-white/70">{formula}</div> : null}
      {note ? <div className="text-[0.65rem] leading-snug text-white/55">{note}</div> : null}
    </div>
  )
}
