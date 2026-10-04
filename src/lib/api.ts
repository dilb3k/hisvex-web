import type { ProcurementReceipt, ProcurementSummary, ProcurementQuery, ProcurementHistoryQuery, ProcurementAnalytics } from './procurementTypes'
'use client'

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import rawAxios from 'axios'
import { createManualMutationRegistry, isDurableManualMutation, isDefinitiveMutationRejection, type ManualIntent } from './manualMutationIntent'
import type { AuthResponse, AuthSuccess, DashboardData, DailySnapshot, DatabaseStats, Debtor, InventoryItem, Product, SyncPayload, SyncResponse, User } from './types'
import { getBusinessDate } from './businessDay'
import { enqueueWrite, flushOfflineQueue, setQueueOwner, getQueueOwner, removeQueuedWrite, markQueuedWriteForReview, isTransientQueueFailure } from './offlineQueue'

interface InventoryResponse {
  items: InventoryItem[]
  summary?: { totalStart: number; totalCurrent: number; totalSold: number; totalRevenue: number; totalProfit: number }
}

// Real backend hosts (Railway primary, Render backup) are no longer known
// to the browser at all — this client always talks to this same origin's
// own /api/* route, which is a server-side proxy (src/app/api/[...path]/
// route.ts) that holds the actual URLs (BACKEND_PRIMARY_URL/
// BACKEND_BACKUP_URL, server-only env vars) and does the primary→backup
// failover itself, in one round trip the browser never sees. That proxy
// answers with a 503 + error.code "BOTH_BACKENDS_DOWN" only when it already
// tried both and neither answered — see isBothBackendsDown below.
//
// Timeouts here are set well above what the proxy needs for its OWN
// two-attempt worst case (10s+10s / 60s+60s server-side) so a genuine dual
// outage surfaces as that clean 503 instead of this client aborting first
// and masking it with a generic timeout error.
const DEFAULT_TIMEOUT_MS = 22000
const HEAVY_TIMEOUT_MS = 125000
const AUTH_TIMEOUT_MS = 35000

const API_BASE_URL = '/api'

// A 503 from OUR OWN proxy carrying this error code is the proxy telling us
// it already tried both backends and neither answered — the same situation
// isFailoverTriggering used to detect from a raw backend response. A plain
// network-level failure reaching this client at all (can't even reach our
// own same-origin proxy) means the device itself has no connectivity, which
// is the same "nothing is reachable" situation from the caller's point of
// view.
function isBothBackendsDown(error: AxiosError): boolean {
  if (error.response?.status === 503) {
    const data = error.response.data as { error?: { code?: string } } | undefined
    if (data?.error?.code === 'BOTH_BACKENDS_DOWN') return true
  }
  if (!error.response && error.code && error.code !== 'ECONNABORTED') return true
  return false
}

// Image/file uploads and anything explicitly flagged heavy get more time
// than a normal read/write — a 10s budget is generous for the rest and
// keeps a genuinely dead primary from hanging a request for a full minute
// before this client even gets to try the backup.
function isHeavyRequest(config: InternalAxiosRequestConfig): boolean {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) return true
  const url = config.url ?? ''
  return url.includes('/snapshots') || url.includes('/inventory/range') || url.includes('/stats') || url.includes('/procurements')
}

function isSessionLogin(config: InternalAxiosRequestConfig): boolean {
  return ['/auth/login', '/auth/login/verify-phone', '/auth/verify-session-challenge'].includes(config.url ?? '')
}

// The only writes queued for offline replay when BOTH backends are down —
// deliberately narrow: these three are the ones a cashier can't just wait
// out (a sale in progress, closing out the day), and their payloads are
// self-contained enough to safely replay later. Everything else (product
// edits, debtor adjustments, admin actions) still surfaces as a normal error
// rather than silently queuing — broadening this list is follow-up work, not
// a default to reach for without checking each endpoint's own replay safety.
const OFFLINE_QUEUABLE_PATHS = ['/inventory/operations', '/inventory/sales', '/inventory/start-day', '/inventory/bulk-current']

function isOfflineQueuable(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? ''
  const method = (config.method ?? '').toLowerCase()
  return (method === 'post' || method === 'put') && OFFLINE_QUEUABLE_PATHS.some((p) => url.includes(p))
}

