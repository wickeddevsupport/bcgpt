import { useState } from 'react'
import { ChevronDown, Bell, User, LogOut } from 'lucide-react'
import { useStore } from '../store'
import { authLogout } from '../api'

export default function Header() {
  const { currentProject, user, setUser } = useStore()
  const [showMenu, setShowMenu] = useState(false)

  const handleLogout = async () => {
    await authLogout()
    setUser(null)
    // Redirect to root so App re-checks auth and shows login
    window.location.href = '/'
  }

  return (
    <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
      {/* Project selector */}
      <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-colors">
        <span className="text-sm font-medium">
          {currentProject?.name || 'OpenClaw'}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Notifications */}
        <button className="p-2 rounded-lg hover:bg-gray-700 transition-colors relative">
          <Bell className="w-5 h-5 text-gray-400" />
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((prev) => !prev)}
            className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-700 transition-colors"
          >
            <div className="w-7 h-7 bg-gradient-to-br from-orange-500 to-orange-600 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm">{user?.name || 'Account'}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 py-1">
                {user?.email && (
                  <div className="px-3 py-2 border-b border-gray-700">
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                )}
                <button
                  onClick={() => void handleLogout()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
