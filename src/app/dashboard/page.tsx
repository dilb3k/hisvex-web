'use client'

import { useEffect, useState, useMemo, useCallback, forwardRef } from 'react'
import { inventoryApi } from '@/lib/api'
import { useAppStore } from '@/lib/appStore'
import dayjs from 'dayjs'
import { Download, CalendarClock, RefreshCw, TrendingUp, TrendingDown, X, ChevronLeft, ChevronRight } from 'lucide-react'
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

function buildProductRankings(inventoryItems: any[]): ProductRankItem[] {
  const seen = new Map<string, { sold: number; profit: number; name: string }>()
  for (const item of inventoryItems) {
    const p = item.product
    if (!p) continue
    const id = p._id || p.id
    if (!id) continue
    const cur = seen.get(id) ?? { sold: 0, profit: 0, name: p.name || 'Noma\'lum' }
    cur.sold += item.sold ?? 0
    cur.profit += item.realizedProfit ?? 0
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

function computeTotals(items: any[]) {
  let sold = 0, revenue = 0, profit = 0, remaining = 0
  for (const item of items) {
    const qty = item.currentQuantity ?? 0
    const p = item.product
    const sellPrice = item.sellPrice ?? p?.sellingPrice ?? 0
    const buyPrice = item.buyPrice ?? p?.costPrice ?? 0
    const soldQty = item.sold ?? 0
    sold += soldQty
    revenue += soldQty * sellPrice
    profit += item.realizedProfit ?? (soldQty * (sellPrice - buyPrice))
    remaining += Math.max(qty, 0)
  }
  const stockSellValue = items.reduce((s, item) => {
    const qty = item.currentQuantity ?? 0
    const p = item.product
    const sellPrice = item.sellPrice ?? p?.sellingPrice ?? 0
    return s + Math.max(qty, 0) * sellPrice
  }, 0)
  const stockProfit = items.reduce((s, item) => {
    const qty = item.currentQuantity ?? 0
    const p = item.product
    const sellPrice = item.sellPrice ?? p?.sellingPrice ?? 0
    const buyPrice = item.buyPrice ?? p?.costPrice ?? 0
    return s + Math.max(qty, 0) * (sellPrice - buyPrice)
  }, 0)
  return {
    sellableItems: sold + remaining, soldItems: sold, sellableValue: revenue + stockSellValue,
    earnedRevenue: revenue, possibleProfit: profit + stockProfit, earnedProfit: profit,
    remainingItems: remaining, stockValue: stockSellValue,
  }
}

export default function StatisticsPage() {
  const [period, setPeriod] = useState<Period>('daily')
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [inventoryItems, setInventoryItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAllTime, setShowAllTime] = useState(false)
  const [allTimeFrom, setAllTimeFrom] = useState(dayjs().subtract(1, 'year').format('YYYY-MM-DD'))
  const [allTimeTo, setAllTimeTo] = useState(dayjs().format('YYYY-MM-DD'))
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
      const sellPrice = item.sellPrice ?? item.product?.sellingPrice ?? 0
      return s + (item.sold ?? 0) * sellPrice
    }, 0)
    const profit = inventoryItems.reduce((s, item) => s + (item.realizedProfit ?? 0), 0)
    const sold = inventoryItems.reduce((s, item) => s + (item.sold ?? 0), 0)
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
      const buy = item.buyPrice ?? p?.buyPrice ?? 0
      const sell = item.sellPrice ?? p?.sellPrice ?? 0
      const sold = item.sold ?? 0
      const revenue = item.revenue ?? sold * sell
      const profit = item.realizedProfit ?? sold * (sell - buy)
      rows.push([name, String(buy), String(sell), String(sold), String(revenue), String(profit)])
    }
    const totals = computeTotals(inventoryItems)
    rows.push(['Jami', '', '', String(totals.soldItems), String(totals.earnedRevenue), String(totals.earnedProfit)])

    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
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
    const from = dayjs().subtract(5, 'year').format('YYYY-MM-DD')
    const to = dayjs().format('YYYY-MM-DD')
    setAllTimeFrom(from); setAllTimeTo(to)
    await fetchAllTime(from, to)
  }, [fetchAllTime])

  function renderRankItem(item: ProductRankItem, index: number, isBlacklist: boolean) {
    const unsold = item.sold <= 0
    return (
      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{
          width: 28, height: 28, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: isBlacklist ? 'rgba(239,68,68,0.13)' : index < 3 ? 'var(--color-primary)' : 'var(--color-border)',
          color: (isBlacklist || index < 3) ? '#fff' : 'var(--color-text-secondary)',
          fontSize: 12, fontWeight: 700,
        }}>{index + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 12, color: unsold ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}>
              {unsold ? t('notSoldInPeriod') : `${item.sold} dona`}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: item.profit < 0 ? 'var(--color-danger)' : item.sold <= 0 ? 'var(--color-text-tertiary)' : isBlacklist ? 'var(--color-warning)' : 'var(--color-primary)' }}>
              {formatMoney(item.profit)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', background: 'var(--color-primary)', borderRadius: 12, padding: 3 }}>
            {PERIODS.map((p) => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                flex: 1, padding: '8px 0', border: 'none', borderRadius: 10,
                background: period === p ? 'rgba(255,255,255,0.2)' : 'transparent',
                color: period === p ? '#fff' : 'rgba(255,255,255,0.7)',
                fontWeight: period === p ? 700 : 600, fontSize: 13, cursor: 'pointer',
                transition: 'all 0.2s',
              }}>{t(p)}</button>
            ))}
          </div>
        </div>
        <button onClick={fetchData} style={{
          width: 38, height: 38, borderRadius: 19, border: 'none',
          background: 'var(--color-primary)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s',
        }}>
          <RefreshCw size={18} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        marginBottom: 12, padding: '8px 12px',
        background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', borderRadius: 12,
      }}>
        <button onClick={() => setSelectedDate((d) => navigateDate(period, d, -1))} style={{
          width: 36, height: 36, borderRadius: 8, border: 'none',
          background: 'rgba(255,255,255,0.15)', color: '#fff',
          fontWeight: 700, fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.2s',
        }}><ChevronLeft size={18} /></button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{periodLabel}</div>
          {range.from !== range.to && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>
              {dayjs(range.from).format('DD.MM')} - {dayjs(range.to).format('DD.MM.YYYY')}
            </div>
          )}
        </div>
        <button onClick={() => setSelectedDate((d) => navigateDate(period, d, 1))} style={{
          width: 36, height: 36, borderRadius: 8, border: 'none',
          background: 'rgba(255,255,255,0.15)', color: '#fff',
          fontWeight: 700, fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.2s',
        }}><ChevronRight size={18} /></button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button onClick={handleDownload} style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '10px 14px', borderRadius: 10, border: '1px solid var(--color-border)',
          background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}><Download size={16} />{t('downloadStatistics')}</button>
        <button onClick={handleOpenAllTime} style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '10px 14px', borderRadius: 10, border: '1px solid var(--color-border)',
          background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}><CalendarClock size={16} />{t('allTimeStatistics')}</button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 }}>
          <div style={{ width: 36, height: 36, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('loading_data')}</span>
        </div>
      ) : (
        <>
          <div style={CARD}>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, marginBottom: 2 }}>{t('totalRevenue')}</p>
            <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
              <p style={{ fontSize: 30, fontWeight: 800, margin: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>{formatMoney(totals.revenue)}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {[{ label: t('soldPieces'), value: totals.sold }, { label: t('netProfit'), value: formatMoney(totals.profit), highlight: true }, { label: t('marginPercent'), value: `${margin}%` }].map((item, i) => (
                <div key={i} style={{ width: '50%', marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, marginBottom: 2 }}>{item.label}</p>
                  <p style={{ fontSize: 18, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums', ...(item.highlight ? { color: 'var(--color-primary)' } : {}) } as any}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          {overallTotals && (
            <div style={CARD}>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>{periodLabel} - {t('totalRevenueLabel')}</p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
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
                  <div key={i} style={{ width: '50%', marginBottom: 16 }}>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, marginBottom: 2 }}>{item.label}</p>
                    <p style={{ fontSize: 18, fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums', ...(item.highlight ? { color: 'var(--color-primary)' } : {}) } as any}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={CARD}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TrendingUp size={18} color="var(--color-success)" />
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('topProductsLabel')}</h3>
            </div>
            {topProducts.length > 0 ? topProducts.slice(0, 5).map((item, i) => renderRankItem(item, i, false)) : <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '12px 0', margin: 0 }}>{t('noProductsPeriod')}</p>}
          </div>

          {leastProducts.length > 0 && (
            <div style={{ ...CARD, borderColor: 'rgba(239,68,68,0.33)', background: 'rgba(239,68,68,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <TrendingDown size={18} color="var(--color-danger)" />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t('leastSold')}</h3>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: -8, marginBottom: 12 }}>{t('blackListSubtitle')}</p>
              {leastProducts.slice(0, 5).map((item, i) => renderRankItem(item, i, true))}
            </div>
          )}
        </>
      )}

      {showAllTime && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowAllTime(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', maxWidth: 480, background: 'var(--color-surface)', borderRadius: 16,
            border: '1px solid var(--color-border)', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t('allTimeStatisticsTitle')}</h3>
              <button onClick={() => setShowAllTime(false)} style={{
                width: 32, height: 32, borderRadius: 8, border: 'none',
                background: 'transparent', color: 'var(--color-text-secondary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', gap: 10, padding: 20 }}>
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
