'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useAppStore } from '@/lib/appStore'
import { inventoryApi, resolveImageUrl, clearApiCache } from '@/lib/api'
import { getBusinessDate } from '@/lib/businessDay'
import {
  compareProducts,
  resolveSellPrice,
  normalizeUnit,
  isWeighed,
  stepFor,
  roundQty,
  roundMoney,
  qtyGreaterThan,
  formatQuantity,
  formatQuantityValue,
  normalizeQuantityInput,
  parseQuantityInput,
} from '@/lib/inventory'
import { formatMoney, formatInputAmount, parseFormattedAmount, kpiCard, kpiIcon, overlay } from '@/lib/sharedStyles'
import { Check, Lock, Minus, Plus, Package, Scan, Search, ShoppingBag, ShoppingCart, Tag, Trash2, Wallet, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal'
import { ErrorBanner } from '@/components/StatusViews'
import { useEscapeToClose } from '@/lib/useEscapeKey'
import { useAuthStore } from '@/lib/authStore'
import { isBlockCodeDisabled } from '@/utils/blockCode'
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
  // Bumped by refreshAll() after any mutation anywhere in the app, so a sale
  // recorded here — or stock edited on Inventory/Products — reloads this
  // screen's stock immediately instead of leaving the previous quantities on
  // screen until the next manual reload.
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  // Per-line negotiated unit price. Absent = charge the list price; the key is
  // only ever written by an explicit edit, so clearing it restores the list
  // price without having to remember what it was.
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({})
  // Raw text of the price field while it's being typed, kept separate from the
  // committed numeric override so a half-typed "12" doesn't briefly become the
  // charged price.
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})
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

  // Per-line price change is gated behind the same PIN used to protect
  // deleting a product/debtor — a cashier quietly discounting a sale is at
  // least as sensitive as either of those. Mirrors dashboard/products'
  // pattern exactly (blockCode / blockDisabled / PIN modal state).
  const blockCode = useAuthStore((s) => s.user?.blockCode ?? null)
  const [blockDisabled, setBlockDisabledState] = useState(false)
  useEffect(() => { setBlockDisabledState(isBlockCodeDisabled()) }, [])
  const [showPinVerify, setShowPinVerify] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinVerifyError, setPinVerifyError] = useState<string | null>(null)
  const pinInputRef = useRef<HTMLInputElement | null>(null)
  // The override a correct PIN should actually apply — stashed here rather
  // than re-derived from the (already-cleared) draft field, since commitPrice
  // clears priceDrafts as soon as it runs, before the PIN is ever entered.
  const [pendingPriceOverride, setPendingPriceOverride] = useState<{ productId: string; price: number } | null>(null)

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
  // Only the very first load shows the skeleton. Refreshes triggered by a
  // completed sale (or by another screen's edit, via refreshKey) repaint in
  // place — flashing the whole screen back to a skeleton after every sale
  // would be worse than the stale numbers this is here to fix.
  const hasLoadedOnce = useRef(false)
  const fetchInitial = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true)
    setLoadError(false)
    try {
      await loadInventory()
      hasLoadedOnce.current = true
    } catch (err) {
      console.error('Load inventory error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [loadInventory])

  useEffect(() => {
    fetchInitial()
    // refreshKey intentionally re-triggers this fetch on any global refresh,
    // matching dashboard/page.tsx and dashboard/inventory/page.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchInitial, refreshKey])

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
      // Same order as Products and Inventory — this list used to be whatever
      // sequence the API returned, so the same catalog read differently on
      // every screen.
      .sort((a, b) => compareProducts(a.product, b.product))
  }, [inventoryItems, productMap, search])

  const cartArray = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const item = inventoryItems.find(i => i.productId === productId)
        const product = item?.product || productMap[productId]
        const listPrice = resolveSellPrice(item || {}, product)
        const unitPrice = priceOverrides[productId] ?? listPrice
        return {
          productId,
          quantity,
          product: product as Product | undefined,
          item,
          unit: normalizeUnit(item?.unit ?? product?.unit),
          listPrice,
          unitPrice,
          lineTotal: roundMoney(quantity * unitPrice),
        }
      })
  }, [cart, inventoryItems, productMap, priceOverrides])

  /**
   * Money for this sale, in one place.
   *
   * Cart-level discounts (a so'm amount, a percent, or typing the final
   * figure) were removed on request — the price charged for a line is the
   * list price unless it is explicitly renegotiated on the line itself, and
   * nothing rewrites the cart total behind the cashier's back.
   */
  const totals = useMemo(() => {
    const subtotal = roundMoney(cartArray.reduce((sum, line) => sum + line.lineTotal, 0))
    return {
      subtotal,
      total: subtotal,
      lines: cartArray,
      // A per-line renegotiated price is still worth showing as "given away",
      // so the cashier can see the gap against the list price at a glance.
      lineDiscount: roundMoney(
        cartArray.reduce((sum, line) => sum + (line.listPrice - line.unitPrice) * line.quantity, 0),
      ),
    }
  }, [cartArray])

  const totalPieces = useMemo(
    () => roundQty(cartArray.reduce((sum, { quantity }) => sum + quantity, 0)),
    [cartArray],
  )

  // Only ever non-empty for a line whose price was explicitly changed away
  // from list (see commitPrice) — a plain quantity/list-price cart never
  // populates this, so it's a safe "does this sale carry a renegotiated
  // price" flag for the confirm button's lock indicator below.
  const hasPriceOverride = Object.keys(priceOverrides).length > 0

  const setQuantity = useCallback((productId: string, next: number, max: number, unit: string) => {
    const clamped = roundQty(Math.max(next, 0))
    if (qtyGreaterThan(clamped, max)) {
      showToast(t('maxStockReached'), 'error')
      setCart(prev => ({ ...prev, [productId]: roundQty(max) }))
      return
    }
    setCart(prev => {
      if (clamped <= 0) {
        const { [productId]: _removed, ...rest } = prev
        return rest
      }
      return { ...prev, [productId]: clamped }
    })
    if (clamped <= 0) {
      // A line dropped from the cart must not leave its negotiated price
      // behind — re-adding the product should start from the list price again.
      setPriceOverrides(prev => {
        const { [productId]: _removed, ...rest } = prev
        return rest
      })
      setPriceDrafts(prev => {
        const { [productId]: _removed, ...rest } = prev
        return rest
      })
      setQtyDrafts(prev => {
        const { [productId]: _removed, ...rest } = prev
        return rest
      })
    }
    void unit
  }, [showToast])

  const handleAdd = useCallback((productId: string, max: number, unit: string) => {
    const current = cart[productId] || 0
    setQuantity(productId, current + stepFor(unit), max, unit)
  }, [cart, setQuantity])

  const handleRemove = useCallback((productId: string, max: number, unit: string) => {
    const current = cart[productId] || 0
    setQuantity(productId, current - stepFor(unit), max, unit)
  }, [cart, setQuantity])

  const clearCart = useCallback(() => {
    setCart({})
    setPriceOverrides({})
    setPriceDrafts({})
    setQtyDrafts({})
  }, [])

  // One-tap reset of a single cart line to 0 — avoids repeatedly tapping "-"
  // down to zero to undo an over-added line.
  const clearLine = useCallback((productId: string) => {
    setCart(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
    setPriceOverrides(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
    setPriceDrafts(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
    setQtyDrafts(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  const commitPrice = useCallback((productId: string, raw: string, listPrice: number) => {
    const parsed = parseFormattedAmount(raw)
    setPriceDrafts(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
    // Empty or unchanged means "no override" rather than "charge zero" — a
    // cleared field should read as the list price, not as a giveaway. Never
    // PIN-gated: returning to the list price isn't the sensitive direction.
    if (!raw.trim() || parsed === listPrice) {
      setPriceOverrides(prev => {
        const { [productId]: _removed, ...rest } = prev
        return rest
      })
      return
    }
    const nextPrice = roundMoney(Math.max(parsed, 0))
    if (blockCode && !blockDisabled) {
      setPendingPriceOverride({ productId, price: nextPrice })
      setPinInput('')
      setPinVerifyError(null)
      setShowPinVerify(true)
      setTimeout(() => pinInputRef.current?.focus(), 60)
      return
    }
    setPriceOverrides(prev => ({ ...prev, [productId]: nextPrice }))
  }, [blockCode, blockDisabled])

  const confirmPin = useCallback((value: string) => {
    if (value === blockCode) {
      if (pendingPriceOverride) {
        setPriceOverrides(prev => ({ ...prev, [pendingPriceOverride.productId]: pendingPriceOverride.price }))
      }
      setShowPinVerify(false)
      setPinInput('')
      setPinVerifyError(null)
      setPendingPriceOverride(null)
    } else {
      setPinVerifyError("Blok kod noto'g'ri")
      setPinInput('')
      setTimeout(() => pinInputRef.current?.focus(), 60)
    }
  }, [blockCode, pendingPriceOverride])

  // Declining the PIN must leave the price exactly where it was before the
  // edit — the field itself already reverts (priceDrafts was cleared in
  // commitPrice), this just makes sure the pending change never lands.
  const cancelPin = useCallback(() => {
    setShowPinVerify(false)
    setPinInput('')
    setPinVerifyError(null)
    setPendingPriceOverride(null)
  }, [])

  const resetPrice = useCallback((productId: string) => {
    setPriceOverrides(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
    setPriceDrafts(prev => {
      const { [productId]: _removed, ...rest } = prev
      return rest
    })
  }, [])

  // BarcodeScannerModal's camera-owning effect deliberately excludes
  // onBarcodeDetected from its deps (re-subscribing per scan would restart
  // the camera on every item). That means whatever function identity was
  // passed in at the moment the modal opened is what keeps getting called
  // for every scan afterward - if this closed over `cart`/`inventoryItems`
  // directly, every scan after the first read a permanently stale
  // snapshot from when the camera session started. In particular the
  // `inCart >= invItem.currentQuantity` guard below would never see a cart
  // count that grew from earlier scans in the same session, so scanning
  // the same barcode past the stock limit kept reporting a false "added"
  // success (green flash) - setCart's own functional update happened to
  // still cap the real total correctly, but the cashier got no warning
  // that the scan was actually a no-op. Reading through refs (always
  // current) instead of the closed-over values fixes this regardless of
  // which render's closure ends up being the one actually invoked.
  const cartRef = useRef(cart)
  useEffect(() => { cartRef.current = cart }, [cart])
  const inventoryItemsRef = useRef(inventoryItems)
  useEffect(() => { inventoryItemsRef.current = inventoryItems }, [inventoryItems])
  const productsRef = useRef(products)
  useEffect(() => { productsRef.current = products }, [products])

  const addBarcodeProduct = useCallback((code: string): string | null => {
    const trimmed = code.trim()
    if (!trimmed) return null

    const product = productsRef.current.find(p => p.barcodes?.includes(trimmed))
    if (!product) return t('barcodeNotFound') || 'Barcode bo\'yicha mahsulot topilmadi'

    const invItem = inventoryItemsRef.current.find(i => i.productId === product._id)
    if (!invItem || invItem.currentQuantity <= 0) return t('noStock')

    const unit = normalizeUnit(invItem.unit ?? product.unit)
    const inCart = cartRef.current[product._id] || 0
    if (!qtyGreaterThan(invItem.currentQuantity, inCart)) return t('maxStockReached')

    setCart(prev => {
      const current = prev[product._id] || 0
      const next = roundQty(current + stepFor(unit))
      if (qtyGreaterThan(next, invItem.currentQuantity)) return prev
      return { ...prev, [product._id]: next }
    })
    return null
  }, [])

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
      const lines = totals.lines.map(({ productId, quantity, lineTotal, listPrice }) => ({
        productId,
        quantity,
        // Only sent when the line was actually renegotiated — an untouched
        // line stays on the server's cheap list-price path instead of being
        // routed through the locked-revenue accumulators for no reason.
        ...(Math.abs(lineTotal - roundMoney(quantity * listPrice)) > 0.005
          ? { lineRevenue: lineTotal }
          : {}),
      }))
      const today = getBusinessDate()
      await inventoryApi.recordSales(today, lines)
      // Drop the sold units from what is on screen before anything is
      // re-fetched, so the remaining stock is correct in the same frame the
      // cart clears — the network round-trip below only confirms it.
      setInventoryItems(prev => prev.map(item => {
        const soldQty = cart[item.productId] || 0
        if (soldQty <= 0) return item
        return { ...item, currentQuantity: roundQty(Math.max(item.currentQuantity - soldQty, 0)) }
      }))
      clearCart()
      clearApiCache()
      // refreshAll() re-fetches products + inventory into the shared store and
      // bumps refreshKey, which is what makes Inventory, Products and
      // Statistics show the new quantities without their own manual reload.
      // Sequential, not parallel: refreshAll clears the API cache on entry, so
      // a concurrent read here would just be a second identical request.
      await refreshAll()
      await loadInventory()
      setSuccess(t('salesSuccess'))
      setError(null)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Record sale error:', err)
      setSuccess(null)
      setError(err instanceof Error ? err.message : (t('error') || 'Xatolik yuz berdi'))
      setTimeout(() => setError(null), 4000)
    } finally {
      setSubmitting(false)
    }
  }, [cart, totals, totalPieces, submitting, loadInventory, refreshAll, clearCart])

  // Manual-entry barcode sheet was not handled before - see useEscapeKey.ts.
  // The camera scanner modal handles its own Escape internally.
  useEscapeToClose([
    [showBarcode, () => { setShowBarcode(false); setBarcodeInput('') }],
    [showPinVerify, cancelPin],
  ])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <SalesSkeleton />
      </div>
    )
  }

  const showEmptyNoStock = sellableItems.length === 0 && !search
  const showEmptyNotFound = sellableItems.length === 0 && search
  const hasDiscount = Math.abs(totals.lineDiscount) > 0.005

  const smallInput: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontVariantNumeric: 'tabular-nums',
  }

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
              className="icon-ghost-btn"
              title="Qidiruvni tozalash"
              aria-label="Qidiruvni tozalash"
              style={{ borderRadius: 6, padding: 4 }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sellableItems.map(item => {
              const product = item.product as Product | undefined
              const cartQty = cart[item.productId] || 0
              const isActive = cartQty > 0
              const unit = normalizeUnit(item.unit ?? product?.unit)
              const weighed = isWeighed(unit)
              const listPrice = resolveSellPrice(item, product)
              const overridden = priceOverrides[item.productId]
              const unitPrice = overridden ?? listPrice
              const isOverridden = overridden !== undefined
              const canAdd = qtyGreaterThan(item.currentQuantity, cartQty)

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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 14px' }}>
                    <div style={{
                      width: 54,
                      height: 54,
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
                        fontSize: 14.5,
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        marginBottom: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {product?.name || 'N/A'}
                      </p>
                      <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{t('sellPrice')}: {formatMoney(unitPrice)}</span>
                        {isOverridden && (
                          <span style={{ textDecoration: 'line-through', opacity: 0.65, fontSize: 12.5 }}>
                            {formatMoney(listPrice)}
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                        {/* Live-adjusted stock: subtract what's already in the
                            cart for this sale so the shown "qoldiq" reflects
                            what will actually remain after checkout (e.g.
                            22 in stock, 2 in cart → shows 20), instead of the
                            unchanging server-side currentQuantity. */}
                        {t('remaining')}: {formatQuantity(roundQty(item.currentQuantity - cartQty), unit)}
                      </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => handleRemove(item.productId, item.currentQuantity, unit)}
                        disabled={cartQty === 0}
                        title="Kamaytirish"
                        aria-label="Kamaytirish"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          border: `1px solid ${cartQty > 0 ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: cartQty > 0 ? 'var(--color-primary-soft)' : 'transparent',
                          color: cartQty > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          cursor: cartQty === 0 ? 'not-allowed' : 'pointer',
                          opacity: cartQty === 0 ? 0.5 : 1,
                          transition: 'all 0.15s',
                        }}
                      >
                        <Minus size={17} />
                      </button>
                      {/* Weighed goods get a real input instead of only a
                          stepper: reaching 1.75 kg by tapping +0.1 seventeen
                          times is not a checkout flow. Counted goods keep the
                          read-only badge, where the stepper is the fast path. */}
                      {weighed ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={t('quantity')}
                          value={qtyDrafts[item.productId] ?? (cartQty > 0 ? formatQuantityValue(cartQty, unit) : '')}
                          placeholder="0"
                          onChange={e => setQtyDrafts(prev => ({
                            ...prev,
                            [item.productId]: normalizeQuantityInput(e.target.value, unit),
                          }))}
                          onBlur={e => {
                            setQtyDrafts(prev => {
                              const { [item.productId]: _removed, ...rest } = prev
                              return rest
                            })
                            setQuantity(item.productId, parseQuantityInput(e.target.value, unit), item.currentQuantity, unit)
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          style={{
                            width: 58,
                            textAlign: 'center',
                            padding: '8px 4px',
                            borderRadius: 8,
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)',
                            color: 'var(--color-text)',
                            fontSize: 16,
                            fontWeight: 700,
                            fontFamily: 'inherit',
                            outline: 'none',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        />
                      ) : (
                        <span style={{
                          fontSize: 15.5,
                          fontWeight: 700,
                          color: 'var(--color-text)',
                          minWidth: 28,
                          textAlign: 'center',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {cartQty}
                        </span>
                      )}
                      {/* No `disabled` attribute here (unlike "-" above): a
                          disabled HTML button never fires onClick, so the
                          "at max stock" toast inside setQuantity could never
                          show. The hard block still lives in setQuantity's own
                          clamp — this is purely additive feedback, not a new
                          gate. Visual dimming stays via cursor/opacity so it
                          still reads as disabled. */}
                      <button
                        onClick={() => handleAdd(item.productId, item.currentQuantity, unit)}
                        title="Ko'paytirish"
                        aria-label="Ko'paytirish"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          border: `1px solid ${canAdd ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: canAdd ? 'var(--color-primary-soft)' : 'transparent',
                          color: canAdd ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          cursor: canAdd ? 'pointer' : 'not-allowed',
                          opacity: canAdd ? 1 : 0.5,
                          transition: 'all 0.15s',
                        }}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                  </div>

                  {isActive && (
                    <div style={{
                      padding: '8px 14px',
                      borderTop: '1px solid var(--color-border)',
                      background: 'var(--color-primary-soft)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}>
                      {/* Per-line price edit — the customer who negotiates a
                          different price for one item is the common case.
                          This is the only place a price can be changed now;
                          the cart-wide discount control was removed. */}
                      {/* Compact, not full-width: the price is a short number,
                          and letting the field stretch the whole row made the
                          line total look detached from it. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 auto' }}>
                        <Tag size={15} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label={t('editPrice')}
                          value={priceDrafts[item.productId] ?? formatInputAmount(String(unitPrice))}
                          onChange={e => setPriceDrafts(prev => ({
                            ...prev,
                            [item.productId]: formatInputAmount(e.target.value),
                          }))}
                          onBlur={e => commitPrice(item.productId, e.target.value, listPrice)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          style={{
                            ...smallInput,
                            width: 108,
                            textAlign: 'right',
                            borderColor: isOverridden ? 'var(--color-primary)' : 'var(--color-border)',
                            color: isOverridden ? 'var(--color-primary)' : 'var(--color-text)',
                          }}
                        />
                        {isOverridden && (
                          <button
                            onClick={() => resetPrice(item.productId)}
                            title={t('resetPrice')}
                            aria-label={t('resetPrice')}
                            className="icon-ghost-btn"
                            style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0 }}
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginLeft: 'auto',
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--color-primary)',
                      }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(roundMoney(cartQty * unitPrice))}
                        </span>
                        {/* One-tap line reset — avoids tapping "-" repeatedly
                            down to zero to undo an over-added line. */}
                        <button
                          onClick={() => clearLine(item.productId)}
                          title={t('clearLine')}
                          aria-label={t('clearLine')}
                          className="icon-ghost-btn"
                          style={{ width: 30, height: 30, borderRadius: 7 }}
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
              <button onClick={handleBarcodeSubmit} className="btn btn-primary" style={{ flex: 1 }}>
                {t('confirm')}
              </button>
              <button
                onClick={() => { setShowBarcode(false); setBarcodeInput('') }}
                className="btn btn-secondary"
                style={{ flex: 1 }}
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

      {/* PIN Verification — gates a per-line price change when a blockCode
          is set, same pattern as Products/Debtors' delete gate. */}
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
              {t('priceChangeRequiresBlockCode')}
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
          <div style={{ ...kpiCard, flex: '1.4 1 0', minWidth: 0, padding: 10, gap: 9 }}>
            <div style={{ ...kpiIcon, width: 30, height: 30, background: 'var(--color-metric-revenue-soft)', color: 'var(--color-metric-revenue)' }}>
              <Wallet size={15} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('saleTotal')}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: 'var(--color-metric-revenue)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: -0.3,
                  overflowWrap: 'anywhere',
                }}>
                  {formatInputAmount(String(totals.total))}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                  color: 'var(--color-metric-revenue)', opacity: 0.75,
                }}>so&apos;m</span>
              </div>
              {/* Only shown when a line was renegotiated below its list
                  price, so the normal sale keeps a single clean number. */}
              {hasDiscount && (
                <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                  <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                    {formatMoney(roundMoney(totals.subtotal + totals.lineDiscount))}
                  </span>
                  {' · '}
                  <span style={{ color: 'var(--color-danger)' }}>
                    −{formatMoney(totals.lineDiscount)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div style={{ ...kpiCard, flex: '1 1 0', minWidth: 0, padding: 10, gap: 9 }}>
            <div style={{ ...kpiIcon, width: 30, height: 30, background: 'var(--color-metric-qty-soft)', color: 'var(--color-metric-qty)' }}>
              <ShoppingCart size={15} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t('sold')}</div>
              <div style={{
                fontSize: 17,
                fontWeight: 800,
                color: 'var(--color-metric-qty)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatQuantityValue(totalPieces, 'kg')}
              </div>
            </div>
          </div>
        </div>

        {/* `.btn` is `white-space: nowrap` and, as a flex child, defaults to
            `min-width: auto` — so three buttons whose labels are wider than
            the phone could not shrink, and "Savdoni tasdiqlash" was pushed
            off the right edge of the screen. `.sales-actions` gives them a
            real `min-width: 0` and, below 560px, puts Confirm on its own
            full-width row above the two secondary actions. */}
        <div className="sales-actions">
          <button
            onClick={clearCart}
            disabled={totalPieces === 0}
            className="btn btn-secondary"
          >
            <X size={16} />
            <span>{t('cancel')}</span>
          </button>
          <button
            onClick={() => { setShowBarcodeScanner(true); setError(null) }}
            className="btn btn-secondary"
          >
            <Scan size={16} />
            <span>{t('barcode')}</span>
          </button>
          <button
            onClick={handleConfirmSale}
            disabled={totalPieces === 0 || submitting}
            className="btn btn-primary sales-actions-confirm"
          >
            {/* Purely informational — the price change itself was already
                PIN-gated the moment it was typed (commitPrice above), so this
                just tells the cashier at a glance that this sale carries a
                renegotiated line before they tap confirm. */}
            {hasPriceOverride ? <Lock size={16} /> : <Check size={16} />}
            <span>{submitting ? t('loading') : t('confirmSale')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
