'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/authStore'
import { setUnauthorizedHandler, setTokensRefreshedHandler } from '@/lib/api'
import { setLanguage, t } from '@/lib/i18n'
import { initBusinessDay } from '@/lib/businessDay'
import { AppSplash } from '@/components/AppSplash'

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
      // While hydrate() is still deciding, it owns the outcome: it clears the
      // session itself and the route guards do a soft replace to /login. A
      // hard navigation here would race that with a full page reload.
      if (useAuthStore.getState().isLoading) return
      logout()
      window.location.href = '/login'
    })
    setTokensRefreshedHandler((token, refreshToken) => {
      useAuthStore.setState({ token, refreshToken })
    })
    return () => {
      setUnauthorizedHandler(null)
      setTokensRefreshedHandler(null)
    }
  }, [logout])

  if (isLoading) return <AppSplash />

  return <>{children}</>
}
