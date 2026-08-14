'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { inventoryApi } from '@/lib/api'
import { useAppStore } from '@/lib/appStore'
import { getBusinessDate } from '@/lib/businessDay'
import { resolveSellPrice, resolveBuyPrice } from '@/lib/inventory'
import dayjs from 'dayjs'
import {
  Download, CalendarClock, RefreshCw, TrendingUp, TrendingDown, X, ChevronLeft, ChevronRight,
  Wallet, ShoppingCart, Percent, Package, BarChart3, Archive, Trophy,
} from 'lucide-react'
import { t } from '@/lib/i18n'
import { formatMoney, kpiCard, kpiIcon } from '@/lib/sharedStyles'
import { SECTION_LABEL, ErrorBanner } from '@/components/StatusViews'

type Period = 'daily' | 'monthly' | 'yearly'
type BucketUnit = 'day' | 'month'
type MetricKey = 'revenue' | 'profit' | 'qty'

const PERIODS: Period[] = ['daily', 'monthly', 'yearly']

function getPeriodRange(period: Period, date: string) {
  const d = dayjs(date)
  switch (period) {
    case 'daily': return { from: date, to: date }
    case 'monthly': return { from: d.startOf('month').format('YYYY-MM-DD'), to: d.endOf('month').format('YYYY-MM-DD') }
    case 'yearly': return { from: d.startOf('year').format('YYYY-MM-DD'), to: d.endOf('year').format('YYYY-MM-DD') }
  }
}

function formatPeriodLabel(period: Period, date: string) {
  const d = dayjs(date)
  switch (period) {
    case 'daily': return d.format('DD MMMM YYYY')
    case 'monthly': return d.format('MMMM YYYY')
    case 'yearly': return d.format('YYYY')
  }
}

function navigateDate(period: Period, date: string, dir: -1 | 1) {
  const d = dayjs(date)
  const unit = period === 'daily' ? 'day' : period === 'monthly' ? 'month' : 'year'
  return d.add(dir, unit).format('YYYY-MM-DD')
}

interface ProductRankItem {
  id: string
  name: string
  sold: number
  profit: number
}

type InventoryLineItem = {
  date?: string
  sold?: number
  realizedProfit?: number
  startQuantity?: number
  openingQuantity?: number
  currentQuantity?: number
  sellPrice?: number
  price?: number
  buyPrice?: number
  product?: { _id?: string; id?: string; name?: string; sellPrice?: number; sellingPrice?: number; buyPrice?: number; costPrice?: number }
}

function buildProductRankings(inventoryItems: InventoryLineItem[]): ProductRankItem[] {
  const seen = new Map<string, { sold: number; profit: number; name: string }>()
  for (const item of inventoryItems) {
    const p = item.product
    if (!p) continue
    const id = p._id || p.id
    if (!id) continue
    const opening = item.startQuantity ?? item.openingQuantity ?? 0
    const sold = item.sold ?? Math.max(opening - (item.currentQuantity ?? 0), 0)
    const cur = seen.get(id) ?? { sold: 0, profit: 0, name: p.name || 'Noma\'lum' }
    cur.sold += sold
    const sp = resolveSellPrice(item, p)
    const bp = resolveBuyPrice(item, p)
    cur.profit += item.realizedProfit ?? (sold * (sp - bp))
    seen.set(id, cur)
  }
  return Array.from(seen.entries()).map(([id, totals]) => ({ id, name: totals.name, sold: totals.sold, profit: totals.profit }))
}

