// Shared strings used by components with no i18n file of their own (e.g.
// ConfirmDialog's default title/button labels, used across nearly every
// page). Most ConfirmDialog call sites only ever override `description` —
// leaving title/confirmLabel/cancelLabel at their defaults — so those
// defaults have to be language-aware themselves, not hardcoded English, or
// a Tamil-mode dialog reads as translated everywhere except its own buttons.
export const COMMON_TEXT = {
  en: {
    areYouSure: 'Are you sure?',
    delete: 'Delete',
    cancel: 'Cancel',
    search: 'Search...',
    noMatches: 'No matches',
  },
  ta: {
    areYouSure: 'நிச்சயமாகவா?',
    delete: 'நீக்கு',
    cancel: 'ரத்து செய்',
    search: 'தேடு...',
    noMatches: 'பொருத்தங்கள் இல்லை',
  },
}
