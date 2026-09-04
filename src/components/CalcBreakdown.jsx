// The content rendered inside an AppTooltip for any calculated figure in the
// app — a small "show your work" breakdown so a manager (or a developer
// chasing a mismatch during a demo) can see exactly which inputs produced a
// number without leaving the screen. Every caller builds `rows`/`formula`
// from the SAME live values already used to render the figure itself (never
// a separately-memoized copy), so this can never show a stale number that
// disagrees with what's on screen.
export default function CalcBreakdown({ rows, formula, note }) {
  return (
    <div className="min-w-[180px] space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center justify-between gap-4 whitespace-nowrap text-[0.7rem]">
          <span className="text-white/75">{row.label}</span>
          <span className="font-bold">{row.value}</span>
        </div>
      ))}
      {formula ? <div className="mt-1 border-t border-white/20 pt-1 text-[0.65rem] leading-snug text-white/70">{formula}</div> : null}
      {note ? <div className="text-[0.65rem] leading-snug text-white/55">{note}</div> : null}
    </div>
  )
}
