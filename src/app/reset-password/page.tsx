'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PasswordInput } from '@/components/PasswordInput'
import { TelegramIcon } from '@/components/TelegramIcon'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/lib/authStore'
import { t } from '@/lib/i18n'
import { takePasswordResetToken } from '@/lib/passwordResetToken'

export default function PasswordResetPage() {
  const initialized = useRef(false)
  const submitting = useRef(false)
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    setToken(takePasswordResetToken(window.location, window.history))
    setReady(true)
  }, [])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!token || submitting.current || success) return
    setError('')
    if (password.length < 6) { setError(t('passwordTooShort')); return }
    if (new TextEncoder().encode(password).length > 72) { setError(t('resetPasswordTooLong')); return }
    if (password !== confirm) { setError(t('passwordsDoNotMatch')); return }
    submitting.current = true
    setLoading(true)
    try {
      const { data } = await authApi.resetPassword(token, password)
      if (!data.reset) throw new Error(t('resetPasswordError'))
      // Leave another account signed in if this browser belongs to it.
      const auth = useAuthStore.getState()
      if (auth.user?._id === data.userId) auth.logout()
      setPassword(''); setConfirm(''); setToken(''); setSuccess(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('resetPasswordError')) }
    finally { submitting.current = false; setLoading(false) }
  }
  const input = { width: '100%', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 9, background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 16 }
  const bot = <a href="https://t.me/hisvex_bot?start=reset_password" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-primary)', lineHeight: 1.5 }}><TelegramIcon />{t('resetPasswordBot')}</a>
  return <main style={{ minHeight: '100dvh', padding: '32px 20px', display: 'grid', placeItems: 'center', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
    <section style={{ width: '100%', maxWidth: 420, padding: 24, borderRadius: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>{t('resetPasswordTitle')}</h1>
      {success ? <><p role="status">{t('resetPasswordSuccess')}</p><Link href="/login" style={{ color: 'var(--color-primary)' }}>{t('signIn')}</Link></>
        : !ready ? <p>{t('loading')}</p>
        : !token ? <><p>{t('resetPasswordMissing')}</p>{bot}</>
        : <><p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t('resetPasswordHint')}</p>
          <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
            <label style={{ display: 'grid', gap: 8 }}>{t('passwordNew')}<PasswordInput value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={6} required disabled={loading} style={input} /></label>
            <label style={{ display: 'grid', gap: 8 }}>{t('confirmPassword')}<PasswordInput value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" minLength={6} required disabled={loading} style={input} /></label>
            {error && <p role="alert" style={{ margin: 0, color: 'var(--color-danger)' }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ padding: 12, border: 0, borderRadius: 9, background: 'var(--color-primary)', color: '#fff', fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>{t(loading ? 'loading' : 'resetPasswordSubmit')}</button>
          </form><p style={{ marginTop: 20, fontSize: 13 }}>{bot}</p></>}
    </section>
  </main>
}
