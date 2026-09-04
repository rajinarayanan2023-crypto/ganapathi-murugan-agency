import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Fuel } from 'lucide-react'
import { useData } from './context/DataContext.jsx'
import Layout from './components/Layout.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Employees from './pages/Employees.jsx'
import Attendance from './pages/Attendance.jsx'
import Salary from './pages/Salary.jsx'
import EmployeeCredits from './pages/EmployeeCredits.jsx'
import FuelEntry from './pages/FuelEntry.jsx'
import FuelEntryForm from './pages/FuelEntryForm.jsx'
import Lubricants from './pages/Lubricants.jsx'
import CreditBills from './pages/CreditBills.jsx'
import Offers from './pages/Offers.jsx'
import Expenses from './pages/Expenses.jsx'

// Shown only while a saved session is being silently restored after a real
// browser refresh (see DataContext's authRestoring) — a beat of visible
// "something is happening" instead of a blank white page for however long
// that one network round trip takes.
function AuthRestoringScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-slate-950">
        <Fuel size={24} className="text-brand-400" />
      </div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, authRestoring } = useData()
  if (authRestoring) return <AuthRestoringScreen />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            fontSize: '13px',
            fontWeight: 500,
            borderRadius: '10px',
            boxShadow: '0 8px 24px -4px rgba(16,24,40,0.15)',
          },
          success: {
            style: {
              background: '#ecfdf5',
              color: '#065f46',
              border: '1px solid #a7f3d0',
            },
            iconTheme: { primary: '#10b981', secondary: '#ffffff' },
          },
          error: {
            style: {
              background: '#fef2f2',
              color: '#9f1239',
              border: '1px solid #fecdd3',
            },
            iconTheme: { primary: '#e11d48', secondary: '#ffffff' },
          },
        }}
      />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/salary" element={<Salary />} />
          <Route path="/employee-credits" element={<EmployeeCredits />} />
          <Route path="/fuel-entry" element={<FuelEntry />} />
          <Route path="/fuel-entry/new" element={<FuelEntryForm />} />
          <Route path="/fuel-entry/:entryId/edit" element={<FuelEntryForm />} />
          <Route path="/lubricants" element={<Lubricants />} />
          <Route path="/credit-bills" element={<CreditBills />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/expenses" element={<Expenses />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
