import { useState, useEffect } from 'react'
import { Zap, Plus, RefreshCw, ExternalLink, MoreHorizontal } from 'lucide-react'

interface Flow {
  id: string
  name: string
  status: 'ENABLED' | 'DISABLED'
  updated: string
  trigger?: string
}

export default function Flows() {
  const [flows, setFlows] = useState<Flow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFlow, setSelectedFlow] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  
  useEffect(() => {
    loadFlows()
  }, [])
  
  const loadFlows = async () => {
    setLoading(true)
    try {
      // Call the list_flows MCP tool via our API
      const response = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'list_flows', arguments: {} },
          id: Date.now()
        })
      })
      const data = await response.json()
      if (data.result?.content?.[0]?.text) {
        const parsed = JSON.parse(data.result.content[0].text)
        setFlows(parsed.flows || [])
      }
    } catch (error) {
      console.error('Failed to load flows:', error)
    } finally {
      setLoading(false)
    }
  }
  
  const openFlowBuilder = (flowId?: string) => {
    setSelectedFlow(flowId || null)
    setShowBuilder(true)
  }
  
  const getFlowBuilderUrl = () => {
    const baseUrl = 'https://flow.wickedlab.io'
    if (selectedFlow) {
      return `${baseUrl}/flows/${selectedFlow}`
    }
    return `${baseUrl}/flows`
  }
  
  if (showBuilder) {
    return (
      <div className="h-full flex flex-col -m-6">
        {/* Builder Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowBuilder(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Back to Flows
            </button>
            <span className="text-gray-600">|</span>
            <span className="font-medium">
              {selectedFlow ? 'Edit Flow' : 'Create New Flow'}
            </span>
          </div>
          <a
            href={getFlowBuilderUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            Open in new tab <ExternalLink className="w-4 h-4" />
          </a>
        </div>
        
        {/* Embedded Flow Builder */}
        <iframe
          src={getFlowBuilderUrl()}
          className="flex-1 w-full bg-gray-900"
          title="Activepieces Flow Builder"
        />
      </div>
    )
  }
  
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-6 h-6 text-yellow-400" />
            Flows
          </h1>
          <p className="text-gray-400 mt-1">Automate your workflows with AI-powered flows</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadFlows}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => openFlowBuilder()}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 
                     rounded-lg hover:from-blue-500 hover:to-blue-400 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Create Flow
          </button>
        </div>
      </div>
      
      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { title: 'Slack Notifications', desc: 'Get notified when tasks are overdue', icon: '💬' },
          { title: 'Daily Digest', desc: 'Send daily summary to email', icon: '📧' },
          { title: 'Auto-assign', desc: 'Assign tasks based on keywords', icon: '🎯' },
        ].map(template => (
          <button
            key={template.title}
            onClick={() => openFlowBuilder()}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl hover:border-blue-500/50 
                     hover:bg-gray-800 transition-all text-left group"
          >
            <div className="text-2xl mb-2">{template.icon}</div>
            <h3 className="font-medium group-hover:text-blue-400 transition-colors">
              {template.title}
            </h3>
            <p className="text-sm text-gray-400 mt-1">{template.desc}</p>
          </button>
        ))}
      </div>
      
      {/* Flows List */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold">Your Flows</h2>
          <span className="text-sm text-gray-400">{flows.length} flows</span>
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading flows...
          </div>
        ) : flows.length === 0 ? (
          <div className="p-8 text-center">
            <Zap className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 mb-4">No flows yet</p>
            <button
              onClick={() => openFlowBuilder()}
              className="text-blue-400 hover:text-blue-300"
            >
              Create your first flow →
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {flows.map(flow => (
              <div
                key={flow.id}
                className="px-4 py-3 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    flow.status === 'ENABLED' ? 'bg-green-400' : 'bg-gray-500'
                  }`} />
                  <div>
                    <p className="font-medium">{flow.name}</p>
                    <p className="text-sm text-gray-400">
                      {flow.trigger || 'Manual trigger'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    Updated {new Date(flow.updated).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => openFlowBuilder(flow.id)}
                    className="p-2 rounded hover:bg-gray-600 transition-colors"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="mt-6 text-center">
        <a
          href="https://flow.wickedlab.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-gray-400 flex items-center justify-center gap-1"
        >
          Powered by Activepieces <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}
