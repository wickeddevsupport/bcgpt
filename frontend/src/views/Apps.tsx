import { useState, useEffect } from 'react'
import { Puzzle, Search, Check, ExternalLink, RefreshCw, Plus, Settings2, Trash2 } from 'lucide-react'

interface Connection {
  id: string
  name: string
  pieceName: string
  icon?: string
  status: 'active' | 'expired' | 'error'
  created: string
}

interface Piece {
  name: string
  displayName: string
  description: string
  logoUrl?: string
  version: string
  categories: string[]
}

export default function Apps() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'connections' | 'catalog'>('connections')
  const [selectedCategory, setSelectedCategory] = useState('All')
  
  useEffect(() => {
    loadData()
  }, [])
  
  const loadData = async () => {
    setLoading(true)
    try {
      // Load connections
      const connResp = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'list_connections', arguments: {} },
          id: Date.now()
        })
      })
      const connData = await connResp.json()
      if (connData.result?.content?.[0]?.text) {
        const parsed = JSON.parse(connData.result.content[0].text)
        setConnections(parsed.connections || [])
      }
      
      // Load available pieces
      const piecesResp = await fetch('/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'list_pieces', arguments: {} },
          id: Date.now() + 1
        })
      })
      const piecesData = await piecesResp.json()
      if (piecesData.result?.content?.[0]?.text) {
        const parsed = JSON.parse(piecesData.result.content[0].text)
        setPieces(parsed.pieces || [])
      }
    } catch (error) {
      console.error('Failed to load apps:', error)
    } finally {
      setLoading(false)
    }
  }
  
  const categories = ['All', 'Communication', 'Project Management', 'AI', 'Marketing', 'CRM', 'Developer Tools', 'Storage']
  
  const filteredPieces = pieces.filter(piece => {
    const matchesSearch = piece.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         piece.description?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'All' || piece.categories?.includes(selectedCategory)
    return matchesSearch && matchesCategory
  })
  
  // Popular pieces for quick access
  const popularPieces = [
    { name: 'slack', displayName: 'Slack', icon: '💬', desc: 'Team messaging' },
    { name: 'google-sheets', displayName: 'Google Sheets', icon: '📊', desc: 'Spreadsheets' },
    { name: 'notion', displayName: 'Notion', icon: '📝', desc: 'Workspace' },
    { name: 'openai', displayName: 'OpenAI', icon: '🤖', desc: 'AI models' },
    { name: 'github', displayName: 'GitHub', icon: '🐙', desc: 'Code & issues' },
    { name: 'gmail', displayName: 'Gmail', icon: '📧', desc: 'Email' },
  ]
  
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-teal-400" />
            Apps
          </h1>
          <p className="text-gray-400 mt-1">Connect your favorite tools and services</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg mb-6 w-fit">
        <button
          onClick={() => setActiveTab('connections')}
          className={`px-4 py-2 rounded-md transition-colors ${
            activeTab === 'connections' 
              ? 'bg-gray-700 text-white' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Connected ({connections.length})
        </button>
        <button
          onClick={() => setActiveTab('catalog')}
          className={`px-4 py-2 rounded-md transition-colors ${
            activeTab === 'catalog' 
              ? 'bg-gray-700 text-white' 
              : 'text-gray-400 hover:text-white'
          }`}
        >
          App Catalog
        </button>
      </div>
      
      {activeTab === 'connections' ? (
        <>
          {/* Quick Connect */}
          <div className="mb-8">
            <h2 className="text-sm font-medium text-gray-400 mb-3">Popular Apps</h2>
            <div className="grid grid-cols-6 gap-3">
              {popularPieces.map(piece => {
                const isConnected = connections.some(c => c.pieceName === piece.name)
                return (
                  <button
                    key={piece.name}
                    className={`p-4 rounded-xl border transition-all text-center group ${
                      isConnected 
                        ? 'bg-teal-500/10 border-teal-500/30' 
                        : 'bg-gray-800/50 border-gray-700 hover:border-teal-500/50 hover:bg-gray-800'
                    }`}
                  >
                    <div className="text-3xl mb-2">{piece.icon}</div>
                    <p className="font-medium text-sm group-hover:text-teal-400 transition-colors">
                      {piece.displayName}
                    </p>
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 text-xs text-teal-400 mt-1">
                        <Check className="w-3 h-3" /> Connected
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          
          {/* Connected Apps */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="font-semibold">Your Connections</h2>
              <button 
                onClick={() => setActiveTab('catalog')}
                className="text-sm text-teal-400 hover:text-teal-300 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add Connection
              </button>
            </div>
            
            {loading ? (
              <div className="p-8 text-center text-gray-400">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                Loading connections...
              </div>
            ) : connections.length === 0 ? (
              <div className="p-8 text-center">
                <Puzzle className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 mb-2">No apps connected</p>
                <p className="text-sm text-gray-500 mb-4">
                  Connect an app to enable automations
                </p>
                <button
                  onClick={() => setActiveTab('catalog')}
                  className="text-teal-400 hover:text-teal-300"
                >
                  Browse app catalog →
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-700">
                {connections.map(conn => (
                  <div
                    key={conn.id}
                    className="px-4 py-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        conn.status === 'active' 
                          ? 'bg-teal-500/20 text-teal-400' 
                          : conn.status === 'error'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {conn.icon || <Puzzle className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="font-medium">{conn.name}</p>
                        <p className="text-sm text-gray-400">{conn.pieceName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Connected {new Date(conn.created).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        conn.status === 'active' 
                          ? 'bg-green-500/20 text-green-400' 
                          : conn.status === 'error'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {conn.status}
                      </span>
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
        </>
      ) : (
        <>
          {/* Catalog Search & Filter */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search 200+ apps..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2
                         focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          
          {/* Pieces Grid */}
          <div className="grid grid-cols-3 gap-4">
            {filteredPieces.length > 0 ? filteredPieces.map(piece => (
              <div
                key={piece.name}
                className="p-4 bg-gray-800 border border-gray-700 rounded-xl hover:border-teal-500/50 
                         transition-all group cursor-pointer"
              >
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gray-700 flex items-center justify-center">
                    {piece.logoUrl ? (
                      <img src={piece.logoUrl} alt={piece.displayName} className="w-8 h-8" />
                    ) : (
                      <Puzzle className="w-6 h-6 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium group-hover:text-teal-400 transition-colors">
                      {piece.displayName}
                    </h3>
                    <p className="text-sm text-gray-400 line-clamp-2 mt-1">
                      {piece.description || 'No description'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-700">
                  <div className="flex gap-1">
                    {piece.categories?.slice(0, 2).map(cat => (
                      <span key={cat} className="text-xs bg-gray-700 px-2 py-0.5 rounded">
                        {cat}
                      </span>
                    ))}
                  </div>
                  <button className="text-sm text-teal-400 hover:text-teal-300 flex items-center gap-1">
                    Connect <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )) : (
              <div className="col-span-3 text-center py-12 text-gray-400">
                {loading ? (
                  <>
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading catalog...
                  </>
                ) : searchQuery ? (
                  <>
                    <Search className="w-6 h-6 mx-auto mb-2" />
                    No apps found matching "{searchQuery}"
                  </>
                ) : (
                  <>
                    <Puzzle className="w-6 h-6 mx-auto mb-2" />
                    No apps available
                  </>
                )}
              </div>
            )}
          </div>
          
          {/* Open Full Catalog Link */}
          <div className="mt-6 text-center">
            <a
              href="/ops-ui/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-400 hover:text-teal-300 inline-flex items-center gap-2"
            >
              Open full n8n catalog <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </>
      )}
    </div>
  )
}
