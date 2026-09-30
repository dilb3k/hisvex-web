'use client'

// Offline write-queue for when BOTH backends (Railway and Render) are
// unreachable — see api.ts's response interceptor, which enqueues here only
// after its own primary->backup failover has already been tried and also
// failed. Distinct from that failover: this is "nowhere to send it right
// now", not "one of the two is down".
//
// Persisted in IndexedDB (survives a refresh/tab close, unlike an in-memory
// queue) rather than localStorage — better suited to structured records and
// not subject to localStorage's ~5MB/string-only limits if a backlog grows.

const DB_NAME = 'hisvex-offline'
const DB_VERSION = 1
const STORE_NAME = 'writeQueue'
const KEY_STORAGE_KEY = 'hisvex_offline_queue_key'

export type QueuedWrite = {
  id: string // the idempotencyKey — same value used on every send attempt
  method: 'post' | 'put'
  url: string
  data: unknown
  createdAt: number
}

type StoredRecord = {
  id: string
  method: 'post' | 'put'
  url: string
  createdAt: number
  iv: string // base64
  ciphertext: string // base64
}

// --- "Encryption" ---
//
// Honest caveat, not a security claim: this is AES-GCM with a key generated
// once and stored in this same origin's localStorage. Anything running as
// this page's own JavaScript (which is exactly what could read IndexedDB
// directly anyway) can read that key too — this does NOT protect against an
// attacker who can execute script in this page or has devtools open with the
// page unlocked. What it DOES protect against: a queued sale/receipt sitting
// as plain, directly-readable JSON if someone opens the browser's IndexedDB
// storage file/inspector without also having the localStorage key material,
// e.g. a shared-computer scenario where someone browses the profile's on-
// disk storage but isn't actively running this page's JS. That is a real but
// modest bar — full encryption-at-rest with a key the page itself can't
// access isn't achievable in a browser without a mechanism (a hardware key,
// a server-held key) this app doesn't have.
async function getOrCreateKey(): Promise<CryptoKey> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY_STORAGE_KEY)
  } catch {
    // localStorage unavailable (private mode, quota) — fall through to a
    // fresh in-memory-only key; the queue still works for this tab's
    // lifetime, just re-encrypts under a new key next load.
  }

  if (raw) {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const exported = await crypto.subtle.exportKey('raw', key)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)))
  try {
    localStorage.setItem(KEY_STORAGE_KEY, b64)
  } catch {
    // Can't persist — next load will generate a new key and this queue's
    // existing entries (encrypted under the old, now-lost key) become
    // undecryptable. Acceptable: this only happens when localStorage itself
    // is unavailable, in which case nothing else here would have persisted
    // across a reload anyway.
  }
  return key
}

async function encrypt(key: CryptoKey, value: unknown): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
  }
}

async function decrypt(key: CryptoKey, iv: string, ciphertext: string): Promise<unknown> {
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0))
  const cipherBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, cipherBytes)
  return JSON.parse(new TextDecoder().decode(decrypted))
}

// --- IndexedDB plumbing ---

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// --- Pub/sub for the UI banner ---

type Listener = (count: number) => void
const listeners = new Set<Listener>()

export function subscribeOfflineQueueCount(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function notifyListeners() {
  const count = await getQueueCount()
  listeners.forEach((l) => l(count))
}

// --- Public API ---

export async function enqueueWrite(item: Omit<QueuedWrite, 'createdAt'>): Promise<void> {
  const key = await getOrCreateKey()
  const { iv, ciphertext } = await encrypt(key, item.data)
  const record: StoredRecord = {
    id: item.id,
    method: item.method,
    url: item.url,
    createdAt: Date.now(),
    iv,
    ciphertext,
  }
  await withStore('readwrite', (store) => store.put(record))
  void notifyListeners()
}

export async function getQueuedWrites(): Promise<QueuedWrite[]> {
  const records = await withStore<StoredRecord[]>('readonly', (store) => store.getAll())
  const key = await getOrCreateKey()
  const items = await Promise.all(
    records.map(async (r) => ({
      id: r.id,
      method: r.method,
      url: r.url,
      createdAt: r.createdAt,
      data: await decrypt(key, r.iv, r.ciphertext),
    })),
  )
  // FIFO — oldest queued write first, so a flush replays operations in the
  // order they actually happened.
  return items.sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeQueuedWrite(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
  void notifyListeners()
}

export async function getQueueCount(): Promise<number> {
  try {
    const records = await withStore<StoredRecord[]>('readonly', (store) => store.getAll())
    return records.length
  } catch {
    return 0
  }
}

let flushing = false

/**
 * Replays queued writes in order via `send`, removing each on success.
 * Stops at the first failure (rather than skipping ahead) so a write that
 * depends on an earlier one's effect (e.g. two sales against the same
 * product's stock) is never applied out of order. `send` reuses the item's
 * own `id` as the idempotencyKey, so a write that the server actually
 * received on a previous, interrupted flush attempt is recognized and not
 * double-applied (see idempotency.service.ts on the backend).
 */
export async function flushOfflineQueue(send: (item: QueuedWrite) => Promise<void>): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const items = await getQueuedWrites()
    for (const item of items) {
      try {
        await send(item)
        await removeQueuedWrite(item.id)
      } catch (error) {
        console.warn('[offlineQueue] flush stopped — still unreachable or a real error', error)
        break
      }
    }
  } finally {
    flushing = false
  }
}
