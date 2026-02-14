import { BarChart3, TrendingUp, TrendingDown, Calendar } from 'lucide-react'

// Mock analytics data
const weeklyStats = [
  { day: 'Mon', completed: 12, added: 8 },
  { day: 'Tue', completed: 8, added: 5 },
  { day: 'Wed', completed: 15, added: 10 },
  { day: 'Thu', completed: 10, added: 12 },
  { day: 'Fri', completed: 18, added: 6 },
]

const projectStats = [
  { name: 'Product Launch', completed: 45, total: 60, onTrack: true },
  { name: 'Client Portal', completed: 22, total: 35, onTrack: true },
  { name: 'Internal Tools', completed: 8, total: 20, onTrack: false },
  { name: 'Documentation', completed: 15, total: 18, onTrack: true },
]

export default function Reports() {
  const maxCompleted = Math.max(...weeklyStats.map(s => s.completed))
  
  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-blue-400" />
          Reports
        </h1>
        <p className="text-gray-400 mt-1">Analytics and insights</p>
      </div>
      
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <p className="text-sm text-gray-400 mb-1">Tasks Completed</p>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold">63</span>
            <span className="flex items-center text-green-400 text-sm">
              <TrendingUp className="w-4 h-4" />
              +12%
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">vs last week</p>
        </div>
        
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <p className="text-sm text-gray-400 mb-1">Tasks Added</p>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold">41</span>
            <span className="flex items-center text-red-400 text-sm">
              <TrendingDown className="w-4 h-4" />
              -5%
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">vs last week</p>
        </div>
        
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <p className="text-sm text-gray-400 mb-1">Completion Rate</p>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold">78%</span>
            <span className="flex items-center text-green-400 text-sm">
              <TrendingUp className="w-4 h-4" />
              +8%
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">vs last week</p>
        </div>
        
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <p className="text-sm text-gray-400 mb-1">Active Projects</p>
          <span className="text-3xl font-bold">4</span>
          <p className="text-xs text-gray-500 mt-1">3 on track</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly activity chart */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold">Weekly Activity</h2>
            <button className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200">
              <Calendar className="w-4 h-4" />
              This week
            </button>
          </div>
          
          {/* Simple bar chart */}
          <div className="flex items-end justify-between h-48 gap-3">
            {weeklyStats.map((stat) => (
              <div key={stat.day} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex flex-col gap-1 h-40 justify-end">
                  <div 
                    className="w-full bg-blue-500 rounded-t"
                    style={{ height: `${(stat.completed / maxCompleted) * 100}%` }}
                    title={`Completed: ${stat.completed}`}
                  />
                </div>
                <span className="text-xs text-gray-400">{stat.day}</span>
              </div>
            ))}
          </div>
          
          <div className="flex items-center justify-center gap-6 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded" />
              <span className="text-gray-400">Completed</span>
            </div>
          </div>
        </div>
        
        {/* Project progress */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h2 className="font-semibold mb-6">Project Progress</h2>
          
          <div className="space-y-4">
            {projectStats.map((project) => {
              const percentage = Math.round((project.completed / project.total) * 100)
              
              return (
                <div key={project.name}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{project.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">
                        {project.completed}/{project.total}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        project.onTrack 
                          ? 'bg-green-500/20 text-green-300' 
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {project.onTrack ? 'On track' : 'At risk'}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        project.onTrack ? 'bg-blue-500' : 'bg-orange-500'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
