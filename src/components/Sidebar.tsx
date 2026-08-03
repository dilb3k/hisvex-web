'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Package, ClipboardList, ShoppingCart, Users, BarChart3, Settings,
  Shield, LogOut, ChevronLeft, ChevronRight, RefreshCw, HandCoins,
} from 'lucide-react'
import { useAuthStore } from '@/lib/authStore'
import { useAppStore } from '@/lib/appStore'
import { t } from '@/lib/i18n'
import { useState } from 'react'

const sidebarNavItems = [
  { to: '/dashboard', icon: BarChart3, labelKey: 'statistics' as const, roles: ['admin'] },
  { to: '/dashboard/products', icon: Package, labelKey: 'products' as const, roles: ['admin'] },
  { to: '/dashboard/inventory', icon: ClipboardList, labelKey: 'inventory' as const, roles: ['admin'] },
  { to: '/dashboard/sales', icon: ShoppingCart, labelKey: 'sales' as const, roles: ['admin'] },
  { to: '/dashboard/debtors', icon: Users, labelKey: 'debtors' as const, roles: ['admin'] },
  { to: '/dashboard/users', icon: Shield, labelKey: 'users' as const, roles: ['superAdmin'] },
  { to: '/dashboard/settings', icon: Settings, labelKey: 'settings' as const, roles: ['admin'] },
]

const mobileTabItems = [
  { to: '/dashboard/products', icon: Package, labelKey: 'products' as const, roles: ['admin'] },
  { to: '/dashboard/inventory', icon: ClipboardList, labelKey: 'inventory' as const, roles: ['admin'] },
  { to: '/dashboard/sales', icon: ShoppingCart, labelKey: 'sales' as const, roles: ['admin'] },
  { to: '/dashboard', icon: BarChart3, labelKey: 'statistics' as const, roles: ['admin'] },
  { to: '/dashboard/users', icon: Users, labelKey: 'users' as const, roles: ['superAdmin'] },
  { to: '/dashboard/debtors', icon: HandCoins, labelKey: 'debtors' as const, roles: ['admin'] },
]

const iconBtn: React.CSSProperties = {
  width: 44, height: 44, border: 'none', background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: 'var(--color-text-tertiary)', borderRadius: 10, flexShrink: 0,
  transition: 'all 0.2s',
}

const getInitials = (name: string) =>
  name.split(/[\s_]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?'

export function Sidebar() {
  const { user, logout } = useAuthStore()
  const refreshAll = useAppStore((s) => s.refreshAll)
  const [collapsed, setCollapsed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const visibleItems = sidebarNavItems.filter(item => item.roles.includes(user?.role || ''))
  const visibleTabs = mobileTabItems.filter(item => item.roles.includes(user?.role || ''))
  const active = (to: string) => to === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(to)

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await refreshAll() } finally { setRefreshing(false) }
  }

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  const currentPageTitle = (() => {
    const current = [...sidebarNavItems, ...mobileTabItems].find(item => active(item.to))
    return current ? t(current.labelKey) : ''
  })()

  return (
    <>
      {/* ===== DESKTOP SIDEBAR (>=1024px) ===== */}
      <aside className="sidebar-desktop" style={{
        width: collapsed ? 60 : 220,
        height: '100%', background: 'var(--color-sidebar)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width 0.2s',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: collapsed ? '6px' : '8px 10px',
          borderBottom: '1px solid var(--color-border)',
          flexDirection: collapsed ? 'column' : 'row',
        }}>
          {collapsed ? (
            <>
              <button onClick={() => setCollapsed(false)} style={iconBtn} title="Expand">
                <ChevronRight size={18} />
              </button>
              <button onClick={handleRefresh} style={iconBtn} title={t('refresh')}>
                <RefreshCw size={18} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              </button>
            </>
          ) : (
            <>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <img src="/logo.png" alt="Hisvex" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-primary)' }}>Hisvex</span>
              </div>
              <button onClick={handleRefresh} style={{ ...iconBtn, width: 34, height: 34 }} title={t('refresh')}>
                <RefreshCw size={16} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
              </button>
              <button onClick={() => setCollapsed(true)} style={{ ...iconBtn, width: 34, height: 34 }} title="Collapse">
                <ChevronLeft size={16} />
              </button>
            </>
          )}
        </div>

        <nav style={{
          flex: 1, padding: collapsed ? '8px 6px' : '8px 8px',
          display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto',
        }}>
          {visibleItems.map((item) => (
            collapsed ? (
              <Link
                key={item.to} href={item.to}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: 44, borderRadius: 10, textDecoration: 'none', transition: 'all 0.15s',
                  color: active(item.to) ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                  background: active(item.to) ? 'var(--color-primary-soft)' : 'transparent',
                }}
                title={t(item.labelKey)}
              >
                <item.icon size={20} />
              </Link>
            ) : (
              <Link
                key={item.to} href={item.to}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10, textDecoration: 'none',
                  fontSize: 13, fontWeight: 500,
                  color: active(item.to) ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  background: active(item.to) ? 'var(--color-primary-soft)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <item.icon size={18} />
                {t(item.labelKey)}
              </Link>
            )
          ))}
        </nav>

        <div style={{ padding: collapsed ? '6px' : '8px 8px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {!collapsed && user && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, position: 'relative',
              }}>
                {getInitials(user.name || user.username)}
                <span style={{
                  position: 'absolute', bottom: 0, right: 0, width: 9, height: 9,
                  borderRadius: '50%', background: '#22c55e',
                  border: '2px solid var(--color-sidebar)',
                }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.name || user.username}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {user.role === 'superAdmin' ? t('superAdmin') : t('admin')}
                </div>
              </div>
            </div>
          )}
          {collapsed ? (
            <button onClick={handleLogout} style={{ ...iconBtn, color: 'var(--color-danger)' }} title={t('logout')}>
              <LogOut size={18} />
            </button>
          ) : (
            <button onClick={handleLogout} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10, width: '100%',
              border: 'none', background: 'transparent',
              color: 'var(--color-text-tertiary)', fontSize: 13, cursor: 'pointer',
            }}>
              <LogOut size={18} />
              {t('logout')}
            </button>
          )}
        </div>
      </aside>

      {/* ===== MOBILE HEADER (<1024px) ===== */}
      <header className="mobile-header">
        <span className="mobile-header-title">{currentPageTitle}</span>
        <div className="mobile-header-actions">
          <button onClick={handleRefresh} className="mobile-header-btn" title={t('refresh')}>
            <RefreshCw size={18} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          {user?.role !== 'superAdmin' && (
            <Link href="/dashboard/settings" className="mobile-header-btn" title={t('settings')}>
              <Settings size={18} />
            </Link>
          )}
        </div>
      </header>

      {/* ===== MOBILE BOTTOM TAB BAR (<1024px) ===== */}
      <nav className="mobile-tab-bar">
        {visibleTabs.map((item) => (
          <Link
            key={item.to} href={item.to}
            className={`mobile-tab${active(item.to) ? ' active' : ''}`}
          >
            <item.icon size={22} />
            <span>{t(item.labelKey)}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}
