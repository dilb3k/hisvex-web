'use client'

const DB_NAME = 'hisvex-offline'
const STORE = 'ownerWriteQueue'
const KEYS = 'ownerKeys'
export type QueuedWrite = {
  id: string; owner: string; method: 'post' | 'put'; url: string; data: unknown; createdAt: number; sequence?: number; lastError?: string
}
type StoredRecord = Omit<QueuedWrite, 'data'> & { iv: string; ciphertext: string; lastError?: string; fingerprint: string }
let activeOwner: string | null = null
export function setQueueOwner(owner: string | null) { activeOwner = owner; void notifyListeners().catch(() => {}) }
export function getQueueOwner() { return activeOwner }
function requireOwner(owner = activeOwner): string { if (!owner) throw Error('Hisobga kiring'); return owner }
function assertOwner(owner: string) { if (activeOwner !== owner) throw Error('Hisob o‘zgardi; amal o‘z hisobida saqlanadi') }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      // Preserve the old unowned writeQueue and its key for manual recovery.
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['owner', 'id'] }); store.createIndex('owner', 'owner')
      }
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(Error('Boshqa eski tabni yoping; navbat yangilanishi kutilmoqda'))
  })
}
async function transaction<T>(storeName: string | string[], mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    let value: T
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? Error('Navbat saqlanmadi')) }
    try { work(tx.objectStore(Array.isArray(storeName) ? storeName[0] : storeName), next => { value = next }) }
    catch (error) { tx.abort(); reject(error) }
  })
}

// Key creation is committed in the same serialized IndexedDB read/write
// transaction across tabs. No temporary or unpersisted key fallback exists.
// This does not protect against JavaScript running in the authenticated origin.
async function getOrCreateKey(owner: string): Promise<CryptoKey> {
  const candidate = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt'])
  return transaction<CryptoKey>(KEYS, 'readwrite', (store, result) => {
    const request = store.get(owner)
    request.onsuccess = () => { const key = request.result ?? candidate; if (!request.result) store.add(key, owner); result(key) }
  })
}
function b64(value: ArrayBuffer | Uint8Array) { return btoa(Array.from(value instanceof Uint8Array ? value : new Uint8Array(value), n => String.fromCharCode(n)).join('')) }
function bytes(value: string) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)) }
async function records(owner: string): Promise<StoredRecord[]> {
  return transaction(STORE, 'readonly', (store, result) => { const request = store.index('owner').getAll(owner); request.onsuccess = () => result(request.result) })
}
export async function enqueueWrite(item: Omit<QueuedWrite, 'createdAt' | 'owner'> & { owner?: string }): Promise<void> {
  item = structuredClone(item)
  const owner = requireOwner(item.owner); assertOwner(owner)
  const key = await getOrCreateKey(owner)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const aad = new TextEncoder().encode(JSON.stringify([owner, item.id, item.method, item.url]))
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad}, key, new TextEncoder().encode(JSON.stringify(item.data)))
  const fingerprint = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([item.method,item.url,item.data]))))
  const record: StoredRecord = {fingerprint,id: item.id,owner,method:item.method,url:item.url,createdAt:Date.now(),iv:b64(iv),ciphertext:b64(encrypted)}
  const compatible = await transaction<boolean>([STORE, KEYS], 'readwrite', (store, result) => {
    const request=store.get([owner,item.id])
    // Existing immutable intent wins. The same ID is only replayed, never
    // replaced by a modified payload after a lost response.
    request.onsuccess=()=>{
      if (request.result) { result(request.result.fingerprint === fingerprint); return }
      const metadata = store.transaction.objectStore(KEYS)
      const sequenceKey = [owner,'sequence']
      const sequence = metadata.get(sequenceKey)
      sequence.onsuccess = () => {
        record.sequence = Number(sequence.result ?? 0) + 1
        metadata.put(record.sequence, sequenceKey)
        store.add(record); result(true)
      }
    }
  })
  if (!compatible) throw Error('Amal ID boshqa ma’lumotlar bilan qayta ishlatilgan')
  assertOwner(owner); void notifyListeners().catch(() => {})
}
export async function getQueuedWrites(owner = requireOwner()): Promise<QueuedWrite[]> {
  const [stored, key] = await Promise.all([records(owner), getOrCreateKey(owner)])
  const result: QueuedWrite[] = []
  for (const record of stored) {
    try {
      const aad = new TextEncoder().encode(JSON.stringify([owner,record.id,record.method,record.url]))
      const raw = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(record.iv),additionalData:aad},key,bytes(record.ciphertext))
      result.push({...record,data:JSON.parse(new TextDecoder().decode(raw))})
    } catch {
      // Corrupt ciphertext remains on disk and in the pending count. Other
      // valid records can still be replayed; no empty replacement is written.
    }
  }
  return result.sort((a,b)=>(a.sequence ?? a.createdAt)-(b.sequence ?? b.createdAt))
}
export async function removeQueuedWrite(id: string, owner = requireOwner()): Promise<void> {
  await transaction(STORE,'readwrite',(store,result)=>{store.delete([owner,id]);result(undefined)})
  void notifyListeners().catch(() => {})
}
export async function markQueuedWriteForReview(id: string, message: string, owner = requireOwner()): Promise<void> {
  await transaction(STORE, 'readwrite', (store,result) => {
    const request=store.get([owner,id])
    request.onsuccess=()=>{ if(request.result) store.put({...request.result,lastError:message});result(undefined) }
  })
  void notifyListeners().catch(()=>{})
}
export async function retryReviewedWrite(id:string,owner=requireOwner()) {
  assertOwner(owner)
  await transaction(STORE,'readwrite',(store,result)=>{
    const request=store.get([owner,id]);request.onsuccess=()=>{if(request.result){const record=request.result;delete record.lastError;store.put(record)}result(undefined)}
  })
  assertOwner(owner)
  void notifyListeners().catch(()=>{})
}
// Clears every parked-for-review item at once, for a manual "retry all"
// action — e.g. after a deploy mismatch is fixed and items were wrongly
// parked before that fix shipped (see ROUTE_NOT_FOUND handling above).
export async function retryAllReviewedWrites(owner=requireOwner()): Promise<number> {
  assertOwner(owner)
  const cleared=await transaction<number>(STORE,'readwrite',(store,result)=>{
    let count=0
    const request=store.index('owner').openCursor(IDBKeyRange.only(owner))
    request.onsuccess=()=>{
      const cursor=request.result
      if(cursor){
        if(cursor.value.lastError){const record={...cursor.value};delete record.lastError;cursor.update(record);count++}
        cursor.continue()
      } else result(count)
    }
  })
  assertOwner(owner)
  void notifyListeners().catch(()=>{})
  return cleared
}
export async function assertNoPendingProductWrites(ids:string[]) {
  const owner=requireOwner();const pending=await getQueuedWrites(owner);assertOwner(owner)
  if((await records(owner)).length!==pending.length || pending.some(item=>dependencies(item).some(id=>ids.includes(id)))) throw Error('Mahsulotga tegishli tasdiqlanmagan amal bor. Avval navbatni tekshiring.')
}
export async function getQueueCount(): Promise<number> { const owner=activeOwner; return owner ? (await records(owner)).length : 0 }
type Listener=(count:number)=>void
const listeners=new Set<Listener>()
export function subscribeOfflineQueueCount(listener: Listener) {
  listeners.add(listener)
  const owner=activeOwner
  void getQueueCount().then(count=>{if(listeners.has(listener)&&owner===activeOwner)listener(count)}).catch(()=>{})
  return ()=>{listeners.delete(listener)}
}
async function notifyListeners() { const owner=activeOwner;const count=await getQueueCount();if(owner===activeOwner) listeners.forEach(listener=>listener(count)) }

