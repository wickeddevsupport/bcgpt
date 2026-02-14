import { useState, useRef, useEffect } from 'react'
import { 
  Send, Sparkles, Loader2, Wrench, AlertCircle, 
  ChevronRight, ChevronLeft, Plus, MessageSquare,
  Clock
} from 'lucide-react'
import { useStore } from '../store'
import { sendChatMessage, listChatSessions, getChatSession } from '../api'

interface ChatSession {
  id: string
  title: string
  created_at: string
}

export default function ChatSidebar() {
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { messages, isLoading, addMessage, setMessages, setLoading, clearMessages, currentProject } = useStore()
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])
  
  // Load chat sessions
  useEffect(() => {
    loadSessions()
  }, [])
  
  const loadSessions = async () => {
    try {
      const data = await listChatSessions()
      setSessions(data)
    } catch {
      // Not authenticated yet
    }
  }
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    const userMessage = input.trim()
    setInput('')
    
    addMessage({ role: 'user', content: userMessage })
    setLoading(true)
    
    try {
      const data = await sendChatMessage(userMessage, {
        sessionId: currentSessionId || undefined,
        projectContext: currentProject?.name,
      })
      
      if (!currentSessionId) {
        setCurrentSessionId(data.sessionId)
        loadSessions()
      }
      
      addMessage({ 
        role: 'assistant', 
        content: data.response,
        toolsUsed: data.toolsUsed,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      addMessage({ 
        role: 'assistant', 
        content: message === 'NOT_AUTHENTICATED' 
          ? 'Please connect your Basecamp account first. Go to Settings or click "Connect Basecamp" in the header.'
          : `Error: ${message}`,
        error: true,
      })
    } finally {
      setLoading(false)
    }
  }
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }
  
  const startNewChat = () => {
    clearMessages()
    setCurrentSessionId(null)
    setShowHistory(false)
  }
  
  const loadSession = async (session: ChatSession) => {
    setLoading(true)
    try {
      const data = await getChatSession(session.id)
      setCurrentSessionId(session.id)
      setMessages(
        (data.messages || []).map((msg) => ({
          id: crypto.randomUUID(),
          role: (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'tool')
            ? msg.role
            : 'assistant',
          content: msg.content || '',
          timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
        }))
      )
      setShowHistory(false)
    } catch {
      addMessage({
        role: 'assistant',
        content: 'Failed to load chat history for this session.',
        error: true,
      })
    } finally {
      setLoading(false)
    }
  }
  
  if (collapsed) {
    return (
      <div className="w-12 bg-gray-800 border-l border-gray-700 flex flex-col items-center py-4">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
          title="Expand chat"
        >
          <ChevronLeft className="w-5 h-5 text-gray-400" />
        </button>
        <div className="mt-4">
          <Sparkles className="w-5 h-5 text-blue-400" />
        </div>
      </div>
    )
  }
  
  return (
    <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-400" />
          <span className="font-semibold">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewChat}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors"
            title="New chat"
          >
            <Plus className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`p-1.5 rounded transition-colors ${showHistory ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
            title="Chat history"
          >
            <Clock className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors"
            title="Collapse"
          >
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
      
      {/* History Panel */}
      {showHistory && (
        <div className="border-b border-gray-700 max-h-48 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              No previous chats
            </div>
          ) : (
            sessions.map(session => (
              <button
                key={session.id}
                onClick={() => loadSession(session)}
                className={`w-full p-3 text-left hover:bg-gray-700 transition-colors flex items-center gap-2 ${
                  currentSessionId === session.id ? 'bg-gray-700' : ''
                }`}
              >
                <MessageSquare className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{session.title || 'New chat'}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(session.created_at).toLocaleDateString()}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Sparkles className="w-10 h-10 mb-3 text-blue-400/50" />
            <p className="text-center font-medium">How can I help?</p>
            <p className="text-sm mt-2 text-center text-gray-500">
              Ask about your projects, create flows, or analyze workload
            </p>
            <div className="mt-4 space-y-2 w-full">
              {[
                "What's due this week?",
                "Show team workload",
                "Create a reminder flow",
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="w-full text-left px-3 py-2 text-sm bg-gray-700/50 rounded-lg 
                           hover:bg-gray-700 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[90%] px-3 py-2 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.error
                        ? 'bg-red-900/50 text-red-200 border border-red-700'
                        : 'bg-gray-700 text-gray-100'
                  }`}
                >
                  {msg.error && (
                    <div className="flex items-center gap-1 mb-1 text-red-400">
                      <AlertCircle className="w-3 h-3" />
                      <span className="text-xs">Error</span>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-600/50">
                      <Wrench className="w-3 h-3 text-gray-400" />
                      {msg.toolsUsed.slice(0, 3).map((tool, i) => (
                        <span key={i} className="text-xs bg-gray-600/50 px-1.5 py-0.5 rounded">
                          {tool}
                        </span>
                      ))}
                      {msg.toolsUsed.length > 3 && (
                        <span className="text-xs text-gray-400">+{msg.toolsUsed.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-700 px-3 py-2 rounded-2xl">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
      
      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={handleSubmit} className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 pr-12 text-sm 
                     resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     placeholder-gray-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 bottom-2 p-2 bg-blue-600 rounded-lg hover:bg-blue-700 
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        {messages.length > 0 && (
          <button
            onClick={startNewChat}
            className="w-full mt-2 text-xs text-gray-500 hover:text-gray-400 transition-colors"
          >
            Clear conversation
          </button>
        )}
      </div>
    </div>
  )
}
