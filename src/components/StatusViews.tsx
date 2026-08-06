'use client'

// Small shared primitives from the Statistics screen redesign, promoted here so a
// second screen (Inventory) can reuse them without duplicating the pattern. Keep
// these generic — anything shaped specifically for one screen's layout (e.g. a
// skeleton matching that screen's exact card structure) stays local to that screen.

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'

export const SECTION_LABEL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

export function ErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
      border: '1px solid var(--color-danger)', background: 'var(--color-danger-soft)', marginBottom: 14,
    }}>
      <AlertTriangle size={20} color="var(--color-danger)" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--color-danger)' }}>{t('dataLoadError')}</span>
      <button onClick={onRetry} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9,
        border: 'none', background: 'var(--color-danger)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
      }}><RefreshCw size={14} />{t('retryAction')}</button>
    </div>
  )
}
