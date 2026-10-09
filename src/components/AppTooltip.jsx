import Tooltip from '@mui/material/Tooltip'

// Thin wrapper around MUI's Tooltip with the app's arrow + black-background
// look baked in, so every call site just passes `title` instead of repeating
// the same slotProps override everywhere.
export default function AppTooltip({ title, children, ...props }) {
  if (!title) return children

  return (
    <Tooltip
      title={title}
      // A real `disabled` native <button>/<input> neither fires mouse
      // events nor accepts the ref MUI's Tooltip clones onto its child
      // (confirmed live: elementFromPoint still resolved to the disabled
      // button itself, yet a genuine mouse hover there never opened the
      // tooltip) — this is a browser-level behavior for disabled form
      // controls, not something CSS like `pointer-events` controls. Most
      // call sites here disable the very element they wrap (a staff-only
      // "Add X" button, a disabled icon action) specifically so the
      // tooltip can explain WHY it's disabled, which is exactly the case
      // this breaks. Wrapping every child in a plain, same-sized span
      // (MUI's own documented fix for this) gives the Tooltip something
      // that always responds to hover/focus, regardless of whether — or
      // how — whatever is inside it is disabled.
      arrow
      // MUI's own default requires a 700ms press-and-hold on a touchscreen
      // before a tooltip opens at all — a normal tap does nothing, which is
      // exactly what "tooltip doesn't respond" looks like on a tablet/phone
      // (this app is used on-site, not just at a desktop). A normal tap now
      // opens it immediately, same as a mouse hover already does.
      enterTouchDelay={0}
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: '#000000',
            color: '#ffffff',
            fontSize: '0.7rem',
            fontWeight: 600,
            borderRadius: '6px',
            px: 1.25,
            py: 0.6,
            // MUI's own default caps every tooltip at 300px wide — fine for a
            // short label, but CalcBreakdown's rows (e.g. the audit litres
            // formula's "1,122,413 → 1,123,491 = 1,077 L" lines) are
            // deliberately single-line (whitespace-nowrap) and easily wider
            // than that, so they were getting silently clipped instead of
            // the tooltip growing to fit. Capped at the viewport width, not
            // removed outright, so it still can't overflow a narrow screen.
            maxWidth: 'min(480px, 92vw)',
          },
        },
        arrow: {
          sx: { color: '#000000' },
        },
      }}
      {...props}
    >
      {/* min-w-0 — a flex item's default min-width is `auto` (its own
          content's natural width), not 0, so without this a long truncating
          child wrapped in here (e.g. a product name with `truncate`) could
          never actually shrink below its full text width no matter how
          tightly its own flex/grid parent tried to squeeze this span —
          the overflow just spilled out instead of ellipsizing. Purely
          permissive (only ever lets something shrink further when its
          parent is already trying to shrink it); every other call site that
          isn't inside a shrinking flex/grid context is unaffected. */}
      <span className="inline-flex min-w-0">{children}</span>
    </Tooltip>
  )
}
