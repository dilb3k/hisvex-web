'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/authStore'
import { AppSplash } from '@/components/AppSplash'

export default function RootPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const role = useAuthStore((s) => s.user?.role)
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) {
      router.replace(isAuthenticated ? (role === 'superAdmin' ? '/dashboard/users' : '/dashboard') : '/login')
    }
  }, [isAuthenticated, isLoading, role, router])

  // Shown only for the instant between hydrate finishing and the redirect
  // landing — the same screen the splash already showed, so the handoff is
  // invisible instead of a jump to a different-looking page.
  return <AppSplash />
}
