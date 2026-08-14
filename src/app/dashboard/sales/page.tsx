'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAppStore } from '@/lib/appStore'
import { inventoryApi, resolveImageUrl, clearApiCache } from '@/lib/api'
import { getBusinessDate } from '@/lib/businessDay'
import { resolveSellPrice } from '@/lib/inventory'
import { formatMoney, kpiCard, kpiIcon } from '@/lib/sharedStyles'
import { Minus, Plus, Package, Scan, Search, ShoppingBag, ShoppingCart, Trash2, Wallet, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal'
import { ErrorBanner } from '@/components/StatusViews'
import type { InventoryItem, Product } from '@/lib/types'

// Shaped pulse-block skeleton matching this screen's actual layout (search bar
// + hint strip + a handful of product/cart cards), following the same
// page-local skeleton convention as InventorySkeleton in
// dashboard/inventory/page.tsx, instead of the old bare spinner.
function SalesSkeleton() {
  const block = (h: number, style?: React.CSSProperties): React.CSSProperties => ({
    height: h, borderRadius: 10, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    animation: 'pulse 1.4s ease-in-out infinite', ...style,
  })
  return (
    <div>
      <div style={block(42, { marginBottom: 16 })} />
      <div style={block(36, { marginBottom: 16 })} />
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={block(90, { marginBottom: 10, animationDelay: `${i * 0.06}s` })} />
      ))}
    </div>
  )
}

