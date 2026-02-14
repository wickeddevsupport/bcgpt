import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, User, Key, Bell, Palette, Link2, Save, Check } from 'lucide-react'
import { useStore } from '../store'
import { getApiKey, setApiKey, clearApiKey, updateUserConfig, getUserConfig } from '../api'

export default function Settings() {
  const { user } = useStore()
  const [llmProvider, setLlmProvider] = useState('gemini')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [bcApiKey, setBcApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  
  // Load existing config
  useEffect(() => {
    const storedKey = getApiKey()
    if (storedKey) {
      setBcApiKey('••••••••' + storedKey.slice(-4))
    }
    
    getUserConfig().then(config => {
      if (config.llm_provider) setLlmProvider(config.llm_provider)
    }).catch(() => {
      // Not authenticated yet
    })
  }, [])
  
  const handleSaveLlmConfig = async () => {
    setSaving(true)
    try {
      await updateUserConfig({
        llmProvider,
        llmApiKey: apiKeyInput || undefined,
      })
      setApiKeyInput('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save config:', error)
    } finally {
      setSaving(false)
    }
  }
  
  const handleSaveBcApiKey = () => {
    if (bcApiKey && !bcApiKey.startsWith('••')) {
      setApiKey(bcApiKey)
      setBcApiKey('••••••••' + bcApiKey.slice(-4))
    }
  }
  
  const handleClearBcApiKey = () => {
    clearApiKey()
    setBcApiKey('')
  }
  
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-blue-400" />
          Settings
        </h1>
        <p className="text-gray-400 mt-1">Manage your account and preferences</p>
      </div>
      
      <div className="space-y-6">
        {/* Profile section */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">Profile</h2>
          </div>
          
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center text-2xl">
              {user?.name?.[0] || 'G'}
            </div>
            <div>
              <p className="font-medium">{user?.name || 'Guest User'}</p>
              <p className="text-sm text-gray-400">{user?.email || 'Not signed in'}</p>
            </div>
          </div>
          
          <button className="px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
            Connect Basecamp
          </button>
        </section>
        
        {/* API Keys section */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">AI Configuration</h2>
          </div>
          
          <p className="text-sm text-gray-400 mb-4">
            By default, PMOS uses Gemini (free tier). You can bring your own API key for better performance.
          </p>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">LLM Provider</label>
              <select 
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="gemini">Gemini (Free)</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="openai">OpenAI GPT</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">LLM API Key (optional)</label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter your API key..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Your API key is encrypted and never shared.
              </p>
            </div>
            
            <button
              onClick={handleSaveLlmConfig}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 
                       transition-colors disabled:opacity-50"
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Configuration'}
            </button>
          </div>
          
          <div className="border-t border-gray-700 mt-6 pt-6">
            <label className="block text-sm font-medium mb-2">BCGPT API Key</label>
            <p className="text-xs text-gray-400 mb-2">
              Use this for direct API access without Basecamp OAuth.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={bcApiKey}
                onChange={(e) => setBcApiKey(e.target.value)}
                placeholder="Enter BCGPT API key..."
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSaveBcApiKey}
                className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg hover:bg-gray-600"
              >
                Save
              </button>
              {bcApiKey && (
                <button
                  onClick={handleClearBcApiKey}
                  className="px-4 py-2 text-red-400 hover:text-red-300"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </section>
        
        {/* Notifications */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">Notifications</h2>
          </div>
          
          <div className="space-y-4">
            {[
              { label: 'Task assignments', description: 'When you are assigned a new task' },
              { label: 'Due date reminders', description: 'Reminders before tasks are due' },
              { label: 'Team updates', description: 'Activity from your team members' },
            ].map((item) => (
              <label key={item.label} className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-gray-400">{item.description}</p>
                </div>
                <input 
                  type="checkbox" 
                  defaultChecked
                  className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-600 
                           focus:ring-blue-500 focus:ring-offset-gray-800"
                />
              </label>
            ))}
          </div>
        </section>
        
        {/* Appearance */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Palette className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">Appearance</h2>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Theme</label>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-gray-700 border-2 border-blue-500 rounded-lg">
                Dark
              </button>
              <button className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg opacity-50 cursor-not-allowed">
                Light (coming soon)
              </button>
            </div>
          </div>
        </section>
        
        {/* Integrations */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Link2 className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">Integrations</h2>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                  🏕️
                </div>
                <div>
                  <p className="font-medium">Basecamp</p>
                  <p className="text-sm text-gray-400">Connected</p>
                </div>
              </div>
              <button className="text-sm text-red-400 hover:text-red-300">
                Disconnect
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
