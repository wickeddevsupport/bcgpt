import { LayoutGrid, Plus, MoreHorizontal } from 'lucide-react'

// Mock kanban data
const columns = [
  {
    id: 'backlog',
    title: 'Backlog',
    cards: [
      { id: 1, title: 'Research competitor features', tags: ['research'], assignee: 'Sarah' },
      { id: 2, title: 'Create user personas', tags: ['design'], assignee: 'Mike' },
    ],
  },
  {
    id: 'todo',
    title: 'To Do',
    cards: [
      { id: 3, title: 'Design landing page', tags: ['design', 'priority'], assignee: 'Lisa' },
      { id: 4, title: 'Set up CI/CD pipeline', tags: ['devops'], assignee: 'Tom' },
      { id: 5, title: 'Write API documentation', tags: ['docs'], assignee: 'Sarah' },
    ],
  },
  {
    id: 'in-progress',
    title: 'In Progress',
    cards: [
      { id: 6, title: 'Implement user auth', tags: ['backend', 'priority'], assignee: 'Tom' },
      { id: 7, title: 'Build dashboard UI', tags: ['frontend'], assignee: 'Lisa' },
    ],
  },
  {
    id: 'review',
    title: 'Review',
    cards: [
      { id: 8, title: 'Payment integration', tags: ['backend'], assignee: 'Mike' },
    ],
  },
  {
    id: 'done',
    title: 'Done',
    cards: [
      { id: 9, title: 'Project setup', tags: ['devops'], assignee: 'Tom' },
      { id: 10, title: 'Database schema', tags: ['backend'], assignee: 'Sarah' },
    ],
  },
]

const tagColors: Record<string, string> = {
  design: 'bg-purple-500/20 text-purple-300',
  research: 'bg-blue-500/20 text-blue-300',
  backend: 'bg-green-500/20 text-green-300',
  frontend: 'bg-orange-500/20 text-orange-300',
  devops: 'bg-cyan-500/20 text-cyan-300',
  docs: 'bg-gray-500/20 text-gray-300',
  priority: 'bg-red-500/20 text-red-300',
}

export default function Board() {
  return (
    <div className="h-full">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-blue-400" />
            Board
          </h1>
          <p className="text-gray-400 mt-1">Drag and drop to organize tasks</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" />
          Add Task
        </button>
      </div>
      
      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <div 
            key={column.id} 
            className="flex-shrink-0 w-72 bg-gray-800/50 rounded-xl"
          >
            {/* Column header */}
            <div className="p-3 flex items-center justify-between border-b border-gray-700">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{column.title}</h3>
                <span className="px-2 py-0.5 text-xs bg-gray-700 rounded-full">
                  {column.cards.length}
                </span>
              </div>
              <button className="p-1 hover:bg-gray-700 rounded">
                <MoreHorizontal className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            
            {/* Cards */}
            <div className="p-2 space-y-2">
              {column.cards.map((card) => (
                <div 
                  key={card.id}
                  className="bg-gray-800 rounded-lg p-3 border border-gray-700 
                           hover:border-gray-600 cursor-pointer transition-colors"
                >
                  <p className="font-medium text-sm mb-2">{card.title}</p>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {card.tags.map((tag) => (
                      <span 
                        key={tag}
                        className={`px-2 py-0.5 text-xs rounded ${tagColors[tag] || 'bg-gray-700'}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center text-xs">
                      {card.assignee[0]}
                    </div>
                    <span className="text-xs text-gray-400">{card.assignee}</span>
                  </div>
                </div>
              ))}
              
              {/* Add card button */}
              <button className="w-full p-2 text-sm text-gray-400 hover:text-gray-200 
                               hover:bg-gray-700 rounded-lg transition-colors flex items-center 
                               justify-center gap-1">
                <Plus className="w-4 h-4" />
                Add card
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
