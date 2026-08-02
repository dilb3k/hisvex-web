'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/authStore'
import { AppLayout } from '@/components/AppLayout'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) {
    return (
      <div style={{
        height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#070512', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #070512 0%, #0F0A2E 30%, #0C0820 65%, #070512 100%)' }} />
        <div style={{ position: 'relative', textAlign: 'center', zIndex: 1 }}>
          <img src="/logo.png" alt="Hisvex" style={{
            width: 80, height: 80, borderRadius: '50%',
            objectFit: 'cover',
            margin: '0 auto 20px',
            boxShadow: '0 8px 40px rgba(124,58,237,0.4)',
          }} />
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            {[0, 0.2, 0.4].map((d, i) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed', animation: `pulse 1.4s ease-in-out infinite ${d}s` }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) return null

  return <AppLayout>{children}</AppLayout>
}
