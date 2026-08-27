import type { CSSProperties } from 'react'

export const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  animation: 'fadeIn 0.2s ease',
  backdropFilter: 'blur(4px)',
  padding: 14,
}

export const modalContainer: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  maxHeight: '90vh',
  background: 'var(--color-bg-alt)',
  borderRadius: 14,
  border: '1px solid var(--color-border)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
  animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
}

export const modalHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '15px 20px',
  borderBottom: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  flexShrink: 0,
}

export const modalBody: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 20,
}

export const modalFooter: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 9,
  padding: '13px 20px',
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  flexShrink: 0,
}

export const inputBase: CSSProperties = {
  padding: '9px 12px',
  borderRadius: 9,
  border: '1.5px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

export const label: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  marginBottom: 6,
}

export const errorText: CSSProperties = {
  color: 'var(--color-danger)',
  fontSize: 12,
  marginTop: 3,
  fontWeight: 500,
}

export const btnPrimary: CSSProperties = {
  padding: '9px 17px',
  borderRadius: 9,
  border: 'none',
  background: 'var(--color-primary)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
  boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
}

export const btnSecondary: CSSProperties = {
  padding: '9px 17px',
  borderRadius: 9,
  border: '1.5px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
}

export const btnDanger: CSSProperties = {
  padding: '9px 17px',
  borderRadius: 9,
  border: 'none',
  background: 'var(--color-danger)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(239,68,68,0.25)',
}

// Statistics screen's KPI-card pattern (icon chip + label + tabular-nums value),
// promoted here so other screens (e.g. Inventory) can reuse the same visual
// language instead of reinventing a summary-row treatment.
export const kpiCard: CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 14,
  padding: 14,
  border: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
}

export const kpiIcon: CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 11,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

export const formatMoney = (val?: number) => {
  if (val == null || Number.isNaN(val) || !Number.isFinite(val)) return "0 so'm"
  return val.toLocaleString('uz-UZ') + " so'm"
}

export const parseFormattedAmount = (text: string) => {
  return Number(text.replace(/[^\d]/g, '')) || 0
}

export const formatInputAmount = (text: string) => {
  const digits = text.replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('uz-UZ')
}
