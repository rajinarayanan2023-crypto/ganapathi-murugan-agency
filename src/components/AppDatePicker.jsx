import dayjs from 'dayjs'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'

// Thin wrapper around MUI's DatePicker: keeps the simple ISO-string
// (YYYY-MM-DD) value/onChange API the rest of the app already uses for
// dates, while rendering with the Indian DD/MM/YYYY format and a look that
// matches our Tailwind inputs.
export default function AppDatePicker({
  value,
  onChange,
  maxDate,
  minDate,
  className = '',
  disabled,
  variant = 'default',
  shouldDisableDate,
  // Adds MUI's own built-in "x" clear button to the field, correctly
  // positioned alongside its calendar icon (unlike a hand-rolled overlay
  // button, which fights the same corner). Off by default — most call
  // sites (e.g. a required "Effective From") never want the value emptied
  // this way; a filter field (e.g. Fuel Entry's history date filter) is the
  // one case that does.
  clearable = false,
  // A genuine fixed width for the DEFAULT variant (number of px, or any CSS
  // width string) — a plain `w-[Npx]` className alone can't do this (see
  // `fullWidth`'s own comment just below): MUI's own fullWidth class still
  // wins the specificity fight, so the field silently renders at 100% of
  // its flex parent instead. `compact` already has its own hardcoded fixed
  // width for a different (small, tinted-chip) look; this is for a normal-
  // looking field that just needs to not grow to fill its row — e.g. a
  // "From"/"To" filter pair that has to sit alongside other controls
  // without pushing them off a single row.
  fixedWidth,
}) {
  const isInline = variant === 'inline'
  const isCompact = variant === 'compact'

  return (
    <DatePicker
      value={value ? dayjs(value) : null}
      onChange={(newValue) => {
        if (newValue && newValue.isValid()) {
          onChange(newValue.format('YYYY-MM-DD'))
        }
      }}
      maxDate={maxDate ? dayjs(maxDate) : undefined}
      minDate={minDate ? dayjs(minDate) : undefined}
      format="DD/MM/YYYY"
      disabled={disabled}
      // Kept as a plain ISO-string predicate at the call site (same
      // "no dayjs outside this file" contract as value/onChange above) —
      // only translated to the dayjs object MUI's own prop expects here.
      shouldDisableDate={shouldDisableDate ? (day) => shouldDisableDate(day.format('YYYY-MM-DD')) : undefined}
      slotProps={{
        field: clearable ? { clearable: true, onClear: () => onChange('') } : undefined,
        textField: {
          size: 'small',
          className,
          // MUI's own supported way to make a TextField fill its container
          // — a plain `w-full` className was landing here too, but MUI's
          // own emotion-generated styles are injected after Tailwind's
          // stylesheet and can still win the width tie, which is exactly
          // why this field kept rendering wider/narrower than a sibling
          // plain <input> under the same equal-width grid. `fullWidth`
          // sets width via MUI's own class, so it can't lose that fight.
          // The compact variant (and, same reasoning, an explicit
          // fixedWidth) wants its own fixed width instead (see the
          // `!important` width below) — fullWidth sets width:100% on the
          // OUTER .MuiFormControl-root wrapper, not the inner
          // .MuiOutlinedInput-root an sx override targets, so leaving
          // fullWidth on would keep the wrapper at 100% regardless of what
          // the sx rule sets on that inner element — it has to be off, not
          // just out-sized, for a fixed width to actually take.
          fullWidth: !isCompact && !fixedWidth,
          sx: isInline
            ? {
                '& .MuiOutlinedInput-root': {
                  borderRadius: '6px',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  backgroundColor: 'transparent',
                  '& fieldset': { border: 'none' },
                  '&:hover fieldset': { border: 'none' },
                  '&.Mui-focused fieldset': { border: '1.5px solid #c46f36' },
                },
                '& .MuiInputBase-input': {
                  padding: '1px 2px',
                  cursor: 'pointer',
                  color: '#1e293b',
                },
                '& .MuiInputAdornment-root': { marginLeft: '2px' },
                '& .MuiIconButton-root': { padding: '2px' },
                '& .MuiSvgIcon-root': { fontSize: '16px' },
              }
            : isCompact
              ? {
                  '& .MuiOutlinedInput-root': {
                    // Set here, not via the `className` prop above — this is
                    // the ONE place `fullWidth` (see the comment on that
                    // prop) actually bit: a plain `w-[Npx]` className on this
                    // component lost the specificity fight against MUI's own
                    // fullWidth class, so the field silently rendered at
                    // 100% of its flex parent instead of the intended fixed
                    // width, wide enough to spill past the card's edge.
                    // `sx` compiles through MUI's own styling pipeline, so it
                    // wins reliably where a className couldn't.
                    width: '112px !important',
                    height: '24px !important',
                    borderRadius: '7px',
                    fontSize: '0.75rem',
                    fontFamily: 'inherit',
                    backgroundColor: '#fbe8d9 !important',
                    '& fieldset': { borderColor: '#e2e8f0' },
                    '&:hover fieldset': { borderColor: '#c46f36' },
                    '&.Mui-focused fieldset': { borderColor: '#c46f36', borderWidth: '1.5px' },
                  },
                  '& .MuiInputBase-input': {
                    padding: '0 6px',
                    backgroundColor: 'transparent',
                  },
                  '& .MuiInputAdornment-root': { marginLeft: '0' },
                  '& .MuiIconButton-root': { padding: '2px' },
                  '& .MuiSvgIcon-root': { fontSize: '13px' },
                }
              : {
                  // MUI X's DatePicker field (PickersTextField) renders its
                  // visual box as .MuiPickersOutlinedInput-root, NOT the
                  // classic .MuiOutlinedInput-root a plain MUI TextField
                  // uses — targeting only the classic name (as this used to)
                  // silently matched nothing at all, so no rule in this
                  // whole block — not even the background color below — was
                  // ever actually reaching the field. Keeping the classic
                  // selector alongside it is harmless and future-proofs
                  // against a MUI version where it's the one that's real.
                  '& .MuiPickersOutlinedInput-root, & .MuiOutlinedInput-root': {
                    borderRadius: '10px',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit',
                    backgroundColor: '#fbe8d9 !important',
                    ...(fixedWidth ? { width: `${typeof fixedWidth === 'number' ? `${fixedWidth}px` : fixedWidth} !important` } : null),
                    '& fieldset': { borderColor: '#e2e8f0' },
                    '&:hover fieldset': { borderColor: '#c46f36' },
                    '&.Mui-focused fieldset': { borderColor: '#c46f36', borderWidth: '1.5px' },
                  },
                  '& .MuiInputBase-input': {
                    padding: '8px 12px',
                    backgroundColor: 'transparent',
                  },
                },
        },
        popper: {
          placement: 'bottom-start',
          modifiers: [
            { name: 'flip', enabled: true, options: { fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] } },
            { name: 'preventOverflow', enabled: true, options: { boundary: 'viewport', altAxis: true, padding: 8 } },
          ],
          sx: {
            '& .MuiPaper-root': { borderRadius: '12px', backgroundColor: '#fbe8d9 !important' },
            '& .MuiDateCalendar-root': { width: '260px', height: '300px' },
            '& .MuiPickersCalendarHeader-root': { minHeight: '32px', marginTop: '4px', marginBottom: '2px', paddingLeft: '8px', paddingRight: '4px' },
            '& .MuiPickersCalendarHeader-label': { fontSize: '0.8125rem' },
            '& .MuiPickersCalendarHeader-switchViewButton': { padding: '2px' },
            '& .MuiPickersArrowSwitcher-button': { padding: '4px' },
            '& .MuiDayCalendar-weekDayLabel': { width: '30px', height: '30px', fontSize: '0.6875rem' },
            '& .MuiPickersDay-root': { width: '30px', height: '30px', fontSize: '0.75rem' },
            '& .MuiPickersYear-yearButton, & .MuiPickersMonth-monthButton': { fontSize: '0.8125rem' },
            '& .MuiPickersDay-root.Mui-selected': { backgroundColor: '#c46f36' },
            '& .MuiPickersDay-root.Mui-selected:hover': { backgroundColor: '#9c5629' },
            '& .MuiPickersDay-root:focus.Mui-selected': { backgroundColor: '#c46f36' },
          },
        },
      }}
    />
  )
}
