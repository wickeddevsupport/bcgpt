import { useState } from 'react'
import { authLogin, authSignup, type AuthUser } from '../api'

interface LoginProps {
  onAuthenticated: (user: AuthUser) => void
}

export default function Login({ onAuthenticated }: LoginProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError(null)

    try {
      const result =
        mode === 'signup'
          ? await authSignup(name, email, password)
          : await authLogin(email, password)

      if (!result.ok || !result.user) {
        setError(result.error ?? 'Authentication failed')
        return
      }
      onAuthenticated(result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-bold text-2xl">O</span>
          </div>
          <h1 className="text-2xl font-bold text-white">OpenClaw</h1>
          <p className="text-gray-400 text-sm mt-1">AI-powered automation for your team</p>
        </div>

        {/* Card */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-1">
            {mode === 'signup' ? 'Create your workspace' : 'Sign in to your workspace'}
          </h2>
          <p className="text-sm text-gray-400 mb-6">
            {mode === 'signup'
              ? 'First account becomes super admin. Use from any device.'
              : 'Use your email and password. Works from any device.'}
          </p>

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Your name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  required={mode === 'signup'}
                  disabled={loading}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-sm
                           text-white placeholder-gray-400 focus:outline-none focus:ring-2
                           focus:ring-orange-500 focus:border-transparent disabled:opacity-50"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                disabled={loading}
                autoComplete="email"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-sm
                         text-white placeholder-gray-400 focus:outline-none focus:ring-2
                         focus:ring-orange-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={loading}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-sm
                         text-white placeholder-gray-400 focus:outline-none focus:ring-2
                         focus:ring-orange-500 focus:border-transparent disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-gradient-to-r from-orange-600 to-orange-500 text-white font-medium
                       rounded-lg py-2.5 text-sm hover:from-orange-500 hover:to-orange-400
                       transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Please wait...'
                : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-gray-400">
            {mode === 'signup' ? (
              <>
                Already have an account?{' '}
                <button
                  onClick={() => { setMode('signin'); setError(null) }}
                  className="text-orange-400 hover:text-orange-300 font-medium"
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to OpenClaw?{' '}
                <button
                  onClick={() => { setMode('signup'); setError(null) }}
                  className="text-orange-400 hover:text-orange-300 font-medium"
                >
                  Create account
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          Sessions last 30 days. Sign in once, use from any device.
        </p>
      </div>
    </div>
  )
}