export default function SalesPage() {
  const { products, refreshAll, showToast } = useAppStore()

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])

  // Plain fetch — used both by the initial load and to silently refresh
  // stock right after a completed sale. Throws on failure; callers decide
  // how to surface that (fetchInitial below shows the persistent
  // ErrorBanner, the post-sale refresh in handleConfirmSale is best-effort).
  const loadInventory = useCallback(async () => {
    const today = getBusinessDate()
    const { data } = await inventoryApi.getByDate(today, today)
    setInventoryItems(data?.items ?? [])
  }, [])

  // Initial page load — genuine fetch failure now surfaces the shared,
  // persistent ErrorBanner + retry (same pattern as dashboard/page.tsx and
  // dashboard/inventory/page.tsx) instead of a transient auto-clearing error
  // line with no way to retry.
  const fetchInitial = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      await loadInventory()
    } catch (err) {
      console.error('Load inventory error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [loadInventory])

  useEffect(() => {
    fetchInitial()
  }, [fetchInitial])

  const productMap = useMemo(() => {
    const map: Record<string, Product> = {}
    for (const p of products) {
      map[p._id] = p
    }
    return map
  }, [products])

  const sellableItems = useMemo(() => {
    return inventoryItems
      .filter(item => item.currentQuantity > 0)
      .map(item => ({
        ...item,
        product: item.product || productMap[item.productId],
      }))
      .filter(item => {
        if (!search) return true
        const name = item.product?.name || ''
        return name.toLowerCase().includes(search.toLowerCase())
      })
  }, [inventoryItems, productMap, search])

  const cartArray = useMemo(() => {
    return Object.entries(cart)
      .filter(([_, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const item = inventoryItems.find(i => i.productId === productId)
        const product = item?.product || productMap[productId]
        return { productId, quantity, product: product as Product | undefined, item }
      })
  }, [cart, inventoryItems, productMap])

  const totalRevenue = useMemo(() => {
    return cartArray.reduce((sum, { quantity, product, item }) => {
      const price = resolveSellPrice(item || {}, product)
      return sum + quantity * price
    }, 0)
  }, [cartArray])

  const totalPieces = useMemo(() => {
    return cartArray.reduce((sum, { quantity }) => sum + quantity, 0)
  }, [cartArray])

  const handleAdd = useCallback((productId: string, max: number) => {
    setCart(prev => {
      const current = prev[productId] || 0
      if (current >= max) {
        // Real-bug fix: tapping + at the stock limit used to just silently
        // no-op (the button also disables, but a cashier tapping fast can
        // easily miss that a second tap did nothing). Now it always gives
        // explicit feedback via the shared toast.
        showToast(t('maxStockReached'), 'error')
        return prev
      }
      return { ...prev, [productId]: current + 1 }
    })
  }, [showToast])

  const handleRemove = useCallback((productId: string) => {
    setCart(prev => {
      const current = prev[productId] || 0
      if (current <= 1) {
        const { [productId]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [productId]: current - 1 }
    })
  }, [])

  const clearCart = useCallback(() => {
    setCart({})
  }, [])

  // One-tap reset of a single cart line to 0 — avoids repeatedly tapping "-"
  // down to zero to undo an over-added line.
  const clearLine = useCallback((productId: string) => {
    setCart(prev => {
      const { [productId]: _, ...rest } = prev
      return rest
    })
  }, [])

  const addBarcodeProduct = useCallback((code: string): string | null => {
    const trimmed = code.trim()
    if (!trimmed) return null

    const product = products.find(p => p.barcodes?.includes(trimmed))
    if (!product) return t('barcodeNotFound') || 'Barcode bo\'yicha mahsulot topilmadi'

    const invItem = inventoryItems.find(i => i.productId === product._id)
    if (!invItem || invItem.currentQuantity <= 0) return t('noStock')

    const inCart = cart[product._id] || 0
    if (inCart >= invItem.currentQuantity) return t('maxStockReached')

    setCart(prev => {
      const current = prev[product._id] || 0
      if (current >= invItem.currentQuantity) return prev
      return { ...prev, [product._id]: current + 1 }
    })
    return null
  }, [products, inventoryItems, cart])

  const handleBarcodeSubmit = useCallback(() => {
    const err = addBarcodeProduct(barcodeInput)
    if (err) {
      setBarcodeError(err)
      return
    }
    setBarcodeInput('')
    setBarcodeError('')
    setShowBarcode(false)
  }, [addBarcodeProduct, barcodeInput])

  const handleConfirmSale = useCallback(async () => {
    if (totalPieces === 0 || submitting) return
    setSubmitting(true)
    try {
      const lines = cartArray.map(({ productId, quantity }) => ({
        productId,
        quantity,
      }))
      const today = getBusinessDate()
      await inventoryApi.recordSales(today, lines)
      clearApiCache()
      await loadInventory()
      await refreshAll()
      setCart({})
      setSuccess(t('salesSuccess'))
      setError(null)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Record sale error:', err)
      setSuccess(null)
      setError(t('error') || 'Xatolik yuz berdi')
      setTimeout(() => setError(null), 3000)
    } finally {
      setSubmitting(false)
    }
  }, [cartArray, totalPieces, submitting, loadInventory, refreshAll])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SalesSkeleton />
      </div>
    )
  }

  const showEmptyNoStock = sellableItems.length === 0 && !search
  const showEmptyNotFound = sellableItems.length === 0 && search

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 8,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}>
          <Search size={18} style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder={t('searchProducts')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              background: 'none',
              outline: 'none',
              color: 'var(--color-text)',
              fontSize: 14,
              fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                padding: 2,
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <p style={{
        fontSize: 13,
        color: 'var(--color-text-secondary)',
        marginBottom: 16,
        padding: '8px 12px',
        borderRadius: 6,
        background: 'var(--color-primary-soft)',
        border: '1px solid var(--color-border)',
      }}>
        {t('salesHint')}
      </p>

      {/* Genuine page-load failure — persistent banner with retry, replacing
          the old transient auto-clearing error text with no way to recover
          short of a full page reload. */}
      {loadError && <ErrorBanner onRetry={fetchInitial} />}

      {success && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 6,
          background: 'rgba(34,197,94,0.1)',
          color: 'var(--color-success)',
          fontSize: 13,
          marginBottom: 16,
        }}>
          {success}
        </div>
      )}

      {/* Genuine post-checkout failure — a one-off action error, kept as the
          existing transient inline banner (distinct from the persistent
          ErrorBanner above, which is for the page failing to load at all). */}
      {error && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 6,
          background: 'rgba(239,68,68,0.1)',
          color: 'var(--color-danger)',
          fontSize: 13,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', marginBottom: 16 }}>
        {showEmptyNoStock || showEmptyNotFound ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 48,
            color: 'var(--color-text-secondary)',
          }}>
            <ShoppingBag size={48} style={{ opacity: 0.4, marginBottom: 12 }} />
            <p style={{ fontSize: 14 }}>
              {showEmptyNotFound ? t('noProductsFound') : t('noStock')}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sellableItems.map(item => {
              const product = item.product as Product | undefined
              const cartQty = cart[item.productId] || 0
              const isActive = cartQty > 0
              const price = resolveSellPrice(item, product)

              return (
                <div
                  key={item.productId}
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: isActive ? 'var(--color-primary-soft)' : 'var(--color-surface)',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: 10,
                      background: 'var(--color-bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      overflow: 'hidden',
                    }}>
                      {(product?.image || product?.imageHash) ? (
                        <img
                          src={resolveImageUrl(product.image, product.imageHash)}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <Package size={22} style={{ color: 'var(--color-text-secondary)', opacity: 0.5 }} />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'var(--color-text)',
                        marginBottom: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {product?.name || 'N/A'}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {t('sellPrice')}: {formatMoney(price)}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                        {t('remaining')}: {item.currentQuantity}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() => handleRemove(item.productId)}
                        disabled={cartQty === 0}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 38,
                          height: 38,
                          borderRadius: 9,
                          border: `1px solid ${cartQty > 0 ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: cartQty > 0 ? 'var(--color-primary-soft)' : 'transparent',
                          color: cartQty > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          cursor: cartQty === 0 ? 'not-allowed' : 'pointer',
                          opacity: cartQty === 0 ? 0.5 : 1,
                        }}
                      >
                        <Minus size={18} />
                      </button>
                      <span style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        minWidth: 28,
                        textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {cartQty}
                      </span>
                      {/* No `disabled` attribute here (unlike "-" above): a
                          disabled HTML button never fires onClick, so the
                          "at max stock" toast inside handleAdd could never
                          show. The hard block still lives in handleAdd's own
                          `current >= max` check — this is purely additive
                          feedback, not a new gate. Visual dimming stays via
                          cursor/opacity so it still reads as disabled. */}
                      <button
                        onClick={() => handleAdd(item.productId, item.currentQuantity)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 38,
                          height: 38,
                          borderRadius: 9,
                          border: `1px solid ${cartQty < item.currentQuantity ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: cartQty < item.currentQuantity ? 'var(--color-primary-soft)' : 'transparent',
                          color: cartQty < item.currentQuantity ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          cursor: cartQty >= item.currentQuantity ? 'not-allowed' : 'pointer',
                          opacity: cartQty >= item.currentQuantity ? 0.5 : 1,
                        }}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>

                  {isActive && (
                    <div style={{
                      padding: '6px 10px 6px 14px',
                      borderTop: '1px solid var(--color-border)',
                      background: 'var(--color-primary-soft)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 13,
                      color: 'var(--color-primary)',
                      fontWeight: 500,
                    }}>
                      <span>{t('saleTotal')}:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{formatMoney(cartQty * price)}</span>
                        {/* One-tap line reset — avoids tapping "-" repeatedly
                            down to zero to undo an over-added line. */}
                        <button
                          onClick={() => clearLine(item.productId)}
                          title={t('clearLine')}
                          aria-label={t('clearLine')}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 26,
                            height: 26,
                            borderRadius: 7,
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showBarcode && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 16,
        }}>
          <div style={{
            width: '100%',
            maxWidth: 360,
            padding: 24,
            borderRadius: 12,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxSizing: 'border-box',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--color-text)' }}>
              {t('barcode')}ni kiriting
            </h3>
            <input
              type="text"
              autoFocus
              placeholder={t('barcode')}
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleBarcodeSubmit() }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: 16,
                fontFamily: 'monospace',
                outline: 'none',
                marginBottom: 16,
                boxSizing: 'border-box',
              }}
            />
            {barcodeError && (
              <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: '-8px 0 12px' }}>
                {barcodeError}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleBarcodeSubmit}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('confirm')}
              </button>
              <button
                onClick={() => { setShowBarcode(false); setBarcodeInput('') }}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera Barcode Scanner — autoConfirm: every valid scan is applied
          immediately (no "tap to accept" step) so the cashier can scan a
          whole basket in one continuous pass; a barcode with no matching
          product is rejected inline (red flash) and never added. */}
      <BarcodeScannerModal
        open={showBarcodeScanner}
        onClose={() => setShowBarcodeScanner(false)}
        onBarcodeDetected={(code) => addBarcodeProduct(code)}
        onManualInput={() => { setShowBarcodeScanner(false); setShowBarcode(true); setBarcodeError('') }}
        autoConfirm
        cartCount={totalPieces}
      />

      <div style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        borderRadius: '12px 12px 0 0',
        padding: '12px 16px',
      }}>
        {/* Running-total KPI chips — same kpiCard/kpiIcon primitive and
            --color-metric-revenue/qty identity colors already established by
            the Statistics/Inventory redesign, instead of the old plain-text
            pairs that sat visually quieter than the buttons below them
            despite being the most important thing to see mid-sale. */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <div style={{ ...kpiCard, flex: 1.4, padding: 12, gap: 10 }}>
            <div style={{ ...kpiIcon, width: 34, height: 34, background: 'var(--color-metric-revenue-soft)', color: 'var(--color-metric-revenue)' }}>
              <Wallet size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('saleTotal')}</div>
              <div style={{
                fontSize: 19,
                fontWeight: 800,
                color: 'var(--color-metric-revenue)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: -0.3,
                overflowWrap: 'anywhere',
              }}>
                {formatMoney(totalRevenue)}
              </div>
            </div>
          </div>
          <div style={{ ...kpiCard, flex: 1, padding: 12, gap: 10 }}>
            <div style={{ ...kpiIcon, width: 34, height: 34, background: 'var(--color-metric-qty-soft)', color: 'var(--color-metric-qty)' }}>
              <ShoppingCart size={17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('soldPieces')}</div>
              <div style={{
                fontSize: 19,
                fontWeight: 800,
                color: 'var(--color-metric-qty)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {totalPieces}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={clearCart}
            disabled={totalPieces === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text)',
              fontSize: 13,
              cursor: totalPieces === 0 ? 'not-allowed' : 'pointer',
              opacity: totalPieces === 0 ? 0.5 : 1,
              flex: 1,
            }}
          >
            <X size={16} />
            {t('cancel')}
          </button>
          <button
            onClick={() => { setShowBarcodeScanner(true); setError(null) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text)',
              fontSize: 13,
              cursor: 'pointer',
              flex: 1,
            }}
          >
            <Scan size={16} />
            {t('barcode')}
          </button>
          <button
            onClick={handleConfirmSale}
            disabled={totalPieces === 0 || submitting}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 8,
              border: 'none',
              background: totalPieces === 0 || submitting ? 'var(--color-border)' : 'var(--color-primary)',
              color: totalPieces === 0 || submitting ? 'var(--color-text-secondary)' : '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: totalPieces === 0 || submitting ? 'not-allowed' : 'pointer',
              flex: 1.5,
            }}
          >
            {submitting ? t('loading') : t('confirmSale')}
          </button>
        </div>
      </div>
    </div>
  )
}
