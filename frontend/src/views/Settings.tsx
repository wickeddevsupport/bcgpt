import { useState, useEffect, useCallback } from 'react'
import { Settings as SettingsIcon, User, Key, Bell, Palette, Link2, Save, Check, Trash2, RefreshCw, Shield, ShieldCheck, ShieldAlert } from 'lucide-react'
import { useStore } from '../store'
import { getApiKey, setApiKey, clearApiKey } from '../api'

// ── BYOK Types ──────────────────────────────────────────────────────

type AIProvider = 'openai' | 'anthropic' | 'google' | 'azure' | 'custom'

interface ByokKeyInfo {
  provider: AIProvider
  label: string
  defaultModel?: string
  validated?: boolean
  createdAt: string
  updatedAt: string
}

const PROVIDERS: { id: AIProvider; name: string; description: string; models: string[] }[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4, o1, o3 and more',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude Opus, Sonnet, Haiku',
    models: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini Pro, Ultra, Flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-pro'],
  },
  {
    id: 'custom',
    name: 'Custom Provider',
    description: 'Any OpenAI-compatible API',
    models: [],
  },
]

// ── BYOK API helpers ────────────────────────────────────────────────

async function fetchByokKeys(): Promise<ByokKeyInfo[]> {
  const res = await fetch('/api/pmos/byok', { credentials: 'include' })
  if (!res.ok) throw new Error(`Failed to load keys: ${res.statusText}`)
  const data = await res.json()
  return data.keys ?? []
}

async function saveByokKey(
  provider: AIProvider,
  apiKey: string,
  opts?: { label?: string; defaultModel?: string },
): Promise<void> {
  const res = await fetch('/api/pmos/byok', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, ...opts }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `Failed to save key: ${res.statusText}`)
  }
}

