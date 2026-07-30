'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { inventoryApi, resolveImageUrl, clearApiCache } from '@/lib/api'
import { useAppStore } from '@/lib/appStore'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, Package, Search } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { Product, InventoryItem } from '@/lib/types'
import { formatMoney, overlay } from '@/lib/sharedStyles'

const parseWholeNumber = (val: string) => Number(val.replace(/\D/g, '')) || 0
const getBusinessDate = () => dayjs().format('YYYY-MM-DD')

interface EnrichedItem {
  product: Product
  inv: InventoryItem | undefined
  opening: number
  current: number
  remaining: number
  sold: number
  revenue: number
  realizedProfit: number
  stockSellValue: number
  unitProfit: number
  sellPrice: number
  buyPrice: number
}

function getStockStatus(remaining: number) {
  if (remaining <= 0) return { label: 'Tugagan', color: 'var(--color-danger)' }
  if (remaining <= 5) return { label: 'Kam', color: 'var(--color-warning)' }
  return { label: 'Bor', color: 'var(--color-success)' }
}

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 700 },
  dateNav: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, justifyContent: 'center' },
  dateNavBtn: { width: 34, height: 34, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  dateDisplay: { display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', userSelect: 'none', padding: '4px 16px' },
  dateText: { fontSize: 15, fontWeight: 700, color: 'var(--color-text)', lineHeight: '20px' },
  weekdayText: { fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: '16px' },
  readOnlyBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)', fontSize: 11, fontWeight: 600, marginLeft: 8 },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 },
  summaryItem: { padding: '14px 16px', borderRadius: 10, background: 'var(--color-surface)', border: '1px solid var(--color-border)', textAlign: 'center' },
  summaryLabel: { fontSize: 11, color: 'var(--color-text-secondary)' },
  summaryValue: { fontSize: 16, fontWeight: 700, marginTop: 2 },
  card: { padding: 16, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', marginBottom: 8, cursor: 'pointer', transition: 'box-shadow 0.15s' },
  modal: { width: 420, maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' },
  modalTitle: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
  modalPrice: { fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 },
  fieldRow: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--color-border)' },
  fieldLabel: { fontSize: 13, color: 'var(--color-text-secondary)' },
  fieldValue: { fontSize: 13, fontWeight: 600 },
  modalInput: { width: 120, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, textAlign: 'right', outline: 'none' },
  previewBox: { marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--color-bg)', border: '1px solid var(--color-border)' },
  savedBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 20, background: 'var(--color-success)', color: '#fff', fontSize: 11, fontWeight: 600, animation: 'fadeIn 0.2s ease' },
  spinnerWrap: { display: 'flex', justifyContent: 'center', padding: 80 },
  emptyWrap: { textAlign: 'center', padding: 60, color: 'var(--color-text-secondary)' },
  searchWrap: { position: 'relative', marginBottom: 12 },
}

