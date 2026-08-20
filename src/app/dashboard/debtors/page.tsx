'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { debtorsApi, clearApiCache } from '@/lib/api'
import { useAuthStore } from '@/lib/authStore'
import { Plus, Minus, UserPlus, History, Pencil, Trash2, Search, Lock, UsersRound, Wallet, AlertTriangle, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/StatusViews'
import type { Debtor, DebtHistory } from '@/lib/types'
import { formatPhone, displayPhone, formatShortDate, formatInputAmount, parseFormattedAmount } from '@/lib/formatters'
import { isBlockCodeDisabled } from '@/utils/blockCode'
import { useEscapeToClose } from '@/lib/useEscapeKey'
import {
  overlay,
  modalContainer,
  modalHeader,
  modalBody,
  modalFooter,
  inputBase,
  label,
  errorText,
  formatMoney,
  kpiCard,
  kpiIcon,
} from '@/lib/sharedStyles'

// item 8 — componentized required-field marker, matching the pattern
// dashboard/products/page.tsx established (kept local to this page since
// that's where the pattern already lives, not promoted to sharedStyles).
const RequiredMark = () => (
  <span style={{ color: 'var(--color-danger)', marginLeft: 3, fontWeight: 700 }} title={t('requiredField')}>*</span>
)

const modalCloseBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
}

const headerIconBtnStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: 'none',
  background: 'var(--color-bg)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--color-text)',
  flexShrink: 0,
  transition: 'background 0.15s, color 0.15s',
}

// item 1 — content-shaped skeleton (KPI card + search bar + debtor rows)
// matching the *Skeleton convention ProductsSkeleton/InventorySkeleton
// established, replacing the old bare spinner.
function DebtorsSkeleton() {
  const block = (h: number, style?: React.CSSProperties): React.CSSProperties => ({
    height: h, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    animation: 'pulse 1.4s ease-in-out infinite', ...style,
  })
  return (
    <div>
      <div style={block(76, { marginBottom: 16 })} />
      <div style={block(40, { marginBottom: 16 })} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} style={block(64, { animationDelay: `${i * 0.06}s` })} />)}
      </div>
    </div>
  )
}

