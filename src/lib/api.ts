'use client'

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import rawAxios from 'axios'
import type { AuthResponse, AuthSuccess, DashboardData, DailySnapshot, DatabaseStats, Debtor, InventoryItem, Product, SyncPayload, SyncResponse, User } from './types'
import { getBusinessDate } from './businessDay'
import { enqueueWrite, flushOfflineQueue } from './offlineQueue'

interface InventoryResponse {
  items: InventoryItem[]
  summary?: { totalStart: number; totalCurrent: number; totalSold: number; totalRevenue: number; totalProfit: number }
}

// Primary (Railway) / Backup (Render) — same codebase deployed twice against
// the same MongoDB Atlas cluster. Calls used to go through Vercel's
// `/api/:path*` rewrite to a single hardcoded backend (see vercel.json); that
// indirection can't switch targets at request time, so failover requires
// calling both backends' absolute URLs directly from the browser instead
// (both already allow this origin via CORS — verified before this change).
const PRIMARY_API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://hisvex-api-production.up.railway.app/api'
const BACKUP_API_URL = process.env.NEXT_PUBLIC_API_BACKUP_URL || 'https://hisvex-api.onrender.com/api'
const HEALTH_RECHECK_INTERVAL_MS = 3 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 10000
const HEAVY_TIMEOUT_MS = 60000

// Kept relative in dev: the local dev server proxies `/api` to whatever a
// developer is running locally (see next.config's dev-only rewrite), and
// there's no second local backend to fail over to.
const API_BASE_URL = process.env.NODE_ENV === 'development' ? (process.env.NEXT_PUBLIC_API_BASE_URL || '/api') : PRIMARY_API_URL

let isPrimaryDown = false
let healthRecheckTimer: ReturnType<typeof setInterval> | null = null

function activeApiBaseUrl(): string {
  if (process.env.NODE_ENV === 'development') return API_BASE_URL
  return isPrimaryDown ? BACKUP_API_URL : PRIMARY_API_URL
}

// Once a request has actually failed over, ping Railway's own health check
// (not through this same failover-aware client — a plain call, so a still-down
// primary can't itself trigger another failover attempt) every 3 minutes.
// Stops itself once primary answers again; a later failure restarts it.
function scheduleHealthRecheck() {
  if (healthRecheckTimer) return
  healthRecheckTimer = setInterval(async () => {
    if (!isPrimaryDown) return
    try {
      const res = await rawAxios.get(`${PRIMARY_API_URL}/health`, { timeout: 5000 })
      if (res.status === 200) {
        isPrimaryDown = false
        if (healthRecheckTimer) { clearInterval(healthRecheckTimer); healthRecheckTimer = null }
        console.log('[api] Primary (Railway) is back — switching off Render.')
        reportOpsFailoverEvent('recovered', 'render', 'railway')
        void flushOfflineQueue((item) =>
          api({ method: item.method, url: item.url, data: item.data }).then(() => undefined),
        )
      }
    } catch {
      // Still down — leave isPrimaryDown as-is, try again next tick.
    }
  }, HEALTH_RECHECK_INTERVAL_MS)
}

// Only a server that's actually unreachable/down should fail over — a 4xx is
// the client's own fault (bad input, expired auth, not found) and retrying it
// against a second server would just get the same answer twice.
function isFailoverTriggering(error: AxiosError): boolean {
  const status = error.response?.status
  if (status === 502 || status === 503 || status === 504) return true
  // No response at all reached us (not even an error response) — a genuine
  // connection-level failure, not our own client-side timeout (ECONNABORTED
  // is handled separately below and deliberately excluded here: a slow-but-
  // alive server isn't "down" the way a dead one returning 502/no-response is).
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
  return url.includes('/snapshots') || url.includes('/inventory/range') || url.includes('/stats')
}

// The only writes queued for offline replay when BOTH backends are down —
// deliberately narrow: these three are the ones a cashier can't just wait
// out (a sale in progress, closing out the day), and their payloads are
// self-contained enough to safely replay later. Everything else (product
// edits, debtor adjustments, admin actions) still surfaces as a normal error
// rather than silently queuing — broadening this list is follow-up work, not
// a default to reach for without checking each endpoint's own replay safety.
const OFFLINE_QUEUABLE_PATHS = ['/inventory/sales', '/inventory/start-day', '/inventory/bulk-current']

function isOfflineQueuable(config: InternalAxiosRequestConfig): boolean {
  const url = config.url ?? ''
  const method = (config.method ?? '').toLowerCase()
  return (method === 'post' || method === 'put') && OFFLINE_QUEUABLE_PATHS.some((p) => url.includes(p))
}

