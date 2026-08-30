'use client'

import { Fragment, useEffect, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/lib/authStore'
import { setUnauthorizedHandler, setTokensRefreshedHandler } from '@/lib/api'
import { getLanguage, getServerLanguage, subscribeLanguage } from '@/lib/i18n'
import { initBusinessDay } from '@/lib/businessDay'
import { AppSplash } from '@/components/AppSplash'

export function HydrateProvider({ children }: { children: React.ReactNode }) {
  const hydrate = useAuthStore((s) => s.hydrate)
  const logout = useAuthStore((s) => s.logout)
  const isLoading = useAuthStore((s) => s.isLoading)

  // Language is restored inside i18n.ts at module init (before the first
  // render), not here — a stored 'ru' applied in an effect would paint the
  // whole app in Uzbek first. This subscription is what makes a *switch*
  // take effect app-wide: `t()` is a plain function, so nothing outside the
  // Settings screen re-rendered on a change until now.
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, getServerLanguage)

  useEffect(() => {
    const savedTheme = localStorage.getItem('hisvex_theme') || 'dark'
    document.documentElement.setAttribute('data-theme', savedTheme)
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

  // Keyed on the language so a switch remounts the tree: `t()` results are
  // read during render all over the app (including inside useMemo bodies and
  // style objects), and there is no dependency React could track to
  // invalidate them one by one.
  return <Fragment key={language}>{children}</Fragment>
}
