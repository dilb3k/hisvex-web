'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAuthStore } from '@/lib/authStore'
import { useAppStore } from '@/lib/appStore'
import { adminsApi, clearApiCache } from '@/lib/api'
import {
  Users, CreditCard, Shield, Pencil, Trash2, X, Search, Clock, Crown,
  UserPlus, RefreshCw, LogOut, Phone, CalendarDays, Sparkles,
} from 'lucide-react'
import { t } from '@/lib/i18n'
import { formatPhone, displayPhone } from '@/lib/formatters'
import type { User } from '@/lib/types'

const TIER_OPTIONS: { key: User['tier']; labelKey: string; color: string; icon: 'free' | 'bor' | 'pro' }[] = [
  { key: 'tekin', labelKey: 'planFree', color: 'var(--color-text-secondary)', icon: 'free' },
  { key: 'bor', labelKey: 'planBor', color: '#10B981', icon: 'bor' },
  { key: 'pro', labelKey: 'planPro', color: '#8B5CF6', icon: 'pro' },
]

function daysUntilExpiry(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function tierColor(tier?: User['tier']): string {
  const opt = TIER_OPTIONS.find((o) => o.key === tier)
  return opt?.color || 'var(--color-text-secondary)'
}

function tierGradient(tier?: User['tier']): string {
  switch (tier) {
    case 'pro': return 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)'
    case 'bor': return 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
    default: return 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)'
  }
}

function TierBadge({ tier }: { tier?: User['tier'] }) {
  const opt = TIER_OPTIONS.find((o) => o.key === tier)
  if (!opt) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 12, fontWeight: 700, letterSpacing: 0.2,
      color: opt.color,
      background: `${opt.color}1A`,
      border: `1px solid ${opt.color}33`,
    }}>
      {t(opt.labelKey as any)}
    </span>
  )
}

function RoleBadge({ role }: { role: User['role'] }) {
  const isSuper = role === 'superAdmin'
  const color = isSuper ? '#8B5CF6' : '#3B82F6'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6,
      fontSize: 11, fontWeight: 600,
      background: `${color}14`, color,
      border: `1px solid ${color}2E`,
    }}>
      <Shield size={11} />
      {isSuper ? t('superAdmin') : t('admin')}
    </span>
  )
}

function Avatar({ username, tier, size = 44 }: { username: string; tier?: User['tier']; size?: number }) {
  const initials = username.slice(0, 2).toUpperCase()
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: tierGradient(tier),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      color: '#fff', fontSize: size * 0.38, fontWeight: 800, letterSpacing: 0.5,
      boxShadow: `0 4px 12px ${tierColor(tier)}40`,
      border: '2px solid rgba(255,255,255,0.12)',
    }}>
      {initials}
    </div>
  )
}

function StatCard({
  icon, label, value, color, soft, gradient,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: string
  soft: string
  gradient?: boolean
}) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      padding: '18px 20px', borderRadius: 16,
      background: gradient
        ? `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`
        : 'var(--color-surface)',
      border: gradient ? 'none' : '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-sm)',
      position: 'relative', overflow: 'hidden',
    }}>
      {gradient && (
        <div style={{
          position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
        }} />
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        color: gradient ? 'rgba(255,255,255,0.85)' : 'var(--color-text-secondary)',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient ? 'rgba(255,255,255,0.18)' : soft,
          color: gradient ? '#fff' : color, flexShrink: 0,
        }}>
          {icon}
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: 26, fontWeight: 800, letterSpacing: -0.5,
        color: gradient ? '#fff' : 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  )
}