function sessionIdentity(token: string | null): string {
  if (!token) return ''
  try { const p=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return `${p.userId}:${p.sessionId??''}:${p.scope??'full'}:${p.securityVersion??0}` } catch { return token }
}
let authEpoch=0
let apiToken: string | null = null
let procurementScope = false
let apiRefreshToken: string | null = null
let unauthorizedHandler: (() => void) | null = null
let backendReachableHandler: (() => void) | null = null
let backendWasUnavailable = false

export function setApiToken(token: string | null) {
  if(sessionIdentity(token)!==sessionIdentity(apiToken)) {authEpoch++;refreshPromise=null;backendWasUnavailable=false}
  apiToken = token
  try { procurementScope = token ? JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).scope === 'procurement' : false } catch { procurementScope = false }
  let owner: string | null = null
  try { owner = token ? JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).userId ?? null : null } catch {}
  setQueueOwner(owner)
  clearApiCache()
}

export function setRefreshToken(token: string | null) {
  apiRefreshToken = token
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function setBackendReachableHandler(handler: (() => void) | null) {
  backendReachableHandler = handler
}

type ApiErrorBody = { success?: boolean; error?: { message?: string; details?: unknown; code?: string }; message?: string }
function queuedWriteNeedsReview(error: AxiosError<ApiErrorBody>): boolean {
  const status = error.response?.status
  const body = error.response?.data
  return !!status && [400, 403, 404, 409, 422].includes(status) && body?.success === false
    && !isTransientQueueFailure(status, body.error?.code)
}

let tokensRefreshedHandler: ((token: string, refreshToken: string) => void) | null = null

export function setTokensRefreshedHandler(handler: ((token: string, refreshToken: string) => void) | null) {
  tokensRefreshedHandler = handler
}

const cache = new Map<string, { data: any; ts: number }>()
// Bumped synchronously on every mutating (non-GET) response, and stamped onto each
// GET request when it is dispatched. A GET response is only allowed to populate the
// cache if no mutation has happened since that GET was sent — this closes the race
// where an in-flight GET resolves after a mutation already cleared the cache and would
// otherwise silently repopulate it with pre-mutation data.
let cacheGeneration = 0
export function clearApiCache() {
  cache.clear()
  cacheGeneration++
}
const CACHE_TTL = 30000

function cacheKey(config: { method?: string; url?: string; params?: any }) {
  return `${config.method}:${config.url}:${JSON.stringify(config.params ?? {})}`
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

const MAX_RETRIES = 2

function manualRegistry(owner: string, epoch: number) {
  const assert = () => { if (owner !== getQueueOwner() || epoch !== authEpoch) throw Error('Hisob yoki sessiya o‘zgardi') }
  const key = (slot: string) => `hisvex-manual-v1:${owner}:${procurementScope ? 'procurement' : 'full'}:${slot}`
  return createManualMutationRegistry({
    read: async slot => { const raw = localStorage.getItem(key(slot)); return raw ? JSON.parse(raw) as ManualIntent : null },
    write: async (slot, value) => { assert(); if (value) localStorage.setItem(key(slot), JSON.stringify(value)); else localStorage.removeItem(key(slot)) },
    lock: async (slot, work) => {
      if (typeof navigator === 'undefined' || !navigator.locks) throw Error('Brauzer xavfsiz amal saqlovini qo‘llamaydi')
      return await navigator.locks.request(key(slot), work)
    },
  }, () => crypto.randomUUID(), async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join(''), assert)
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const cfg = error.config as (InternalAxiosRequestConfig & { _timeoutRetryCount?: number }) | undefined
    // GET is safe to retry blind — it can't change anything server-side, so
    // replaying it after a timeout risks nothing worse than reading the same
    // data twice. A mutating method (sales, debtor adjust, payment approve,
    // ...) is a different story: a timeout only means THIS client gave up
    // waiting, not that the server didn't finish the write — the request
    // could easily have already succeeded and be sitting in the database
    // when this fires. Retrying it here would record that same sale/payment
    // a second time with no way to tell it apart from a real second one.
    // Fixing this properly needs an idempotency key the server dedupes on;
    // until that exists, the safe default is to not retry writes at all and
    // surface the timeout as an error instead.
    if (error.code === 'ECONNABORTED' && cfg && cfg.method === 'get') {
      const count = cfg._timeoutRetryCount ?? 0
      if (count < MAX_RETRIES) {
        cfg._timeoutRetryCount = count + 1
        console.log(`API timeout, retrying (${count + 1}/${MAX_RETRIES})...`)
        return api.request(cfg)
      }
    }
    return Promise.reject(error)
  }
)

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if ((config as any)._authEpoch !== undefined && (config as any)._authEpoch !== authEpoch) throw Error('Sessiya o‘zgardi')
  ;(config as any)._authEpoch=authEpoch
  if (config.headers['X-Account-ID'] && config.headers['X-Account-ID'] !== getQueueOwner()) throw new Error('Hisob o‘zgardi')
  if (getQueueOwner()) config.headers['X-Account-ID'] = getQueueOwner()
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) config.headers.delete('Content-Type')
  config.headers['X-Client-Protocol']='2'
  if (!config.headers['Idempotency-Key'] && isDurableManualMutation(config.method, config.url)) {
    const owner = getQueueOwner()
    if (!owner) throw Error('Avval hisobga kiring')
    const registry = manualRegistry(owner, authEpoch)
    const slot = `${config.method}:${config.url}`
    const intent = await registry.claim(slot, { body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, params: config.params })
    config.headers['Idempotency-Key'] = intent.id
    ;(config as any)._manualIntent = { registry, slot, id: intent.id }
  }
  if(!['get','head','options'].includes(config.method??'get')) config.headers['Idempotency-Key'] ??= crypto.randomUUID()
  if (apiToken) {
    config.headers.Authorization = `Bearer ${apiToken}`
  }
  if (!config.timeout) {
    config.timeout = isSessionLogin(config) ? AUTH_TIMEOUT_MS : isHeavyRequest(config) ? HEAVY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
  }
  if (isOfflineQueuable(config)) {
    // Axios may have serialized data on a prior attempt. Recover the same
    // payload and identity rather than generating another sale ID.
    const data = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    if (!data || typeof data !== 'object') throw new Error('Amal ma’lumotlari noto‘g‘ri')
    data.idempotencyKey ??= data.id ?? crypto.randomUUID()
    config.headers['Idempotency-Key'] = data.idempotencyKey
    config.data = data
    if (!(config as any)._queueReplay) await enqueueWrite({id:data.idempotencyKey,method:config.method as 'post'|'put',url:config.url!,data,owner:getQueueOwner()!})
  }
  if (config.method === 'get' && !config.url?.startsWith('/auth/')) {
    // Stamp the generation active at dispatch time so the response handler can tell
    // whether a mutation raced ahead of this GET before its response landed.
    ;(config as InternalAxiosRequestConfig & { _cacheGen?: number })._cacheGen = cacheGeneration
    const key = cacheKey(config)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      config.adapter = () => Promise.resolve({ data: hit.data, status: 200, statusText: 'OK', headers: { 'x-local-cache': 'hit' }, config })
    }
  }
  return config
})

