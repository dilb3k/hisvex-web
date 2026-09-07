'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { inventoryApi, resolveImageUrl, clearApiCache } from '@/lib/api'
import { useAppStore } from '@/lib/appStore'
import { getBusinessDate, isPastBusinessDate, isTodayBusinessDate, isFutureBusinessDate } from '@/lib/businessDay'
import {
  compareProducts,
  resolveSellPrice,
  resolveBuyPrice,
  clampCurrentQuantity,
  normalizeUnit,
  isWeighed,
  roundQty,
  roundMoney,
  qtyGreaterThan,
  formatQuantity,
  formatQuantityValue,
  normalizeQuantityInput,
  parseQuantityInput,
} from '@/lib/inventory'
import dayjs from 'dayjs'
import { ChevronLeft, ChevronRight, Package, Search, Archive, ShoppingCart, Wallet, TrendingUp, X, Lock } from 'lucide-react'
import { t } from '@/lib/i18n'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/StatusViews'
import type { Product, InventoryItem, ProductUnit } from '@/lib/types'
import { formatMoney, formatInputAmount, parseFormattedAmount, overlay, kpiCard, kpiIcon } from '@/lib/sharedStyles'
import { useEscapeToClose } from '@/lib/useEscapeKey'
import { useAuthStore } from '@/lib/authStore'
import { isBlockCodeDisabled } from '@/utils/blockCode'

interface EnrichedItem {
  product: Product
  inv: InventoryItem | undefined
  unit: ProductUnit
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
  dateNavBtn: { width: 34, height: 34, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s, border-color 0.15s' },
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
  // Set only when the user overwrites the expected-revenue figure. Kept
  // separate from the computed one so clearing the field returns to "value
  // these units at the list price" instead of meaning "they brought in 0".
  const [revenueInput, setRevenueInput] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Overriding the expected revenue away from what the list price implies is
  // this screen's equivalent of Sales' per-line price renegotiation — gated
  // behind the same blockCode PIN, same pattern as Sales/Products/Debtors.
  // Unlike Sales (which gates the instant the field is typed), this gates at
  // Save time: nothing here clears currentQtyInput/revenueInput while the
  // PIN modal is open, so the values are simply re-read once the code checks
  // out rather than needing a separate "pending edit" stash.
  const blockCode = useAuthStore((s) => s.user?.blockCode ?? null)
  const [blockDisabled, setBlockDisabledState] = useState(false)
  useEffect(() => { setBlockDisabledState(isBlockCodeDisabled()) }, [])
  const [showPinVerify, setShowPinVerify] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinVerifyError, setPinVerifyError] = useState<string | null>(null)
  const pinInputRef = useRef<HTMLInputElement | null>(null)

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

