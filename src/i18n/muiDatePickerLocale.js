import { enUS } from '@mui/x-date-pickers/locales'

// MUI X Date Pickers ships no Indian-language locale at all (see every
// export of @mui/x-date-pickers/locales — nothing for 'ta' or any other
// Indian language). `adapterLocale="ta"` on LocalizationProvider (main.jsx)
// only switches dayjs's own month/day names and date formatting; it does
// NOT translate the picker's own UI strings — nav-button aria-labels, the
// field's per-section "Day"/"Month"/"Year" accessible names, the Today/
// Clear button text, the "Choose date, selected date is ..." field
// description, etc. Without this override those stayed in English even in
// Tamil mode, which is exactly why AppDatePicker.jsx (the app's one and
// only MUI DatePicker usage) still read as half-English after everything
// else had been translated.
const enDefaults = enUS.components.MuiLocalizationProvider.defaultProps.localeText

export const MUI_DATE_PICKER_TA_LOCALE_TEXT = {
  ...enDefaults,
  previousMonth: 'முந்தைய மாதம்',
  nextMonth: 'அடுத்த மாதம்',
  openPreviousView: 'முந்தைய காட்சியைத் திற',
  openNextView: 'அடுத்த காட்சியைத் திற',
  calendarViewSwitchingButtonAriaLabel: (view) =>
    view === 'year'
      ? 'ஆண்டு காட்சி திறந்துள்ளது, நாள்காட்டி காட்சிக்கு மாறவும்'
      : 'நாள்காட்டி காட்சி திறந்துள்ளது, ஆண்டு காட்சிக்கு மாறவும்',
  cancelButtonLabel: 'ரத்து செய்',
  clearButtonLabel: 'அழி',
  okButtonLabel: 'சரி',
  todayButtonLabel: 'இன்று',
  datePickerToolbarTitle: 'தேதியைத் தேர்ந்தெடு',
  calendarWeekNumberHeaderLabel: 'வார எண்',
  calendarWeekNumberAriaLabelText: (weekNumber) => `வாரம் ${weekNumber}`,
  openDatePickerDialogue: (formattedDate) =>
    formattedDate ? `தேதியைத் தேர்ந்தெடு, தேர்ந்தெடுக்கப்பட்ட தேதி ${formattedDate}` : 'தேதியைத் தேர்ந்தெடு',
  fieldClearLabel: 'அழி',
  dateTableLabel: 'தேதியைத் தேர்ந்தெடு',
  year: 'ஆண்டு',
  month: 'மாதம்',
  day: 'நாள்',
  weekDay: 'வார நாள்',
}
