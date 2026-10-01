'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { PendingOperations } from './PendingOperations'
import { useAppStore } from '@/lib/appStore'
import { useAuthStore } from '@/lib/authStore'
import { subscribeOfflineQueueCount } from '@/lib/offlineQueue'
import { flushOfflineQueueOnStartup } from '@/lib/api'
import { X, AlertTriangle, CheckCircle, Info, WifiOff } from 'lucide-react'

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { error, clearError, toast, hideToast } = useAppStore()
  const isOffline = useAuthStore((s) => s.isOffline)
  const [queuedCount, setQueuedCount] = useState(0)

  useEffect(() => {
    // Replays anything left queued from a previous session (tab closed while
    // both backends were unreachable) as soon as this one starts.
    flushOfflineQueueOnStartup()
    return subscribeOfflineQueueCount(setQueuedCount)
  }, [])

  const showOfflineBanner = isOffline || queuedCount > 0

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
            </div>
          )}
          {queuedCount > 0 && <PendingOperations count={queuedCount} />}
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
