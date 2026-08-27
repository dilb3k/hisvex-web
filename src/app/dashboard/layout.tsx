'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/authStore'
import { AppLayout } from '@/components/AppLayout'
import { AppSplash } from '@/components/AppSplash'

// Business pages (statistics/products/inventory/sales/debtors) only make sense for
// a shop 'admin' account - a superAdmin has no products/inventory of their own.
// '/dashboard/users' is the mirror case: superAdmin-only. Settings is intentionally
// left out of both lists - it's reachable (and functionally supports) either role,
// it's just not linked from a superAdmin's nav (see Sidebar.tsx).
const ADMIN_ONLY_PATHS = ['/dashboard/products', '/dashboard/inventory', '/dashboard/sales', '/dashboard/debtors']
const SUPERADMIN_ONLY_PATHS = ['/dashboard/users']

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const user = useAuthStore((s) => s.user)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, isLoading, router])

  // Role gate: hidden nav links alone don't stop a direct URL visit. Without this,
  // a superAdmin hitting /dashboard/products (etc.) directly saw a broken page -
  // that account has no products/inventory/sales/debtors of its own, so every API
  // call underneath just failed. Same protection in reverse for /dashboard/users.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return
    const isAdminOnlyRoute = pathname === '/dashboard' || ADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p))
    const isSuperAdminOnlyRoute = SUPERADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p))
    if (user.role === 'superAdmin' && isAdminOnlyRoute) {
      router.replace('/dashboard/users')
    } else if (user.role !== 'superAdmin' && isSuperAdminOnlyRoute) {
      router.replace('/dashboard')
    }
  }, [pathname, user, isAuthenticated, isLoading, router])

  // Unreachable in practice — HydrateProvider blocks the whole tree while
  // loading — but kept as the same screen so a future change that renders
  // this layout earlier cannot reintroduce a second, different splash.
  if (isLoading) return <AppSplash />

  if (!isAuthenticated) return null

  // Mirrors the redirect effect above so the mismatched page's content never
  // flashes on screen for the one render before the effect fires.
  if (user) {
    const isAdminOnlyRoute = pathname === '/dashboard' || ADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p))
    const isSuperAdminOnlyRoute = SUPERADMIN_ONLY_PATHS.some((p) => pathname.startsWith(p))
    if ((user.role === 'superAdmin' && isAdminOnlyRoute) || (user.role !== 'superAdmin' && isSuperAdminOnlyRoute)) {
      return null
    }
  }

  return <AppLayout>{children}</AppLayout>
}