// Best-effort, fire-and-forget report to whichever backend is CURRENTLY
// reachable — never routed through the `api` instance above, since that
// would re-enter the very failover logic this is reporting on. A failure
// here (e.g. this call itself hits a third, even-worse failure) is silently
// dropped; it must never affect the request that triggered the failover.
function reportOpsFailoverEvent(event: 'failover' | 'recovered', from: string, to: string) {
  if (!apiToken) return
  const baseUrl = event === 'failover' ? BACKUP_API_URL : PRIMARY_API_URL
  void rawAxios
    .post(
      `${baseUrl}/ops/failover`,
      { event, from, to },
      { timeout: 5000, headers: { Authorization: `Bearer ${apiToken}` } },
    )
    .catch(() => {})
}

let apiToken: string | null = null
let apiRefreshToken: string | null = null
let unauthorizedHandler: (() => void) | null = null

export function setApiToken(token: string | null) {
  apiToken = token
}

export function setRefreshToken(token: string | null) {
  apiRefreshToken = token
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
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

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (apiToken) {
    config.headers.Authorization = `Bearer ${apiToken}`
  }
  // Re-evaluated on every dispatch (not baked into the axios instance) so a
  // failover that happened mid-session immediately applies to the very next
  // call, including one already in flight being retried by the response
  // interceptor below.
  config.baseURL = activeApiBaseUrl()
  if (config.timeout === undefined) {
    config.timeout = isHeavyRequest(config) ? HEAVY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
  }
  // Stamped once per logical request, not once per attempt: a retry (the
  // failover-retry below, or a replay from the offline queue) reuses the
  // SAME config object, so this only runs the first time and the key
  // travels unchanged through every subsequent attempt — which is the whole
  // point, since the backend dedupes on it (see idempotency.service.ts).
  if (
    isOfflineQueuable(config) &&
    config.data &&
    typeof config.data === 'object' &&
    !('idempotencyKey' in config.data)
  ) {
    ;(config.data as Record<string, unknown>).idempotencyKey =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  if (config.method === 'get') {
    // Stamp the generation active at dispatch time so the response handler can tell
    // whether a mutation raced ahead of this GET before its response landed.
    ;(config as InternalAxiosRequestConfig & { _cacheGen?: number })._cacheGen = cacheGeneration
    const key = cacheKey(config)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      config.adapter = () => Promise.resolve({ data: hit.data, status: 200, statusText: 'OK', headers: {}, config })
    }
  }
  return config
})