function dependencies(item: QueuedWrite): string[] {
  const data = item.data as {productId?:string;lines?: {productId:string}[];items?:{productId:string}[]}
  const ids = (data?.lines ?? data?.items ?? []).map(row=>row.productId)
  if(data?.productId) ids.push(data.productId)
  return ids.length ? ids : [item.url]
}
const flushing=new Set<string>()
export async function flushOfflineQueue(send:(item:QueuedWrite)=>Promise<void>):Promise<void> {
  const owner=activeOwner
  if(!owner || flushing.has(owner)) return
  flushing.add(owner)
  try {
    const items=await getQueuedWrites(owner)
    const blocked=new Set<string>()
    for(const item of items) {
      assertOwner(owner)
      const resources=dependencies(item)
      if(item.lastError) { resources.forEach(resource=>blocked.add(resource));continue }
      if(resources.some(resource=>blocked.has(resource))) continue
      try { await send(item); await removeQueuedWrite(item.id,owner) }
      catch(error) {
        const status=(error as {status?:number})?.status
        const code=(error as {code?:string})?.code
        // ROUTE_NOT_FOUND (backend's notFoundMiddleware) means the endpoint
        // itself isn't recognized — a frontend/backend deploy briefly out of
        // sync — not that the server understood the request and rejected it
        // on business grounds (e.g. a genuinely deleted product, which is
        // still 404 but a real, permanent business state worth reviewing).
        // Treated like a network failure instead: stop this flush and retry
        // the whole queue on the next automatic attempt, so it self-heals
        // once the deploy mismatch resolves rather than being silently
        // stranded in "needs review" forever.
        if(status===404 && code==='ROUTE_NOT_FOUND') break
        if(status && [400,403,404,409,422].includes(status)) {
          await markQueuedWriteForReview(item.id,(error as Error).message || `HTTP ${status}`,owner)
          resources.forEach(resource=>blocked.add(resource));continue
        }
        break
      }
    }
  } finally {flushing.delete(owner)}
}
