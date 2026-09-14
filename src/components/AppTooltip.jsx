import Tooltip from '@mui/material/Tooltip'

// Thin wrapper around MUI's Tooltip with the app's arrow + black-background
// look baked in, so every call site just passes `title` instead of repeating
// the same slotProps override everywhere.
export default function AppTooltip({ title, children, ...props }) {
  if (!title) return children

  return (
    <Tooltip
      title={title}
      arrow
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
      {children}
    </Tooltip>
  )
}
