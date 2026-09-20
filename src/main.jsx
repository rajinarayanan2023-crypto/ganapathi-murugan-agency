import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import 'dayjs/locale/ta'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { DataProvider } from './context/DataContext.jsx'
import { LanguageProvider, useLanguage } from './context/LanguageContext.jsx'
import { registerPrimeReactLocale } from './i18n/primereactLocale.js'
import muiTheme from './muiTheme.js'
import 'primereact/resources/themes/lara-light-amber/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'
import './index.css'
import './datatable-theme.css'

registerPrimeReactLocale()

function LocalizedApp() {
  const { language } = useLanguage()
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={language === 'ta' ? 'ta' : 'en'}>
      {/* Last-resort safety net: Layout's own ErrorBoundary only wraps the
          routed page content (<Outlet />), not the sidebar/header around it —
          a render crash there (e.g. a data-driven translation lookup that's
          only ever missing for some rarely-hit value, surfacing after the
          app's been used for a while) had nowhere to be caught, so React
          unmounted the ENTIRE tree and the whole app went blank instead of
          just the one broken page. resetKey={language}: switching the
          language again — the most likely next thing someone tries after a
          blank screen — remounts this from scratch and clears the error on
          its own, without needing to find the "Try again" button first. */}
      <ErrorBoundary resetKey={language} fullScreen>
        <App />
      </ErrorBoundary>
    </LocalizationProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <DataProvider>
        <LanguageProvider>
          <ThemeProvider theme={muiTheme}>
            <LocalizedApp />
          </ThemeProvider>
        </LanguageProvider>
      </DataProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