let refreshPromise: Promise<'ok' | 'failed' | 'network' | 'changed'> | null = null

// Token this device held right before another device logged into the same
// account and got it kicked (see SESSION_REPLACED below). Kept separately
// from 'hisvex_token' so the normal login/logout lifecycle never touches it
// — only the phone-verification page's read-only "view products" link uses
// it, and only until it naturally expires.
const STORAGE_KEY_STALE_TOKEN = 'hisvex_stale_token'

// Decodes a JWT's `exp` claim locally — no network call, so this still works
// when both backends are unreachable. Used by authStore.hydrate() to decide
// whether a cached session can be trusted while offline instead of treating
// "the server didn't answer" the same as "the server said this token is
// dead" (see handleSessionExpired's isSessionExpired tag above).
export function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(normalized))
    return typeof json.exp === 'number' ? json.exp * 1000 : null
  } catch {
    return null
  }
}

export function getStaleToken(): string | null {
  try { return localStorage.getItem(STORAGE_KEY_STALE_TOKEN) } catch { return null }
}

export function clearStaleToken(): void {
  try { localStorage.removeItem(STORAGE_KEY_STALE_TOKEN) } catch {}
}

function handleSessionExpired(
  error: AxiosError<{ success?: boolean; error?: { message?: string; details?: unknown; code?: string }; message?: string }>,
): Error {
  const data = error.response?.data
  const code =
    data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object'
      ? (data.error as { code?: string }).code
      : undefined

  // This device got kicked because another device logged into the same
  // account — the token is dead for every normal call, but the server
  // still honors it (authenticate({ allowStale: true })) for the read-only
  // product/stock preview on the phone-verification page. Stash it before
  // wiping the live token below.
  if (code === 'SESSION_REPLACED' && apiToken) {
    try { localStorage.setItem(STORAGE_KEY_STALE_TOKEN, apiToken) } catch {}
  }

  setApiToken(null)
  apiRefreshToken = null
  cache.clear()
  cacheGeneration++
  try { localStorage.removeItem('hisvex_token') } catch {}
  try { localStorage.removeItem('hisvex_refresh') } catch {}
  try { localStorage.removeItem('hisvex_user') } catch {}
  unauthorizedHandler?.()

  // Tagged so callers (authStore.hydrate) can tell "the server actually said
  // this session is dead" apart from a network/backend-down failure that
  // happened to reach this same code path some other way — only the former
  // should ever wipe a still-otherwise-valid token.
  const tag = (err: Error): Error => Object.assign(err, { isSessionExpired: true })

  if (data && typeof data === 'object') {
    if ('error' in data && data.error && typeof data.error === 'object' && 'message' in data.error && typeof data.error.message === 'string') {
      return tag(new Error(data.error.message))
    }
    if ('message' in data && typeof data.message === 'string') {
      return tag(new Error(data.message))
    }
  }
  return tag(new Error('Avtorizatsiya tugagan. Qayta kiring.'))
}