function computeTotals(items: InventoryLineItem[]) {
  // Flow metrics (sold/revenue/profit) are correctly summed across every
  // day-entry in the range — a sale on Monday and a sale on Tuesday are two
  // distinct events that both count.
  let sold = 0, revenue = 0, profit = 0
  for (const item of items) {
    const qty = item.currentQuantity ?? 0
    const sp = resolveSellPrice(item, item.product)
    const bp = resolveBuyPrice(item, item.product)
    const soldQty = item.sold ?? Math.max((item.startQuantity ?? item.openingQuantity ?? 0) - qty, 0)
    sold += soldQty
    revenue += soldQty * sp
    profit += item.realizedProfit ?? (soldQty * (sp - bp))
  }

  // Stock metrics (remaining pieces/value) are a POINT-IN-TIME snapshot, not
  // a flow — a product's physical stock exists once, not once per day it
  // shows up in a wide date-range query. Summing `currentQuantity` across
  // every per-product-per-day row (the previous bug here) inflated these
  // totals by roughly "days in range" for any multi-day query, producing
  // reports like "653,329,201 dona" for a small bar. Take only each
  // product's most-recent entry in the range instead, mirroring the
  // backend's aggregateInventoryForRange (inventory.logic.ts).
  const latestByProduct = new Map<string, InventoryLineItem>()
  for (const item of items) {
    const id = item.product?._id || item.product?.id
    if (!id) continue
    const existing = latestByProduct.get(id)
    if (!existing || (item.date ?? '') >= (existing.date ?? '')) {
      latestByProduct.set(id, item)
    }
  }
  let remaining = 0, stockSellValue = 0, stockProfit = 0
  for (const item of latestByProduct.values()) {
    const qty = Math.max(item.currentQuantity ?? 0, 0)
    const sp = resolveSellPrice(item, item.product)
    const bp = resolveBuyPrice(item, item.product)
    remaining += qty
    stockSellValue += qty * sp
    stockProfit += qty * (sp - bp)
  }

  return {
    sellableItems: sold + remaining, soldItems: sold, sellableValue: revenue + stockSellValue,
    earnedRevenue: revenue, possibleProfit: profit + stockProfit, earnedProfit: profit,
    remainingItems: remaining, stockValue: stockSellValue,
  }
}

// ============================================================
// Trend chart — Section A's "Bu davr" bar chart, reused (per spec) inside the
// All-Time modal too. Plain divs only, no chart library.
// ============================================================

function bucketKeyFor(date: string, unit: BucketUnit) {
  const d = dayjs(date)
  return unit === 'day' ? d.format('YYYY-MM-DD') : d.format('YYYY-MM')
}

function bucketLabelFor(key: string, unit: BucketUnit) {
  return unit === 'day' ? dayjs(key).format('DD MMM') : dayjs(key + '-01').format('MMM YYYY')
}

function aggregateBuckets(items: InventoryLineItem[], unit: BucketUnit) {
  const map = new Map<string, { revenue: number; profit: number; qty: number }>()
  for (const item of items) {
    if (!item?.date) continue
    const key = bucketKeyFor(item.date, unit)
    const sp = resolveSellPrice(item, item.product)
    const bp = resolveBuyPrice(item, item.product)
    const opening = item.startQuantity ?? item.openingQuantity ?? 0
    const soldQty = item.sold ?? Math.max(opening - (item.currentQuantity ?? 0), 0)
    const cur = map.get(key) ?? { revenue: 0, profit: 0, qty: 0 }
    cur.revenue += soldQty * sp
    cur.profit += item.realizedProfit ?? soldQty * (sp - bp)
    cur.qty += soldQty
    map.set(key, cur)
  }
  return map
}

function bucketKeysInRange(from: string, to: string, unit: BucketUnit) {
  const keys: string[] = []
  const unitName = unit === 'day' ? 'day' : 'month'
  let cur = dayjs(from).startOf(unitName)
  const end = dayjs(to).startOf(unitName)
  let guard = 0
  while ((cur.isBefore(end) || cur.isSame(end, unitName)) && guard < 400) {
    keys.push(unit === 'day' ? cur.format('YYYY-MM-DD') : cur.format('YYYY-MM'))
    cur = cur.add(1, unitName)
    guard++
  }
  return keys
}