export default function DebtorsPage() {
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [loading, setLoading] = useState(true)
  // item 1 — genuine fetch failure now gets a persistent ErrorBanner + retry
  // instead of being conflated with a bare "offline" warning banner.
  const [loadError, setLoadError] = useState(false)

  const [search, setSearch] = useState('')

  const [showAddModal, setShowAddModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null)

  const [addName, setAddName] = useState('')
  const [addAmountDisplay, setAddAmountDisplay] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [addNameError, setAddNameError] = useState('')
  const [addAmountError, setAddAmountError] = useState('')

  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editNameError, setEditNameError] = useState('')

  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustError, setAdjustError] = useState('')

  const [deleteError, setDeleteError] = useState('')

  // item 9 — real bug fix: this page previously had zero duplicate-submission
  // guard anywhere (no `disabled` attribute existed on the file at all).
  // Mirrors desktop DebtorsScreen's `saving` flag exactly: a single flag is
  // enough since these modals are mutually exclusive, only one action can be
  // in flight from this screen at a time.
  const [saving, setSaving] = useState(false)

  // item 10 — route Delete through the same PIN-gate pattern
  // dashboard/products/page.tsx uses when a blockCode is set.
  const blockCode = useAuthStore((s) => s.user?.blockCode ?? null)
  // Per-device "temporarily disable" toggle set on the Settings page.
  const [blockDisabled, setBlockDisabledState] = useState(false)
  useEffect(() => { setBlockDisabledState(isBlockCodeDisabled()) }, [])
  const [showPinVerify, setShowPinVerify] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinVerifyError, setPinVerifyError] = useState<string | null>(null)
  const pinInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (showAddModal) {
      setAddName('')
      setAddAmountDisplay('')
      setAddPhone('')
      setAddNotes('')
      setAddNameError('')
      setAddAmountError('')
    }
  }, [showAddModal])

  useEffect(() => {
    if (showEditModal && selectedDebtor) {
      setEditName(selectedDebtor.name || '')
      setEditPhone(selectedDebtor.phone ? displayPhone(selectedDebtor.phone) : '')
      setEditNotes(selectedDebtor.notes || selectedDebtor.note || '')
      setEditNameError('')
    }
  }, [showEditModal, selectedDebtor])

  useEffect(() => {
    if (showDetailModal) {
      setAdjustAmount('')
      setAdjustError('')
    }
  }, [showDetailModal])

  useEffect(() => {
    if (showDeleteConfirm) {
      setDeleteError('')
    } else {
      setShowPinVerify(false)
      setPinInput('')
      setPinVerifyError(null)
    }
  }, [showDeleteConfirm])

  const loadDebtors = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const { data } = await debtorsApi.getAll()
      setDebtors(data)
    } catch (err) {
      console.error('Load debtors error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDebtors()
  }, [loadDebtors])

  const filtered = useMemo(() => {
    if (!search.trim()) return debtors
    const q = search.toLowerCase()
    return debtors.filter((d) => {
      const nameMatch = d.name.toLowerCase().includes(q)
      const phoneDigits = d.phone?.replace(/\D/g, '') || ''
      const searchDigits = q.replace(/\D/g, '')
      const phoneMatch = searchDigits && phoneDigits.includes(searchDigits)
      return nameMatch || phoneMatch
    })
  }, [debtors, search])

  const totalDebt = useMemo(() => {
    return debtors.reduce((sum, d) => sum + (d.amount || 0), 0)
  }, [debtors])

  const handleCardClick = (debtor: Debtor) => {
    setSelectedDebtor(debtor)
    setShowDetailModal(true)
  }

  const handleEditFromDetail = () => {
    setShowDetailModal(false)
    setShowEditModal(true)
  }

  const handleDeleteFromDetail = () => {
    setShowDetailModal(false)
    setShowDeleteConfirm(true)
  }

  // Actual delete API call, split out from the confirm-button click handler
  // so it can be invoked either directly (no blockCode set) or after a
  // successful PIN check (item 10).
  const execDelete = useCallback(async () => {
    if (!selectedDebtor || saving) return
    setSaving(true)
    try {
      await debtorsApi.delete(selectedDebtor._id)
      setShowDeleteConfirm(false)
      setSelectedDebtor(null)
      clearApiCache()
      loadDebtors()
    } catch (err) {
      console.error('Debtor delete error:', err)
      setDeleteError(t('error') || 'Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }, [selectedDebtor, saving, loadDebtors])

  const handleDeleteConfirm = () => {
    if (!selectedDebtor || saving) return
    if (blockCode && !blockDisabled) {
      setPinInput('')
      setPinVerifyError(null)
      setShowPinVerify(true)
      setTimeout(() => pinInputRef.current?.focus(), 60)
      return
    }
    execDelete()
  }

  const confirmPin = useCallback((value: string) => {
    if (value === blockCode) {
      setShowPinVerify(false)
      setPinInput('')
      setPinVerifyError(null)
      execDelete()
    } else {
      setPinVerifyError("Blok kod noto'g'ri")
      setPinInput('')
      setTimeout(() => pinInputRef.current?.focus(), 60)
    }
  }, [blockCode, execDelete])

  const handleAdjust = async (type: 'add' | 'subtract') => {
    if (!selectedDebtor || saving) return
    setAdjustError('')
    const amount = parseFormattedAmount(adjustAmount)
    if (amount <= 0) {
      // Real bug fix: this used to silently no-op on an empty/zero amount -
      // the button isn't disabled for that case, so a tap produced no
      // feedback at all and looked like the app had frozen.
      setAdjustError(t('amountRequired'))
      return
    }
    if (type === 'subtract' && amount > selectedDebtor.amount) {
      setAdjustError('O\'chirilayotgan summa qarzdan katta')
      return
    }
    const adjAmount = type === 'subtract' ? -amount : amount
    setSaving(true)
    try {
      await debtorsApi.adjust(selectedDebtor._id, adjAmount)
      clearApiCache()
      const { data } = await debtorsApi.getAll()
      setDebtors(data)
      const updated = data.find((d) => d._id === selectedDebtor._id)
      if (updated) setSelectedDebtor(updated)
      setAdjustAmount('')
    } catch {
      setAdjustError(t('error') || 'Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  const handleAddSave = async () => {
    if (saving) return
    let valid = true
    if (!addName.trim()) {
      setAddNameError(t('nameRequired'))
      valid = false
    } else {
      setAddNameError('')
    }
    const amountNum = parseFormattedAmount(addAmountDisplay)
    if (amountNum <= 0) {
      setAddAmountError(t('amountRequired'))
      valid = false
    } else {
      setAddAmountError('')
    }
    if (!valid) return
    setSaving(true)
    try {
      await debtorsApi.create({
        name: addName.trim(),
        amount: amountNum,
        phone: addPhone || undefined,
        notes: addNotes || undefined,
      })
      setShowAddModal(false)
      clearApiCache()
      loadDebtors()
    } catch {
      setAddNameError(t('error') || 'Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  const handleEditSave = async () => {
    if (!selectedDebtor || saving) return
    if (!editName.trim()) {
      setEditNameError(t('nameRequired'))
      return
    }
    setEditNameError('')
    setSaving(true)
    try {
      await debtorsApi.update(selectedDebtor._id, {
        name: editName.trim(),
        phone: editPhone || undefined,
        notes: editNotes || undefined,
      })
      setShowEditModal(false)
      setSelectedDebtor(null)
      clearApiCache()
      loadDebtors()
    } catch {
      setEditNameError(t('error') || 'Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  // Escape closes only the top-most open overlay (PIN verify can sit over
  // the delete-confirm dialog) - see useEscapeKey.ts. None of this app's
  // modals handled Escape at all before.
  useEscapeToClose([
    [showPinVerify, () => setShowPinVerify(false)],
    [showDeleteConfirm, () => { setShowDeleteConfirm(false); setSelectedDebtor(null) }],
    [showEditModal, () => { setShowEditModal(false); setSelectedDebtor(null) }],
    [showDetailModal, () => { setShowDetailModal(false); setSelectedDebtor(null) }],
    [showAddModal, () => setShowAddModal(false)],
  ])

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <PageHeader
        actions={
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary"
          >
            <UserPlus size={16} />
            {t('addDebtor')}
          </button>
        }
      />

      {loading ? (
        <DebtorsSkeleton />
      ) : loadError ? (
        <ErrorBanner onRetry={loadDebtors} />
      ) : (
        <>
          {/* item 4 — kpiCard structural pattern (icon chip + label +
              tabular-nums value) replacing the bespoke purple gradient hero
              card. Kept in the danger/red tone deliberately: total debt owed
              is a liability figure, not one of the revenue/profit/qty
              metric-identity colors. Debtor count kept as a secondary chip,
              same info as before. */}
          <div style={{ ...kpiCard, marginBottom: 16, alignItems: 'flex-start' }}>
            <div style={{ ...kpiIcon, background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}>
              <Wallet size={20} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {t('totalDebt')}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)',
                  background: 'var(--color-bg)', padding: '2px 9px', borderRadius: 20,
                  border: '1px solid var(--color-border)', whiteSpace: 'nowrap',
                }}>
                  {debtors.length} {t('debtors')}
                </div>
              </div>
              <div style={{
                fontSize: 'clamp(20px, 6vw, 26px)', fontWeight: 800, color: 'var(--color-danger)',
                marginTop: 4, letterSpacing: -0.4, fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.15, overflowWrap: 'anywhere',
              }}>
                {formatMoney(totalDebt)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
            }}>
              <Search size={16} color="var(--color-text-secondary)" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  fontSize: 13,
                  outline: 'none',
                  width: '100%',
                }}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            // item 11 — distinguish "search found nothing" from "genuinely no
            // debtors" (previously identical plain centered text for both),
            // and bring the empty state up to the icon-card level the other
            // redesigned screens (and desktop's .empty-state) already use.
            <div className="empty-state">
              <div className="empty-state-icon"><UsersRound size={24} /></div>
              <p className="empty-state-title">{search ? t('noDebtorsFound') : t('noDebtors')}</p>
              {!search && (
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary" style={{ marginTop: 4 }}>
                  <Plus size={16} />
                  {t('addDebtor')}
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {filtered.map((debtor, idx) => (
                <div
                  key={debtor._id}
                  onClick={() => handleCardClick(debtor)}
                  className="list-row-hover"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '14px 16px',
                    borderRadius: 10,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    marginBottom: 8,
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--color-primary)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>
                      {debtor.name}
                    </div>
                    {debtor.phone && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 2 }}>
                        {displayPhone(debtor.phone)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {formatShortDate(debtor.createdAt)}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: 'var(--color-danger)',
                    whiteSpace: 'nowrap',
                    maxWidth: '55%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {formatMoney(debtor.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Add Debtor Modal */}
      {showAddModal && (
        <div style={overlay} onClick={() => setShowAddModal(false)}>
          <div style={modalContainer} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('addDebtor')}</span>
              <button
                onClick={() => setShowAddModal(false)}
                className="icon-ghost-btn"
                style={modalCloseBtnStyle}
                title={t('close')}
                aria-label={t('close')}
              ><X size={18} /></button>
            </div>
            <div style={modalBody}>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('debtorName')}<RequiredMark /></label>
                <input
                  value={addName}
                  onChange={(e) => { setAddName(e.target.value); setAddNameError('') }}
                  placeholder={t('enterName')}
                  style={inputBase}
                />
                {addNameError && <div style={errorText}>{addNameError}</div>}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('debtorAmount')}<RequiredMark /></label>
                <input
                  value={addAmountDisplay}
                  onChange={(e) => { setAddAmountDisplay(formatInputAmount(e.target.value)); setAddAmountError('') }}
                  placeholder="0 so'm"
                  inputMode="numeric"
                  style={inputBase}
                />
                {addAmountError && <div style={errorText}>{addAmountError}</div>}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('phone')}</label>
                <input
                  value={addPhone}
                  onChange={(e) => setAddPhone(formatPhone(e.target.value))}
                  placeholder="+998 XX XXX XX XX"
                  style={inputBase}
                />
              </div>
              <div>
                <label style={label}>{t('note')}</label>
                <textarea
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  placeholder={t('notePlaceholder')}
                  rows={3}
                  style={{ ...inputBase, resize: 'vertical' }}
                />
              </div>
            </div>
            <div style={modalFooter}>
              <button onClick={() => setShowAddModal(false)} className="btn btn-secondary">{t('cancel')}</button>
              <button
                onClick={handleAddSave}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? t('loading') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debtor Detail / Adjust Modal */}
      {showDetailModal && selectedDebtor && (
        <div style={overlay} onClick={() => { setShowDetailModal(false); setSelectedDebtor(null) }}>
          <div style={{ ...modalContainer, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('adjustDebt')}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={handleEditFromDetail}
                  style={headerIconBtnStyle}
                  title={t('edit')}
                  aria-label={t('edit')}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg)' }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={handleDeleteFromDetail}
                  style={{ ...headerIconBtnStyle, color: 'var(--color-danger)' }}
                  title={t('delete')}
                  aria-label={t('delete')}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-danger-soft)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg)' }}
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={() => { setShowDetailModal(false); setSelectedDebtor(null) }}
                  className="icon-ghost-btn"
                  style={modalCloseBtnStyle}
                  title={t('close')}
                  aria-label={t('close')}
                ><X size={18} /></button>
              </div>
            </div>

            <div style={modalBody}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>
                  {selectedDebtor.name}
                </div>
                {selectedDebtor.phone && (
                  <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    {displayPhone(selectedDebtor.phone)}
                  </div>
                )}
                {(selectedDebtor.notes || selectedDebtor.note) && (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6, fontStyle: 'italic' }}>
                    {(selectedDebtor.notes || selectedDebtor.note)}
                  </div>
                )}
              </div>

              <div style={{
                background: 'var(--color-danger-soft)',
                borderRadius: 12,
                padding: '16px 20px',
                marginBottom: 24,
                border: '1px solid rgba(239,68,68,0.2)',
              }}>
                <div style={{ fontSize: 12, color: 'var(--color-danger)', fontWeight: 500, marginBottom: 4 }}>
                  {t('debtAmount')}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-danger)' }}>
                  {formatMoney(selectedDebtor.amount)}
                </div>
              </div>

              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginBottom: 12,
                }}>
                  <History size={18} />
                  {t('debtHistory')}
                </div>
                {(!selectedDebtor.history || selectedDebtor.history.length === 0) ? (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: '16px 0', textAlign: 'center' }}>
                    {t('noData')}
                  </div>
                ) : (
                  [...selectedDebtor.history].reverse().map((h: DebtHistory, idx: number, reversed: DebtHistory[]) => {
                    const isAdd = h.type === 'add'
                    // item 5 — the backend seeds exactly one "add" history
                    // entry when a debtor is created with a non-zero starting
                    // amount (debtor.service.ts create()). That entry is
                    // always history[0], i.e. the oldest one (last item once
                    // reversed to newest-first), and lands the same calendar
                    // day as the debtor's own createdAt. Detect it via that
                    // combination and label it distinctly from a later manual
                    // "Qo'shildi" adjustment.
                    const isOldest = idx === reversed.length - 1
                    const isStartingDebt = isOldest && isAdd
                      && formatShortDate(h.date) === formatShortDate(selectedDebtor.createdAt)
                    return (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          padding: '10px 0',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        <div style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isAdd ? 'var(--color-danger)' : 'var(--color-success)',
                          marginTop: 5,
                          flexShrink: 0,
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: isAdd ? 'var(--color-danger)' : 'var(--color-success)',
                            }}>
                              {isStartingDebt ? t('startingDebtLabel') : (isAdd ? t('added') : t('subtracted'))}
                            </span>
                            {h.note && (
                              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                · {h.note}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                            {formatShortDate(h.date)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: isAdd ? 'var(--color-danger)' : 'var(--color-success)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}>
                          {isAdd ? '+' : '-'}{formatMoney(h.amount)}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div style={{ ...modalFooter, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              {adjustError && (
                <div style={{ fontSize: 12, color: 'var(--color-danger)', textAlign: 'center' }}>
                  {adjustError}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <input
                    value={adjustAmount}
                    onChange={(e) => { setAdjustAmount(formatInputAmount(e.target.value)); setAdjustError('') }}
                    placeholder="0 so'm"
                    inputMode="numeric"
                    style={{
                      ...inputBase,
                      fontSize: 16,
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  />
                </div>
                {/* item 3 — explicit +/- glyph on Add/Subtract, matching
                    mobile's existing clarity (color-only signal wasn't
                    enough). Red = grows debt, green = shrinks debt, unchanged. */}
                <button
                  onClick={() => handleAdjust('add')}
                  disabled={saving}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--color-danger)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: saving ? 0.6 : 1,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'filter 0.15s',
                  }}
                  onMouseEnter={(e) => { if (!saving) e.currentTarget.style.filter = 'brightness(1.08)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
                >
                  <Plus size={14} />
                  {t('addToDebt')}
                </button>
                <button
                  onClick={() => handleAdjust('subtract')}
                  disabled={saving}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '10px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--color-success)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    opacity: saving ? 0.6 : 1,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'filter 0.15s',
                  }}
                  onMouseEnter={(e) => { if (!saving) e.currentTarget.style.filter = 'brightness(1.08)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
                >
                  <Minus size={14} />
                  {t('subtractFromDebt')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Debtor Modal */}
      {showEditModal && selectedDebtor && (
        <div style={overlay} onClick={() => { setShowEditModal(false); setSelectedDebtor(null) }}>
          <div style={modalContainer} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('editDebtor')}</span>
              <button
                onClick={() => { setShowEditModal(false); setSelectedDebtor(null) }}
                className="icon-ghost-btn"
                style={modalCloseBtnStyle}
                title={t('close')}
                aria-label={t('close')}
              ><X size={18} /></button>
            </div>
            <div style={modalBody}>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('debtorName')}<RequiredMark /></label>
                <input
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setEditNameError('') }}
                  placeholder={t('enterName')}
                  style={inputBase}
                />
                {editNameError && <div style={errorText}>{editNameError}</div>}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('phone')}</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(formatPhone(e.target.value))}
                  placeholder="+998 XX XXX XX XX"
                  style={inputBase}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('note')}</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder={t('notePlaceholder')}
                  rows={3}
                  style={{ ...inputBase, resize: 'vertical' }}
                />
              </div>
              {/* amount stays Add/Subtract-only, not directly editable here —
                  cheap hint so that constraint doesn't need discovering by trial. */}
              <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', padding: '8px 10px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                {t('editDebtorAmountHint')}
              </div>
            </div>
            <div style={modalFooter}>
              <button onClick={() => { setShowEditModal(false); setSelectedDebtor(null) }} className="btn btn-secondary">{t('cancel')}</button>
              <button
                onClick={handleEditSave}
                disabled={saving}
                className="btn btn-primary"
              >
                {saving ? t('loading') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div style={overlay} onClick={() => { setShowDeleteConfirm(false); setSelectedDebtor(null) }}>
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: 14,
            padding: 24,
            width: '100%',
            maxWidth: 380,
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <AlertTriangle size={22} color="var(--color-danger)" />
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('deleteConfirm')}</div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, marginBottom: 8, lineHeight: 1.5 }}>
              {t('deleteDebtorConfirm', { name: selectedDebtor?.name || '' })}
            </p>
            {/* item 6 — explicitly disclose that the debtor's full history is
                also permanently deleted (backend's findOneAndDelete removes
                the whole document, embedded history included). */}
            <p style={{ fontSize: 13, color: 'var(--color-danger)', margin: 0, marginBottom: 20, lineHeight: 1.5, fontWeight: 500 }}>
              {t('deleteDebtorHistoryWarning')}
            </p>
            {deleteError && (
              <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 12, textAlign: 'center' }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => { setShowDeleteConfirm(false); setSelectedDebtor(null) }}
                className="btn btn-secondary"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={saving}
                className="btn btn-danger"
                style={{ gap: 6 }}
              >
                {blockCode && !blockDisabled ? <Lock size={14} color="#fff" style={{ display: 'block' }} /> : null}
                {saving ? t('loading') : t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Verification — gates Delete when a blockCode is set (item 10) */}
      {showPinVerify && (
        <div style={overlay} onClick={() => { setShowPinVerify(false) }}>
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: 14,
            padding: 24,
            width: '100%',
            maxWidth: 380,
            border: '1px solid var(--color-border)',
            textAlign: 'center',
            boxShadow: 'var(--shadow-lg)',
          }} onClick={(e) => e.stopPropagation()}>
            <Lock size={32} color="var(--color-warning)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>Blok kodni kiriting</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 20 }}>
              {t('deleteDebtorRequiresBlockCode')}
            </div>
            <input
              ref={pinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={4}
              placeholder="••••"
              value={pinInput}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                setPinInput(v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pinInput.length === 4) confirmPin(pinInput)
              }}
              onFocus={(e) => e.target.select()}
              style={{
                width: '100%',
                maxWidth: 200,
                height: 56,
                borderRadius: 12,
                border: '1.5px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: 26,
                fontWeight: 700,
                textAlign: 'center',
                outline: 'none',
                letterSpacing: 12,
                caretColor: 'var(--color-primary)',
                fontVariantNumeric: 'tabular-nums',
                marginBottom: 16,
              }}
            />
            {pinVerifyError ? (
              <div style={{ fontSize: 13, color: 'var(--color-danger)', marginBottom: 16, minHeight: 18 }}>{pinVerifyError}</div>
            ) : (
              <div style={{ minHeight: 18, marginBottom: 16 }} />
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowPinVerify(false)} className="btn btn-secondary">Bekor qilish</button>
              <button
                onClick={() => confirmPin(pinInput)}
                disabled={pinInput.length !== 4}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                Tasdiqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