api.interceptors.response.use(
  async (response) => {
    if ((response.config as any)._authEpoch !== authEpoch) throw Error('Hisob yoki sessiya o‘zgardi')
    if (response.config.headers['X-Account-ID'] && response.config.headers['X-Account-ID'] !== getQueueOwner()) throw new Error('Hisob o‘zgardi')
    // Only a real protected response confirms a cached offline session. A
    // local GET cache hit, public login response, or stale preview does not.
    const confirmsSession = response.status >= 200 && response.status < 300 && response.data?.success !== false
      && !response.headers['x-local-cache'] && apiToken && response.config.headers.Authorization === `Bearer ${apiToken}`
      && !/^\/auth\/(?:login|register|refresh|logout|verify)/.test(response.config.url ?? '')
      && response.config.url !== '/inventory-preview'
    const recovered = confirmsSession && backendWasUnavailable
    if (confirmsSession) { backendWasUnavailable = false; backendReachableHandler?.() }
    const manual = (response.config as any)._manualIntent
    if (manual && response.status !== 202 && response.data?.success !== false) await manual.registry.acknowledge(manual.slot, manual.id)
    if (isOfflineQueuable(response.config) && !(response.config as any)._queueReplay && response.status !== 202 && response.data?.success !== false) {
      await removeQueuedWrite(String(response.config.headers['Idempotency-Key']), String(response.config.headers['X-Account-ID']))
    }
    const body = response.data
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
      response.data = body.data
    }
    if (response.config.method === 'get' && !response.config.url?.startsWith('/auth/')) {
      // Only cache this response if no mutation completed since the request was sent —
      // otherwise it's a stale in-flight read racing a mutation's cache-clear, and
      // writing it in would silently resurrect pre-mutation data.
      const reqGen = (response.config as InternalAxiosRequestConfig & { _cacheGen?: number })._cacheGen
      if (reqGen === cacheGeneration && !response.headers['x-local-cache']) {
        cache.set(cacheKey(response.config), { data: response.data, ts: Date.now() })
      }
    } else if (response.config.method !== 'get' && response.config.url !== '/auth/session/heartbeat') {
      // Invalidate synchronously, before this mutating call's promise resolves to its
      // caller, so an immediately-following GET can never observe stale cached data.
      cache.clear()
      cacheGeneration++
      // A successful write is a strong "we can reach a real backend right
      // now" signal — opportunistically drain anything still queued from an
      // earlier both-down stretch instead of waiting for this tab to
      // reload. flushOfflineQueue no-ops cheaply when the queue is empty or
      // already flushing, so this is safe to fire on every mutation.
      if (!procurementScope && response.status !== 202) void flushOfflineQueueOnStartup().catch(() => {})
    }
    if (recovered && response.config.method === 'get') void flushOfflineQueueOnStartup().catch(() => {})
    return response
  },
  async (error: AxiosError<ApiErrorBody>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    if (originalRequest && (originalRequest as any)._authEpoch !== authEpoch) return Promise.reject(Error('Hisob yoki sessiya o‘zgardi'))
    if (originalRequest?.headers['X-Account-ID'] && originalRequest.headers['X-Account-ID'] !== getQueueOwner()) return Promise.reject(new Error('Hisob o‘zgardi'))
    if (originalRequest && (!error.response || error.response.status >= 500 || (error.response.status === 404 && error.response.data?.success !== false))) backendWasUnavailable = true
    const manual = (originalRequest as any)?._manualIntent
    if (manual && isDefinitiveMutationRejection(error.response?.status, error.response?.data)) await manual.registry.acknowledge(manual.slot, manual.id)
    const url = originalRequest?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/verify-session-challenge') || url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh') || url.includes('/auth/logout') || url.includes('/auth/password/reset')

    // The proxy (src/app/api/[...path]/route.ts) already tried primary then
    // backup server-side before this response ever reached the browser — no
    // client-side retry-against-a-different-baseURL left to do here. For a
    // sale/stock-write specifically, don't hand the cashier an error over
    // something outside their control — queue it locally and answer as if
    // it went through. Read requests, and every other write, still surface
    // the real error: there's no safe "pretend it worked" answer for those
    // (a cashier can retry a save, but can't act on stale/guessed data for
    // a read).
    if (
      originalRequest &&
      !(originalRequest as any)._queueReplay &&
      (isBothBackendsDown(error) || !error.response || error.response.status >= 500 || [400,403,404,409,422].includes(error.response.status)) &&
      isOfflineQueuable(originalRequest)
    ) {
      // Intent was persisted before dispatch. A failed response never
      // changes its ID or claims the server has committed it.
      const needsReview=queuedWriteNeedsReview(error)
      const message=error.response?.data?.error?.message ?? error.response?.data?.message ?? 'Server amalni rad etdi'
      if(needsReview) await markQueuedWriteForReview(String(originalRequest.headers['Idempotency-Key']),message,String(originalRequest.headers['X-Account-ID']))
      return { data: { queued: true, needsReview, message:needsReview?message:undefined }, status: 202, statusText: 'Queued; awaiting confirmation', headers: {}, config: originalRequest }
    }

    if (error.response?.status === 401 && !isAuthEndpoint && apiRefreshToken && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true
      const refreshEpoch=authEpoch
      const refreshingToken=apiRefreshToken
      const pending = refreshPromise ?? (refreshPromise = (async () => {
        try {
          const res = await rawAxios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: refreshingToken }, { timeout: DEFAULT_TIMEOUT_MS })
          if(refreshEpoch!==authEpoch) return 'changed' as const
          const body = res.data
          const data = body && typeof body === 'object' && 'success' in body && 'data' in body ? body.data : body
          const newToken: string = data.token
          const newRefresh: string = data.refreshToken
          apiToken = newToken
          apiRefreshToken = newRefresh
          try { localStorage.setItem('hisvex_token', newToken) } catch {}
          try { localStorage.setItem('hisvex_refresh', newRefresh) } catch {}
          tokensRefreshedHandler?.(newToken, newRefresh)
          return 'ok' as const
        } catch (refreshError: any) {
          if(refreshEpoch!==authEpoch) return 'changed' as const
          return [400,401,403].includes(refreshError?.response?.status)?'failed' as const:'network' as const
        }
      })().finally(() => { if(refreshEpoch===authEpoch) refreshPromise = null }))
      return pending.then((result) => {
        if(refreshEpoch!==authEpoch || result==='changed') return Promise.reject(Error('Hisob yoki sessiya o‘zgardi'))
        if(result==='network') return Promise.reject(Object.assign(Error('Tokenni yangilash uchun server bilan aloqa yo‘q'),{code:'REFRESH_NETWORK_ERROR'}))
        if (result === 'failed') {
          return Promise.reject(handleSessionExpired(error))
        }
        originalRequest.headers.Authorization = `Bearer ${apiToken ?? ''}`
        return api(originalRequest)
      })
    }

    if (error.response?.status === 401 && !isAuthEndpoint) {
      return Promise.reject(handleSessionExpired(error))
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new Error("So'rov vaqti tugadi. Internet aloqasini tekshiring."))
    }
    if (error.code === 'ERR_NETWORK') {
      return Promise.reject(new Error('Tarmoq xatoligi. Server bilan aloqa yo\'q.'))
    }
    const data = error.response?.data
    let message: string
    // Backend AppError codes (e.g. ROUTE_NOT_FOUND) were previously dropped
    // here — offlineQueue.ts's flush loop needs `code` to tell a genuine
    // route/deploy mismatch apart from a real business 404.
    let code: string | undefined
    if (data && typeof data === 'object') {
      if ('error' in data && data.error && typeof data.error === 'object' && 'message' in data.error && typeof data.error.message === 'string') {
        message = data.error.message
        code = (data.error as { code?: string }).code
      } else if ('message' in data && typeof data.message === 'string') {
        message = data.message
      } else {
        message = error.message || 'API xatoligi'
      }
    } else {
      message = error.message || 'API xatoligi'
    }
    return Promise.reject(Object.assign(new Error(message), { status: error.response?.status, code,
      requiresReview: originalRequest && isOfflineQueuable(originalRequest) ? queuedWriteNeedsReview(error) : undefined }))
  },
)

