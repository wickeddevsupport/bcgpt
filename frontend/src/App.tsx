import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Today from './views/Today'
import Flows from './views/Flows'
import Agents from './views/Agents'
import Board from './views/Board'
import People from './views/People'
import Apps from './views/Apps'
import Reports from './views/Reports'
import Settings from './views/Settings'
import Login from './views/Login'
import { useStore } from './store'
import { authMe } from './api'
import './index.css'

function App() {
  const { isAuthenticated, authChecked, setUser, setAuthChecked } = useStore()

  // On first load, try to restore session from cookie.
  // Session is server-side (30-day TTL) — works from any machine/IP.
  useEffect(() => {
    void authMe().then((user) => {
      if (user) setUser({ id: user.id, name: user.name, email: user.email })
      setAuthChecked(true)
    })
  }, [setUser, setAuthChecked])

  // Still checking session
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-white font-bold text-xl">O</span>
          </div>
          <p className="text-gray-400 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  // Not logged in — show login screen
  if (!isAuthenticated) {
    return (
      <Login
        onAuthenticated={(user) => {
          setUser({ id: user.id, name: user.name, email: user.email })
        }}
      />
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/today" replace />} />
          <Route path="today" element={<Today />} />
          <Route path="flows" element={<Flows />} />
          <Route path="agents" element={<Agents />} />
          <Route path="board" element={<Board />} />
          <Route path="team" element={<People />} />
          <Route path="people" element={<People />} />
          <Route path="apps" element={<Apps />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
