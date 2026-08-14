'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { inventoryApi, resolveImageUrl, clearApiCache } from '@/lib/api'
import { useAppStore } from '@/lib/appStore'
import { getBusinessDate, isPastBusinessDate, isTodayBusinessDate, isFutureBusinessDate } from '@/lib/businessDay'
import { resolveSellPrice, resolveBuyPrice, clampCurrentQuantity } from '@/lib/inventory'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, Package, Search, Archive, ShoppingCart, Wallet, TrendingUp } from 'lucide-react'
import { t } from '@/lib/i18n'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/StatusViews'
import type { Product, InventoryItem } from '@/lib/types'
import { formatMoney, overlay, kpiCard, kpiIcon } from '@/lib/sharedStyles'

const parseWholeNumber = (val: string) => Number(val.replace(/\D/g, '')) || 0

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
  if (remaining <= 0) return { label: 'Tugagan', color: 'var(--color-danger)', cls: 'badge badge-danger' }
  if (remaining <= 5) return { label: 'Kam', color: 'var(--color-warning)', cls: 'badge badge-warning' }
  return { label: 'Bor', color: 'var(--color-success)', cls: 'badge badge-success' }
}

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: 20, fontWeight: 700 },
  dateNav: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, justifyContent: 'center' },
  dateNavBtn: { width: 34, height: 34, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  dateDisplay: { display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', userSelect: 'none', padding: '4px 16px' },
  dateText: { fontSize: 15, fontWeight: 700, color: 'var(--color-text)', lineHeight: '20px' },
  weekdayText: { fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: '16px' },
  readOnlyBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', color: 'var(--color-danger)', fontSize: 11, fontWeight: 600, marginLeft: 8 },
  card: { padding: 16, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)', marginBottom: 8, cursor: 'pointer', transition: 'box-shadow 0.15s' },
  modal: { width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', padding: 24, borderRadius: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' },
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

// Shaped pulse-block skeleton matching this screen's actual layout (KPI row +
// equation caption + search bar + a handful of product cards), ported from the
// Statistics redesign's skeleton pattern rather than the old bare spinner.
function InventorySkeleton() {
  const block = (h: number, style?: React.CSSProperties): React.CSSProperties => ({
    height: h, borderRadius: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    animation: 'pulse 1.4s ease-in-out infinite', ...style,
  })
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 8 }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} style={block(70, { animationDelay: `${i * 0.07}s` })} />)}
      </div>
      <div style={{ height: 12, width: 200, borderRadius: 4, background: 'var(--color-surface)', marginBottom: 16, animation: 'pulse 1.4s ease-in-out infinite' }} />
      <div style={block(40, { marginBottom: 12, borderRadius: 10 })} />
      {[0, 1, 2, 3].map((i) => <div key={i} style={block(94, { marginBottom: 8, animationDelay: `${i * 0.08}s` })} />)}
    </div>
  )
}