export default function UsersPage() {
  const { user, logout } = useAuthStore()
  const showToast = useAppStore((s) => s.showToast)
  const [admins, setAdmins] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<User['tier'] | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadAdmins = useCallback(async (silent = false) => {
    if (user?.role !== 'superAdmin') {
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    try {
      const { data } = await adminsApi.getAll()
      setAdmins(data)
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('error'), 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user?.role, showToast, t])

  useEffect(() => {
    loadAdmins()
  }, [loadAdmins])

  const stats = useMemo(() => {
    const total = admins.length
    const inactive = admins.filter((a) => a.isActive === false).length
    const active = admins.filter((a) => a.tier !== 'tekin' && daysUntilExpiry(a.subscriptionEndDate) !== 0).length
    const expired = admins.filter((a) => a.tier !== 'tekin' && daysUntilExpiry(a.subscriptionEndDate) === 0).length
    const pro = admins.filter((a) => a.tier === 'pro').length
    return { total, inactive, active, expired, pro }
  }, [admins])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return admins.filter((a) => {
      const matchesTier = tierFilter === 'all' || a.tier === tierFilter
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && a.isActive !== false)
        || (statusFilter === 'inactive' && a.isActive === false)
      const matchesSearch = !q
        || a.username.toLowerCase().includes(q)
        || (a.phone_number || '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))
      return matchesTier && matchesStatus && matchesSearch
    })
  }, [admins, search, tierFilter, statusFilter])

  if (!user || user.role !== 'superAdmin') return null

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadAdmins(true)
  }

  const handleLogout = () => {
    logout()
  }

  const handleCreated = () => {
    setCreateOpen(false)
    clearApiCache()
    loadAdmins(true)
    showToast(t('adminCreated'), 'success')
  }

  const handleUpdated = () => {
    setEditTarget(null)
    clearApiCache()
    loadAdmins(true)
    showToast(t('adminUpdated'), 'success')
  }

  const handleDeleted = () => {
    setDeleteTarget(null)
    clearApiCache()
    loadAdmins(true)
    showToast(t('adminDeleted'), 'success')
  }

  const handleToggleActive = async (admin: User) => {
    if (togglingId) return
    setTogglingId(admin._id)
    const next = admin.isActive === false
    try {
      await adminsApi.update(admin._id, { isActive: next })
      clearApiCache()
      setAdmins((prev) => prev.map((a) => (a._id === admin._id ? { ...a, isActive: next } : a)))
      showToast(next ? t('adminActivated') : t('adminDeactivated'), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('error'), 'error')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 8 }}>
      {/* ===== Hero ===== */}
      <div style={{
        borderRadius: 20,
        background: 'linear-gradient(120deg, #1b1035 0%, #2a1468 50%, #3b1d96 100%)',
        border: '1px solid rgba(139,92,246,0.25)',
        padding: '28px 28px',
        position: 'relative', overflow: 'hidden',
        marginBottom: 18,
      }}>
        <div style={{
          position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.35) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: -80, left: 120, width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 70%)',
        }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, flexShrink: 0,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              backdropFilter: 'blur(4px)',
            }}>
              <Users size={28} />
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'rgba(216,180,254,0.75)', margin: 0 }}>
                {t('usersSubtitle')}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRefresh}
              title={t('refresh')}
              style={{
                width: 44, height: 44, borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
              }}
            >
              <RefreshCw size={18} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              onClick={handleLogout}
              title={t('logout')}
              style={{
                width: 44, height: 44, borderRadius: 12,
                border: '1px solid rgba(239,68,68,0.35)',
                background: 'rgba(239,68,68,0.12)',
                color: '#fca5a5', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s',
              }}
            >
              <LogOut size={18} />
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0 18px', height: 44, borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(124,58,237,0.45)',
                transition: 'transform 0.15s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 26px rgba(124,58,237,0.55)' }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(124,58,237,0.45)' }}
            >
              <UserPlus size={17} />
              {t('newUser')}
            </button>
          </div>
        </div>
      </div>

      {/* ===== Stats ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard icon={<Users size={15} />} label={t('totalAdmins')} value={stats.total} color="#8B5CF6" soft="rgba(139,92,246,0.14)" gradient />
        <StatCard icon={<CreditCard size={15} />} label={t('activeSubscriptions')} value={stats.active} color="#10B981" soft="rgba(16,185,129,0.14)" />
        <StatCard icon={<Crown size={15} />} label={t('proAccounts')} value={stats.pro} color="#8B5CF6" soft="rgba(139,92,246,0.14)" />
        <StatCard icon={<Clock size={15} />} label={t('expiredSubscriptions')} value={stats.expired} color="#EF4444" soft="rgba(239,68,68,0.14)" />
        <StatCard icon={<LogOut size={15} />} label={t('inactive')} value={stats.inactive} color="#6b7280" soft="rgba(107,114,128,0.14)" />
      </div>

      {/* ===== Toolbar ===== */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginBottom: 14,
      }}>
        <div style={{
          flex: 1, minWidth: 220,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 14px', height: 42, borderRadius: 12,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}>
          <Search size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchAdminPlaceholder')}
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', color: 'var(--color-text)',
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            { key: 'all' as const, labelKey: 'all' as const, color: 'var(--color-text-secondary)' },
            ...TIER_OPTIONS,
          ]).map((opt) => {
            const selected = tierFilter === opt.key
            const color = opt.key === 'all' ? 'var(--color-primary)' : opt.color
            return (
              <button
                key={opt.key}
                onClick={() => setTierFilter(opt.key)}
                style={{
                  padding: '8px 16px', borderRadius: 20,
                  border: `1.5px solid ${selected ? color : 'var(--color-border)'}`,
                  background: selected ? `${color}14` : 'transparent',
                  color: selected ? color : 'var(--color-text-secondary)',
                  fontSize: 13, fontWeight: selected ? 700 : 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {t(opt.labelKey as any)}
              </button>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            { key: 'all' as const, labelKey: 'all' as const, color: 'var(--color-primary)' },
            { key: 'active' as const, labelKey: 'active' as const, color: '#10B981' },
            { key: 'inactive' as const, labelKey: 'inactive' as const, color: '#EF4444' },
          ]).map((opt) => {
            const selected = statusFilter === opt.key
            const color = opt.key === 'all' ? 'var(--color-primary)' : opt.color
            return (
              <button
                key={opt.key}
                onClick={() => setStatusFilter(opt.key)}
                style={{
                  padding: '8px 16px', borderRadius: 20,
                  border: `1.5px solid ${selected ? color : 'var(--color-border)'}`,
                  background: selected ? `${color}14` : 'transparent',
                  color: selected ? color : 'var(--color-text-secondary)',
                  fontSize: 13, fontWeight: selected ? 700 : 500,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {t(opt.labelKey as any)}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <Sparkles size={14} style={{ color: 'var(--color-primary)' }} />
        <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', fontWeight: 600 }}>
          {filtered.length} {t('usersCount')}
        </span>
      </div>

      {/* ===== List ===== */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 70, gap: 14 }}>
          <div style={{ width: 36, height: 36, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('loading_data')}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: 70, borderRadius: 20,
          background: 'var(--color-surface)', border: '1px dashed var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', marginBottom: 14,
            background: 'var(--color-primary-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-primary)',
          }}>
            {search || tierFilter !== 'all' || statusFilter !== 'all' ? <Search size={32} /> : <Users size={32} />}
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
            {search || tierFilter !== 'all' || statusFilter !== 'all' ? t('noResults') : "Foydalanuvchilar yo'q"}
          </span>
          {(search || tierFilter !== 'all' || statusFilter !== 'all') && (
            <button
              onClick={() => { setSearch(''); setTierFilter('all'); setStatusFilter('all') }}
              style={{
                marginTop: 14, padding: '8px 18px', borderRadius: 10,
                border: '1px solid var(--color-border)',
                background: 'transparent', color: 'var(--color-text-secondary)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('all')}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtered.map((admin) => {
            const days = daysUntilExpiry(admin.subscriptionEndDate)
            const isUnlimited = admin.tier === 'pro' && !admin.subscriptionEndDate
            const isExpired = admin.tier !== 'tekin' && days === 0
            const isLow = days !== null && days > 0 && days <= 3
            const isInactive = admin.isActive === false
            const statusColor = isInactive
              ? 'var(--color-text-tertiary)'
              : isExpired
                ? 'var(--color-danger)'
                : isLow
                  ? '#F59E0B'
                  : isUnlimited || (days !== null && days > 0) || admin.tier === 'tekin'
                    ? '#10B981'
                    : 'var(--color-text-tertiary)'
            const barPercent = days !== null && days > 0
              ? Math.min(100, Math.round((days / 30) * 100))
              : 0

            return (
              <div
                key={admin._id}
                className="animate-slideUp"
                style={{
                  borderRadius: 16,
                  background: 'var(--color-surface)',
                  border: `1px solid ${isInactive ? 'rgba(107,114,128,0.35)' : isExpired ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
                  padding: 18,
                  opacity: isInactive ? 0.72 : 1,
                  transition: 'transform 0.15s, box-shadow 0.2s, border-color 0.2s, opacity 0.2s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--color-border-light)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = isInactive ? 'rgba(107,114,128,0.35)' : isExpired ? 'rgba(239,68,68,0.3)' : 'var(--color-border)' }}
              >
                <button
                  onClick={() => handleToggleActive(admin)}
                  disabled={togglingId === admin._id}
                  title={isInactive ? t('adminActivated') : t('adminDeactivated')}
                  style={{
                    position: 'absolute', top: 14, right: 14,
                    width: 44, height: 24, borderRadius: 12,
                    border: 'none', cursor: 'pointer', padding: 0,
                    background: isInactive ? 'rgba(107,114,128,0.45)' : 'linear-gradient(135deg, #10B981, #34D399)',
                    opacity: togglingId === admin._id ? 0.55 : 1,
                    transition: 'background 0.2s, opacity 0.2s',
                    zIndex: 2,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: isInactive ? 2 : 22,
                    width: 20, height: 20, borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                    transition: 'left 0.2s',
                  }} />
                </button>

                <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
                  <Avatar username={admin.username} tier={admin.tier} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingRight: 58 }}>
                      <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {admin.username}
                      </span>
                      {isInactive && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 6,
                          fontSize: 11, fontWeight: 600,
                          background: 'rgba(107,114,128,0.15)', color: 'var(--color-text-tertiary)',
                          border: '1px solid rgba(107,114,128,0.35)',
                        }}>
                          <Clock size={11} />
                          {t('inactive')}
                        </span>
                      )}
                      <RoleBadge role={admin.role} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                      <TierBadge tier={admin.tier} />
                      {!isInactive && admin.tier !== 'tekin' && !isExpired && (
                        <span style={{
                          fontSize: 11.5, fontWeight: 600, color: statusColor,
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                        }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
                          {isUnlimited ? t('unlimited') : t('expiresIn', { days: days ?? 0 })}
                        </span>
                      )}
                      {isExpired && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '2px 8px', borderRadius: 12,
                          background: 'var(--color-danger-soft)',
                          color: 'var(--color-danger)',
                          fontSize: 11, fontWeight: 700,
                        }}>
                          <Clock size={11} />
                          {t('expired')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {admin.tier !== 'tekin' && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{
                      height: 6, borderRadius: 3, overflow: 'hidden',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 3,
                        width: isUnlimited ? '100%' : `${barPercent}%`,
                        background: isExpired
                          ? 'var(--color-danger)'
                          : isLow
                            ? 'linear-gradient(90deg, #F59E0B, #FBBF24)'
                            : 'linear-gradient(90deg, #10B981, #34D399)',
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                )}

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  paddingTop: 12, borderTop: '1px solid var(--color-border)',
                  fontSize: 12, color: 'var(--color-text-secondary)',
                }}>
                  {admin.phone_number && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <Phone size={12} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayPhone(admin.phone_number)}
                      </span>
                    </span>
                  )}
                  {admin.createdAt && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                      <CalendarDays size={12} />
                      {new Date(admin.createdAt).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => setEditTarget(admin)}
                    title={t('editAdmin')}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '9px 0', borderRadius: 10,
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-secondary)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-soft)'; e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.borderColor = 'var(--color-primary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)' }}
                  >
                    <Pencil size={14} />
                    {t('edit')}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(admin)}
                    title={t('delete')}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '9px 0', borderRadius: 10,
                      border: '1px solid rgba(239,68,68,0.35)',
                      background: 'transparent',
                      color: 'var(--color-danger)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-danger-soft)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <Trash2 size={14} />
                    {t('delete')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== Modals ===== */}
      {createOpen && (
        <AdminFormModal
          onClose={() => setCreateOpen(false)}
          onSaved={handleCreated}
        />
      )}
      {editTarget && (
        <AdminFormModal
          admin={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleUpdated}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          admin={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 10,
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  marginBottom: 6,
}

function AdminFormModal({
  admin,
  onClose,
  onSaved,
}: {
  admin?: User | null
  onClose: () => void
  onSaved: () => void
}) {
  const [username, setUsername] = useState(admin?.username || '')
  const [password, setPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState(admin?.phone_number ? formatPhone(admin.phone_number) : '+998')
  const [tier, setTier] = useState<User['tier']>(admin?.tier || 'bor')
  const [saving, setSaving] = useState(false)
  const showToast = useAppStore((s) => s.showToast)

  const isEdit = !!admin

  const handleSubmit = async () => {
    if (!username.trim()) return
    if (!isEdit && password.length < 6) return
    setSaving(true)
    try {
      if (isEdit) {
        const payload: { username?: string; password?: string; tier?: string; phone_number?: string } = { username: username.trim(), tier }
        if (password) payload.password = password
        if (phoneNumber && phoneNumber !== '+998') payload.phone_number = phoneNumber.replace(/\D/g, '')
        await adminsApi.update(admin!._id, payload)
      } else {
        await adminsApi.create(username.trim(), password, tier || 'bor', (phoneNumber || '').replace(/\D/g, '') || undefined)
      }
      onSaved()
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, backdropFilter: 'blur(4px)',
      animation: 'fadeIn 0.2s ease',
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-scaleIn"
        style={{
          width: '100%', maxWidth: 480, maxHeight: '92vh',
          background: 'var(--color-bg-alt)',
          borderRadius: 20,
          border: '1px solid var(--color-border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 22px', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'var(--color-primary-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-primary)',
            }}>
              {isEdit ? <Pencil size={18} /> : <UserPlus size={18} />}
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
              {isEdit ? t('editAdmin') : t('createAdmin')}
            </h3>
          </div>
          <button onClick={onClose} style={{
            width: 34, height: 34, borderRadius: 9,
            border: 'none', background: 'transparent',
            color: 'var(--color-text-secondary)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
          <div style={{
            padding: 14, borderRadius: 12, marginBottom: 20,
            borderLeft: '3px solid #8B5CF6',
            background: 'rgba(139,92,246,0.07)',
            fontSize: 13, color: 'var(--color-text-secondary)',
            lineHeight: 1.6,
          }}>
            <strong style={{ color: '#8B5CF6', display: 'block', marginBottom: 3 }}>
              <Sparkles size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
              {t('importantInfo')}
            </strong>
            {t('adminInfo')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={labelStyle}>{t('loginLabel')}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
                placeholder={t('loginPlaceholder_Admin')}
              />
            </div>
            <div>
              <label style={labelStyle}>
                {isEdit ? t('passwordNew') : t('password')}
                {isEdit && (
                  <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}> ({t('phoneOptional')})</span>
                )}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                placeholder={t('passwordPlaceholder_Admin')}
              />
              {isEdit && (
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '4px 0 0' }}>
                  {t('passwordLength')}
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>{t('phoneNumber')}</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(formatPhone(e.target.value))}
                style={inputStyle}
                placeholder={t('phoneNumberPlaceholder')}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('tier')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {TIER_OPTIONS.map((opt) => {
                  const selected = tier === opt.key
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setTier(opt.key)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        padding: '14px 8px', borderRadius: 12,
                        border: `1.5px solid ${selected ? opt.color : 'var(--color-border)'}`,
                        background: selected ? `${opt.color}12` : 'transparent',
                        color: selected ? opt.color : 'var(--color-text-secondary)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%',
                        border: `2px solid ${selected ? opt.color : 'var(--color-border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {selected && <div style={{ width: 9, height: 9, borderRadius: '50%', background: opt.color }} />}
                      </div>
                      <span style={{ fontSize: 13, fontWeight: selected ? 700 : 500 }}>
                        {t(opt.labelKey as any)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{
          padding: '16px 22px', borderTop: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          display: 'flex', gap: 10,
        }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px 0', borderRadius: 10,
            border: '1.5px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text)',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            {t('cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !username.trim() || (!isEdit && password.length < 6)}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 10,
              border: 'none',
              background: saving || !username.trim() || (!isEdit && password.length < 6)
                ? 'var(--color-primary)' : 'var(--color-primary)',
              opacity: saving || !username.trim() || (!isEdit && password.length < 6) ? 0.55 : 1,
              color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {saving && (
              <span style={{
                width: 15, height: 15, border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            {saving ? t('loading') : isEdit ? t('confirmSave') : t('confirmCreate')}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({
  admin,
  onClose,
  onDeleted,
}: {
  admin: User
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const showToast = useAppStore((s) => s.showToast)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await adminsApi.delete(admin._id)
      onDeleted()
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('error'), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, backdropFilter: 'blur(4px)',
      animation: 'fadeIn 0.2s ease',
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-scaleIn"
        style={{
          width: '100%', maxWidth: 400,
          background: 'var(--color-bg-alt)',
          borderRadius: 20,
          border: '1px solid rgba(239,68,68,0.25)',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: '50%', marginBottom: 16,
          background: 'var(--color-danger-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--color-danger)',
        }}>
          <Trash2 size={24} />
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, marginBottom: 6 }}>
          {t('deleteUserTitle')}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Avatar username={admin.username} tier={admin.tier} size={34} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
            {admin.username}
          </span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('deleteUserConfirm', { username: admin.username })}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={deleting} style={{
            flex: 1, padding: '12px 0', borderRadius: 10,
            border: '1.5px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text)',
            fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer',
          }}>
            {t('cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 10,
              border: 'none',
              background: deleting ? '#DC262680' : 'var(--color-danger)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: deleting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: '0 4px 14px rgba(239,68,68,0.3)',
            }}
          >
            {deleting && (
              <span style={{
                width: 15, height: 15, border: '2px solid rgba(255,255,255,0.4)',
                borderTopColor: '#fff', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            {deleting ? t('loading') : t('delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
