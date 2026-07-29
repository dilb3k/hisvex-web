'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/authStore'

export default function RootPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) {
      router.replace(isAuthenticated ? '/dashboard' : '/login')
    }
  }, [isAuthenticated, isLoading, router])

  return (
    <div style={{
      height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#070512',
    }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 0.2, 0.4].map((d, i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%', background: '#7c3aed',
            animation: `pulse 1.4s ease-in-out infinite ${d}s`,
          }} />
        ))}
      </div>
    </div>
  )
}
