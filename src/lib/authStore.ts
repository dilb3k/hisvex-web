import { create } from 'zustand'
import { setApiToken, setRefreshToken, clearApiCache, authApi } from './api'
import type { User } from './types'

const STORAGE_KEY_TOKEN = 'hisvex_token'
const STORAGE_KEY_REFRESH = 'hisvex_refresh'
const STORAGE_KEY_USER = 'hisvex_user'

function persistToken(token: string) {
  try { localStorage.setItem(STORAGE_KEY_TOKEN, token) } catch {}
}

function persistRefreshToken(token: string) {
  try { localStorage.setItem(STORAGE_KEY_REFRESH, token) } catch {}
}

function persistUser(user: User) {
  try { localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user)) } catch {}
}

function clearPersistedToken() {
  try { localStorage.removeItem(STORAGE_KEY_TOKEN) } catch {}
  try { localStorage.removeItem(STORAGE_KEY_REFRESH) } catch {}
  try { localStorage.removeItem(STORAGE_KEY_USER) } catch {}
}

function readPersistedToken(): { token: string; refreshToken: string; user: User | null } | null {
  try {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN)
    if (!token) return null
    const refreshToken = localStorage.getItem(STORAGE_KEY_REFRESH) || ''
    let user: User | null = null
    const raw = localStorage.getItem(STORAGE_KEY_USER)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?._id || parsed?.id) {
        if (!parsed._id && parsed.id) parsed._id = parsed.id
        user = parsed
      }
    }
    return { token, refreshToken, user }
  } catch {
    return null
  }
}

interface AuthState {
  token: string
  refreshToken: string
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  setAuth: (token: string, refreshToken: string, user: User) => void
  setUser: (user: User) => void
  logout: () => void
  setLoading: (loading: boolean) => void
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  token: '',
  refreshToken: '',
  user: null,
  isLoading: true,
  isAuthenticated: false,
  setAuth: (token, refreshToken, user) => {
    const normalized = { ...user }
    if (!normalized._id && (normalized as any).id) {
      normalized._id = (normalized as any).id
    }
    setApiToken(token)
    setRefreshToken(refreshToken)
    persistToken(token)
    persistRefreshToken(refreshToken)
    persistUser(normalized)
    set({ token, refreshToken, user: normalized, isAuthenticated: true })
  },
  setUser: (user) => {
    persistUser(user)
    set({ user })
  },
  logout: () => {
    try { authApi.logout().catch(() => {}) } catch {}
    setApiToken(null)
    setRefreshToken('')
    clearApiCache()
    clearPersistedToken()
    set({ token: '', refreshToken: '', user: null, isAuthenticated: false })
  },
  setLoading: (isLoading) => set({ isLoading }),
  hydrate: async () => {
    try {
      const result = readPersistedToken()
      if (!result?.token) {
        set({ isLoading: false })
        return
      }
      setApiToken(result.token)
      setRefreshToken(result.refreshToken)
      // Paint immediately with the cached user, then revalidate below —
      // avoids a blank/splash screen on every load just to wait on network.
      set({ token: result.token, refreshToken: result.refreshToken, user: result.user ?? null, isAuthenticated: true })

      // Mandatory revalidation against the server on every load — the
      // locally cached user is only a fast first paint, never the source of
      // truth (subscription tier, block status, business day hour, etc. may
      // have changed elsewhere). A hard auth failure (401) is already
      // handled by the response interceptor itself (handleSessionExpired
      // clears storage and calls unauthorizedHandler, which redirects to
      // /login) — so the only thing left to tolerate here is a network
      // failure, which keeps the cached session instead of forcing a login
      // screen while offline (matches the desktop/mobile apps).
      try {
        const { data } = await authApi.getMe()
        if (data) {
          const normalized = { ...data }
          if (!normalized._id && (normalized as any).id) {
            normalized._id = (normalized as any).id
          }
          persistUser(normalized)
          set({ user: normalized })
        }
      } catch {
        // see comment above — nothing left to do for either outcome
      }

      set({ isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },
}))
