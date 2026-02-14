import { NavLink } from 'react-router-dom'
import { 
  Calendar, Users, BarChart3, Settings, 
  Zap, Bot, Plug, FolderKanban 
} from 'lucide-react'

const mainNavItems = [
  { to: '/today', icon: Calendar, label: 'Today' },
  { to: '/flows', icon: Zap, label: 'Flows' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/board', icon: FolderKanban, label: 'Board' },
  { to: '/people', icon: Users, label: 'Team' },
]

const secondaryNavItems = [
  { to: '/apps', icon: Plug, label: 'Apps' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
]

export default function Sidebar() {
  return (
    <aside className="w-16 lg:w-56 bg-gray-800 border-r border-gray-700 flex flex-col transition-all">
      {/* Logo */}
      <div className="p-3 lg:p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <div className="hidden lg:block">
            <span className="text-lg font-bold">PMOS</span>
            <p className="text-xs text-gray-400">PM Operating System</p>
          </div>
        </div>
      </div>
      
      {/* Main Navigation */}
      <nav className="flex-1 p-2 lg:p-3">
        <div className="space-y-1">
          {mainNavItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md'
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                }`
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </NavLink>
          ))}
        </div>
        
        <div className="mt-6 pt-6 border-t border-gray-700/50">
          <p className="hidden lg:block text-xs text-gray-500 px-3 mb-2">More</p>
          <div className="space-y-1">
            {secondaryNavItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                  }`
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="hidden lg:block">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
      
      {/* Settings at bottom */}
      <div className="p-2 lg:p-3 border-t border-gray-700">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
              isActive
                ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-md'
                : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
            }`
          }
        >
          <Settings className="w-5 h-5 flex-shrink-0" />
          <span className="hidden lg:block">Settings</span>
        </NavLink>
      </div>
    </aside>
  )
}