let refreshPromise: Promise<'ok' | 'failed'> | null = null

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

  apiToken = null
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
  (response) => {
    const body = response.data
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
      response.data = body.data
    }
    if (response.config.method === 'get') {
      // Only cache this response if no mutation completed since the request was sent —
      // otherwise it's a stale in-flight read racing a mutation's cache-clear, and
      // writing it in would silently resurrect pre-mutation data.
      const reqGen = (response.config as InternalAxiosRequestConfig & { _cacheGen?: number })._cacheGen
      if (reqGen === cacheGeneration) {
        cache.set(cacheKey(response.config), { data: response.data, ts: Date.now() })
      }
    } else {
      // Invalidate synchronously, before this mutating call's promise resolves to its
      // caller, so an immediately-following GET can never observe stale cached data.
      cache.clear()
      cacheGeneration++
    }
    return response
  },
  async (error: AxiosError<{ success?: boolean; error?: { message?: string; details?: unknown }; message?: string }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _failoverRetried?: boolean }
    const url = originalRequest?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh') || url.includes('/auth/logout')

    // Primary looks down (502/503/504, or unreachable outright) — resend this
    // exact request (headers, auth, body — including a FormData upload, which
    // browsers/RN keep re-readable, unlike a Node stream) against the backup
    // immediately, before this error reaches the caller as a failure. Applies
    // to auth calls too: a login shouldn't be stuck just because Railway is
    // the one that's down. Only ever retried once per request either way, so
    // a backup that's *also* down surfaces as a normal error instead of
    // looping.
    if (originalRequest && !originalRequest._failoverRetried && isFailoverTriggering(error)) {
      originalRequest._failoverRetried = true
      if (!isPrimaryDown) {
        isPrimaryDown = true
        scheduleHealthRecheck()
        console.warn('[api] Primary (Railway) unreachable — failing over to Render for this and subsequent requests.')
        reportOpsFailoverEvent('failover', 'railway', 'render')
      }
      originalRequest.baseURL = BACKUP_API_URL
      return api(originalRequest)
    }

    // Both backends just failed for this exact request (the branch above
    // already tried the other one). For a sale/stock-write specifically,
    // don't hand the cashier an error over something outside their control —
    // queue it locally and answer as if it went through. Read requests, and
    // every other write, still surface the real error: there's no safe
    // "pretend it worked" answer for those (a cashier can retry a save, but
    // can't act on stale/guessed data for a read).
    if (
      originalRequest?._failoverRetried &&
      isFailoverTriggering(error) &&
      isOfflineQueuable(originalRequest)
    ) {
      // config.data is still the original plain object at this point — axios
      // only serializes it to a string internally when actually dispatching,
      // it doesn't mutate config.data itself.
      const data = (originalRequest.data as Record<string, unknown>) ?? {}
      const id = (data.idempotencyKey as string | undefined) ?? crypto.randomUUID()
      try {
        await enqueueWrite({
          id,
          method: (originalRequest.method as 'post' | 'put') ?? 'post',
          url: originalRequest.url ?? '',
          data,
        })
        console.warn(`[api] Both backends unreachable — queued ${originalRequest.url} for offline replay (${id}).`)
        return { data, status: 200, statusText: 'OK (queued offline)', headers: {}, config: originalRequest }
      } catch (queueError) {
        console.error('[api] Failed to queue write for offline replay — surfacing the original error', queueError)
        // Fall through to the normal error path below; the operation is
        // genuinely lost otherwise, and the caller needs to know that
        // rather than believe it was queued.
      }
    }

    if (error.response?.status === 401 && !isAuthEndpoint && apiRefreshToken && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true
      const pending = refreshPromise ?? (refreshPromise = (async () => {
        try {
          const res = await rawAxios.post(`${activeApiBaseUrl()}/auth/refresh`, { refreshToken: apiRefreshToken }, { timeout: DEFAULT_TIMEOUT_MS })
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
        } catch {
          return 'failed' as const
        }
      })().finally(() => { refreshPromise = null }))
      return pending.then((result) => {
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
    if (data && typeof data === 'object') {
      if ('error' in data && data.error && typeof data.error === 'object' && 'message' in data.error && typeof data.error.message === 'string') {
        message = data.error.message
      } else if ('message' in data && typeof data.message === 'string') {
        message = data.message
      } else {
        message = error.message || 'API xatoligi'
      }
    } else {
      message = error.message || 'API xatoligi'
    }
    return Promise.reject(new Error(message))
  },
)

export const authApi = {
  login: (username: string, password: string) => api.post<AuthResponse>('/auth/login', { username, password, deviceId: getDeviceId() }),
  loginWithPhone: (username: string, password: string, phone_number: string) => api.post<AuthSuccess>('/auth/login/verify-phone', { username, password, phone_number, deviceId: getDeviceId() }),
  register: (username: string, password: string, phone_number?: string, businessDayStartHour?: number) => api.post<AuthSuccess>('/auth/register', {
    username,
    password,
    phone_number,
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
  delete: (id: string) => api.delete(`/products/${id}`),
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
  startDay: (items: { productId: string; startQuantity: number; currentQuantity?: number; note?: string; localId?: string; createdAt?: string; updatedAt?: string }[]) =>
    api.post('/inventory/start-day', { deviceId: getDeviceId(), date: getBusinessDate(), items }),
  /**
   * `lineRevenue` restates the money taken for everything this edit counts as
   * sold (the "Kutilgan tushum" field). Profit follows from it automatically.
   */
  bulkUpdate: (items: { productId: string; currentQuantity: number; lineRevenue?: number; note?: string }[]) =>
    api.put('/inventory/bulk-current', { deviceId: getDeviceId(), date: getBusinessDate(), items }),
  /**
   * A line states what it actually brought in: `lineRevenue` is the money for
   * the whole line (exact — what a hand-typed cart total uses), `unitPrice` a
   * haggled per-unit price. Omit both to charge the list price.
   */
  recordSales: (
    date: string,
    lines: { productId: string; quantity: number; unitPrice?: number; lineRevenue?: number }[],
  ) =>
    api.post('/inventory/sales', { date, deviceId: getDeviceId(), lines }),
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
    // Legacy pre-R2 images live in Mongo, not R2 — reachable from whichever
    // backend is currently active since both read the same Atlas cluster.
    return `${activeApiBaseUrl()}/products/image/${src}`
  }
  return undefined
}

// Call once on app startup (see AppLayout) to replay anything left queued
// from a previous tab/session that closed while both backends were down —
// the health-recheck-triggered flush in scheduleHealthRecheck above only
// covers a recovery that happens while this tab is already open.
export function flushOfflineQueueOnStartup() {
  void flushOfflineQueue((item) =>
    api({ method: item.method, url: item.url, data: item.data }).then(() => undefined),
  )
}

export default api
