'use client'

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import rawAxios from 'axios'
import type { AuthResponse, DashboardData, DailySnapshot, DatabaseStats, Debtor, InventoryItem, Product, SyncPayload, SyncResponse, User } from './types'
import { getBusinessDate } from './businessDay'

interface InventoryResponse {
  items: InventoryItem[]
  summary?: { totalStart: number; totalCurrent: number; totalSold: number; totalRevenue: number; totalProfit: number }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://comp-bar-server.onrender.com/api'

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

const cache = new Map<string, { data: any; ts: number }>()
export function clearApiCache() { cache.clear() }
const CACHE_TTL = 30000

function cacheKey(config: { method?: string; url?: string; params?: any }) {
  return `${config.method}:${config.url}:${JSON.stringify(config.params ?? {})}`
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
})

let retryCount = 0
const MAX_RETRIES = 2

api.interceptors.response.use(
  (response) => {
    retryCount = 0
    return response
  },
  async (error) => {
    if (error.code === 'ECONNABORTED' && retryCount < MAX_RETRIES) {
      retryCount++
      console.log(`API timeout, retrying (${retryCount}/${MAX_RETRIES})...`)
      return api.request(error.config)
    }
    retryCount = 0
    return Promise.reject(error)
  }
)

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (apiToken) {
    config.headers.Authorization = `Bearer ${apiToken}`
  }
  if (config.method === 'get') {
    const key = cacheKey(config)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      config.adapter = () => Promise.resolve({ data: hit.data, status: 200, statusText: 'OK', headers: {}, config })
    }
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    const body = response.data
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
      response.data = body.data
    }
    if (response.config.method === 'get') {
      cache.set(cacheKey(response.config), { data: response.data, ts: Date.now() })
    }
    return response
  },
  async (error: AxiosError<{ success?: boolean; error?: { message?: string; details?: unknown }; message?: string }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    if (error.response?.status === 401 && apiRefreshToken && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        const res = await rawAxios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken: apiRefreshToken })
        const body = res.data
        const data = body && typeof body === 'object' && 'success' in body && 'data' in body ? body.data : body
        const newToken: string = data.token
        const newRefresh: string = data.refreshToken
        apiToken = newToken
        apiRefreshToken = newRefresh
        try { localStorage.setItem('hisvex_token', newToken) } catch {}
        try { localStorage.setItem('hisvex_refresh', newRefresh) } catch {}
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return api(originalRequest)
      } catch {}
    }
    if (error.response?.status === 401) {
      apiToken = null
      apiRefreshToken = null
      try { localStorage.removeItem('hisvex_token') } catch {}
      try { localStorage.removeItem('hisvex_refresh') } catch {}
      try { localStorage.removeItem('hisvex_user') } catch {}
      unauthorizedHandler?.()
      const data = error.response?.data
      if (data && typeof data === 'object') {
        if ('error' in data && data.error && typeof data.error === 'object' && 'message' in data.error && typeof data.error.message === 'string') {
          return Promise.reject(new Error(data.error.message))
        }
        if ('message' in data && typeof data.message === 'string') {
          return Promise.reject(new Error(data.message))
        }
      }
      return Promise.reject(new Error('Avtorizatsiya tugagan. Qayta kiring.'))
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
  login: (username: string, password: string) => api.post<AuthResponse>('/auth/login', { username, password }),
  register: (username: string, password: string, phone_number?: string) => api.post<AuthResponse>('/auth/register', { username, password, phone_number }),
  getMe: () => api.get<User>('/auth/me'),
  updateMe: (data: Partial<User>) => api.put('/auth/me', data),
}

export const productsApi = {
  getAll: (search?: string) => api.get<Product[]>('/products', { params: { search } }),
  getById: (id: string) => api.get<Product>(`/products/${id}`),
  create: (data: Partial<Product>) => api.post<Product>('/products', data),
  update: (id: string, data: Partial<Product>) => api.put<Product>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
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
  bulkUpdate: (items: { productId: string; currentQuantity: number; note?: string }[]) =>
    api.put('/inventory/bulk-current', { deviceId: getDeviceId(), date: getBusinessDate(), items }),
  recordSales: (date: string, lines: { productId: string; quantity: number }[]) =>
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
  adjust: (id: string, amount: number, note?: string) => api.post(`/debtors/${id}/adjust`, { amount, note }),
  delete: (id: string) => api.delete(`/debtors/${id}`),
}

export const adminsApi = {
  getAll: () => api.get<User[]>('/auth/admins'),
  create: (username: string, password: string, tier?: string, phone_number?: string) => api.post('/auth/admins', { username, password, tier, phone_number }),
  update: (id: string, data: { username?: string; password?: string; tier?: string; phone_number?: string }) => api.put(`/auth/admins/${id}`, data),
  delete: (id: string) => api.delete(`/auth/admins/${id}`),
  bulkUpdateTier: (tier: 'tekin' | 'bor' | 'pro') => api.put('/auth/users/tier', { tier }),
  getStats: () => api.get<DatabaseStats>('/stats'),
}

export const healthApi = {
  check: () => api.get('/health'),
}

const IMAGE_HASH_REGEX = /^[a-f0-9]{64}$/

export function resolveImageUrl(image?: string, imageHash?: string): string | undefined {
  const src = image || imageHash
  if (!src) return undefined
  if (src.startsWith('data:image/') || src.startsWith('https://') || src.startsWith('http://')) {
    return src
  }
  if (IMAGE_HASH_REGEX.test(src)) {
    return `${API_BASE_URL}/products/image/${src}`
  }
  return undefined
}

export default api
