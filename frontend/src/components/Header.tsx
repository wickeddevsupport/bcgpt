import { ChevronDown, Bell, User } from 'lucide-react'
import { useStore } from '../store'

export default function Header() {
  const { currentProject, user } = useStore()
  
  return (
    <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
      {/* Project selector */}
      <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors">
        <span className="text-sm font-medium">
          {currentProject?.name || 'Select Project'}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      
      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="p-2 rounded-lg hover:bg-gray-700 transition-colors relative">
          <Bell className="w-5 h-5 text-gray-400" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full" />
        </button>
        
        {/* User menu */}
        <button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-700 transition-colors">
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 bg-gray-600 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-gray-300" />
            </div>
          )}
          <span className="text-sm">{user?.name || 'Guest'}</span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>
      </div>
    </header>
  )
}
