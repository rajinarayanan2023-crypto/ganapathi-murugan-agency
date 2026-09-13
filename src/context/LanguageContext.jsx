import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { locale as setPrimeReactLocale } from 'primereact/api'

const LanguageContext = createContext(null)

// Same storage prefix/pattern DataContext's own usePersistedState uses for
// every other small user preference (station info, fuel rates, ...) — kept
// here instead of imported since that helper isn't exported, and this is a
// single, simple value. Without this, the language choice lived only in
// React state: a real page reload (or the tab being reopened later) always
// came back up in English no matter what was last selected, with nothing on
// screen to explain why — exactly the kind of "sometimes it just changes
// back" glitch that's easy to notice but hard to pin down.
const LANGUAGE_STORAGE_KEY = 'ga-fuel-pump:language'

function loadPersistedLanguage() {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return raw === 'ta' ? 'ta' : 'en'
  } catch {
    return 'en'
  }
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(loadPersistedLanguage)

  // PrimeReact's own built-in strings (column filter menu, etc.) are driven by
  // a global locale setting, not a per-component prop — keep it in sync here
  // so every DataTable instance picks up the change automatically.
  useEffect(() => {
    setPrimeReactLocale(language === 'ta' ? 'ta' : 'en')
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Storage full/unavailable (e.g. private browsing) — the toggle still
      // works for the rest of this session, it just won't survive a reload.
    }
  }, [language])

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => setLanguage((prev) => (prev === 'en' ? 'ta' : 'en')),
    }),
    [language],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