export const authApi = {
  resetPassword: (token: string, password: string) => api.post<{ reset: boolean; userId: string; username: string }>('/auth/password/reset', { token, password }),
  beginRegistrationPhone: () => api.post<{ token: string; botUrl: string; expiresAt: string }>('/auth/register/phone', {}),
  registrationPhoneStatus: (token: string) => api.post<{ verified: boolean; phone: string | null }>('/auth/register/phone/status', { token }),
  heartbeat: () => api.post('/auth/session/heartbeat', {}),
  loginProcurement: (username: string, password: string) => api.post<AuthSuccess>('/auth/login/procurement', { username, password }),
  login: (username: string, password: string) => api.post<AuthResponse>('/auth/login', { username, password, deviceId: getDeviceId() }),
  loginWithPhone: (username: string, password: string, phone_number: string) => api.post<AuthResponse>('/auth/login/verify-phone', { username, password, phone_number, deviceId: getDeviceId() }),
  // Completes the AuthOtpChallenge path login() can now return — see
  // types.ts. Same success shape as a normal login (token/refreshToken/user).
  verifySessionChallenge: (sessionChallengeId: string, otpCode: string) =>
    api.post<AuthSuccess>('/auth/verify-session-challenge', { sessionChallengeId, otpCode, deviceId: getDeviceId() }),
  register: (username: string, password: string, phone_number?: string, businessDayStartHour?: number, phoneVerificationToken?: string) => api.post<AuthSuccess>('/auth/register', {
    username,
    password,
    phone_number,
    phoneVerificationToken,
    deviceId: getDeviceId(),
    ...(businessDayStartHour !== undefined ? { businessDayStartHour } : {}),
  }),
  // The caller passes its token explicitly because logout races the local
  // sign-out: the request interceptor reads `apiToken` when the request is
  // actually dispatched, which is a microtask after the caller has already
  // cleared it. The logout then went out with no Authorization header, the
  // server answered 401, and the account's activeSessionId was never
  // released — so the next login was met with "this account is active on
  // another device" and a phone-verification prompt.
  //
  // An explicit header survives, because the interceptor only sets one when
  // `apiToken` is non-null and so never overwrites this.
  logout: (token?: string) =>
    api.post(
      '/auth/logout',
      undefined,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
    ),
  getMe: () => api.get<User>('/auth/me'),
  updateMe: (data: Partial<User>) => api.put('/auth/me', data),
  // Read-only product/stock list for the phone-verification page's "view
  // products" link. Takes the stale token explicitly rather than relying
  // on apiToken — same reasoning as logout()'s explicit token above: this
  // call happens precisely when this device is NOT the authenticated one.
  fetchProductPreview: (staleToken: string) =>
    api.get<{ productId: string; name: string; unit: string; sellPrice: number; currentQuantity: number }[]>(
      '/inventory-preview',
      { headers: { Authorization: `Bearer ${staleToken}` } },
    ),
}

