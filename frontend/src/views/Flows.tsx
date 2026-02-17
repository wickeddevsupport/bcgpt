import { useState, useEffect } from 'react'
import { Zap, Plus, RefreshCw, ExternalLink, MoreHorizontal, Play, Pause } from 'lucide-react'

interface Workflow {
  id: string
  name: string
  active: boolean
  updatedAt: string
  createdAt: string
  tags?: Array<{ name: string }>
  nodes?: Array<{ type: string; name: string }>
}

/**
 * Resolve the n8n base URL.
 * Precedence: env override → local proxy at /ops-ui → remote ops.wickedlab.io
 */
function getN8nBaseUrl(): string {
  // When running inside OpenClaw (proxied), use the local /ops-ui path
  // The pmos-ops-proxy transparently routes to the embedded or remote n8n
  return '/ops-ui'
}

/**
 * Resolve the n8n API base URL for REST calls.
 * Uses the /api/ops proxy which injects workspace-scoped API keys.
 */
function getN8nApiUrl(): string {
  return '/api/ops'
}

export default function Flows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadWorkflows()
  }, [])

  const loadWorkflows = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${getN8nApiUrl()}/workflows`, {
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error(`Failed to load workflows: ${response.statusText}`)
      }
      const data = await response.json()
      // n8n returns { data: Workflow[] } or { workflows: Workflow[] }
      const list = data.data ?? data.workflows ?? []
      setWorkflows(Array.isArray(list) ? list : [])
    } catch (err) {
      console.error('Failed to load workflows:', err)
      setError(String(err instanceof Error ? err.message : err))
      // Fallback: try MCP tool call (legacy Activepieces path)
      try {
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
          const flows = parsed.flows || []
          // Normalize Activepieces format to n8n-like format
          setWorkflows(flows.map((f: { id: string; name: string; status: string; updated: string }) => ({
            id: f.id,
            name: f.name,
            active: f.status === 'ENABLED',
            updatedAt: f.updated,
            createdAt: f.updated,
          })))
          setError(null)
        }
      } catch {
        // Both paths failed
      }
    } finally {
      setLoading(false)
    }
  }

  const toggleWorkflow = async (workflowId: string, activate: boolean) => {
    try {
      const endpoint = activate
        ? `${getN8nApiUrl()}/workflows/${workflowId}/activate`
        : `${getN8nApiUrl()}/workflows/${workflowId}/deactivate`
      await fetch(endpoint, { method: 'POST', credentials: 'include' })
      await loadWorkflows()
    } catch (err) {
      console.error('Failed to toggle workflow:', err)
    }
  }

  const openBuilder = (workflowId?: string) => {
    setSelectedWorkflow(workflowId || null)
    setShowBuilder(true)
  }

  const getBuilderUrl = () => {
    const base = getN8nBaseUrl()
    if (selectedWorkflow) {
      return `${base}/workflow/${selectedWorkflow}`
    }
    return `${base}/workflow/new`
  }

  const getExternalUrl = () => {
    // Direct URL for opening in a new tab
    const opsUrl = 'https://ops.wickedlab.io'
    if (selectedWorkflow) {
      return `${opsUrl}/workflow/${selectedWorkflow}`
    }
    return `${opsUrl}/workflows`
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
              ← Back to Workflows
            </button>
            <span className="text-gray-600">|</span>
            <span className="font-medium">
              {selectedWorkflow ? 'Edit Workflow' : 'Create New Workflow'}
            </span>
          </div>
          <a
            href={getExternalUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"
          >
            Open in Wicked Ops <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Embedded n8n Workflow Editor */}
        <iframe
          src={getBuilderUrl()}
          className="flex-1 w-full bg-gray-900"
          title="Wicked Ops Workflow Editor"
          allow="clipboard-read; clipboard-write"
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
            Workflows
          </h1>
          <p className="text-gray-400 mt-1">Automate your work with n8n-powered workflows</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadWorkflows}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => openBuilder()}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-500
                     rounded-lg hover:from-orange-500 hover:to-orange-400 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            New Workflow
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { title: 'Basecamp Sync', desc: 'Sync tasks and todos across projects', icon: '🏕' },
          { title: 'Slack Alerts', desc: 'Get notified on task updates', icon: '💬' },
          { title: 'Daily Report', desc: 'Auto-generate daily status reports', icon: '📊' },
        ].map(template => (
          <button
            key={template.title}
            onClick={() => openBuilder()}
            className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl hover:border-orange-500/50
                     hover:bg-gray-800 transition-all text-left group"
          >
            <div className="text-2xl mb-2">{template.icon}</div>
            <h3 className="font-medium group-hover:text-orange-400 transition-colors">
              {template.title}
            </h3>
            <p className="text-sm text-gray-400 mt-1">{template.desc}</p>
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Workflows List */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold">Your Workflows</h2>
          <span className="text-sm text-gray-400">{workflows.length} workflows</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading workflows...
          </div>
        ) : workflows.length === 0 ? (
          <div className="p-8 text-center">
            <Zap className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 mb-4">No workflows yet</p>
            <button
              onClick={() => openBuilder()}
              className="text-orange-400 hover:text-orange-300"
            >
              Create your first workflow →
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {workflows.map(workflow => (
              <div
                key={workflow.id}
                className="px-4 py-3 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    workflow.active ? 'bg-green-400' : 'bg-gray-500'
                  }`} />
                  <div>
                    <p className="font-medium">{workflow.name}</p>
                    <p className="text-sm text-gray-400">
                      {workflow.tags?.map(t => t.name).join(', ') || 'No tags'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    Updated {new Date(workflow.updatedAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => toggleWorkflow(workflow.id, !workflow.active)}
                    className={`p-1.5 rounded transition-colors ${
                      workflow.active
                        ? 'text-green-400 hover:bg-green-900/30'
                        : 'text-gray-500 hover:bg-gray-600'
                    }`}
                    title={workflow.active ? 'Deactivate' : 'Activate'}
                  >
                    {workflow.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => openBuilder(workflow.id)}
                    className="p-2 rounded hover:bg-gray-600 transition-colors"
                    title="Edit workflow"
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
          href="https://ops.wickedlab.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-gray-400 flex items-center justify-center gap-1"
        >
          Powered by Wicked Ops (n8n) <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}
