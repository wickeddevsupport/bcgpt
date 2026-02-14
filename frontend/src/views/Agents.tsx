import { useState, useEffect } from 'react'
import { Bot, Plus, RefreshCw, Play, Pause, Settings2, Trash2, Clock } from 'lucide-react'

interface Agent {
  id: string
  name: string
  description: string
  status: 'active' | 'paused' | 'error'
  schedule?: string
  lastRun?: string
  tools: string[]
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  
  useEffect(() => {
    loadAgents()
  }, [])
  
  const loadAgents = async () => {
    setLoading(true)
    try {
      const response = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'list_agents', arguments: {} },
          id: Date.now()
        })
      })
      const data = await response.json()
      if (data.result?.content?.[0]?.text) {
        const parsed = JSON.parse(data.result.content[0].text)
        setAgents(parsed.agents || [])
      }
    } catch (error) {
      console.error('Failed to load agents:', error)
    } finally {
      setLoading(false)
    }
  }
  
  const toggleAgent = async (agentId: string, currentStatus: string) => {
    const action = currentStatus === 'active' ? 'pause_agent' : 'run_agent'
    try {
      await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: action, arguments: { agent_id: agentId } },
          id: Date.now()
        })
      })
      loadAgents()
    } catch (error) {
      console.error('Failed to toggle agent:', error)
    }
  }
  
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6 text-purple-400" />
            Agents
          </h1>
          <p className="text-gray-400 mt-1">AI agents that work for you 24/7</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadAgents}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-500 
                     rounded-lg hover:from-purple-500 hover:to-purple-400 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Create Agent
          </button>
        </div>
      </div>
      
      {/* Agent Templates */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { 
            title: 'Standup Bot', 
            desc: 'Generates daily standup reports from Basecamp activity',
            icon: '☀️',
            tools: ['daily_report', 'who_did_what']
          },
          { 
            title: 'Task Monitor', 
            desc: 'Watches for blocked or overdue tasks and alerts you',
            icon: '🔔',
            tools: ['get_alerts', 'detect_ghost_work']
          },
          { 
            title: 'Sprint Helper', 
            desc: 'Suggests task prioritization based on deadlines',
            icon: '🎯',
            tools: ['what_should_i_work_on', 'predict_deadline']
          },
        ].map(template => (
          <button
            key={template.title}
            onClick={() => setShowCreate(true)}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl hover:border-purple-500/50 
                     hover:bg-gray-800 transition-all text-left group"
          >
            <div className="text-2xl mb-2">{template.icon}</div>
            <h3 className="font-medium group-hover:text-purple-400 transition-colors">
              {template.title}
            </h3>
            <p className="text-sm text-gray-400 mt-1">{template.desc}</p>
            <div className="flex flex-wrap gap-1 mt-3">
              {template.tools.map(tool => (
                <span key={tool} className="text-xs bg-gray-700 px-2 py-0.5 rounded">
                  {tool}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      
      {/* Agents List */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold">Your Agents</h2>
          <span className="text-sm text-gray-400">{agents.length} agents</span>
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading agents...
          </div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center">
            <Bot className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 mb-2">No agents configured</p>
            <p className="text-sm text-gray-500 mb-4">
              Create an agent to automate your PM tasks
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-purple-400 hover:text-purple-300"
            >
              Create your first agent →
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="px-4 py-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    agent.status === 'active' 
                      ? 'bg-green-500/20 text-green-400' 
                      : agent.status === 'error'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-gray-600 text-gray-400'
                  }`}>
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-medium">{agent.name}</p>
                    <p className="text-sm text-gray-400">{agent.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      {agent.schedule && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {agent.schedule}
                        </span>
                      )}
                      {agent.lastRun && (
                        <span>Last run: {new Date(agent.lastRun).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1 mr-4">
                    {agent.tools.slice(0, 3).map(tool => (
                      <span key={tool} className="text-xs bg-gray-700 px-2 py-0.5 rounded">
                        {tool}
                      </span>
                    ))}
                    {agent.tools.length > 3 && (
                      <span className="text-xs text-gray-500">+{agent.tools.length - 3}</span>
                    )}
                  </div>
                  <button
                    onClick={() => toggleAgent(agent.id, agent.status)}
                    className={`p-2 rounded transition-colors ${
                      agent.status === 'active'
                        ? 'hover:bg-yellow-500/20 text-yellow-400'
                        : 'hover:bg-green-500/20 text-green-400'
                    }`}
                    title={agent.status === 'active' ? 'Pause' : 'Start'}
                  >
                    {agent.status === 'active' ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </button>
                  <button className="p-2 rounded hover:bg-gray-600 transition-colors">
                    <Settings2 className="w-4 h-4 text-gray-400" />
                  </button>
                  <button className="p-2 rounded hover:bg-red-500/20 text-red-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Create Agent Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">Create Agent</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Name</label>
                <input
                  type="text"
                  placeholder="e.g., Daily Standup Bot"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Instructions</label>
                <textarea
                  placeholder="Describe what this agent should do..."
                  rows={3}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 
                           focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Schedule</label>
                <select className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2">
                  <option>Every day at 9 AM</option>
                  <option>Every hour</option>
                  <option>On webhook trigger</option>
                  <option>Manual only</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Tools</label>
                <div className="flex flex-wrap gap-2">
                  {['daily_report', 'list_todos_due', 'assignment_report', 'detect_ghost_work', 'what_should_i_work_on'].map(tool => (
                    <label key={tool} className="flex items-center gap-2 bg-gray-700 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-600">
                      <input type="checkbox" className="rounded" />
                      <span className="text-sm">{tool}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-500 transition-colors"
              >
                Create Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
