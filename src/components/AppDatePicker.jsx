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
          // The compact variant wants its own small fixed width instead
          // (see the `!important` width below) — fullWidth would otherwise
          // still fight that, so it's skipped just for this variant.
          fullWidth: !isCompact,
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
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '10px',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit',
                    backgroundColor: '#fbe8d9 !important',
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
