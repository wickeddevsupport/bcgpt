import { Users, Mail, MoreHorizontal } from 'lucide-react'

// Mock team data
const teamMembers = [
  {
    id: 1,
    name: 'Sarah Chen',
    role: 'Product Manager',
    email: 'sarah@example.com',
    avatar: null,
    tasksAssigned: 8,
    tasksCompleted: 5,
    status: 'available',
  },
  {
    id: 2,
    name: 'Mike Johnson',
    role: 'Backend Developer',
    email: 'mike@example.com',
    avatar: null,
    tasksAssigned: 12,
    tasksCompleted: 9,
    status: 'busy',
  },
  {
    id: 3,
    name: 'Lisa Williams',
    role: 'UI/UX Designer',
    email: 'lisa@example.com',
    avatar: null,
    tasksAssigned: 6,
    tasksCompleted: 4,
    status: 'available',
  },
  {
    id: 4,
    name: 'Tom Davis',
    role: 'DevOps Engineer',
    email: 'tom@example.com',
    avatar: null,
    tasksAssigned: 5,
    tasksCompleted: 5,
    status: 'away',
  },
]

const statusColors: Record<string, string> = {
  available: 'bg-green-500',
  busy: 'bg-red-500',
  away: 'bg-yellow-500',
}

export default function People() {
  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" />
            People
          </h1>
          <p className="text-gray-400 mt-1">Team workload and availability</p>
        </div>
      </div>
      
      {/* Team grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teamMembers.map((member) => {
          const progress = Math.round((member.tasksCompleted / member.tasksAssigned) * 100)
          const workload = member.tasksAssigned - member.tasksCompleted
          
          return (
            <div 
              key={member.id}
              className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center text-lg font-medium">
                      {member.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div 
                      className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800 ${statusColors[member.status]}`}
                    />
                  </div>
                  <div>
                    <h3 className="font-medium">{member.name}</h3>
                    <p className="text-sm text-gray-400">{member.role}</p>
                  </div>
                </div>
                <button className="p-1 hover:bg-gray-700 rounded">
                  <MoreHorizontal className="w-4 h-4 text-gray-400" />
                </button>
              </div>
              
              {/* Stats */}
              <div className="space-y-3">
                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Progress</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                
                {/* Task counts */}
                <div className="flex justify-between text-sm">
                  <div>
                    <span className="text-gray-400">Assigned: </span>
                    <span className="font-medium">{member.tasksAssigned}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Active: </span>
                    <span className={`font-medium ${workload > 5 ? 'text-red-400' : 'text-green-400'}`}>
                      {workload}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Actions */}
              <div className="mt-4 pt-4 border-t border-gray-700">
                <button className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
                  <Mail className="w-4 h-4" />
                  Contact
                </button>
              </div>
            </div>
          )
        })}
      </div>
      
      {/* Workload summary */}
      <div className="mt-8 bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="font-semibold mb-4">Workload Distribution</h2>
        <div className="space-y-3">
          {teamMembers.map((member) => {
            const workload = member.tasksAssigned - member.tasksCompleted
            const maxWorkload = 10
            const percentage = Math.min((workload / maxWorkload) * 100, 100)
            
            return (
              <div key={member.id} className="flex items-center gap-4">
                <span className="w-32 text-sm truncate">{member.name}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full ${
                      percentage > 80 ? 'bg-red-500' : 
                      percentage > 50 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-12 text-right">{workload} tasks</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
