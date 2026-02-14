import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import ChatSidebar from './ChatSidebar'

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Left Sidebar - Navigation */}
      <Sidebar />
      
      {/* Main content area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <Header />
        
        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      
      {/* Right Sidebar - AI Chat */}
      <ChatSidebar />
    </div>
  )
}
