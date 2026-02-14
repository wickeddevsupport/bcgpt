import { Calendar, CheckCircle2, Clock, AlertCircle } from 'lucide-react'

// Mock data for now - will be replaced with real API calls
const todayTasks = [
  { id: 1, title: 'Review Q1 roadmap draft', project: 'Product Launch', due: '10:00 AM', priority: 'high' },
  { id: 2, title: 'Team standup meeting', project: 'Daily Ops', due: '10:30 AM', priority: 'medium' },
  { id: 3, title: 'Update sprint backlog', project: 'Product Launch', due: '2:00 PM', priority: 'medium' },
  { id: 4, title: 'Client feedback review', project: 'Client Portal', due: '4:00 PM', priority: 'low' },
]

const recentActivity = [
  { id: 1, user: 'Sarah', action: 'completed', item: 'Design mockups', time: '5 min ago' },
  { id: 2, user: 'Mike', action: 'commented on', item: 'API integration', time: '15 min ago' },
  { id: 3, user: 'Lisa', action: 'created', item: 'Bug: Login issue', time: '1 hour ago' },
]

export default function Today() {
  const completedToday = 3
  const totalToday = 8
  const progress = Math.round((completedToday / totalToday) * 100)
  
  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calendar className="w-6 h-6 text-blue-400" />
          Today
        </h1>
        <p className="text-gray-400 mt-1">
          {new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
          })}
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column - Tasks */}
        <div className="lg:col-span-2 space-y-6">
          {/* Progress card */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Today's Progress</h2>
              <span className="text-2xl font-bold text-blue-400">{progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400 mt-2">
              {completedToday} of {totalToday} tasks completed
            </p>
          </div>
          
          {/* Task list */}
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h2 className="font-semibold">Due Today</h2>
            </div>
            <ul className="divide-y divide-gray-700">
              {todayTasks.map((task) => (
                <li key={task.id} className="p-4 hover:bg-gray-750 transition-colors">
                  <div className="flex items-center gap-3">
                    <button className="text-gray-500 hover:text-green-400 transition-colors">
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                    <div className="flex-1">
                      <p className="font-medium">{task.title}</p>
                      <p className="text-sm text-gray-400">{task.project}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-400">{task.due}</span>
                    </div>
                    {task.priority === 'high' && (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        
        {/* Sidebar - Activity */}
        <div className="space-y-6">
          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-2xl font-bold text-green-400">12</p>
              <p className="text-sm text-gray-400">Completed</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-2xl font-bold text-orange-400">5</p>
              <p className="text-sm text-gray-400">In Progress</p>
            </div>
          </div>
          
          {/* Recent activity */}
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="p-4 border-b border-gray-700">
              <h2 className="font-semibold">Recent Activity</h2>
            </div>
            <ul className="divide-y divide-gray-700">
              {recentActivity.map((activity) => (
                <li key={activity.id} className="p-4">
                  <p className="text-sm">
                    <span className="font-medium text-blue-400">{activity.user}</span>
                    {' '}{activity.action}{' '}
                    <span className="font-medium">{activity.item}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{activity.time}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
