'use client'
import { useEffect, useState } from 'react'
import { getQueuedWrites, getQueueOwner, retryReviewedWrite, subscribeOfflineQueueCount, type QueuedWrite } from '@/lib/offlineQueue'
import { flushOfflineQueueOnStartup } from '@/lib/api'

export function PendingOperations({ count, onRetry, retrying = false }: { count: number; onRetry?: () => Promise<void>; retrying?: boolean }) {
  const [items, setItems] = useState<QueuedWrite[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const unsubscribe = subscribeOfflineQueueCount(() => {
      const owner = getQueueOwner()
      if (!owner) { setItems([]); setLoaded(false); return }
      void getQueuedWrites(owner).then(rows => {
        if (alive && owner === getQueueOwner()) { setItems(rows); setLoaded(true); setError('') }
      }).catch(err => { if (alive && owner === getQueueOwner()) setError(String(err)) })
    })
    return () => { alive = false; unsubscribe() }
  }, [])

  async function retry(item: QueuedWrite) {
    setRetryingId(item.id)
    try {
      await retryReviewedWrite(item.id, item.owner)
      await flushOfflineQueueOnStartup()
      if (item.owner === getQueueOwner()) setItems(await getQueuedWrites(item.owner))
    } catch (err) { setError(String(err)) }
    finally { setRetryingId(null) }
  }

  const visibleItems = items.filter(item => item.owner === getQueueOwner())
  const needsReview = !!error || visibleItems.some(item => item.lastError) || (loaded && visibleItems.length < count)
  function download() {
    const blob = new Blob([JSON.stringify({ owner: getQueueOwner(), exportedAt: new Date().toISOString(), operations: visibleItems }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'hisvex-pending-operations.json'; link.click(); URL.revokeObjectURL(url)
  }

  return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '6px 20px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
    <details style={{ flex: 1, minWidth: 0 }}>
      <summary style={{ cursor: 'pointer', color: needsReview ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>
        {needsReview ? 'Navbatni tekshirish kerak' : 'Server tasdig‘i kutilmoqda'} ({count})
      </summary>
      <p>Bu amallar saqlangan. Ularni yangi savdo sifatida qayta kiritmang. Rad etilgan amalni qayta yuborishdan oldin sababini tekshiring.</p>
      {loaded && visibleItems.length < count && <p role="alert">Ayrim yozuvlar o‘qilmadi. Brauzer ma’lumotlarini tozalamang; tiklash uchun administratorga murojaat qiling.</p>}
      {error && <p role="alert">{error}</p>}
      <button onClick={download} disabled={!loaded}>Yozuvlar nusxasini yuklab olish</button>
      <ul>{visibleItems.map(item => <li key={item.id} style={{ margin: '10px 0' }}>
        <span>{new Date(item.createdAt).toLocaleString()} — {item.lastError ?? 'Server tasdig‘i kutilmoqda'}</span>
        <div style={{ fontSize: 12 }}>Amal: {item.id}</div>
        {item.lastError && <button onClick={() => void retry(item)} disabled={retrying || retryingId !== null}>
          {retryingId === item.id ? 'Tekshirilmoqda…' : 'Tekshirdim, shu amalni qayta yuborish'}
        </button>}
      </li>)}</ul>
    </details>
    {onRetry && <button onClick={() => void onRetry()} disabled={retrying} style={{ background: 'none', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '2px 8px', fontSize: 12, cursor: retrying ? 'default' : 'pointer', flexShrink: 0 }}>
      {retrying ? 'Tekshirilmoqda…' : 'Qayta tekshirish'}
    </button>}
  </div>
}
