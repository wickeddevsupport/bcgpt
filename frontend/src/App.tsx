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
import './index.css'

function App() {
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
