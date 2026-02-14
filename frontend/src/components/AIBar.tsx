import { useState, useRef, useEffect } from 'react'
import { Send, Sparkles, X, Maximize2, Minimize2, Loader2, Wrench, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { sendChatMessage } from '../api'

export default function AIBar() {
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { messages, isLoading, addMessage, setLoading } = useStore()
  
  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    const userMessage = input.trim()
    setInput('')
    
    // Add user message
    addMessage({ role: 'user', content: userMessage })
    
    // Expand chat to show response
    if (!expanded) setExpanded(true)
    
    setLoading(true)
    
    try {
      const data = await sendChatMessage(userMessage, {
        projectContext: useStore.getState().currentProject?.name,
      })
      
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
          ? 'Please authenticate first. Go to Settings to connect your Basecamp account or enter an API key.'
          : `Sorry, I encountered an error: ${message}`,
        error: true,
      })
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div 
      className={`bg-gray-800 border-t border-gray-700 transition-all duration-300 ${
        expanded ? 'h-96' : 'h-16'
      }`}
    >
      {/* Expanded chat view */}
      {expanded && (
        <div className="h-80 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Sparkles className="w-8 h-8 mb-2" />
              <p>Ask me anything about your projects</p>
              <p className="text-sm mt-1">
                Try: "What's due this week?" or "Show team workload"
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.error
                        ? 'bg-red-900/50 text-red-200 border border-red-700'
                        : 'bg-gray-700 text-gray-100'
                  }`}
                >
                  {msg.error && (
                    <div className="flex items-center gap-1 mb-1 text-red-400">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-xs font-medium">Error</span>
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-gray-600">
                      <Wrench className="w-3 h-3 text-gray-400" />
                      {msg.toolsUsed.map((tool, i) => (
                        <span key={i} className="text-xs bg-gray-600 px-1.5 py-0.5 rounded">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-xs opacity-60 mt-1 block">
                    {msg.timestamp.toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </span>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-700 px-4 py-2 rounded-2xl">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}
      
      {/* Input bar */}
      <div className="h-16 px-4 flex items-center gap-3 border-t border-gray-700">
        {/* Toggle expand */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
          title={expanded ? 'Minimize' : 'Expand'}
        >
          {expanded ? (
            <Minimize2 className="w-5 h-5 text-gray-400" />
          ) : (
            <Maximize2 className="w-5 h-5 text-gray-400" />
          )}
        </button>
        
        {/* AI indicator */}
        <div className="flex items-center gap-2 text-blue-400">
          <Sparkles className="w-5 h-5" />
          <span className="text-sm font-medium">AI</span>
        </div>
        
        {/* Input */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything... (e.g., 'What did the team accomplish this week?')"
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-sm 
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     placeholder-gray-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="p-2 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        
        {/* Clear chat */}
        {messages.length > 0 && (
          <button
            onClick={() => useStore.getState().clearMessages()}
            className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
            title="Clear chat"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        )}
      </div>
    </div>
  )
}
