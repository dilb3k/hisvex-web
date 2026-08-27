import { create } from 'zustand'
import { setApiToken, setRefreshToken, clearApiCache, authApi } from './api'
import { syncBusinessDayFromServer } from './businessDay'
import type { User } from './types'

// The business-day boundary is per-account, so every path that establishes or
// refreshes the session has to push the server's value into businessDay.ts —
// otherwise date math here silently runs on the hardcoded default.
function applyBusinessDay(user: User | null | undefined) {
  if (!user) return
  syncBusinessDayFromServer({
    businessDayStartHour: user.businessDayStartHour,
    pendingBusinessDayStartHour: user.pendingBusinessDayStartHour,
    businessDayEffectiveFrom: user.businessDayEffectiveFrom,
  })
}

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
    applyBusinessDay(normalized)
    set({ token, refreshToken, user: normalized, isAuthenticated: true })
  },
  setUser: (user) => {
    persistUser(user)
    applyBusinessDay(user)
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
    const fail = () => {
      // Any failure ends the same way: no session, and the route guards send
      // straight to /login from the splash. Nothing is ever marked
      // authenticated on the strength of localStorage alone.
      setApiToken(null)
      setRefreshToken('')
      clearApiCache()
      clearPersistedToken()
      set({ token: '', refreshToken: '', user: null, isAuthenticated: false, isLoading: false })
    }

    const result = readPersistedToken()
    if (!result?.token) {
      set({ isLoading: false, isAuthenticated: false })
      return
    }

    setApiToken(result.token)
    setRefreshToken(result.refreshToken)

    // The server decides whether this session is real — the cached user is
    // never enough. Previously `isAuthenticated: true` was set here, before
    // /me had answered, so a stale token painted the dashboard first and only
    // bounced to /login once some later request happened to 401. The whole
    // point of holding the splash is to make that impossible: one request,
    // and the very next screen is either the dashboard or the login page.
    //
    // A network failure is treated as "no session" too. This client has no
    // offline mode (unlike desktop/mobile, which queue writes locally), so a
    // dashboard it cannot talk to is a worse answer than a login screen.
    try {
      const { data } = await authApi.getMe()
      if (!data) { fail(); return }

      const normalized = { ...data }
      if (!normalized._id && (normalized as any).id) {
        normalized._id = (normalized as any).id
      }
      persistUser(normalized)
      applyBusinessDay(normalized)
      set({
        token: result.token,
        refreshToken: result.refreshToken,
        user: normalized,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      fail()
    }
  },
}))
