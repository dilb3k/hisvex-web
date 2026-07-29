'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/authStore'
import { setUnauthorizedHandler } from '@/lib/api'
import { setLanguage } from '@/lib/i18n'
import { initBusinessDay } from '@/lib/businessDay'

export function HydrateProvider({ children }: { children: React.ReactNode }) {
  const hydrate = useAuthStore((s) => s.hydrate)
  const logout = useAuthStore((s) => s.logout)
  const isLoading = useAuthStore((s) => s.isLoading)

  useEffect(() => {
    const savedTheme = localStorage.getItem('hisvex_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', savedTheme)
    const savedLanguage = localStorage.getItem('hisvex_language')
    if (savedLanguage === 'uz' || savedLanguage === 'ru') {
      setLanguage(savedLanguage)
    }
    initBusinessDay()
    hydrate()
  }, [hydrate])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout()
      window.location.href = '/login'
    })
    return () => setUnauthorizedHandler(null)
  }, [logout])

  if (isLoading) {
    return (
      <div style={{
        height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#070512', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #070512 0%, #0F0A2E 30%, #0C0820 65%, #070512 100%)' }} />
        <div style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)',
          top: '-150px', right: '-150px',
        }} />
        <div style={{ position: 'relative', textAlign: 'center', zIndex: 1 }}>
          <div style={{
            width: 80, height: 80, borderRadius: 20,
            background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            boxShadow: '0 8px 40px rgba(124,58,237,0.4)',
          }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#fff' }}>H</span>
          </div>
          <h1 style={{
            fontSize: 32, fontWeight: 800, marginBottom: 12,
            background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>Hisvex</h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {[0, 0.2, 0.4].map((d, i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%', background: '#7c3aed',
                animation: `pulse 1.4s ease-in-out infinite ${d}s`,
              }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