function metricOptions() {
  return [
    { key: 'revenue' as const, label: t('revenue'), color: 'var(--color-metric-revenue)' },
    { key: 'profit' as const, label: t('netProfit'), color: 'var(--color-metric-profit)' },
    { key: 'qty' as const, label: t('soldPieces'), color: 'var(--color-metric-qty)' },
  ]
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: '4px 4px 0 0', background: 'var(--color-border)',
          height: `${28 + ((i * 37) % 62)}%`, animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.05}s`,
        }} />
      ))}
    </div>
  )
}

function TrendChart({ items, bucketUnit, rangeFrom, rangeTo, currentKey, loading, compact }: {
  items: InventoryLineItem[]
  bucketUnit: BucketUnit
  rangeFrom: string
  rangeTo: string
  currentKey?: string
  loading?: boolean
  compact?: boolean
}) {
  const [metric, setMetric] = useState<MetricKey>('revenue')
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const options = metricOptions()
  const active = options.find((o) => o.key === metric)!
  const plotHeight = compact ? 84 : 130

  const buckets = useMemo(() => {
    const map = aggregateBuckets(items, bucketUnit)
    const keys = bucketKeysInRange(rangeFrom, rangeTo, bucketUnit)
    return keys.map((key) => ({ key, ...(map.get(key) ?? { revenue: 0, profit: 0, qty: 0 }) }))
  }, [items, bucketUnit, rangeFrom, rangeTo])

  const isEmpty = !loading && (items.length === 0 || buckets.length === 0)
  const maxVal = Math.max(...buckets.map((b) => b[metric]), 1)

  return (
    <div style={{ marginBottom: compact ? 0 : 14 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {options.map((opt) => (
          <button key={opt.key} onClick={() => { setMetric(opt.key); setActiveIdx(null) }} style={{
            padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1.5px solid ${metric === opt.key ? opt.color : 'var(--color-border)'}`,
            background: metric === opt.key ? opt.color : 'transparent',
            color: metric === opt.key ? '#fff' : 'var(--color-text-secondary)',
            transition: 'all 0.15s',
          }}>{opt.label}</button>
        ))}
      </div>

      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14,
        padding: compact ? '14px 12px 10px' : '18px 16px 12px',
      }}>
        {loading ? (
          <ChartSkeleton height={plotHeight} />
        ) : isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: plotHeight, textAlign: 'center' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-primary-soft)', color: 'var(--color-primary)' }}>
              <BarChart3 size={17} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('chartNoData')}</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: plotHeight }}>
              {buckets.map((b, i) => {
                const val = b[metric]
                const isCurrent = currentKey ? b.key === currentKey : i === buckets.length - 1
                const heightPct = Math.max((val / maxVal) * 100, val > 0 ? 4 : 2)
                const isActive = activeIdx === i
                const edgeStart = i < buckets.length * 0.15
                const edgeEnd = i > buckets.length * 0.85
                return (
                  <div
                    key={b.key}
                    style={{ position: 'relative', flex: 1, minWidth: 2, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseLeave={() => setActiveIdx((cur) => (cur === i ? null : cur))}
                    onClick={() => setActiveIdx((cur) => (cur === i ? null : i))}
                  >
                    {isActive && (
                      <div style={{
                        position: 'absolute', bottom: 'calc(100% + 6px)',
                        left: edgeStart ? 0 : edgeEnd ? 'auto' : '50%',
                        right: edgeEnd ? 0 : 'auto',
                        transform: edgeStart || edgeEnd ? 'none' : 'translateX(-50%)',
                        background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', borderRadius: 8,
                        padding: '6px 10px', boxShadow: 'var(--shadow-md)', zIndex: 5, pointerEvents: 'none', whiteSpace: 'nowrap',
                      }}>
                        <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{bucketLabelFor(b.key, bucketUnit)}</div>
                        <div style={{ fontSize: 'clamp(11px, 3vw, 13px)', fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                          {metric === 'qty' ? `${val} dona` : formatMoney(val)}
                        </div>
                      </div>
                    )}
                    <div style={{
                      width: '100%', height: `${heightPct}%`, borderRadius: '4px 4px 0 0',
                      background: active.color, opacity: isCurrent ? 1 : 0.35,
                      transition: 'height 0.3s ease, opacity 0.2s',
                    }} />
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{bucketLabelFor(buckets[0].key, bucketUnit)}</span>
              {buckets.length > 1 && <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{bucketLabelFor(buckets[buckets.length - 1].key, bucketUnit)}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Small shared pieces
// ============================================================

const CARD: React.CSSProperties = {
  padding: 24,
  borderRadius: 16,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  transition: 'all 0.2s',
}

const heroChip: React.CSSProperties = {
  padding: '5px 12px',
  borderRadius: 20,
  background: 'rgba(255,255,255,0.15)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
}

const navBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 9,
  border: 'none',
  background: 'rgba(255,255,255,0.15)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.2s',
}

function StatsSkeleton() {
  const block = (h: number, style?: React.CSSProperties): React.CSSProperties => ({
    height: h, borderRadius: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    animation: 'pulse 1.4s ease-in-out infinite', ...style,
  })
  return (
    <div>
      <div style={block(126, { marginBottom: 14 })} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ flex: 1, height: 30, borderRadius: 999, background: 'var(--color-surface)', border: '1px solid var(--color-border)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
      <div style={block(160, { marginBottom: 14 })} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        {[0, 1, 2].map((i) => <div key={i} style={block(68, { animationDelay: `${i * 0.1}s` })} />)}
      </div>
      <div style={block(110, { marginBottom: 14 })} />
      <div style={block(220)} />
    </div>
  )
}

// Native-input-backed date button styled to match the label-over-value control this app
// uses for range pickers elsewhere. react-datepicker (which desktop's equivalent modal
// uses) is not a dependency of this app yet — see final report; kept to the native
// <input type="date"> to avoid adding a new npm dependency without flagging it, but wraps
// it in the same visual affordance desktop's `RangeButton` provides.
function RangeDateButton({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{
      position: 'relative', flex: 1, padding: 12, borderRadius: 10, border: '1px solid var(--color-border)',
      background: 'var(--color-bg)', overflow: 'hidden', cursor: 'pointer',
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
        {dayjs(value).format('DD.MM.YYYY')}
      </div>
      <input
        type="date"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-label={label}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none' }}
      />
    </div>
  )
}

// ============================================================
// Page
// ============================================================

export default function StatisticsPage() {
  const [period, setPeriod] = useState<Period>('daily')
  const [selectedDate, setSelectedDate] = useState(getBusinessDate)
  const [inventoryItems, setInventoryItems] = useState<InventoryLineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showAllTime, setShowAllTime] = useState(false)
  const [allTimeFrom, setAllTimeFrom] = useState(() => dayjs(getBusinessDate()).subtract(1, 'year').format('YYYY-MM-DD'))
  const [allTimeTo, setAllTimeTo] = useState(getBusinessDate)
  const [allTimeItems, setAllTimeItems] = useState<InventoryLineItem[] | null>(null)
  const [allTimeLoading, setAllTimeLoading] = useState(false)
  const [allTimeError, setAllTimeError] = useState(false)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const range = useMemo(() => getPeriodRange(period, selectedDate), [period, selectedDate])
  const periodLabel = useMemo(() => formatPeriodLabel(period, selectedDate), [period, selectedDate])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const invRes = await inventoryApi.getByDate(range.from, range.to)
      setInventoryItems(invRes.data?.items ?? [])
    } catch {
      setInventoryItems([])
      setLoadError(true)
    } finally { setLoading(false) }
  }, [range.from, range.to, refreshKey])

  useEffect(() => { fetchData() }, [fetchData])

  // The chart needs finer-grained history than a single "daily" period's range provides
  // (that range is just one day) — widen it to a rolling 14-day window client-side only
  // for the chart, without touching the main fetch/cache path used by the rest of the page.
  const chartRange = useMemo(() => {
    if (period === 'daily') {
      const to = selectedDate
      const from = dayjs(selectedDate).subtract(13, 'day').format('YYYY-MM-DD')
      return { from, to, unit: 'day' as BucketUnit }
    }
    if (period === 'monthly') return { from: range.from, to: range.to, unit: 'day' as BucketUnit }
    return { from: range.from, to: range.to, unit: 'month' as BucketUnit }
  }, [period, selectedDate, range.from, range.to])

  const [dailyChartItems, setDailyChartItems] = useState<InventoryLineItem[]>([])
  const [dailyChartLoading, setDailyChartLoading] = useState(true)

  useEffect(() => {
    if (period !== 'daily') return
    let cancelled = false
    setDailyChartLoading(true)
    inventoryApi.getByDate(chartRange.from, chartRange.to)
      .then((res) => { if (!cancelled) setDailyChartItems(res.data?.items ?? []) })
      .catch(() => { if (!cancelled) setDailyChartItems([]) })
      .finally(() => { if (!cancelled) setDailyChartLoading(false) })
    return () => { cancelled = true }
  }, [period, chartRange.from, chartRange.to, refreshKey])

  const chartItems = period === 'daily' ? dailyChartItems : inventoryItems
  const chartIsLoading = period === 'daily' ? dailyChartLoading : loading
  const currentBucketKey = chartRange.unit === 'month' ? dayjs(selectedDate).format('YYYY-MM') : dayjs(selectedDate).format('YYYY-MM-DD')

  const totals = useMemo(() => {
    const revenue = inventoryItems.reduce((s, item) => {
      const sp = resolveSellPrice(item, item.product)
      const opening = item.startQuantity ?? item.openingQuantity ?? 0
      const soldQty = item.sold ?? Math.max(opening - (item.currentQuantity ?? 0), 0)
      return s + soldQty * sp
    }, 0)
    const profit = inventoryItems.reduce((s, item) => {
      const sp = resolveSellPrice(item, item.product)
      const bp = resolveBuyPrice(item, item.product)
      const opening = item.startQuantity ?? item.openingQuantity ?? 0
      const soldQty = item.sold ?? Math.max(opening - (item.currentQuantity ?? 0), 0)
      return s + (item.realizedProfit ?? soldQty * (sp - bp))
    }, 0)
    const sold = inventoryItems.reduce((s, item) => {
      const opening = item.startQuantity ?? item.openingQuantity ?? 0
      return s + (item.sold ?? Math.max(opening - (item.currentQuantity ?? 0), 0))
    }, 0)
    return { revenue, profit, sold }
  }, [inventoryItems])

  const overallTotals = useMemo(() => {
    if (inventoryItems.length > 0) return computeTotals(inventoryItems)
    return null
  }, [inventoryItems])

  const margin = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : 0
  const allProductStats = useMemo(() => buildProductRankings(inventoryItems), [inventoryItems])
  const topProducts = useMemo(() => allProductStats.filter((p) => p.sold > 0).sort((a, b) => b.sold - a.sold || b.profit - a.profit), [allProductStats])
  const leastProducts = useMemo(() => [...allProductStats].sort((a, b) => a.sold - b.sold || a.profit - b.profit), [allProductStats])
  const maxLeastSold = useMemo(() => Math.max(...leastProducts.map((p) => p.sold), 1), [leastProducts])
  const allTimeTotals = useMemo(() => { if (!allTimeItems) return null; return computeTotals(allTimeItems) }, [allTimeItems])
  const allTimeBucketUnit: BucketUnit = useMemo(() => dayjs(allTimeTo).diff(dayjs(allTimeFrom), 'day') > 60 ? 'month' : 'day', [allTimeFrom, allTimeTo])

  const fetchAllTime = useCallback(async (from: string, to: string) => {
    setAllTimeLoading(true)
    setAllTimeError(false)
    try {
      const invRes = await inventoryApi.getByDate(from, to)
      setAllTimeItems(invRes.data?.items ?? [])
    } catch {
      setAllTimeItems(null)
      setAllTimeError(true)
    } finally { setAllTimeLoading(false) }
  }, [])

  const handleDownload = () => {
    if (!inventoryItems.length) return
    // Column order/format matches the paper/Excel ledger businesses already
    // keep (№, Tovar, Olingan/Sotilish narhi, Soni/Qoldi/Sotildi, then the
    // four money columns Olingan/Umumiy/Sotilgan/Qoldi summa, Foyda) — not
    // the app's own internal terminology, so an exported report drops
    // straight into the same layout a bar owner is already used to.
    const rows = [['№', 'Tovar', 'Olingan narhi', 'Sotilish narhi', 'Soni', 'Qoldi', 'Sotildi', 'Olingan summa', 'Umumiy summa', 'Sotilgan summa', 'Qoldi summasi', 'Foyda']]
    let totalSoni = 0, totalQoldi = 0, totalSotildi = 0
    let totalOlinganSumma = 0, totalUmumiySumma = 0, totalSotilganSumma = 0, totalQoldiSumma = 0, totalFoyda = 0
    let idx = 0
    for (const item of inventoryItems) {
      idx += 1
      const p = item.product
      const name = p?.name || 'Noma\'lum'
      const buy = resolveBuyPrice(item, p)
      const sell = resolveSellPrice(item, p)
      const opening = item.startQuantity ?? item.openingQuantity ?? 0
      const remaining = Math.max(item.currentQuantity ?? 0, 0)
      const sold = item.sold ?? Math.max(opening - remaining, 0)
      const olinganSumma = opening * buy
      const umumiySumma = opening * sell
      const sotilganSumma = (item as { revenue?: number }).revenue ?? sold * sell
      const qoldiSumma = remaining * sell
      const foyda = (sell - buy) * opening
      rows.push([
        String(idx), name, String(buy), String(sell), String(opening), String(remaining), String(sold),
        String(olinganSumma), String(umumiySumma), String(sotilganSumma), String(qoldiSumma), String(foyda),
      ])
      totalSoni += opening
      totalQoldi += remaining
      totalSotildi += sold
      totalOlinganSumma += olinganSumma
      totalUmumiySumma += umumiySumma
      totalSotilganSumma += sotilganSumma
      totalQoldiSumma += qoldiSumma
      totalFoyda += foyda
    }
    rows.push([
      '', 'Jami', '', '', String(totalSoni), String(totalQoldi), String(totalSotildi),
      String(totalOlinganSumma), String(totalUmumiySumma), String(totalSotilganSumma), String(totalQoldiSumma), String(totalFoyda),
    ])

    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hisobot-${range.from}-${range.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOpenAllTime = useCallback(async () => {
    setShowAllTime(true)
    const from = dayjs(getBusinessDate()).subtract(5, 'year').format('YYYY-MM-DD')
    const to = getBusinessDate()
    setAllTimeFrom(from); setAllTimeTo(to)
    await fetchAllTime(from, to)
  }, [fetchAllTime])

  function renderRankItem(item: ProductRankItem, index: number, isBlacklist: boolean, maxSold = 1) {
    const unsold = item.sold <= 0
    const ratio = item.sold > 0 ? Math.min(item.sold / maxSold, 1) : 0
    return (
      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0' }}>
        <div style={{
          width: 30, height: 30, borderRadius: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: isBlacklist ? 'rgba(239,68,68,0.13)' : index < 3 ? 'var(--color-primary)' : 'var(--color-border)',
          color: (isBlacklist || index < 3) ? '#fff' : 'var(--color-text-secondary)',
          fontSize: 12, fontWeight: 700,
        }}>{index + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0, color: item.profit < 0 ? 'var(--color-danger)' : item.sold <= 0 ? 'var(--color-text-tertiary)' : isBlacklist ? 'var(--color-warning)' : 'var(--color-primary)' }}>
              {formatMoney(item.profit)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 12, color: unsold ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}>
              {unsold ? t('notSoldInPeriod') : `${item.sold} dona`}
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--color-border)', marginTop: 6, overflow: 'hidden' }}>
            <div style={{
              width: `${ratio * 100}%`, height: '100%', borderRadius: 2, minHeight: ratio > 0 ? 2 : 0,
              background: isBlacklist ? 'var(--color-danger)' : 'var(--color-metric-qty)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>{periodLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleDownload} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 10,
            border: '1px solid var(--color-border)', background: 'var(--color-surface)',
            color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s', whiteSpace: 'nowrap',
          }}><Download size={16} />{t('downloadStatistics')}</button>
          <button onClick={handleOpenAllTime} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 10,
            border: 'none', background: 'var(--color-primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            transition: 'opacity 0.15s', whiteSpace: 'nowrap',
          }}><CalendarClock size={16} />{t('allTimeStatistics')}</button>
        </div>
      </div>

      {/* Section A — "Bu davr" (this period, realized/actual only) */}
      <div style={{ ...SECTION_LABEL, marginBottom: 8 }}><Wallet size={13} /> {t('statsThisPeriod')}</div>

      {/* Period tabs + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', background: 'var(--color-surface)', borderRadius: 12, padding: 3, border: '1px solid var(--color-border)' }}>
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              flex: 1, minWidth: 0, padding: '9px 4px', border: 'none', borderRadius: 9,
              background: period === p ? 'var(--color-primary)' : 'transparent',
              color: period === p ? '#fff' : 'var(--color-text-secondary)',
              fontWeight: period === p ? 700 : 600, fontSize: 12, cursor: 'pointer',
              transition: 'all 0.2s', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{t(p)}</button>
          ))}
        </div>
        <button onClick={fetchData} style={{
          width: 42, height: 42, borderRadius: 12, border: '1px solid var(--color-border)',
          background: 'var(--color-surface)', color: 'var(--color-text)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s', flexShrink: 0,
        }}>
          <RefreshCw size={17} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Date nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        marginBottom: 16, padding: '10px 12px',
        background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', borderRadius: 14,
      }}>
        <button onClick={() => setSelectedDate((d) => navigateDate(period, d, -1))} style={navBtn}><ChevronLeft size={18} /></button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{periodLabel}</div>
          {range.from !== range.to && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
              {dayjs(range.from).format('DD.MM')} - {dayjs(range.to).format('DD.MM.YYYY')}
            </div>
          )}
        </div>
        <button onClick={() => setSelectedDate((d) => navigateDate(period, d, 1))} style={navBtn}><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <StatsSkeleton />
      ) : loadError ? (
        <ErrorBanner onRetry={fetchData} />
      ) : (
        <>
          {/* Hero */}
          <div style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 55%, #4c1d95 100%)',
            borderRadius: 18, padding: '24px 26px', marginBottom: 14, position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: -50, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
            <div style={{ position: 'absolute', bottom: -70, left: 80, width: 170, height: 170, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: 1 }}>
              <Wallet size={15} /> {t('totalRevenue')}
            </div>
            <div style={{ position: 'relative', fontSize: 'clamp(22px, 7vw, 34px)', fontWeight: 800, color: '#fff', marginTop: 8, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15, overflowWrap: 'anywhere' }}>
              {formatMoney(totals.revenue)}
            </div>
            <div style={{ position: 'relative', display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={heroChip}>{t('soldPieces')}: {totals.sold}</span>
              <span style={heroChip}>{t('marginPercent')}: {margin}%</span>
            </div>
          </div>

          {/* Trend chart — single metric at a time, segmented control, current bucket emphasized */}
          <TrendChart
            items={chartItems}
            bucketUnit={chartRange.unit}
            rangeFrom={chartRange.from}
            rangeTo={chartRange.to}
            currentKey={currentBucketKey}
            loading={chartIsLoading}
          />

          {/* KPI cards — realized numbers only, solid-filled cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { icon: <TrendingUp size={18} />, label: t('netProfit'), value: formatMoney(totals.profit), color: 'var(--color-metric-profit)', soft: 'var(--color-metric-profit-soft)' },
              { icon: <ShoppingCart size={18} />, label: t('soldPieces'), value: String(totals.sold), color: 'var(--color-metric-qty)', soft: 'var(--color-metric-qty-soft)' },
              { icon: <Percent size={18} />, label: t('marginPercent'), value: `${margin}%`, color: 'var(--color-violet)', soft: 'rgba(139,92,246,0.14)' },
            ].map((item, i) => (
              <div key={i} style={kpiCard}>
                <div style={{ ...kpiIcon, background: item.soft, color: item.color }}>{item.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 800, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3 }}>{item.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Section B ("Ombordagi holat") was removed per feedback — its 3
              numbers (remaining pieces/value, potential profit) are now
              fully covered by the "To'liq statistika" full-breakdown card
              below, so it was pure duplication. */}

          {/* Full breakdown — all 8 numbers together in one sequential card,
              in addition to the KPI row / Section B split above. Reuses the
              same (now-fixed) overallTotals values, so this is purely an
              additive presentation, not a second data source. */}
          {overallTotals && (
            <>
              <div style={{ marginBottom: 8 }}>
                <div style={SECTION_LABEL}><BarChart3 size={13} /> {t('statsFullBreakdown')}</div>
                <p style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', margin: '3px 0 0' }}>{t('statsFullBreakdownSubtitle')}</p>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20,
                padding: 14, borderRadius: 14, border: '1px solid var(--color-border)', background: 'var(--color-surface)',
              }}>
                {[
                  { label: t('totalSellablePieces'), value: String(overallTotals.sellableItems) },
                  { label: t('soldPieces'), value: String(overallTotals.soldItems) },
                  { label: t('totalSellValue'), value: formatMoney(overallTotals.sellableValue) },
                  { label: t('soldValue'), value: formatMoney(overallTotals.earnedRevenue) },
                  { label: t('potentialProfit'), value: formatMoney(overallTotals.possibleProfit), color: 'var(--color-metric-profit)' },
                  { label: t('earnedProfit'), value: formatMoney(overallTotals.earnedProfit), color: 'var(--color-metric-profit)' },
                  { label: t('remainingPieces'), value: String(overallTotals.remainingItems) },
                  { label: t('remainingStockValue'), value: formatMoney(overallTotals.stockValue) },
                ].map((item, i) => (
                  <div key={i}>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 4px' }}>{item.label}</p>
                    <p style={{
                      fontSize: 'clamp(13px, 3.5vw, 15px)', fontWeight: 700, margin: 0,
                      color: item.color ?? 'var(--color-text)', fontVariantNumeric: 'tabular-nums',
                    }}>{item.value}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Section C — Rankings */}
          <div style={{ marginBottom: 8 }}>
            <div style={SECTION_LABEL}><Trophy size={13} /> {t('statsRankings')}</div>
          </div>

          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TrendingUp size={18} color="var(--color-success)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('topProductsLabel')}</h3>
            </div>
            {topProducts.length > 0 ? topProducts.slice(0, 5).map((item, i) => renderRankItem(item, i, false, topProducts[0]?.sold)) : <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '12px 0', margin: 0 }}>{t('noProductsPeriod')}</p>}
          </div>

          {leastProducts.length > 0 && (
            <div style={{ ...CARD, borderColor: 'rgba(239,68,68,0.33)', background: 'rgba(239,68,68,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <TrendingDown size={18} color="var(--color-danger)" />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('leastSold')}</h3>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: -8, marginBottom: 12 }}>{t('blackListSubtitle')}</p>
              {leastProducts.slice(0, 5).map((item, i) => renderRankItem(item, i, true, maxLeastSold))}
            </div>
          )}
        </>
      )}

      {showAllTime && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowAllTime(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 480, background: 'var(--color-surface)', borderRadius: 16,
            border: '1px solid var(--color-border)', maxHeight: '90vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t('allTimeStatisticsTitle')}</h3>
              <button onClick={() => setShowAllTime(false)} style={{
                width: 32, height: 32, borderRadius: 8, border: 'none',
                background: 'transparent', color: 'var(--color-text-secondary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: 20, flexWrap: 'wrap' }}>
              <RangeDateButton label={t('rangeFrom')} value={allTimeFrom} onChange={setAllTimeFrom} />
              <RangeDateButton label={t('rangeTo')} value={allTimeTo} onChange={setAllTimeTo} />
            </div>
            <button onClick={() => fetchAllTime(allTimeFrom, allTimeTo)} disabled={allTimeLoading} style={{
              display: 'block', margin: '0 20px 12px', padding: '12px 0', borderRadius: 8, border: 'none',
              background: 'var(--color-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: allTimeLoading ? 'not-allowed' : 'pointer', width: 'calc(100% - 40px)',
            }}>{allTimeLoading ? t('loading_data') : t('applyRange')}</button>
            {allTimeLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div style={{ width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : allTimeError ? (
              <div style={{ padding: '0 20px 20px' }}>
                <ErrorBanner onRetry={() => fetchAllTime(allTimeFrom, allTimeTo)} />
              </div>
            ) : allTimeTotals ? (
              <div style={{ padding: '0 20px 20px' }}>
                <TrendChart
                  items={allTimeItems ?? []}
                  bucketUnit={allTimeBucketUnit}
                  rangeFrom={allTimeFrom}
                  rangeTo={allTimeTo}
                  loading={false}
                  compact
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 14 }}>
                  {[
                    { label: t('totalSellablePieces'), value: allTimeTotals.sellableItems },
                    { label: t('soldPieces'), value: allTimeTotals.soldItems },
                    { label: t('totalSellValue'), value: formatMoney(allTimeTotals.sellableValue) },
                    { label: t('soldValue'), value: formatMoney(allTimeTotals.earnedRevenue) },
                    { label: t('potentialProfit'), value: formatMoney(allTimeTotals.possibleProfit), highlight: true },
                    { label: t('earnedProfit'), value: formatMoney(allTimeTotals.earnedProfit), highlight: true },
                    { label: t('remainingPieces'), value: allTimeTotals.remainingItems },
                    { label: t('remainingStockValue'), value: formatMoney(allTimeTotals.stockValue) },
                  ].map((item, i) => (
                    <div key={i} style={{ width: '50%', marginBottom: 12 }}>
                      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, marginBottom: 1 }}>{item.label}</p>
                      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums', ...(item.highlight ? { color: 'var(--color-primary)' } : {}) } as React.CSSProperties}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{t('noData')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