export const productsApi = {
  getAll: (search?: string) => api.get<Product[]>('/products', { params: { search } }),
  getById: (id: string) => api.get<Product>(`/products/${id}`),
  create: (data: Partial<Product>) => api.post<Product>('/products', data),
  update: (id: string, data: Partial<Product>) => api.put<Product>(`/products/${id}`, data),
  delete: (id: string,baseVersion:number) => api.delete(`/products/${id}`,{data:{baseVersion}}),
  restock: (productId: string, quantity: number) => api.post('/inventory/operations', { kind: 'restock', id: crypto.randomUUID(), deviceId: getDeviceId(), occurredAt: new Date().toISOString(), productId, quantity }),
  // Multipart upload to the R2-backed endpoint. Field name must be "image" to
  // match the backend's `imageUpload.single("image")` middleware. No
  // Content-Type header here — axios sets `multipart/form-data; boundary=...`
  // itself from the FormData body, and overriding it drops the boundary.
  uploadImage: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('image', file)
    return api.post<{ product: Product }>(`/products/${id}/image`, formData)
  },
}

export function getDeviceId(): string {
  try {
    let did = localStorage.getItem('hisvex_device_id')
    if (!did) {
      did = crypto.randomUUID?.() || Math.random().toString(36).slice(2)
      localStorage.setItem('hisvex_device_id', did)
    }
    return did
  } catch { return '' }
}

