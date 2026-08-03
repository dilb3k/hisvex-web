'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAppStore } from '@/lib/appStore'
import { inventoryApi, resolveImageUrl, clearApiCache } from '@/lib/api'
import dayjs from 'dayjs'
import { Minus, Plus, Package, Scan, Search, ShoppingBag, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { InventoryItem, Product } from '@/lib/types'

const formatMoney = (val?: number) => {
  if (!val) return '0 so\'m'
  return val.toLocaleString('uz-UZ') + ' so\'m'
}
const getBusinessDate = () => dayjs().format('YYYY-MM-DD')

export default function SalesPage() {
  const { products, refreshAll } = useAppStore()

  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showBarcode, setShowBarcode] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [success, setSuccess] = useState<string | null>(null)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])

  const loadInventory = useCallback(async () => {
    try {
      const today = getBusinessDate()
      const { data } = await inventoryApi.getByDate(today, today)
      setInventoryItems(data?.items ?? [])
    } catch {
      // handled by loadInventory caller
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await loadInventory()
      setLoading(false)
    }
    load()
  }, [loadInventory])

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
      const price = item?.sellPrice ?? product?.sellPrice ?? 0
      return sum + quantity * price
    }, 0)
  }, [cartArray])

  const totalPieces = useMemo(() => {
    return cartArray.reduce((sum, { quantity }) => sum + quantity, 0)
  }, [cartArray])

  const handleAdd = useCallback((productId: string, max: number) => {
    setCart(prev => {
      const current = prev[productId] || 0
      if (current >= max) return prev
      return { ...prev, [productId]: current + 1 }
    })
  }, [])

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

  const handleBarcodeSubmit = useCallback(() => {
    const code = barcodeInput.trim()
    if (!code) return

    const product = products.find(p => p.barcodes?.includes(code))
    if (!product) {
      setBarcodeInput('')
      setShowBarcode(false)
      return
    }

    const invItem = inventoryItems.find(i => i.productId === product._id)
    if (!invItem || invItem.currentQuantity <= 0) {
      setBarcodeInput('')
      setShowBarcode(false)
      return
    }

    setCart(prev => {
      const current = prev[product._id] || 0
      if (current >= invItem.currentQuantity) return prev
      return { ...prev, [product._id]: current + 1 }
    })

    setBarcodeInput('')
    setShowBarcode(false)
  }, [barcodeInput, products, inventoryItems])

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
      setTimeout(() => setSuccess(null), 3000)
    } catch {
      setSuccess(t('error') || 'Xatolik yuz berdi')
      setTimeout(() => setSuccess(null), 3000)
    } finally {
      setSubmitting(false)
    }
  }, [cartArray, totalPieces, submitting, loadInventory, refreshAll])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <div style={{
          width: 32,
          height: 32,
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
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
        background: 'rgba(168,85,247,0.08)',
        border: '1px solid rgba(168,85,247,0.15)',
      }}>
        {t('salesHint')}
      </p>

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
              const price = item.sellPrice ?? product?.sellPrice ?? 0

              return (
                <div
                  key={item.productId}
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    background: isActive ? 'rgba(168,85,247,0.04)' : 'var(--color-surface)',
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
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${cartQty > 0 ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: cartQty > 0 ? 'rgba(168,85,247,0.1)' : 'transparent',
                          color: cartQty > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          cursor: cartQty === 0 ? 'not-allowed' : 'pointer',
                          opacity: cartQty === 0 ? 0.5 : 1,
                        }}
                      >
                        <Minus size={16} />
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
                      <button
                        onClick={() => handleAdd(item.productId, item.currentQuantity)}
                        disabled={cartQty >= item.currentQuantity}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${cartQty < item.currentQuantity ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: cartQty < item.currentQuantity ? 'rgba(168,85,247,0.1)' : 'transparent',
                          color: cartQty < item.currentQuantity ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                          cursor: cartQty >= item.currentQuantity ? 'not-allowed' : 'pointer',
                          opacity: cartQty >= item.currentQuantity ? 0.5 : 1,
                        }}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>

                  {isActive && (
                    <div style={{
                      padding: '6px 14px',
                      borderTop: '1px solid var(--color-border)',
                      background: 'rgba(168,85,247,0.03)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 13,
                      color: 'var(--color-primary)',
                      fontWeight: 500,
                    }}>
                      <span>{t('saleTotal')}:</span>
                      <span>{formatMoney(cartQty * price)}</span>
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
        }}>
          <div style={{
            width: 360,
            padding: 24,
            borderRadius: 12,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
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

      <div style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        borderRadius: '12px 12px 0 0',
        padding: '12px 16px',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}>
          <div>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('saleTotal')}: </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
              {formatMoney(totalRevenue)}
            </span>
          </div>
          <div>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t('soldPieces')}: </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {totalPieces}
            </span>
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
            onClick={() => setShowBarcode(true)}
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
