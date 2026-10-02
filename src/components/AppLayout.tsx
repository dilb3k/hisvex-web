'use client'

import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'
import { PendingOperations } from './PendingOperations'
import { useAppStore } from '@/lib/appStore'
import { useAuthStore } from '@/lib/authStore'
import { subscribeOfflineQueueCount, retryAllReviewedWrites, getQueueOwner, getQueueCount } from '@/lib/offlineQueue'
import { flushOfflineQueueOnStartup } from '@/lib/api'
import { X, AlertTriangle, CheckCircle, Info, WifiOff, RotateCw } from 'lucide-react'

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { error, clearError, toast, hideToast, showToast } = useAppStore()
  const scoped = useAuthStore(s => s.user?.scope === 'procurement')
  const isOffline = useAuthStore((s) => s.isOffline)
  const [queuedCount, setQueuedCount] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [browserOffline, setBrowserOffline] = useState(false)
  const [pendingVisible, setPendingVisible] = useState(false)
  const pendingSince = useRef<number | null>(null)

  const handleRetryNow = async () => {
    const owner = getQueueOwner()
    if (!owner || retrying || scoped) return
    setRetrying(true)
    try {
      // Items that were previously rejected and parked (e.g. a route that
      // briefly didn't exist during a deploy) are otherwise never retried
      // automatically again — this re-queues all of them for one more try.
      await retryAllReviewedWrites(owner)
      await flushOfflineQueueOnStartup()
      const remaining = await getQueueCount()
      if (owner !== getQueueOwner()) return
      showToast(remaining === 0 ? 'Barcha yozuvlar tasdiqlandi' : `${remaining} ta yozuv hali tasdiqlanmadi`, remaining === 0 ? 'success' : 'info')
    } catch {
      showToast('Qayta urinib bo‘lmadi', 'error')
    } finally {
      setRetrying(false)
    }
  }

  useEffect(() => {
    // Replays anything left queued from a previous session (tab closed while
    // both backends were unreachable) as soon as this one starts.
    const flush = () => { void flushOfflineQueueOnStartup().catch(() => {}) }
    const online = () => { setBrowserOffline(false); flush() }
    const offline = () => setBrowserOffline(true)
    setBrowserOffline(!navigator.onLine)
    flush()
    const unsubscribeCount = subscribeOfflineQueueCount(setQueuedCount)
    // Desktop (syncEngine.ts) and Mobile (useNetworkStatus.ts) both already
    // retry automatically on reconnect and on a periodic timer — the web
    // app only ever retried on initial mount, so a tab left open across an
    // outage never noticed the backend coming back until manually
    // refreshed. Mirrors the same two triggers here.
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    const interval = setInterval(flush, 60_000)
    return () => {
      unsubscribeCount()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (scoped || queuedCount === 0) {
      pendingSince.current = null
      setPendingVisible(false)
      return
    }
    // Every online write is durable before dispatch. Don't flash a global
    // warning during that normal request; retain a compact notice if it lasts.
    pendingSince.current ??= Date.now()
    const timeout = setTimeout(() => setPendingVisible(true), Math.max(0, 1500 - (Date.now() - pendingSince.current!)))
    return () => clearTimeout(timeout)
  }, [queuedCount, scoped])

  const showOfflineBanner = !scoped && (isOffline || browserOffline)

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar />
        <main className="dashboard-main" style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--color-bg)',
        }}>
          {showOfflineBanner && (
            <div
              role="status"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 20px',
                background: 'var(--color-warning-soft)',
                borderBottom: '1px solid rgba(245,158,11,0.3)',
                color: 'var(--color-warning)',
                fontSize: 13, fontWeight: 500,
              }}
            >
              <WifiOff size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                Server tasdig‘ini kutayotgan yozuvlar bo‘lishi mumkin. Hisobotda faqat tasdiqlangan ma’lumotlar aks etadi.
                {queuedCount > 0 ? ` (${queuedCount} ta yozuv navbatda)` : ''}
              </span>
              {queuedCount > 0 && (
                <button
                  onClick={handleRetryNow}
                  disabled={retrying}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: '1px solid currentColor', borderRadius: 6,
                    color: 'var(--color-warning)', fontSize: 12, fontWeight: 600,
                    padding: '4px 10px', cursor: retrying ? 'default' : 'pointer', opacity: retrying ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  <RotateCw size={13} style={{ animation: retrying ? 'spin 0.8s linear infinite' : 'none' }} />
                  Qayta urinish
                </button>
              )}
            </div>
          )}
          {!scoped && queuedCount > 0 && (pendingVisible || showOfflineBanner) && (
            <PendingOperations count={queuedCount} onRetry={showOfflineBanner ? undefined : handleRetryNow} retrying={retrying} />
          )}
          {error && (
            <div
              role="alert"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 20px',
                background: 'var(--color-danger-soft)',
                borderBottom: '1px solid rgba(239,68,68,0.25)',
                color: 'var(--color-danger)',
                fontSize: 13, fontWeight: 500,
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={clearError} aria-label="Close error" style={{
                background: 'none', border: 'none', color: 'var(--color-danger)',
                cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', opacity: 0.7,
              }}>
                <X size={16} />
              </button>
            </div>
          )}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }} className="dashboard-content">
            {children}
          </div>
        </main>
      </div>
      {toast.visible && (
        <div
          className="animate-slideUp"
          onClick={hideToast}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 20px',
            borderRadius: 10,
            background: toast.type === 'success' ? 'var(--color-success)' : toast.type === 'error' ? 'var(--color-danger)' : 'var(--color-info)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: 'var(--shadow-lg)',
            cursor: 'pointer',
            maxWidth: 400,
          }}
        >
          {toast.type === 'success' ? <CheckCircle size={18} /> : toast.type === 'error' ? <AlertTriangle size={18} /> : <Info size={18} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