export const inventoryApi = {
  getByDate: (from: string, to: string) => api.get<InventoryResponse>('/inventory', { params: { from, to } }),
  getDashboard: () => api.get<DashboardData>('/inventory/dashboard'),
  startDay: (items: { productId: string; baseVersion?: number; startQuantity: number; currentQuantity?: number; note?: string; localId?: string; createdAt?: string; updatedAt?: string }[]) =>
    api.post('/inventory/start-day', { deviceId: getDeviceId(), date: getBusinessDate(), items }),
  /**
   * `lineRevenue` restates the money taken for everything this edit counts as
   * sold (the "Kutilgan tushum" field). Profit follows from it automatically.
   */
  bulkUpdate: (items: { productId: string; baseVersion: number; currentQuantity: number; lineRevenue?: number; note?: string }[]) =>
    api.put('/inventory/bulk-current', { deviceId: getDeviceId(), date: getBusinessDate(), items }),
  /**
   * A line states what it actually brought in: `lineRevenue` is the money for
   * the whole line (exact — what a hand-typed cart total uses), `unitPrice` a
   * haggled per-unit price. Omit both to charge the list price.
   */
  recordSales: (
    date: string,
    lines: { productId: string; quantity: number; lineRevenue: number; expectedBuyPrice: number; expectedUnit: "dona"|"kg"; expectedStockEpoch: number }[],
  ) =>
    api.post('/inventory/operations', { kind: 'sale', id: crypto.randomUUID(), occurredAt: new Date().toISOString(), date, deviceId: getDeviceId(), lines }),
}

export const snapshotsApi = {
  getDaily: (date: string) => api.get<DailySnapshot>('/snapshots/daily', { params: { date } }),
  getRange: (from: string, to: string) => api.get<DailySnapshot[]>('/snapshots/range', { params: { from, to } }),
  createDaily: (data: DailySnapshot) => api.post<DailySnapshot>('/snapshots/daily', data),
}

export const syncApi = {
  sync: (payload: SyncPayload) => api.post<SyncResponse>('/sync', payload),
}

export const debtorsApi = {
  getAll: () => api.get<Debtor[]>('/debtors'),
  getById: (id: string) => api.get<Debtor>(`/debtors/${id}`),
  create: (data: Partial<Debtor>) => api.post<Debtor>('/debtors', data),
  update: (id: string, data: Partial<Debtor>) => api.put<Debtor>(`/debtors/${id}`, data),
  // Real bug fix: this sent only {amount, note} — the backend's
  // adjustDebtSchema requires `type` ("add"|"subtract") and a *positive*
  // amount, so every call from this screen (both directions) was rejected
  // with a 400 before it ever reached the debtor. Desktop's client already
  // does this correctly; mirrored here.
  adjust: (id: string, amount: number, note?: string) =>
    api.post(`/debtors/${id}/adjust`, {
      amount: Math.abs(amount),
      type: amount < 0 ? 'subtract' : 'add',
      note,
    }),
  delete: (id: string) => api.delete(`/debtors/${id}`),
}