  // Only the first load of a given date shows the skeleton; refreshes driven
  // by refreshKey (a sale on the Sales screen, an edit on Products) repaint in
  // place rather than flashing the whole screen back to placeholders.
  const loadedDateRef = useRef<string | null>(null)
  const fetchData = useCallback(() => {
    if (isFutureDate) { setItems([]); setLoading(false); return () => {} }
    let cancelled = false
    if (loadedDateRef.current !== selectedDate) setLoading(true)
    setLoadError(false)
    inventoryApi.getByDate(selectedDate, selectedDate)
      .then(({ data }) => {
        if (!cancelled) { setItems(data?.items ?? []); loadedDateRef.current = selectedDate }
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
      const unit = normalizeUnit(item.unit ?? (product as Product).unit)
      const opening = roundQty(item.startQuantity ?? item.openingQuantity ?? 0)
      const current = roundQty(item.currentQuantity ?? 0)
      const remaining = roundQty(Math.max(current, 0))
      const sold = item.sold ?? roundQty(Math.max(opening - current, 0))
      // Server figures win when present: units sold at a negotiated price are
      // valued in the entry's locked accumulators, which sold x list price
      // cannot reproduce.
      const revenue = item.revenue ?? roundMoney(sold * sellPrice)
      const realizedProfit = item.realizedProfit ?? roundMoney(sold * (sellPrice - buyPrice))
      const stockSellValue = roundMoney(remaining * sellPrice)
      const unitProfit = sellPrice - buyPrice
      result.push({
        product: product as Product, inv: item, unit,
        opening, current, remaining, sold, revenue, realizedProfit,
        stockSellValue, unitProfit, sellPrice, buyPrice,
      })
    }
    // Shared comparator — Products, Inventory and Sales all order the catalog
    // identically now (see compareProducts in lib/inventory.ts).
    result.sort((a, b) => compareProducts(a.product, b.product))
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
    return {
      start: roundQty(start),
      remaining: roundQty(remaining),
      sold: roundQty(sold),
      revenue: roundMoney(revenue),
      profit: roundMoney(profit),
    }
  }, [combinedData])

  const goToPrevDay = useCallback(() => setSelectedDate((prev) => dayjs(prev).subtract(1, 'day').format('YYYY-MM-DD')), [])
  const goToNextDay = useCallback(() => setSelectedDate((prev) => dayjs(prev).add(1, 'day').format('YYYY-MM-DD')), [])

  const openModal = (entry: EnrichedItem) => { setSelectedEntry(entry); setCurrentQtyInput(formatQuantityValue(entry.current, entry.unit)); setRevenueInput(null); setSaved(false) }
  const closeModal = () => { setSelectedEntry(null); setCurrentQtyInput(''); setRevenueInput(null) }

  // Was not handled before - see useEscapeKey.ts.
  // Real bug fix: the raw value the user typed can exceed the day's opening
  // quantity. Block save + show the same inline message mobile already uses
  // in that case, rather than silently accepting a nonsensical "remaining".
  const rawQtyInput = selectedEntry
    ? parseQuantityInput(currentQtyInput, selectedEntry.unit)
    : 0
  const overCount = !!selectedEntry && isEditable && qtyGreaterThan(rawQtyInput, selectedEntry.opening)

  const execSave = async () => {
    if (!selectedEntry || !isEditable) return
    if (overCount) return
    setSaving(true)
    try {
      // Second bug fix layer, defense-in-depth: clamp the value actually sent
      // to the API at the point it gets applied/saved, mirroring mobile's
      // clampCurrentQuantity exactly, so a bad value can never persist even if
      // the inline check above is somehow bypassed.
      const newQty = clampCurrentQuantity(parseQuantityInput(currentQtyInput, selectedEntry.unit), selectedEntry.opening)
      const productId = selectedEntry.inv?.productId ?? selectedEntry.product._id
      const statedRevenue = preview?.isOverridden ? preview.newRevenue : undefined
      await inventoryApi.bulkUpdate([{
        productId,
        currentQuantity: newQty,
        ...(statedRevenue !== undefined ? { lineRevenue: statedRevenue } : {}),
      }])
      clearApiCache()
      setItems((prev) => prev.map((item) => {
        if (item.productId !== productId && item.product?._id !== productId) return item
        const opening = item.startQuantity ?? item.openingQuantity ?? 0
        const newSold = roundQty(Math.max(opening - newQty, 0))
        const sp = resolveSellPrice(item, item.product)
        const bp = resolveBuyPrice(item, item.product)
        const revenue = statedRevenue ?? roundMoney(newSold * sp)
        return {
          ...item,
          currentQuantity: newQty,
          sold: newSold,
          revenue,
          realizedProfit: roundMoney(revenue - newSold * bp),
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

  const handleSave = () => {
    if (!selectedEntry || !isEditable || overCount) return
    if (preview?.isOverridden && blockCode && !blockDisabled) {
      setPinInput('')
      setPinVerifyError(null)
      setShowPinVerify(true)
      setTimeout(() => pinInputRef.current?.focus(), 60)
      return
    }
    execSave()
  }

  // Deliberately not wrapped in useCallback: it closes over execSave (itself
  // unmemoized, so it captures the current currentQtyInput/revenueInput on
  // every render) — memoizing this against a narrower dep list would risk
  // calling a stale execSave from an earlier render's closure.
  const confirmPin = (value: string) => {
    if (value === blockCode) {
      setShowPinVerify(false)
      setPinInput('')
      setPinVerifyError(null)
      execSave()
    } else {
      setPinVerifyError("Blok kod noto'g'ri")
      setPinInput('')
      setTimeout(() => pinInputRef.current?.focus(), 60)
    }
  }

  const cancelPin = () => {
    setShowPinVerify(false)
    setPinInput('')
    setPinVerifyError(null)
  }

  // PIN sheet stacks on top of the entry modal (selectedEntry stays set while
  // it's open) — ordered topmost-first so Escape dismisses just the PIN sheet
  // first, matching useEscapeKey.ts's layering contract.
  useEscapeToClose([
    [showPinVerify, cancelPin],
    [!!selectedEntry, closeModal],
  ])

  const preview = useMemo(() => {
    if (!selectedEntry || !isEditable || overCount) return null
    const newCurrent = parseQuantityInput(currentQtyInput, selectedEntry.unit)
    const newSold = roundQty(Math.max(selectedEntry.opening - newCurrent, 0))
    const listRevenue = roundMoney(newSold * selectedEntry.sellPrice)
    // An overwritten revenue is authoritative. Profit is never entered — it is
    // always revenue minus the cost of the units sold, so every so'm taken off
    // the revenue comes straight off the profit.
    const newRevenue = revenueInput === null ? listRevenue : roundMoney(parseFormattedAmount(revenueInput))
    const newProfit = roundMoney(newRevenue - newSold * selectedEntry.buyPrice)
    return {
      prevSold: selectedEntry.sold,
      newSold,
      // What THIS edit does, as opposed to the day totals around it.
      //
      // The maths was never wrong — remaining is always measured against the
      // opening quantity, which is what makes a mid-day recount work at all —
      // but the panel only ever showed the day totals. Typing 87 over a
      // remaining of 88 put "19 sold" on screen when one single unit had just
      // been sold, and 19 is the number that catches the eye. The delta is now
      // stated outright so the two readings can't be confused.
      soldNow: roundQty(newSold - selectedEntry.sold),
      revenueNow: roundMoney(newRevenue - selectedEntry.revenue),
      profitNow: roundMoney(newProfit - selectedEntry.realizedProfit),
      listRevenue,
      newRevenue,
      newProfit,
      isOverridden: revenueInput !== null && Math.abs(newRevenue - listRevenue) > 0.005,
    }
  }, [selectedEntry, currentQtyInput, revenueInput, isEditable, overCount])

  const renderDateNav = () => (
    <div style={s.dateNav}>
      <button
        onClick={goToPrevDay}
        style={s.dateNavBtn}
        title="Oldingi kun"
        aria-label="Oldingi kun"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)' }}
      ><ChevronLeft size={18} /></button>
      <label style={s.dateDisplay}>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          style={{ ...s.dateText, border: 'none', background: 'transparent', cursor: 'pointer', outline: 'none', width: 'auto' }}
        />
        <span style={s.weekdayText}>{dayjs(selectedDate).format('dddd')}</span>
      </label>
      <button
        onClick={goToNextDay}
        style={s.dateNavBtn}
        title="Keyingi kun"
        aria-label="Keyingi kun"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-surface)' }}
      ><ChevronRight size={18} /></button>
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
      // No unit suffix on these three: they sum across products measured in
      // different units, so "24.5 dona" would be wrong. formatQuantityValue
      // with 'kg' just means "keep the decimals, drop the trailing zeros".
      { icon: <Package size={18} />, label: t('start'), value: formatQuantityValue(totals.start, 'kg'), color: neutralInk, soft: neutralSoft },
      { icon: <Archive size={18} />, label: t('remaining'), value: formatQuantityValue(totals.remaining, 'kg'), color: neutralInk, soft: neutralSoft },
      { icon: <ShoppingCart size={18} />, label: t('sold'), value: formatQuantityValue(totals.sold, 'kg'), color: 'var(--color-metric-qty)', soft: 'var(--color-metric-qty-soft)' },
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
      <div style={s.card} className="list-row-hover" onClick={() => openModal(entry)}>
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
          <div><div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 1 }}>{t('start')}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{formatQuantity(entry.opening, entry.unit)}</div></div>
          <div><div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 1 }}>{t('remaining')}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{formatQuantity(entry.remaining, entry.unit)}</div></div>
          <div><div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 1 }}>{t('sold')}</div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-success)' }}>{formatQuantity(entry.sold, entry.unit)}</div></div>
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
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('start')}</span><span style={s.fieldValue}>{formatQuantity(selectedEntry.opening, selectedEntry.unit)}</span></div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('remaining')}</span><span style={s.fieldValue}>{formatQuantity(selectedEntry.remaining, selectedEntry.unit)}</span></div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('sold')}</span><span style={s.fieldValue}>{formatQuantity(selectedEntry.sold, selectedEntry.unit)}</span></div>
            </div>
          ) : (
            <div>
              <div style={s.fieldRow}><span style={s.fieldLabel}>{t('start')}</span><span style={s.fieldValue}>{formatQuantity(selectedEntry.opening, selectedEntry.unit)}</span></div>
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>{t('startQtyAuto')}</p>
              <div style={{ ...s.fieldRow, marginTop: 8 }}>
                <span style={s.fieldLabel}>{t('remaining')} ({selectedEntry.unit})</span>
                <input
                  type="text"
                  value={currentQtyInput}
                  onChange={(e) => setCurrentQtyInput(normalizeQuantityInput(e.target.value, selectedEntry.unit))}
                  style={{ ...s.modalInput, ...(overCount ? { borderColor: 'var(--color-danger)' } : {}) }}
                  inputMode={isWeighed(selectedEntry.unit) ? 'decimal' : 'numeric'}
                  aria-invalid={overCount}
                />
              </div>
              {overCount && (
                <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 6, fontWeight: 500 }}>{t('cannotAddMoreThanSold')}</p>
              )}
              {p && (
                <div style={s.previewBox}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>{t('preSaveCheck')}</div>

                  {/* What this one edit does, stated first and on its own.
                      Everything below it is a day total, which is what made
                      the panel misleading: typing 87 over a remaining of 88
                      showed "19 sold" — correct for the day, but one unit was
                      what actually just changed hands. */}
                  <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
                    padding: '8px 10px', borderRadius: 8, marginBottom: 8,
                    background: p.soldNow === 0 ? 'var(--color-surface)' : 'var(--color-primary-soft)',
                    border: `1px solid ${p.soldNow === 0 ? 'var(--color-border)' : 'var(--color-primary)'}`,
                  }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      {p.soldNow === 0 ? t('noQtyChange') : p.soldNow > 0 ? t('sellingNowQty') : t('returningNowQty')}
                    </span>
                    {p.soldNow !== 0 && (
                      <span style={{ textAlign: 'right', minWidth: 0 }}>
                        <span style={{
                          fontSize: 15, fontWeight: 800, color: 'var(--color-primary)',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {formatQuantity(Math.abs(p.soldNow), selectedEntry.unit)}
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 1 }}>
                          {formatMoney(Math.abs(p.revenueNow))}
                          {' · '}
                          {t('profit')} {formatMoney(Math.abs(p.profitNow))}
                        </span>
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>
                    {t('dayTotals')}
                  </div>
                  <div style={s.fieldRow}><span style={s.fieldLabel}>{t('previousSold')}</span><span style={s.fieldValue}>{formatQuantity(p.prevSold, selectedEntry.unit)}</span></div>
                  <div style={s.fieldRow}><span style={s.fieldLabel}>{t('newSold')}</span><span style={s.fieldValue}>{formatQuantity(p.newSold, selectedEntry.unit)}</span></div>
                  {/* Editable: the shop often takes a different amount than
                      the list price implies. Profit is deliberately NOT
                      editable — it is always revenue minus the cost of the
                      units sold, so it follows from this field on its own. */}
                  <div style={{ ...s.fieldRow, alignItems: 'center' }}>
                    <span style={s.fieldLabel}>{t('expectedRevenue')}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={t('expectedRevenue')}
                        value={p.isOverridden || revenueInput !== null
                          ? (revenueInput ?? '')
                          : formatInputAmount(String(p.listRevenue))}
                        onChange={(e) => setRevenueInput(formatInputAmount(e.target.value))}
                        onFocus={() => { if (revenueInput === null) setRevenueInput(formatInputAmount(String(p.listRevenue))) }}
                        style={{
                          ...s.modalInput,
                          width: 130,
                          ...(p.isOverridden ? { borderColor: 'var(--color-primary)', color: 'var(--color-primary)' } : {}),
                        }}
                      />
                      {p.isOverridden && (
                        <button
                          onClick={() => setRevenueInput(null)}
                          title={t('resetPrice')}
                          aria-label={t('resetPrice')}
                          className="icon-ghost-btn"
                          style={{ width: 28, height: 28, borderRadius: 7 }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={s.fieldRow}>
                    <span style={s.fieldLabel}>{t('expectedProfit')}</span>
                    <span style={{ ...s.fieldValue, color: p.newProfit < 0 ? 'var(--color-danger)' : undefined }}>
                      {formatMoney(p.newProfit)}
                    </span>
                  </div>
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
                style={saved
                  ? { display: 'none' }
                  : {
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      ...(overCount ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
                    }}
              >
                {/* Purely informational, like Sales' confirm button — the
                    override itself is already PIN-gated in handleSave above,
                    this just flags in advance that saving will ask for it. */}
                {p?.isOverridden && <Lock size={14} />}
                {saving ? t('loading_data') : t('save')}
              </button>
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
        className="search-input"
        style={{ paddingLeft: 36 }}
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
            <div className="empty-state">
              <div className="empty-state-icon"><Package size={24} /></div>
              <p className="empty-state-title">{isSearchMiss ? t('noProductsFound') : isCatalogEmpty ? t('addProductsFirst') : t('noInventory')}</p>
            </div>
          )}
          {filteredItems.map((entry, idx) => {
            const key = entry.inv?.productId ?? entry.product._id ?? `inv-${idx}`
            return <div key={key}>{renderCard(entry)}</div>
          })}
        </>
      )}
      {selectedEntry && renderModal()}

      {/* PIN Verification — gates an overridden expected-revenue save when a
          blockCode is set, same pattern as Sales' per-line price gate. */}
      {showPinVerify && (
        <div style={overlay} onClick={cancelPin}>
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
              {t('revenueChangeRequiresBlockCode')}
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
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter' && pinInput.length === 4) confirmPin(pinInput) }}
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
              <button onClick={cancelPin} className="btn btn-secondary">{t('cancel')}</button>
              <button
                onClick={() => confirmPin(pinInput)}
                disabled={pinInput.length !== 4}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  if (isFutureDate) {
    return (
      <div>
        {renderDateNav()}
        <div className="empty-state">
          <div className="empty-state-icon"><Package size={24} /></div>
          <p className="empty-state-title">{t('futureDateNotice')}</p>
          <p className="empty-state-text">{t('futureDateNoticeText')}</p>
        </div>
      </div>
    )
  }

  return <div>{content()}</div>
}