async function deleteByokKey(provider: AIProvider): Promise<void> {
  const res = await fetch(`/api/pmos/byok/${provider}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`Failed to remove key: ${res.statusText}`)
}

async function validateByokKey(
  provider: AIProvider,
  apiKey?: string,
): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch('/api/pmos/byok/validate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, ...(apiKey ? { apiKey } : {}) }),
  })
  return await res.json()
}

// ── Component ───────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useStore()

  // BYOK state
  const [keys, setKeys] = useState<ByokKeyInfo[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [keysError, setKeysError] = useState<string | null>(null)
  const [addingProvider, setAddingProvider] = useState<AIProvider | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState<AIProvider | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Legacy BCGPT key
  const [bcApiKey, setBcApiKey] = useState('')

  useEffect(() => {
    const storedKey = getApiKey()
    if (storedKey) setBcApiKey('••••••••' + storedKey.slice(-4))
  }, [])

  const loadKeys = useCallback(async () => {
    setKeysLoading(true)
    setKeysError(null)
    try {
      const loaded = await fetchByokKeys()
      setKeys(loaded)
    } catch (err) {
      setKeysError(String(err instanceof Error ? err.message : err))
    } finally {
      setKeysLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  const handleSaveKey = async () => {
    if (!addingProvider || !keyInput.trim()) return
    setSaving(true)
    setKeysError(null)
    try {
      await saveByokKey(addingProvider, keyInput.trim(), {
        label: labelInput.trim() || undefined,
        defaultModel: modelInput.trim() || undefined,
      })
      setKeyInput('')
      setLabelInput('')
      setModelInput('')
      setAddingProvider(null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      await loadKeys()
    } catch (err) {
      setKeysError(String(err instanceof Error ? err.message : err))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteKey = async (provider: AIProvider) => {
    if (!confirm(`Remove ${provider} API key?`)) return
    try {
      await deleteByokKey(provider)
      await loadKeys()
    } catch (err) {
      setKeysError(String(err instanceof Error ? err.message : err))
    }
  }

  const handleValidateKey = async (provider: AIProvider) => {
    setValidating(provider)
    try {
      const result = await validateByokKey(provider)
      if (result.valid) {
        await loadKeys() // refresh to show validated status
      } else {
        setKeysError(`${provider}: ${result.error || 'Key validation failed'}`)
      }
    } catch (err) {
      setKeysError(String(err instanceof Error ? err.message : err))
    } finally {
      setValidating(null)
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

  const configuredProviders = new Set(keys.map((k) => k.provider))

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

        {/* BYOK: AI Provider Keys */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-orange-400" />
              <h2 className="font-semibold">AI Provider Keys</h2>
            </div>
            <button
              onClick={loadKeys}
              disabled={keysLoading}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${keysLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <p className="text-sm text-gray-400 mb-4">
            Bring your own API keys to use premium AI models. Keys are encrypted at rest and never
            shared.
          </p>

          {keysError && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-sm text-red-300">
              {keysError}
              <button onClick={() => setKeysError(null)} className="ml-2 text-red-400 hover:text-red-300">
                Dismiss
              </button>
            </div>
          )}

          {saveSuccess && (
            <div className="mb-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-sm text-green-300 flex items-center gap-2">
              <Check className="w-4 h-4" /> Key saved successfully
            </div>
          )}

          {/* Configured keys */}
          {keys.length > 0 && (
            <div className="space-y-3 mb-6">
              {keys.map((key) => (
                <div
                  key={key.provider}
                  className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {key.validated ? (
                      <ShieldCheck className="w-5 h-5 text-green-400" />
                    ) : key.validated === false ? (
                      <ShieldAlert className="w-5 h-5 text-red-400" />
                    ) : (
                      <Shield className="w-5 h-5 text-gray-400" />
                    )}
                    <div>
                      <p className="font-medium">
                        {key.label || key.provider}
                        <span className="ml-2 text-xs text-gray-500 font-mono">{key.provider}</span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {key.defaultModel && <span className="mr-2">Model: {key.defaultModel}</span>}
                        {key.validated === true && <span className="text-green-400">Validated</span>}
                        {key.validated === false && <span className="text-red-400">Invalid</span>}
                        {key.validated == null && <span className="text-gray-500">Not validated</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleValidateKey(key.provider)}
                      disabled={validating === key.provider}
                      className="px-3 py-1.5 text-sm bg-gray-600 rounded hover:bg-gray-500 transition-colors disabled:opacity-50"
                    >
                      {validating === key.provider ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => {
                        setAddingProvider(key.provider)
                        setLabelInput(key.label || '')
                        setModelInput(key.defaultModel || '')
                      }}
                      className="px-3 py-1.5 text-sm bg-gray-600 rounded hover:bg-gray-500 transition-colors"
                    >
                      Update
                    </button>
                    <button
                      onClick={() => handleDeleteKey(key.provider)}
                      className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add/update key form */}
          {addingProvider ? (
            <div className="p-4 bg-gray-700/30 border border-gray-600 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {configuredProviders.has(addingProvider) ? 'Update' : 'Add'}{' '}
                  {PROVIDERS.find((p) => p.id === addingProvider)?.name || addingProvider} Key
                </h3>
                <button
                  onClick={() => {
                    setAddingProvider(null)
                    setKeyInput('')
                    setLabelInput('')
                    setModelInput('')
                  }}
                  className="text-sm text-gray-400 hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">API Key</label>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2
                           focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Label (optional)</label>
                  <input
                    type="text"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    placeholder="e.g. My OpenAI key"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2
                             focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Default Model (optional)</label>
                  {PROVIDERS.find((p) => p.id === addingProvider)?.models.length ? (
                    <select
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2
                               focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <option value="">Auto</option>
                      {PROVIDERS.find((p) => p.id === addingProvider)?.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      placeholder="model-id"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2
                               focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSaveKey}
                  disabled={saving || !keyInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-600 rounded-lg hover:bg-orange-500
                           transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? 'Saving...' : 'Save Key'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-3">Add a new provider:</p>
              <div className="grid grid-cols-2 gap-3">
                {PROVIDERS.filter((p) => !configuredProviders.has(p.id)).map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => setAddingProvider(provider.id)}
                    className="p-3 bg-gray-700/50 border border-gray-600 rounded-lg hover:border-orange-500/50
                             hover:bg-gray-700 transition-all text-left"
                  >
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{provider.description}</p>
                  </button>
                ))}
              </div>
              {configuredProviders.size === PROVIDERS.length && (
                <p className="text-sm text-gray-500 mt-3">All providers configured.</p>
              )}
            </div>
          )}
        </section>

        {/* BCGPT API Key (legacy) */}
        <section className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Link2 className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">BCGPT API Key</h2>
          </div>
          <p className="text-xs text-gray-400 mb-3">
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
              <button onClick={handleClearBcApiKey} className="px-4 py-2 text-red-400 hover:text-red-300">
                Clear
              </button>
            )}
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
              <button className="px-4 py-2 bg-gray-700 border-2 border-blue-500 rounded-lg">Dark</button>
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
              <button className="text-sm text-red-400 hover:text-red-300">Disconnect</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
