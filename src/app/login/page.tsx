'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/authStore'
import { t } from '@/lib/i18n'
import { formatPhone } from '@/lib/formatters'

const C = {
  bg: '#070512',
  bgMid: '#0F0A2E',
  bgDeep: '#0C0820',
  primary: '#7C3AED',
  accent: '#A78BFA',
  accentDim: 'rgba(167,139,250,0.65)',
  surface: 'rgba(255,255,255,0.04)',
  border: 'rgba(167,139,250,0.15)',
  borderFocus: '#7C3AED',
  text: 'rgba(255,255,255,0.9)',
  textSecondary: 'rgba(167,139,250,0.65)',
  textTertiary: 'rgba(167,139,250,0.3)',
  danger: '#EF4444',
  dangerBg: 'rgba(239,68,68,0.1)',
  dangerBorder: 'rgba(239,68,68,0.25)',
}

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('+998')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)
  const setAuth = useAuthStore((s) => s.setAuth)
  const router = useRouter()
  const isLoginMode = mode === 'login'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password.trim()) {
      setError(t('enterLoginPassword'))
      return
    }
    if (!isLoginMode) {
      if (password !== confirmPassword) {
        setError(t('passwordsDoNotMatch'))
        return
      }
      if (password.length < 6) {
        setError(t('passwordTooShort'))
        return
      }
    }
    setLoading(true)
    try {
      const { data } = isLoginMode
        ? await authApi.login(username.trim(), password)
        : await authApi.register(username.trim(), password, phoneNumber.replace(/\D/g, '') || undefined)
      setAuth(data.token, data.refreshToken, data.user)
      router.replace(data.user.role === 'superAdmin' ? '/dashboard/users' : '/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (isLoginMode ? t('loginError') : t('registerError'))
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = (field: string): React.CSSProperties => ({
    width: '100%',
    padding: 12,
    borderRadius: 10,
    border: '1.5px solid',
    borderColor: focusedField === field ? C.borderFocus : C.border,
    background: C.surface,
    color: C.text,
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  })

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: C.bg,
      padding: 32,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'fixed', inset: 0,
        background: `linear-gradient(180deg, ${C.bg} 0%, ${C.bgMid} 30%, ${C.bgDeep} 65%, ${C.bg} 100%)`,
        zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
        top: '-200px', right: '-200px', zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 70%)',
        bottom: '-150px', left: '-150px', zIndex: 0,
      }} />
      <div style={{
        position: 'fixed', width: 720, height: 720, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,58,237,0.07) 0%, rgba(124,58,237,0.02) 55%, transparent 70%)',
        top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 0,
      }} />

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 88, height: 88, borderRadius: 22,
            overflow: 'hidden', margin: '0 auto 22px',
            boxShadow: '0 12px 40px rgba(124,58,237,0.35)',
          }}>
            <Image
              src="/logo.png" alt="Hisvex"
              width={88} height={88}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              priority
            />
          </div>
          <h1 style={{
            margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.2,
            background: 'linear-gradient(135deg, #A78BFA 0%, #7C3AED 60%, #6D28D9 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Hisvex
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, color: C.textSecondary, letterSpacing: 0.4 }}>
            {isLoginMode ? t('signInToSystem') : t('createAccount')}
          </p>
        </div>

        <div style={{
          borderRadius: 20, border: `1px solid ${C.border}`,
          background: 'rgba(255,255,255,0.03)', padding: 24,
        }}>
          <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => { setMode('login'); setError('') }}
              style={{
                paddingBottom: 8, border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: isLoginMode ? `2px solid ${C.primary}` : '2px solid transparent',
              }}
            >
              <span style={{
                fontSize: 16, fontWeight: isLoginMode ? 700 : 600,
                color: isLoginMode ? C.primary : C.textTertiary,
              }}>{t('signIn')}</span>
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError('') }}
              style={{
                paddingBottom: 8, border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: !isLoginMode ? `2px solid ${C.primary}` : '2px solid transparent',
              }}
            >
              <span style={{
                fontSize: 16, fontWeight: !isLoginMode ? 700 : 600,
                color: !isLoginMode ? C.primary : C.textTertiary,
              }}>{t('signUp')}</span>
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{
                borderRadius: 10, padding: 12,
                border: `1px solid ${C.dangerBorder}`,
                background: C.dangerBg,
              }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, textAlign: 'center', color: C.danger }}>
                  {error}
                </p>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.textSecondary, marginBottom: 6, marginLeft: 2 }}>
                {t('loginLabel')}
              </label>
              <input
                type="text" value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField('username')}
                onBlur={() => setFocusedField(null)}
                style={inputStyle('username')}
                placeholder={t('loginPlaceholder')}
                autoCapitalize="none" autoCorrect="off"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.textSecondary, marginBottom: 6, marginLeft: 2 }}>
                {t('password')}
              </label>
              <input
                type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                style={inputStyle('password')}
                placeholder={t('passwordPlaceholder')}
                autoCapitalize="none" autoCorrect="off"
              />
            </div>

            {!isLoginMode && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.textSecondary, marginBottom: 6, marginLeft: 2 }}>
                    {t('confirmPassword')}
                  </label>
                  <input
                    type="password" value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onFocus={() => setFocusedField('confirm')}
                    onBlur={() => setFocusedField(null)}
                    style={inputStyle('confirm')}
                    placeholder={t('confirmPasswordPlaceholder')}
                    autoCapitalize="none" autoCorrect="off"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.textSecondary, marginBottom: 6, marginLeft: 2 }}>
                    {t('phoneNumber')}
                  </label>
                  <input
                    type="tel" value={phoneNumber}
                    onChange={(e) => setPhoneNumber(formatPhone(e.target.value))}
                    onFocus={() => setFocusedField('phone')}
                    onBlur={() => setFocusedField(null)}
                    style={inputStyle('phone')}
                    placeholder={t('phoneNumberPlaceholder')}
                    autoCapitalize="none" autoCorrect="off"
                  />
                </div>
              </>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', padding: 16, borderRadius: 10, border: 'none',
                background: C.primary, color: '#fff',
                fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1, marginTop: 4,
              }}
            >{loading ? t('loading') : isLoginMode ? t('signIn') : t('signUp')}</button>
          </form>
        </div>

        <div style={{ marginTop: 28, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <p style={{ margin: 0, fontSize: 13, color: C.textTertiary }}>
            {isLoginMode ? t('noAccountSwitch') : t('haveAccountSwitch')}
          </p>
          <button
            type="button"
            onClick={() => { setMode(isLoginMode ? 'register' : 'login'); setError('') }}
            style={{
              background: 'none', border: 'none', color: C.primary,
              cursor: 'pointer', fontSize: 15, fontWeight: 700, padding: 0,
            }}
          >{isLoginMode ? t('signUpHere') : t('signInHere')}</button>
        </div>
      </div>
    </div>
  )
}
