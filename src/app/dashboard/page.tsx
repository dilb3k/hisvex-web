'use client'

import { useEffect, useState, useMemo, useCallback, forwardRef } from 'react'
import { inventoryApi } from '@/lib/api'
import { useAppStore } from '@/lib/appStore'
import { getBusinessDate } from '@/lib/businessDay'
import { resolveSellPrice, resolveBuyPrice } from '@/lib/inventory'
import dayjs from 'dayjs'
import { Download, CalendarClock, RefreshCw, TrendingUp, TrendingDown, X, ChevronLeft, ChevronRight, Wallet, ShoppingCart, Percent, Package } from 'lucide-react'
import { t } from '@/lib/i18n'
import { formatMoney } from '@/lib/sharedStyles'

type Period = 'daily' | 'monthly' | 'yearly'

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

function buildProductRankings(inventoryItems: { sold?: number; realizedProfit?: number; startQuantity?: number; openingQuantity?: number; currentQuantity?: number; sellPrice?: number; price?: number; buyPrice?: number; product?: { _id?: string; id?: string; name?: string; sellPrice?: number; sellingPrice?: number; buyPrice?: number; costPrice?: number } }[]): ProductRankItem[] {
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

const CARD: React.CSSProperties = {
  padding: 24,
  borderRadius: 16,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  transition: 'all 0.2s',
}

const kpiCard: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: 14,
  padding: 16,
  border: '1px solid var(--color-border)',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
}

const kpiIcon: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
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

function computeTotals(items: { sellPrice?: number; buyPrice?: number; price?: number; currentQuantity?: number; startQuantity?: number; openingQuantity?: number; sold?: number; realizedProfit?: number; product?: { sellPrice?: number; sellingPrice?: number; buyPrice?: number; costPrice?: number } }[]) {
  let sold = 0, revenue = 0, profit = 0, remaining = 0
  for (const item of items) {
    const qty = item.currentQuantity ?? 0
    const sp = resolveSellPrice(item, item.product)
    const bp = resolveBuyPrice(item, item.product)
    const soldQty = item.sold ?? Math.max((item.startQuantity ?? item.openingQuantity ?? 0) - qty, 0)
    sold += soldQty
    revenue += soldQty * sp
    profit += item.realizedProfit ?? (soldQty * (sp - bp))
    remaining += Math.max(qty, 0)
  }
  const stockSellValue = items.reduce((s, item) => {
    const qty = item.currentQuantity ?? 0
    const sp = resolveSellPrice(item, item.product)
    return s + Math.max(qty, 0) * sp
  }, 0)
  const stockProfit = items.reduce((s, item) => {
    const qty = item.currentQuantity ?? 0
    const sp = resolveSellPrice(item, item.product)
    const bp = resolveBuyPrice(item, item.product)
    return s + Math.max(qty, 0) * (sp - bp)
  }, 0)
  return {
    sellableItems: sold + remaining, soldItems: sold, sellableValue: revenue + stockSellValue,
    earnedRevenue: revenue, possibleProfit: profit + stockProfit, earnedProfit: profit,
    remainingItems: remaining, stockValue: stockSellValue,
  }
}

