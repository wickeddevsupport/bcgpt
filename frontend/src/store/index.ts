import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolsUsed?: string[]
  toolCalls?: ToolCall[]
  error?: boolean
  timestamp: Date
}

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  result?: unknown
}

export interface Project {
  id: string
  name: string
  accountId: string
}

interface PMOSState {
  // Chat state
  messages: Message[]
  isLoading: boolean
  chatOpen: boolean

  // Project context
  currentProject: Project | null
  projects: Project[]

  // User
  user: User | null
  isAuthenticated: boolean
  authChecked: boolean  // true once we've attempted to restore the session

  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
  setMessages: (messages: Message[]) => void
  setLoading: (loading: boolean) => void
  toggleChat: () => void
  setCurrentProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void
  setUser: (user: User | null) => void
  setAuthChecked: (checked: boolean) => void
  clearMessages: () => void
}

export interface User {
  id: string
  email: string
  name: string
  avatar?: string
}

export const useStore = create<PMOSState>((set) => ({
  // Initial state
  messages: [],
  isLoading: false,
  chatOpen: false,
  currentProject: null,
  projects: [],
  user: null,
  isAuthenticated: false,
  authChecked: false,

  // Actions
  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        },
      ],
    })),

  setMessages: (messages) => set({ messages }),

  setLoading: (loading) => set({ isLoading: loading }),

  toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),

  setCurrentProject: (project) => set({ currentProject: project }),

  setProjects: (projects) => set({ projects }),

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  setAuthChecked: (checked) => set({ authChecked: checked }),

  clearMessages: () => set({ messages: [] }),
}))