export default function InventoryPage() {
  const [selectedDate, setSelectedDate] = useState(getBusinessDate)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [selectedEntry, setSelectedEntry] = useState<EnrichedItem | null>(null)
  const [currentQtyInput, setCurrentQtyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isPastDate = dayjs(selectedDate).isBefore(dayjs(), 'day')
  const isFutureDate = dayjs(selectedDate).isAfter(dayjs(), 'day')
  const isEditable = !isPastDate && !isFutureDate
  const refreshKey = useAppStore((s) => s.refreshKey)
  const refreshAll = useAppStore((s) => s.refreshAll)

  useEffect(() => {
    if (isFutureDate) { setItems([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    inventoryApi.getByDate(selectedDate, selectedDate)
      .then(({ data }) => {
        if (!cancelled) setItems(data?.items ?? [])
      })
      .catch(() => { if (!cancelled) setItems([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedDate, isFutureDate, refreshKey])

  const combinedData = useMemo(() => {
    const result: EnrichedItem[] = []
    for (const item of items) {
      const product = item.product
      if (!product) continue
      const sellPrice = item.sellPrice ?? product.sellingPrice ?? 0
      const buyPrice = item.buyPrice ?? product.costPrice ?? 0
      const opening = item.startQuantity ?? 0
      const current = item.currentQuantity ?? 0
      const remaining = Math.max(current, 0)
      const sold = item.sold ?? 0
      const revenue = item.revenue ?? (sold * sellPrice)
      const realizedProfit = item.realizedProfit ?? (sold * (sellPrice - buyPrice))
      const stockSellValue = remaining * sellPrice
      const unitProfit = sellPrice - buyPrice
      result.push({
        product: product as Product, inv: item,
        opening, current, remaining, sold, revenue, realizedProfit,
        stockSellValue, unitProfit, sellPrice, buyPrice,
      })
    }
    result.sort((a, b) => {
      const ia = a.product.displayIndex ?? 999
      const ib = b.product.displayIndex ?? 999
      return ia !== ib ? ia - ib : (a.product.name || '').localeCompare(b.product.name || '')
    })
    return result
  }, [items])

  const filteredItems = useMemo(() => {
    if (!search.trim()) return combinedData
    const q = search.toLowerCase()
    return combinedData.filter((e) => e.product.name.toLowerCase().includes(q))
  }, [combinedData, search])

  const totals = useMemo(() => {
    let remaining = 0, sold = 0, revenue = 0, profit = 0
    for (const e of combinedData) { remaining += e.remaining; sold += e.sold; revenue += e.revenue; profit += e.realizedProfit }
    return { remaining, sold, revenue, profit }
  }, [combinedData])

  const goToPrevDay = useCallback(() => setSelectedDate((prev) => dayjs(prev).subtract(1, 'day').format('YYYY-MM-DD')), [])
  const goToNextDay = useCallback(() => setSelectedDate((prev) => dayjs(prev).add(1, 'day').format('YYYY-MM-DD')), [])

  const openModal = (entry: EnrichedItem) => { setSelectedEntry(entry); setCurrentQtyInput(String(entry.current)); setSaved(false) }
  const closeModal = () => { setSelectedEntry(null); setCurrentQtyInput('') }

  const handleSave = async () => {
    if (!selectedEntry || !isEditable) return
    setSaving(true)
    try {
      const newQty = parseWholeNumber(currentQtyInput)
      const productId = selectedEntry.inv?.productId ?? selectedEntry.product._id
      await inventoryApi.bulkUpdate([{ productId, currentQuantity: newQty }])
      clearApiCache()
      setItems((prev) => prev.map((item) =>
        (item.productId === productId || item.product?._id === productId)
          ? { ...item, currentQuantity: newQty }
          : item
      ))
      await refreshAll()
      setSaved(true)
      setTimeout(() => closeModal(), 700)
    } catch (err) { console.error('Inventory save error:', err) } finally { setSaving(false) }
  }

  const preview = useMemo(() => {
    if (!selectedEntry || !isEditable) return null
    const newCurrent = parseWholeNumber(currentQtyInput)
    const newSold = Math.max(selectedEntry.opening - newCurrent, 0)
    const newRevenue = newSold * selectedEntry.sellPrice
    const newProfit = newSold * (selectedEntry.sellPrice - selectedEntry.buyPrice)
    return { prevSold: selectedEntry.sold, newSold, newRevenue, newProfit }
  }, [selectedEntry, currentQtyInput, isEditable])

  const renderDateNav = () => (
    <div style={s.dateNav}>
      <button onClick={goToPrevDay} style={s.dateNavBtn}><ChevronLeft size={18} /></button>
      <label style={s.dateDisplay}>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{ ...s.dateText, border: 'none', background: 'transparent', cursor: 'pointer', outline: 'none', width: 'auto' }}
        />
        <span style={s.weekdayText}>{dayjs(selectedDate).format('dddd')}</span>
      </label>
      <button onClick={goToNextDay} style={s.dateNavBtn}><ChevronRight size={18} /></button>
    </div>
  )

  const renderCard = (entry: EnrichedItem) => {
    const status = getStockStatus(entry.remaining)
    return (
      <div style={s.card} onClick={() => openModal(entry)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {(entry.product.image || entry.product.imageHash) ? (
              <img src={resolveImageUrl(entry.product.image, entry.product.imageHash)} alt={entry.product.name} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
            ) : (
              <Package size={20} color="var(--color-text-tertiary)" />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{entry.product.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 1 }}>{formatMoney(entry.sellPrice)}</div>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20,
            fontSize: 11, fontWeight: 600, background: `${status.color}18`, color: status.color, whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />
            {status.label}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <div><div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 1 }}>{t('start')}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{entry.opening}</div></div>
          <div><div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 1 }}>{t('remaining')}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{entry.remaining}</div></div>
          <div><div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 1 }}>{t('sold')}</div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-success)' }}>{entry.sold}</div></div>
        </div>
      </div>
    )
  }

  const renderModal = () => {
    if (!selectedEntry) return null
    const status = getStockStatus(selectedEntry.remaining)
    const p = preview
    return (
      <div style={overlay} onClick={closeModal}>
        <div style={s.modal} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {(selectedEntry.product.image || selectedEntry.product.imageHash) ? (
                <img src={resolveImageUrl(selectedEntry.product.image, selectedEntry.product.imageHash)} alt={selectedEntry.product.name} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
              ) : (
                <Package size={18} color="var(--color-text-tertiary)" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={s.modalTitle}>{selectedEntry.product.name}</div>
              <div style={s.modalPrice}>{formatMoney(selectedEntry.sellPrice)}</div>
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20,
              fontSize: 11, fontWeight: 600, background: `${status.color}18`, color: status.color, whiteSpace: 'nowrap',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />
              {status.label}
            </div>
          </div>

          {isPastDate ? (
            <div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('start')}</span><span style={s.fieldValue}>{selectedEntry.opening}</span></div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('remaining')}</span><span style={s.fieldValue}>{selectedEntry.remaining}</span></div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('sold')}</span><span style={s.fieldValue}>{selectedEntry.sold}</span></div>
            </div>
          ) : (
            <div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('start')}</span><span style={s.fieldValue}>{selectedEntry.opening}</span></div>
              <div style={s.fieldRow}>
                <span style={s.fieldLabel}>{t('remaining')}</span>
                <input type="text" value={currentQtyInput} onChange={(e) => setCurrentQtyInput(e.target.value)} style={s.modalInput} inputMode="numeric" />
              </div>
              {p && (
                <div style={s.previewBox}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>{t('preSaveCheck')}</div>
                  <div style={s.fieldRow}><span style={s.fieldLabel}>{t('previousSold')}</span><span style={s.fieldValue}>{p.prevSold}</span></div>
                  <div style={s.fieldRow}><span style={s.fieldLabel}>{t('newSold')}</span><span style={s.fieldValue}>{p.newSold}</span></div>
                  <div style={s.fieldRow}><span style={s.fieldLabel}>{t('expectedRevenue')}</span><span style={s.fieldValue}>{formatMoney(p.newRevenue)}</span></div>
                  <div style={s.fieldRow}><span style={s.fieldLabel}>{t('expectedProfit')}</span><span style={s.fieldValue}>{formatMoney(p.newProfit)}</span></div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button onClick={closeModal} style={{
              padding: '8px 16px', borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'transparent', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer',
            }}>{t('back')}</button>
            {!isPastDate && (
              <button
                onClick={handleSave} disabled={saving}
                style={{
                  padding: '8px 16px', borderRadius: 6, border: 'none',
                  background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                  display: saved ? 'none' : undefined,
                }}
              >{saving ? t('loading_data') : t('save')}</button>
            )}
            {saved && <span style={s.savedBadge}>{t('success')}</span>}
          </div>
        </div>
      </div>
    )
  }

  const renderSearch = () => (
    <div style={s.searchWrap}>
      <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
      <input
        type="text" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: '9px 14px 9px 36px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, outline: 'none' }}
      />
    </div>
  )

  const content = () => (
    <>
      <div style={s.header}>
        <h2 style={s.title}>{t('inventory')}</h2>
        {isPastDate && <span style={s.readOnlyBadge}>{t('readOnly')}</span>}
      </div>
      {renderDateNav()}
      {renderSearch()}
      <div style={s.summaryRow}>
        <div style={s.summaryItem}><div style={s.summaryLabel}>{t('remaining')}</div><div style={s.summaryValue}>{totals.remaining}</div></div>
        <div style={s.summaryItem}><div style={s.summaryLabel}>{t('sold')}</div><div style={s.summaryValue}>{totals.sold}</div></div>
        <div style={s.summaryItem}><div style={s.summaryLabel}>{t('revenue')}</div><div style={s.summaryValue}>{formatMoney(totals.revenue)}</div></div>
        <div style={s.summaryItem}><div style={s.summaryLabel}>{t('profit')}</div><div style={{ ...s.summaryValue, color: 'var(--color-success)' }}>{formatMoney(totals.profit)}</div></div>
      </div>
      {loading && <div style={s.spinnerWrap}><div style={{ width: 28, height: 28, border: '2.5px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>}
      {!loading && filteredItems.length === 0 && (
        <div style={s.emptyWrap}>
          <Package size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 500 }}>{t('noInventory')}</p>
        </div>
      )}
      {filteredItems.map((entry, idx) => {
        const key = entry.inv?.productId ?? entry.product._id ?? `inv-${idx}`
        return <div key={key}>{renderCard(entry)}</div>
      })}
      {selectedEntry && renderModal()}
    </>
  )

  if (isFutureDate) {
    return (
      <div>
        <div style={s.header}><h2 style={s.title}>{t('inventory')}</h2></div>
        {renderDateNav()}
        <div style={s.emptyWrap}>
          <Package size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 500 }}>{t('futureDateNotice')}</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>{t('futureDateNoticeText')}</p>
        </div>
      </div>
    )
  }

  if (loading && items.length === 0) {
    return (
      <div>
        <div style={s.header}><h2 style={s.title}>{t('inventory')}</h2></div>
        {renderDateNav()}
        <div style={s.spinnerWrap}><div style={{ width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /></div>
      </div>
    )
  }

  return <div>{content()}</div>
}