export default function StatisticsPage() {
  const [period, setPeriod] = useState<Period>('daily')
  const [selectedDate, setSelectedDate] = useState(getBusinessDate)
  const [inventoryItems, setInventoryItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAllTime, setShowAllTime] = useState(false)
  const [allTimeFrom, setAllTimeFrom] = useState(() => dayjs(getBusinessDate()).subtract(1, 'year').format('YYYY-MM-DD'))
  const [allTimeTo, setAllTimeTo] = useState(getBusinessDate)
  const [allTimeItems, setAllTimeItems] = useState<any[] | null>(null)
  const [allTimeLoading, setAllTimeLoading] = useState(false)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const range = useMemo(() => getPeriodRange(period, selectedDate), [period, selectedDate])
  const periodLabel = useMemo(() => formatPeriodLabel(period, selectedDate), [period, selectedDate])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const invRes = await inventoryApi.getByDate(range.from, range.to)
      setInventoryItems(invRes.data?.items ?? [])
    } catch { setInventoryItems([]) }
    finally { setLoading(false) }
  }, [range.from, range.to, refreshKey])

  useEffect(() => { fetchData() }, [fetchData])

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

  const fetchAllTime = useCallback(async (from: string, to: string) => {
    setAllTimeLoading(true)
    try {
      const invRes = await inventoryApi.getByDate(from, to)
      setAllTimeItems(invRes.data?.items ?? [])
    } catch { setAllTimeItems(null) }
    finally { setAllTimeLoading(false) }
  }, [])

  const handleDownload = () => {
    if (!inventoryItems.length) return
    const rows = [['Mahsulot', 'Kelish', 'Sotish', 'Sotilgan', 'Tushum', 'Foyda']]
    for (const item of inventoryItems) {
      const p = item.product
      const name = p?.name || 'Noma\'lum'
      const buy = resolveBuyPrice(item, p)
      const sell = resolveSellPrice(item, p)
      const opening = item.startQuantity ?? item.openingQuantity ?? 0
      const sold = item.sold ?? Math.max(opening - (item.currentQuantity ?? 0), 0)
      const revenue = item.revenue ?? sold * sell
      const profit = item.realizedProfit ?? sold * (sell - buy)
      rows.push([name, String(buy), String(sell), String(sold), String(revenue), String(profit)])
    }
    const totals = computeTotals(inventoryItems)
    rows.push(['Jami', '', '', String(totals.soldItems), String(totals.earnedRevenue), String(totals.earnedProfit)])

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
              width: `${ratio * 100}%`, height: '100%', borderRadius: 2,
              background: isBlacklist ? 'var(--color-danger)' : 'var(--color-primary)',
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
          <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.3, color: 'var(--color-text)' }}>{t('statistics')}</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '2px 0 0' }}>{periodLabel}</p>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 }}>
          <div style={{ width: 36, height: 36, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('loading_data')}</span>
        </div>
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

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            {[
              { icon: <TrendingUp size={18} />, label: t('netProfit'), value: formatMoney(totals.profit), color: 'var(--color-primary)' },
              { icon: <ShoppingCart size={18} />, label: t('soldPieces'), value: String(totals.sold), color: 'var(--color-success)' },
              { icon: <Percent size={18} />, label: t('marginPercent'), value: `${margin}%`, color: '#8b5cf6' },
            ].map((item, i) => (
              <div key={i} style={kpiCard}>
                <div style={{ ...kpiIcon, background: `${item.color}1a`, color: item.color }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{item.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3 }}>{item.value}</div>
                </div>
              </div>
            ))}
          </div>

          {overallTotals && (
            <div style={CARD}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Package size={17} color="var(--color-primary)" />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{periodLabel} - {t('totalRevenueLabel')}</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                {[
                  { label: t('totalSellablePieces'), value: overallTotals.sellableItems },
                  { label: t('soldPieces'), value: overallTotals.soldItems },
                  { label: t('totalSellValue'), value: formatMoney(overallTotals.sellableValue) },
                  { label: t('soldValue'), value: formatMoney(overallTotals.earnedRevenue) },
                  { label: t('potentialProfit'), value: formatMoney(overallTotals.possibleProfit), highlight: true },
                  { label: t('earnedProfit'), value: formatMoney(overallTotals.earnedProfit), highlight: true },
                  { label: t('remainingPieces'), value: overallTotals.remainingItems },
                  { label: t('remainingStockValue'), value: formatMoney(overallTotals.stockValue) },
                ].map((item, i) => (
                  <div key={i} style={{ padding: 12, borderRadius: 10, background: 'rgba(127,127,127,0.06)', border: '1px solid var(--color-border)' }}>
                    <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: 0, marginBottom: 3 }}>{item.label}</p>
                    <p style={{ fontSize: 16, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums', ...(item.highlight ? { color: 'var(--color-primary)' } : { color: 'var(--color-text)' }) } as any}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TrendingUp size={18} color="var(--color-success)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('topProductsLabel')}</h3>
            </div>
            {topProducts.length > 0 ? topProducts.slice(0, 5).map((item, i) => renderRankItem(item, i, false, topProducts[0]?.sold)) : <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '12px 0', margin: 0 }}>{t('noProductsPeriod')}</p>}          </div>

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
              <div onClick={() => {}} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer' }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('rangeFrom')}</div>
                <input type="date" value={allTimeFrom} onChange={(e) => setAllTimeFrom(e.target.value)} style={{
                  fontSize: 14, fontWeight: 700, color: 'var(--color-text)', border: 'none', background: 'transparent', outline: 'none', width: '100%',
                }} />
              </div>
              <div onClick={() => {}} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer' }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{t('rangeTo')}</div>
                <input type="date" value={allTimeTo} onChange={(e) => setAllTimeTo(e.target.value)} style={{
                  fontSize: 14, fontWeight: 700, color: 'var(--color-text)', border: 'none', background: 'transparent', outline: 'none', width: '100%',
                }} />
              </div>
            </div>
            <button onClick={() => fetchAllTime(allTimeFrom, allTimeTo)} disabled={allTimeLoading} style={{
              display: 'block', margin: '0 20px 12px', padding: '12px 0', borderRadius: 8, border: 'none',
              background: 'var(--color-primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: allTimeLoading ? 'not-allowed' : 'pointer', width: 'calc(100% - 40px)',
            }}>{allTimeLoading ? t('loading_data') : t('applyRange')}</button>
            {allTimeLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <div style={{ width: 32, height: 32, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              </div>
            ) : allTimeTotals ? (
              <div style={{ padding: '0 20px 20px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
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
                      <p style={{ fontSize: 15, fontWeight: 700, margin: 0, ...(item.highlight ? { color: 'var(--color-primary)' } : {}) } as any}>{item.value}</p>
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