export const adminsApi = {
  getAll: () => api.get<User[]>('/auth/admins'),
  create: (username: string, password: string, tier?: string, phone_number?: string) => api.post('/auth/admins', { username, password, tier, phone_number }),
  update: (id: string, data: { username?: string; password?: string; tier?: string; phone_number?: string; isActive?: boolean }) => api.put(`/auth/admins/${id}`, data),
  delete: (id: string) => api.delete(`/auth/admins/${id}`),
  bulkUpdateTier: (tier: 'tekin' | 'bor' | 'pro') => api.put('/auth/users/tier', { tier }),
  getStats: () => api.get<DatabaseStats>('/stats'),
}

export const healthApi = {
  check: () => api.get('/health'),
}

const IMAGE_HASH_REGEX = /^[a-f0-9]{64}$/

// `imageUrl` (R2) wins when present; `image`/`imageHash` is the pre-R2-migration
// fallback for products that haven't been touched since.
export function resolveImageUrl(imageUrl?: string | null, image?: string, imageHash?: string): string | undefined {
  if (imageUrl) return imageUrl
  const src = image || imageHash
  if (!src) return undefined
  if (src.startsWith('data:image/') || src.startsWith('https://') || src.startsWith('http://')) {
    return src
  }
  if (IMAGE_HASH_REGEX.test(src)) {
    // Legacy pre-R2 images live in Mongo, not R2 — routed through the same
    // same-origin proxy as every other call, which picks whichever backend
    // is currently reachable (both read the same Atlas cluster).
    return `${API_BASE_URL}/products/image/${src}`
  }
  return undefined
}

// Call once on app startup (see AppLayout) to replay anything left queued
// from a previous tab/session that closed while both backends were down —
// the opportunistic flush in the response interceptor's success handler
// above only covers a recovery that happens while this tab is already open.
export function flushOfflineQueueOnStartup() {
  if (procurementScope) return Promise.resolve()
  return flushOfflineQueue(async (item) => {
    const response = await api({ method: item.method, url: item.url, data: item.data, headers: { 'X-Account-ID': item.owner }, _queueReplay: true } as any)
    if (response.status === 202 || response.data?.queued || response.data?.success === false) {
      throw Object.assign(Error('Server tasdig‘i hali kelmadi'), { status: 409, code: 'OPERATION_IN_PROGRESS', requiresReview: false })
    }
  })
}


export const procurementApi = {
  products: async () => {
    const { data } = await api.get<Product[]>('/products')
    return data.map(p => ({id:p.localId ?? p._id,name:p.name,unit:(p.unit ?? 'dona') as 'dona'|'kg',quantity:p.quantity ?? 0,buyPrice:p.buyPrice ?? 0,barcodes:p.barcodes ?? []}))
  },
  list: async (params?: ProcurementHistoryQuery) => (await api.get<ProcurementReceipt[]>('/procurements', {params})).data,
  detail: async (id: string) => (await api.get<ProcurementReceipt>(`/procurements/${encodeURIComponent(id)}`)).data,
  summary: async () => (await api.get<ProcurementSummary>('/procurements/summary')).data,
  analytics: async (params: ProcurementQuery) => (await api.get<ProcurementAnalytics>('/procurements/analytics', {params})).data,
  export: async (params: ProcurementQuery, format: 'csv'|'xlsx'|'pdf') => (await api.get<ArrayBuffer>('/procurements/export', {params:{...params,format},responseType:'arraybuffer'})).data,
  submit: async (id: string, items: import('./procurementIntent').ProcurementItem[], supplier?: string) => {
    const { data } = await api.post<{procurement:{localId:string}}>('/procurements', {items,supplier}, {headers:{'Idempotency-Key':id}})
    return data.procurement
  },
}

export default api
