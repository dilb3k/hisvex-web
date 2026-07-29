'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/authStore'
import { t, getLanguage, setLanguage } from '@/lib/i18n'
import type { Language } from '@/lib/i18n'
import {
  User,
  Globe,
  Sun,
  Moon,
  MessageCircle,
  Info,
  LogOut,
  ChevronRight,
  Clock,
  X,
  Minus,
  Plus,
} from 'lucide-react'
import {
  getBusinessDayStartHour,
  getPendingBusinessDayStartHour,
  getEffectiveFrom,
  scheduleBusinessDayStartHour,
} from '@/lib/businessDay'
import dayjs from 'dayjs'

const THEMES = [
  { code: 'light', labelKey: 'light', icon: Sun },
  { code: 'dark', labelKey: 'dark', icon: Moon },
] as const

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'uz', label: "O'zbek" },
  { code: 'ru', label: 'Русский' },
]

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 18px',
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  transition: 'all 0.15s',
  userSelect: 'none',
}

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  marginBottom: 8,
}

export default function SettingsPage() {
  const router = useRouter()
  const { user, logout } = useAuthStore()

  const curLang = getLanguage()
  const [language, setLangState] = useState<Language>(curLang)
  const [theme, setThemeState] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'dark'
    }
    return 'dark'
  })
  const [showBusinessDay, setShowBusinessDay] = useState(false)
  const [showTariffs, setShowTariffs] = useState(false)
  const [editingHour, setEditingHour] = useState(getBusinessDayStartHour())

  const userTier = user?.tier ?? 'tekin'
  const pendingHour = getPendingBusinessDayStartHour()

  const handleSetTheme = useCallback((code: string) => {
    setThemeState(code)
    document.documentElement.setAttribute('data-theme', code)
    try { localStorage.setItem('hisvex_theme', code) } catch {}
  }, [])

  const handleSetLanguage = useCallback((code: Language) => {
    setLangState(code)
    setLanguage(code)
    try { localStorage.setItem('hisvex_language', code) } catch {}
  }, [])

  const openBusinessDay = useCallback(() => {
    setEditingHour(getBusinessDayStartHour())
    setShowBusinessDay(true)
  }, [])

  const handleHourDec = useCallback(() => {
    setEditingHour(prev => prev <= 0 ? 23 : prev - 1)
  }, [])

  const handleHourInc = useCallback(() => {
    setEditingHour(prev => prev >= 23 ? 0 : prev + 1)
  }, [])

  const handleSaveBusinessDay = useCallback(() => {
    scheduleBusinessDayStartHour(editingHour)
    setShowBusinessDay(false)
  }, [editingHour])

  const formatHourRange = (hour: number) => {
    if (hour === 0) return '00:00 dan 23:59 gacha'
    return `${String(hour).padStart(2, '0')}:00 dan ${String(hour - 1).padStart(2, '0')}:59 gacha`
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'pro': return 'var(--color-primary)'
      case 'bor': return 'var(--color-success)'
      default: return 'var(--color-text-secondary)'
    }
  }

  const getTierBg = (tier: string) => {
    switch (tier) {
      case 'pro': return 'rgba(99,102,241,0.12)'
      case 'bor': return 'rgba(34,197,94,0.12)'
      default: return 'rgba(145,149,166,0.12)'
    }
  }

  const sectionStyle: React.CSSProperties = {
    marginBottom: 24,
  }

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  }

  const handleLogout = useCallback(() => {
    logout()
    router.push('/login')
  }, [logout, router])

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', paddingBottom: 40 }}>
      {/* User Info */}
      {user && (
        <div style={sectionStyle}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                background: 'rgba(99,102,241,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <User size={24} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{user.username}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  {user.role === 'superAdmin' ? t('superAdmin') : t('admin')}
                </div>
              </div>
            </div>
          </div>

          {/* Subscription Card */}
          <div
            onClick={() => setShowTariffs(true)}
            style={{
              ...cardStyle,
              borderColor: `${getTierColor(userTier)}40`,
              background: userTier === 'pro'
                ? 'rgba(99,102,241,0.06)'
                : userTier === 'bor'
                  ? 'rgba(34,197,94,0.06)'
                  : 'var(--color-surface)',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 12px',
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 700,
                background: getTierBg(userTier),
                color: getTierColor(userTier),
              }}>
                {userTier === 'pro' ? t('planPro') : userTier === 'bor' ? t('planBor') : t('planFree')}
              </span>
              <ChevronRight size={18} style={{ color: 'var(--color-text-secondary)' }} />
            </div>
            {user?.subscriptionEndDate ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                {t('subscriptionEndDate')}: {new Date(user.subscriptionEndDate).toLocaleDateString()}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Language */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <Globe size={16} />
          {t('language')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {LANGUAGES.map(lang => {
            const selected = language === lang.code
            return (
              <button
                key={lang.code}
                onClick={() => handleSetLanguage(lang.code)}
                style={{
                  ...pillStyle,
                  background: selected ? 'rgba(99,102,241,0.12)' : 'var(--color-surface)',
                  borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                  color: selected ? 'var(--color-primary)' : 'var(--color-text)',
                  fontWeight: selected ? 700 : 600,
                }}
              >
                {lang.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Theme */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
          {t('theme')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEMES.map(item => {
            const selected = theme === item.code
            const Icon = item.icon
            return (
              <button
                key={item.code}
                onClick={() => handleSetTheme(item.code)}
                style={{
                  ...pillStyle,
                  background: selected ? 'rgba(99,102,241,0.12)' : 'var(--color-surface)',
                  borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                  color: selected ? 'var(--color-primary)' : 'var(--color-text)',
                  fontWeight: selected ? 700 : 600,
                }}
              >
                <Icon size={18} />
                {item.code === 'light' ? t('light') : t('dark')}
              </button>
            )
          })}
        </div>
      </div>

      {/* Business Day Hour */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <Clock size={16} />
          {t('businessDayHour')}
        </div>
        <button
          onClick={openBusinessDay}
          style={{
            ...cardStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('businessDayHour')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-primary)' }}>
              {String(getBusinessDayStartHour()).padStart(2, '0')}:00
            </span>
            <ChevronRight size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </span>
        </button>
      </div>

      {/* Support */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <MessageCircle size={16} />
          {t('support')}
        </div>
        <a
          href="https://t.me/dilbek7011"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            ...cardStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          <MessageCircle size={20} color="#0088cc" />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0088cc' }}>Telegram: @dilbek7011</span>
        </a>
      </div>

      {/* Logout */}
      <div style={sectionStyle}>
        <button
          onClick={handleLogout}
          style={{
            ...cardStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            cursor: 'pointer',
            color: 'var(--color-danger)',
            fontWeight: 700,
            fontSize: 14,
            background: 'rgba(239,68,68,0.08)',
            borderColor: 'rgba(239,68,68,0.3)',
          }}
        >
          <LogOut size={20} />
          {t('logout')}
        </button>
      </div>

      {/* Subscription Modal */}
      {showTariffs && (
        <div onClick={() => setShowTariffs(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 420,
            background: 'var(--color-surface)', borderRadius: 16,
            border: '1px solid var(--color-border)', overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t('subscriptionDetails')}</h3>
              <button onClick={() => setShowTariffs(false)} style={{
                width: 32, height: 32, borderRadius: 8, border: 'none',
                background: 'transparent', color: 'var(--color-text-secondary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><X size={20} /></button>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Current Plan */}
              {user && (
                <div style={{
                  padding: 12, borderRadius: 10,
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                    {t('currentPlan')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{
                      fontSize: 15, fontWeight: 700,
                      color: userTier === 'pro' ? '#7C3AED' : userTier === 'bor' ? '#10B981' : 'var(--color-text-secondary)',
                    }}>
                      {userTier === 'pro' ? t('planPro') : userTier === 'bor' ? t('planBor') : t('planFree')}
                    </span>
                    {user?.subscriptionEndDate ? (
                      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {t('subscriptionEndDate')}: {new Date(user.subscriptionEndDate).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Plan Cards: Bor & Pro */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  {
                    key: 'bor', label: t('planBor'), price: t('planBorPrice'),
                    color: '#10B981', bg: 'rgba(16,185,129,0.08)',
                    features: ['Ombor hisobi', 'Statistika', 'Savdo', '100 tagacha mahsulot'],
                  },
                  {
                    key: 'pro', label: t('planPro'), price: t('planProPrice'),
                    color: '#7C3AED', bg: 'rgba(124,58,237,0.08)',
                    features: ['Ombor hisobi', 'Statistika', 'Savdo', 'Cheksiz mahsulotlar'],
                  },
                ].map((plan) => {
                  const isActive = userTier === plan.key
                  const isSuperAdmin = user?.role === 'superAdmin'
                  return (
                    <div key={plan.key} style={{
                      padding: 14, borderRadius: 10,
                      border: `1.5px solid ${isActive ? plan.color : 'var(--color-border)'}`,
                      background: isActive ? plan.bg : 'var(--color-bg)',
                      position: 'relative',
                    }}>
                      {isActive && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          padding: '2px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                          background: plan.color, color: '#fff',
                        }}>
                          {t('currentPlanBadge')}
                        </div>
                      )}
                      <div style={{ fontSize: 16, fontWeight: 700, color: plan.color }}>{plan.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: plan.color, marginTop: 4, marginBottom: 10 }}>
                        {plan.price}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                        {plan.features.map((f, i) => (
                          <div key={i} style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: plan.color, fontWeight: 700 }}>✓</span> {f}
                          </div>
                        ))}
                      </div>
                      {!isActive && plan.key === 'bor' && (
                        <button
                          onClick={() => window.open('https://t.me/dilbek7011', '_blank')}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            border: 'none', background: `${plan.color}15`,
                            color: plan.color, cursor: 'pointer',
                          }}
                        >
                          <MessageCircle size={14} />
                          {t('contactAdmin')}
                        </button>
                      )}
                      {!isActive && plan.key === 'pro' && !isSuperAdmin && (
                        <button
                          onClick={() => window.open('https://t.me/dilbek7011', '_blank')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            border: `1px solid ${plan.color}40`, background: `${plan.color}15`,
                            color: plan.color, cursor: 'pointer',
                          }}
                        >
                          <MessageCircle size={14} />
                          {t('contactAdmin')}
                        </button>
                      )}
                      {plan.key === 'pro' && isSuperAdmin && (
                        <div style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          padding: '8px 0', borderRadius: 8,
                          background: `${plan.color}10`, color: plan.color,
                          fontSize: 12, fontWeight: 600,
                        }}>
                          {t('cheksiz')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Support */}
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                  {t('contactAdminSub')}
                </p>
                <a
                  href="https://t.me/dilbek7011"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    textDecoration: 'none', color: '#0088cc',
                    background: '#0088cc15', border: '1px solid #0088cc40',
                  }}
                >
                  <MessageCircle size={16} />
                  Telegram: @dilbek7011
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Business Day Modal */}
      {showBusinessDay && (
        <div
          onClick={() => setShowBusinessDay(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              background: 'var(--color-surface)',
              borderRadius: 16,
              border: '1px solid var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid var(--color-border)',
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                {t('businessDayHour')}
              </h3>
              <button
                onClick={() => setShowBusinessDay(false)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                {t('businessDayHourDesc')}
              </p>

              {pendingHour !== null && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(245,158,11,0.12)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  marginBottom: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--color-warning)',
                }}>
                  <Info size={14} />
                  Kutilayotgan: {String(pendingHour).padStart(2, '0')}:00 ({dayjs(getEffectiveFrom()).format('DD.MM HH:mm')} dan)
                </div>
              )}

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20,
                padding: 16,
                borderRadius: 8,
                background: 'var(--color-bg)',
                marginBottom: 16,
              }}>
                <button
                  onClick={handleHourDec}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-primary)',
                    fontSize: 24,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Minus size={24} />
                </button>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {String(editingHour).padStart(2, '0')}:00
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    {formatHourRange(editingHour)}
                  </div>
                </div>
                <button
                  onClick={handleHourInc}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-primary)',
                    fontSize: 24,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Plus size={24} />
                </button>
              </div>

              <div style={{
                padding: 12,
                borderRadius: 8,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                fontSize: 12,
                color: 'var(--color-text)',
                lineHeight: 1.6,
                marginBottom: 20,
              }}>
                {editingHour === 0
                  ? `00:00 dan 23:59 gacha. Masalan: ${dayjs().format('DD.MM')} 00:00 dan ${dayjs().add(1, 'day').format('DD.MM')} 00:00 gacha bir kun hisoblanadi.`
                  : `${String(editingHour).padStart(2, '0')}:00 dan ${String(editingHour - 1 < 0 ? 23 : editingHour - 1).padStart(2, '0')}:59 gacha.\nMasalan: ${dayjs().add(1, 'day').startOf('day').hour(editingHour).format('DD.MM HH:mm')} dan ${dayjs().add(2, 'day').startOf('day').hour(editingHour).format('DD.MM HH:mm')} gacha bir kun hisoblanadi.`}
              </div>

              <button
                onClick={handleSaveBusinessDay}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