export default function InventoryPage() {
  const [selectedDate, setSelectedDate] = useState(getBusinessDate)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [selectedEntry, setSelectedEntry] = useState<EnrichedItem | null>(null)
  const [currentQtyInput, setCurrentQtyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const isPastDate = isPastBusinessDate(selectedDate)
  const isFutureDate = isFutureBusinessDate(selectedDate)
  const isEditable = isTodayBusinessDate(selectedDate)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const refreshAll = useAppStore((s) => s.refreshAll)
  const storeProducts = useAppStore((s) => s.products)
  const loadProducts = useAppStore((s) => s.loadProducts)
  const showToast = useAppStore((s) => s.showToast)

  // Item 5 (products redesign spec) — ensure the product catalog is actually
  // loaded so the "genuinely no products yet" vs "just no inventory entries
  // today" distinction below is reliable, not a false positive from
  // storeProducts happening to be empty because nothing has populated it yet
  // this session. Cheap no-op if the store already has products cached.
  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  const fetchData = useCallback(() => {
    if (isFutureDate) { setItems([]); setLoading(false); return () => {} }
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    inventoryApi.getByDate(selectedDate, selectedDate)
      .then(({ data }) => {
        if (!cancelled) setItems(data?.items ?? [])
      })
      .catch(() => {
        if (!cancelled) { setItems([]); setLoadError(true) }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedDate, isFutureDate])

  useEffect(() => {
    const cancel = fetchData()
    return cancel
    // refreshKey intentionally re-triggers this effect on global data refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, refreshKey])

  const combinedData = useMemo(() => {
    const productMap = new Map(storeProducts.map((p) => [p._id, p]))
    const result: EnrichedItem[] = []
    for (const item of items) {
      const product = item.product || productMap.get(item.productId || '')
      if (!product) continue
      const sellPrice = resolveSellPrice(item, product)
      const buyPrice = resolveBuyPrice(item, product)
      const opening = item.startQuantity ?? item.openingQuantity ?? 0
      const current = item.currentQuantity ?? 0
      const remaining = Math.max(current, 0)
      const sold = item.sold ?? Math.max(opening - current, 0)
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
  }, [items, storeProducts])

  const filteredItems = useMemo(() => {
    if (!search.trim()) return combinedData
    const q = search.toLowerCase()
    return combinedData.filter((e) => e.product.name.toLowerCase().includes(q))
  }, [combinedData, search])

  const isSearchMiss = search.trim().length > 0 && combinedData.length > 0 && filteredItems.length === 0
  // Item 5 — distinguish "the product catalog itself is empty" (point the
  // user at Products) from "just no inventory entries for this date yet".
  const isCatalogEmpty = storeProducts.length === 0

  const totals = useMemo(() => {
    let start = 0, remaining = 0, sold = 0, revenue = 0, profit = 0
    for (const e of combinedData) { start += e.opening; remaining += e.remaining; sold += e.sold; revenue += e.revenue; profit += e.realizedProfit }
    return { start, remaining, sold, revenue, profit }
  }, [combinedData])

  const goToPrevDay = useCallback(() => setSelectedDate((prev) => dayjs(prev).subtract(1, 'day').format('YYYY-MM-DD')), [])
  const goToNextDay = useCallback(() => setSelectedDate((prev) => dayjs(prev).add(1, 'day').format('YYYY-MM-DD')), [])

  const openModal = (entry: EnrichedItem) => { setSelectedEntry(entry); setCurrentQtyInput(String(entry.current)); setSaved(false) }
  const closeModal = () => { setSelectedEntry(null); setCurrentQtyInput('') }

  // Real bug fix: the raw value the user typed can exceed the day's opening
  // quantity. Block save + show the same inline message mobile already uses
  // in that case, rather than silently accepting a nonsensical "remaining".
  const rawQtyInput = parseWholeNumber(currentQtyInput)
  const overCount = !!selectedEntry && isEditable && rawQtyInput > selectedEntry.opening

  const handleSave = async () => {
    if (!selectedEntry || !isEditable) return
    if (overCount) return
    setSaving(true)
    try {
      // Second bug fix layer, defense-in-depth: clamp the value actually sent
      // to the API at the point it gets applied/saved, mirroring mobile's
      // clampCurrentQuantity exactly, so a bad value can never persist even if
      // the inline check above is somehow bypassed.
      const newQty = clampCurrentQuantity(parseWholeNumber(currentQtyInput), selectedEntry.opening)
      const productId = selectedEntry.inv?.productId ?? selectedEntry.product._id
      await inventoryApi.bulkUpdate([{ productId, currentQuantity: newQty }])
      clearApiCache()
      setItems((prev) => prev.map((item) => {
        if (item.productId !== productId && item.product?._id !== productId) return item
        const opening = item.startQuantity ?? item.openingQuantity ?? 0
        const newSold = Math.max(opening - newQty, 0)
        const sp = resolveSellPrice(item, item.product)
        const bp = resolveBuyPrice(item, item.product)
        return {
          ...item,
          currentQuantity: newQty,
          sold: newSold,
          revenue: newSold * sp,
          realizedProfit: newSold * (sp - bp),
        }
      }))
      await refreshAll()
      setSaved(true)
      setTimeout(() => closeModal(), 700)
    } catch (err) {
      console.error('Inventory save error:', err)
      // Real bug fix: a failed save used to look identical to a successful one
      // from the user's perspective. Surface it via the app's existing toast
      // mechanism (same one products/page.tsx uses for save failures).
      showToast(err instanceof Error ? err.message : t('saveError'), 'error')
    } finally { setSaving(false) }
  }

  const preview = useMemo(() => {
    if (!selectedEntry || !isEditable || overCount) return null
    const newCurrent = parseWholeNumber(currentQtyInput)
    const newSold = Math.max(selectedEntry.opening - newCurrent, 0)
    const newRevenue = newSold * selectedEntry.sellPrice
    const newProfit = newSold * (selectedEntry.sellPrice - selectedEntry.buyPrice)
    return { prevSold: selectedEntry.sold, newSold, newRevenue, newProfit }
  }, [selectedEntry, currentQtyInput, isEditable, overCount])

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

  // Standardized 5-item KPI row (same set/order/labels the Statistics screen
  // and mobile now use): Boshlang'ich -> Qoldiq -> Sotildi -> Tushum -> Foyda,
  // using the Statistics KPI-card visual pattern with metric-identity colors
  // on the three "activity" numbers; start/remaining stay neutral ink.
  const renderKpiRow = () => {
    const neutralSoft = 'var(--color-border)'
    const neutralInk = 'var(--color-text-secondary)'
    const kpis = [
      { icon: <Package size={18} />, label: t('start'), value: String(totals.start), color: neutralInk, soft: neutralSoft },
      { icon: <Archive size={18} />, label: t('remaining'), value: String(totals.remaining), color: neutralInk, soft: neutralSoft },
      { icon: <ShoppingCart size={18} />, label: t('sold'), value: String(totals.sold), color: 'var(--color-metric-qty)', soft: 'var(--color-metric-qty-soft)' },
      { icon: <Wallet size={18} />, label: t('revenue'), value: formatMoney(totals.revenue), color: 'var(--color-metric-revenue)', soft: 'var(--color-metric-revenue-soft)' },
      { icon: <TrendingUp size={18} />, label: t('profit'), value: formatMoney(totals.profit), color: 'var(--color-metric-profit)', soft: 'var(--color-metric-profit-soft)' },
    ]
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 8 }}>
          {kpis.map((item, i) => (
            <div key={i} style={kpiCard}>
              <div style={{ ...kpiIcon, background: item.soft, color: item.color }}>{item.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 'clamp(13px, 3.4vw, 16px)', fontWeight: 800, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.2, overflowWrap: 'anywhere' }}>{item.value}</div>
              </div>
            </div>
          ))}
        </div>
        {/* Quiet equation caption — a single anchor sentence so it's clear why
            these numbers relate the way they do, without adding clutter per-row. */}
        <p style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', margin: '0 0 16px', textAlign: 'center' }}>
          {t('inventoryEquationCaption')}
        </p>
      </>
    )
  }

  const renderCard = (entry: EnrichedItem) => {
    const status = getStockStatus(entry.remaining)
    return (
      <div style={s.card} onClick={() => openModal(entry)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
            {(entry.product.image || entry.product.imageHash) ? (
              <img src={resolveImageUrl(entry.product.image, entry.product.imageHash)} alt={entry.product.name} style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
            ) : (
              <Package size={24} color="var(--color-text-tertiary)" />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{entry.product.name}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 1 }}>{formatMoney(entry.sellPrice)}</div>
          </div>
          <span className={status.cls} style={{ gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />
            {status.label}
          </span>
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
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {(selectedEntry.product.image || selectedEntry.product.imageHash) ? (
                <img src={resolveImageUrl(selectedEntry.product.image, selectedEntry.product.imageHash)} alt={selectedEntry.product.name} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }} />
              ) : (
                <Package size={22} color="var(--color-text-tertiary)" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={s.modalTitle}>{selectedEntry.product.name}</div>
              <div style={s.modalPrice}>{formatMoney(selectedEntry.sellPrice)}</div>
            </div>
            <span className={status.cls} style={{ gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: status.color }} />
              {status.label}
            </span>
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
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>{t('startQtyAuto')}</p>
              <div style={{ ...s.fieldRow, marginTop: 8 }}>
                <span style={s.fieldLabel}>{t('remaining')}</span>
                <input
                  type="text" value={currentQtyInput} onChange={(e) => setCurrentQtyInput(e.target.value)}
                  style={{ ...s.modalInput, ...(overCount ? { borderColor: 'var(--color-danger)' } : {}) }}
                  inputMode="numeric"
                  aria-invalid={overCount}
                />
              </div>
              {overCount && (
                <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 6, fontWeight: 500 }}>{t('cannotAddMoreThanSold')}</p>
              )}
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
            <button onClick={closeModal} className="btn btn-secondary">{t('back')}</button>
            {!isPastDate && (
              <button
                onClick={handleSave} disabled={saving || overCount}
                className="btn btn-primary"
                style={saved ? { display: 'none' } : overCount ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
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
      <PageHeader
        actions={isPastDate ? <span className="badge badge-danger">{t('readOnly')}</span> : undefined}
      />
      {renderDateNav()}
      {loading ? (
        <InventorySkeleton />
      ) : loadError ? (
        <ErrorBanner onRetry={fetchData} />
      ) : (
        <>
          {renderKpiRow()}
          {renderSearch()}
          {filteredItems.length === 0 && (
            <div style={s.emptyWrap}>
              <Package size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: 15, fontWeight: 500 }}>{isSearchMiss ? t('noProductsFound') : isCatalogEmpty ? t('addProductsFirst') : t('noInventory')}</p>
            </div>
          )}
          {filteredItems.map((entry, idx) => {
            const key = entry.inv?.productId ?? entry.product._id ?? `inv-${idx}`
            return <div key={key}>{renderCard(entry)}</div>
          })}
        </>
      )}
      {selectedEntry && renderModal()}
    </>
  )

  if (isFutureDate) {
    return (
      <div>
        {renderDateNav()}
        <div style={s.emptyWrap}>
          <Package size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontSize: 15, fontWeight: 500 }}>{t('futureDateNotice')}</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>{t('futureDateNoticeText')}</p>
        </div>
      </div>
    )
  }

  return <div>{content()}</div>
}
