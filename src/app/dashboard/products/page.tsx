'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/appStore'
import { useAuthStore } from '@/lib/authStore'
import { productsApi, resolveImageUrl, getDeviceId, clearApiCache } from '@/lib/api'
import { resolveSellPrice, resolveBuyPrice } from '@/lib/inventory'
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/StatusViews'
import { Package, Plus, Search, Pencil, Lock, AlertTriangle, Trash2, X, Layers, Wallet } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { Product } from '@/lib/types'
import {
  overlay,
  modalContainer,
  modalHeader,
  modalBody,
  modalFooter,
  inputBase,
  label,
  errorText,
  btnPrimary,
  btnSecondary,
  btnDanger,
  formatMoney,
  formatInputAmount,
  parseFormattedAmount,
  kpiCard,
  kpiIcon,
} from '@/lib/sharedStyles'
import { formatPhone } from '@/lib/formatters'
import { isBlockCodeDisabled } from '@/utils/blockCode'

const normalizeDigits = (text: string) => text.replace(/[^\d]/g, '')

interface ValidationErrors {
  name: string
  buyPrice: string
  sellPrice: string
  quantity: string
}

const validateProductInput = (input: { name: string; quantity: number; buyPrice: number; sellPrice: number }): ValidationErrors => {
  const errors: ValidationErrors = { name: '', buyPrice: '', sellPrice: '', quantity: '' }
  if (!input.name || input.name.trim().length === 0) {
    errors.name = 'Mahsulot nomi majburiy'
  } else if (input.name.trim().length < 2) {
    errors.name = "Mahsulot nomi kamida 2 ta belgidan iborat bo'lishi kerak"
  }
  if (!input.buyPrice || input.buyPrice <= 0) {
    errors.buyPrice = 'Sotib olish narxi 0 dan katta bo\'lishi kerak'
  }
  if (!input.sellPrice || input.sellPrice <= 0) {
    errors.sellPrice = 'Sotish narxi 0 dan katta bo\'lishi kerak'
  } else if (input.sellPrice < input.buyPrice) {
    errors.sellPrice = 'Sotish narxi sotib olish narxidan kam bo\'lmasligi kerak'
  }
  if (input.quantity < 0) {
    errors.quantity = 'Miqdor manfiy bo\'lmasligi kerak'
  }
  return errors
}

const hasValidationErrors = (errors: ValidationErrors) => Object.values(errors).some((e) => e !== '')

interface ProductForm {
  name: string
  quantity: string
  buyPrice: string
  sellPrice: string
  image: string | undefined
  barcodes: string[]
}

const EMPTY_FORM: ProductForm = {
  name: '',
  quantity: '',
  buyPrice: '',
  sellPrice: '',
  image: undefined,
  barcodes: [],
}

const EMPTY_ERRORS: ValidationErrors = { name: '', buyPrice: '', sellPrice: '', quantity: '' }

const inputError: React.CSSProperties = {
  ...inputBase,
  borderColor: 'var(--color-danger)',
}

const RequiredMark = () => (
  <span style={{ color: 'var(--color-danger)', marginLeft: 3, fontWeight: 700 }} title={t('requiredField')}>*</span>
)

// Shaped pulse-block skeleton matching this screen's actual layout (KPI row +
// search bar + a handful of grid cards), following the same page-local
// skeleton convention InventorySkeleton/SalesSkeleton established, instead of
// the old bare spinner.
function ProductsSkeleton() {
  const block = (h: number, style?: React.CSSProperties): React.CSSProperties => ({
    height: h, borderRadius: 12, background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    animation: 'pulse 1.4s ease-in-out infinite', ...style,
  })
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[0, 1, 2].map((i) => <div key={i} style={block(70, { animationDelay: `${i * 0.07}s` })} />)}
      </div>
      <div className="product-grid">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={block(126, { animationDelay: `${i * 0.06}s` })} />)}
      </div>
    </div>
  )
}

export default function ProductsPage() {
  const router = useRouter()
  const products = useAppStore((s) => s.products)
  const loadProducts = useAppStore((s) => s.loadProducts)
  const showToast = useAppStore((s) => s.showToast)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<ValidationErrors>(EMPTY_ERRORS)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const blockCode = useAuthStore((s) => s.user?.blockCode ?? null)
  // Per-device "temporarily disable" toggle set on the Settings page — lets
  // a user skip PIN prompts on this browser without deleting the saved
  // code. See src/utils/blockCode.ts.
  const [blockDisabled, setBlockDisabledState] = useState(false)
  useEffect(() => { setBlockDisabledState(isBlockCodeDisabled()) }, [])
  const [showPinVerify, setShowPinVerify] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinVerifyError, setPinVerifyError] = useState<string | null>(null)
  // Tracks which gated action the PIN prompt is currently guarding, so the
  // same modal/flow used for Save can also gate Delete (item 11).
  const [pinAction, setPinAction] = useState<'save' | 'delete' | null>(null)
  const pinInputRef = useRef<HTMLInputElement | null>(null)

  const [showRestockModal, setShowRestockModal] = useState(false)
  const [restockProduct, setRestockProduct] = useState<Product | null>(null)
  const [restockQty, setRestockQty] = useState('')
  const [isRestocking, setIsRestocking] = useState(false)

  const [showBarcodeInput, setShowBarcodeInput] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false)
  // Field-level error for the barcode section, surfaced when a save fails
  // specifically due to a duplicate-barcode conflict (item 8) rather than
  // only via a generic toast.
  const [barcodeFieldError, setBarcodeFieldError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Direct fetch (bypasses the store's own cache-skip logic) so a genuine
  // load failure can be told apart from "catalog is just empty" and surfaced
  // via a persistent ErrorBanner + retry, matching the Inventory/Sales
  // redesign convention. Writes the result into the shared store so other
  // consumers (barcode-conflict check, Sales/Inventory screens) stay in sync.
  const fetchProducts = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const { data } = await productsApi.getAll()
      useAppStore.setState({ products: data })
    } catch (err) {
      console.error('Load products error:', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const sortedProducts = useMemo(() => {
    return [...products]
      .filter((p) => !debouncedSearch || p.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
      .sort((a, b) => {
        const ia = a.displayIndex ?? 0
        const ib = b.displayIndex ?? 0
        return ia !== ib ? ia - ib : a.name.localeCompare(b.name)
      })
  }, [products, debouncedSearch])

  // KPI row totals (item 2) — computed over the full catalog, independent of
  // the current search filter, same as the totals shown on the Inventory KPI
  // row. Low-stock is "at/below the Kam threshold" (<=5), which includes
  // out-of-stock items too.
  const kpiTotals = useMemo(() => {
    let lowStock = 0
    let stockValue = 0
    for (const p of products) {
      const qty = p.quantity ?? 0
      if (qty <= 5) lowStock++
      stockValue += qty * resolveSellPrice(p, p)
    }
    return { totalSku: products.length, lowStock, stockValue }
  }, [products])

  const previewQty = Number(form.quantity || 0)
  const previewBuy = parseFormattedAmount(form.buyPrice)
  const previewSell = parseFormattedAmount(form.sellPrice)
  const previewTotalCost = previewQty * previewBuy
  const previewExpectedProfit = previewQty * (previewSell - previewBuy)
  const previewMargin = previewSell > 0 && previewBuy > 0 ? ((previewSell - previewBuy) / previewSell * 100).toFixed(1) : '0'

  const getStockStatus = (qty: number) => {
    if (qty <= 0) return { label: 'Tugagan', color: 'var(--color-danger)' }
    if (qty <= 5) return { label: 'Kam', color: 'var(--color-warning)' }
    return { label: 'Mavjud', color: 'var(--color-success)' }
  }

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setFormErrors(EMPTY_ERRORS)
    setEditingProduct(null)
    setBarcodeFieldError('')
  }

  const closeProductModal = () => {
    setShowModal(false)
    resetForm()
  }

  const openEdit = (item: Product) => {
    setEditingProduct(item)
    setFormErrors(EMPTY_ERRORS)
    setBarcodeFieldError('')
    setForm({
      name: item.name,
      quantity: String(item.quantity ?? ''),
      buyPrice: item.buyPrice ? formatInputAmount(String(item.buyPrice)) : '',
      sellPrice: item.sellPrice ? formatInputAmount(String(item.sellPrice)) : '',
      image: item.image || item.imageHash,
      barcodes: item.barcodes ?? [],
    })
    setShowModal(true)
  }

  const openCreate = () => {
    resetForm()
    setShowModal(true)
  }

  const openRestock = (item: Product) => {
    setRestockProduct(item)
    setRestockQty('')
    setShowRestockModal(true)
  }

  const closeRestockModal = () => {
    setShowRestockModal(false)
    setRestockProduct(null)
    setRestockQty('')
  }

  const handleImagePick = () => fileInputRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setForm((prev) => ({ ...prev, image: reader.result as string }))
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleAddBarcode = () => { setShowBarcodeScanner(true) }
  const handleManualBarcode = () => { setShowBarcodeScanner(false); setShowBarcodeInput(true); setBarcodeInput('') }
  const handleScannerDetected = (code: string) => {
    setBarcodeFieldError('')
    setForm((prev) => ({
      ...prev,
      barcodes: prev.barcodes.includes(code) ? prev.barcodes : [...prev.barcodes, code],
    }))
    setShowBarcodeScanner(false)
  }
  const handleConfirmBarcode = () => {
    const code = barcodeInput.trim()
    if (!code) return
    setBarcodeFieldError('')
    setForm((prev) => ({
      ...prev,
      barcodes: prev.barcodes.includes(code) ? prev.barcodes : [...prev.barcodes, code],
    }))
    setShowBarcodeInput(false)
    setBarcodeInput('')
  }
  const handleRemoveBarcode = (index: number) => {
    setBarcodeFieldError('')
    setForm((prev) => ({ ...prev, barcodes: prev.barcodes.filter((_, i) => i !== index) }))
  }

  // Stable reference so BarcodeScannerModal's camera-owning effect (which depends on
  // this prop) doesn't tear down and reinitialize the camera on unrelated re-renders.
  const checkBarcodeConflict = useCallback((code: string) => {
    const dup = products.find(
      (p) => p.barcodes?.includes(code) && p._id !== editingProduct?._id
    )
    return dup ? { conflictName: dup.name } : null
  }, [products, editingProduct])

  const validate = () => {
    const next = validateProductInput({
      name: form.name.trim(),
      quantity: Number(form.quantity || 0),
      buyPrice: parseFormattedAmount(form.buyPrice),
      sellPrice: parseFormattedAmount(form.sellPrice),
    })
    setFormErrors(next)
    return !hasValidationErrors(next)
  }

  const execSave = useCallback(async () => {
    setBarcodeFieldError('')
    const barcodes = form.barcodes.filter(Boolean)
    if (barcodes.length) {
      for (const code of barcodes) {
        const dup = products.find((p) => p.barcodes?.includes(code) && p._id !== editingProduct?._id)
        if (dup) {
          const message = `"${dup.name}" allaqachon bu (${code}) barcode dan foydalanmoqda`
          setBarcodeFieldError(message)
          showToast(message, 'error')
          return false
        }
      }
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      quantity: Number(form.quantity || 0),
      buyPrice: parseFormattedAmount(form.buyPrice),
      sellPrice: parseFormattedAmount(form.sellPrice),
      barcodes,
      deviceId: getDeviceId(),
    }
    if (form.image !== undefined && form.image !== editingProduct?.image) {
      payload.image = form.image
    }
    setIsSubmitting(true)
    try {
      if (editingProduct) {
        await productsApi.update(editingProduct._id, payload)
      } else {
        await productsApi.create(payload)
      }
      closeProductModal()
      clearApiCache()
      await loadProducts(true)
      return true
    } catch (err: unknown) {
      console.error('Product save error:', err)
      // The API interceptor already turns 409 duplicate-barcode responses (and other
      // API errors) into an Error carrying the backend's friendly message - surface it
      // instead of failing silently.
      const message = err instanceof Error ? err.message : t('error')
      // The API interceptor collapses the response into a plain Error with just a
      // message, losing the 409 status — so a duplicate-barcode conflict from the
      // backend (product.service's "allaqachon ... barcode dan foydalanmoqda" /
      // "allaqachon boshqa mahsulotda ishlatilmoqda" messages) is only detectable by
      // shape here. When it matches, surface it next to the barcode field too, not
      // just as a generic toast (item 8).
      if (/barcode/i.test(message) && /(allaqachon|ishlatilmoqda)/i.test(message)) {
        setBarcodeFieldError(message)
      }
      showToast(message, 'error')
      return false
    } finally {
      setIsSubmitting(false)
    }
  }, [form, editingProduct, loadProducts, products, showToast])

  // Actual delete API call, split out from the click-handler below so it can
  // be invoked either directly (no blockCode set) or after a successful PIN
  // check (item 11 — route Delete through the same PIN gate Save already
  // uses, since deleting is at least as destructive as editing).
  const execDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await productsApi.delete(deleteTarget._id)
      setShowDeleteModal(false); setDeleteTarget(null)
      closeProductModal()
      clearApiCache()
      await loadProducts(true)
    } catch (err: unknown) {
      console.error('Delete error:', err)
      // Real bug fix (item 3): a failed delete used to look identical to a
      // successful one from the user's perspective.
      showToast(err instanceof Error ? err.message : t('error'), 'error')
    } finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, loadProducts, showToast])

  const handleSave = async () => {
    if (!validate()) return
    if (blockCode && !blockDisabled) {
      setPinAction('save')
      setPinInput('')
      setPinVerifyError(null)
      setShowPinVerify(true)
      setTimeout(() => pinInputRef.current?.focus(), 60)
      return
    }
    await execSave()
  }

  const confirmPin = useCallback((value: string) => {
    if (value === blockCode) {
      setShowPinVerify(false)
      setPinInput('')
      setPinVerifyError(null)
      if (pinAction === 'delete') {
        execDelete()
      } else {
        execSave()
      }
      setPinAction(null)
    } else {
      setPinVerifyError("Blok kod noto'g'ri")
      setPinInput('')
      setTimeout(() => pinInputRef.current?.focus(), 60)
    }
  }, [blockCode, execSave, execDelete, pinAction])

  const handleRestock = async () => {
    if (!restockProduct || !restockQty) return
    const qtyToAdd = parseInt(restockQty.replace(/\D/g, ''), 10)
    if (Number.isNaN(qtyToAdd) || qtyToAdd <= 0) { console.error('Invalid restock quantity'); return }
    setIsRestocking(true)
    try {
      const { data: freshProduct } = await productsApi.getById(restockProduct._id)
      const currentQty = freshProduct?.quantity ?? restockProduct.quantity ?? 0
      await productsApi.update(restockProduct._id, { quantity: currentQty + qtyToAdd })
      closeRestockModal()
      clearApiCache()
      await loadProducts(true)
    } catch (err: unknown) {
      console.error('Restock error:', err)
      // Real bug fix (item 3): a failed restock used to look identical to a
      // successful one from the user's perspective. Surface it via the same
      // toast mechanism execSave already uses for save failures.
      showToast(err instanceof Error ? err.message : t('error'), 'error')
    } finally {
      setIsRestocking(false)
    }
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    if (blockCode && !blockDisabled) {
      setPinAction('delete')
      setPinInput('')
      setPinVerifyError(null)
      setShowPinVerify(true)
      setTimeout(() => pinInputRef.current?.focus(), 60)
      return
    }
    execDelete()
  }

  return (
    <div style={{ padding: 0 }}>
      <PageHeader
        actions={
          <>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder={t('search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="search-input"
                style={{ paddingLeft: 36, width: '100%', maxWidth: 260 }}
              />
            </div>
            <button
              onClick={openCreate}
              className="btn btn-primary btn-icon"
              title={t('addProduct')}
            >
              <Plus size={20} />
            </button>
          </>
        }
      />

      {loading ? (
        <ProductsSkeleton />
      ) : loadError ? (
        <ErrorBanner onRetry={fetchProducts} />
      ) : (
        <>
          {/* KPI row (item 2): total SKU count and low-stock count use the
              qty-count metric-identity color; total stock value uses the
              revenue metric-identity color (stock value is closest in spirit
              to "revenue" of the three tracked metrics). Low-stock is a
              status signal, not a tracked metric, so it stays on the warning
              color instead. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            <div style={kpiCard}>
              <div style={{ ...kpiIcon, background: 'var(--color-metric-qty-soft)', color: 'var(--color-metric-qty)' }}><Layers size={18} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{t('totalSkuCount')}</div>
                <div style={{ fontSize: 'clamp(13px, 3.4vw, 16px)', fontWeight: 800, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{kpiTotals.totalSku}</div>
              </div>
            </div>
            <div style={kpiCard}>
              <div style={{ ...kpiIcon, background: 'rgba(245,158,11,0.15)', color: 'var(--color-warning)' }}><AlertTriangle size={18} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{t('lowStockCount')}</div>
                <div style={{ fontSize: 'clamp(13px, 3.4vw, 16px)', fontWeight: 800, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{kpiTotals.lowStock}</div>
              </div>
            </div>
            <div style={kpiCard}>
              <div style={{ ...kpiIcon, background: 'var(--color-metric-revenue-soft)', color: 'var(--color-metric-revenue)' }}><Wallet size={18} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 2 }}>{t('stockValueLabel')}</div>
                <div style={{ fontSize: 'clamp(13px, 3.4vw, 16px)', fontWeight: 800, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: -0.2, overflowWrap: 'anywhere' }}>{formatMoney(kpiTotals.stockValue)}</div>
              </div>
            </div>
          </div>

          {sortedProducts.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 80,
          color: 'var(--color-text-secondary)',
        }}>
          <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <p style={{ fontSize: 15, fontWeight: 500 }}>{debouncedSearch ? t('noProductsFound') : t('noProducts')}</p>
          {!debouncedSearch && (
            <button
              onClick={openCreate}
              className="btn btn-primary"
              style={{ marginTop: 4 }}
            >
              <Plus size={16} />
              {t('addProduct')}
            </button>
          )}
        </div>
      ) : (
        <div className="product-grid">
          {sortedProducts.map((item) => {
            const status = getStockStatus(item.quantity ?? 0)
            return (
              <div
                key={item._id}
                className="product-card"
                onClick={() => openEdit(item)}
              >
                <div className="product-card-img">
                  {(item.image || item.imageHash) ? (
                    <img
                      src={resolveImageUrl(item.image, item.imageHash)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <Package size={28} color="var(--color-text-tertiary)" />
                  )}
                </div>

                <div className="product-card-mid">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 3 }}>
                      {item.displayIndex && item.displayIndex > 0 ? `#${item.displayIndex} · ` : ''}
                      {t('currentQuantity')}: {item.quantity ?? 0}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: status.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: status.color }}>{status.label}</span>
                    </div>
                  </div>

                  <div className="product-card-prices">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(resolveBuyPrice(item, item))}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('buy')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(resolveSellPrice(item, item))}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('sell')}</div>
                    </div>
                  </div>
                </div>

                <div className="product-card-actions">
                  <div
                    className="product-card-action"
                    onClick={(e) => { e.stopPropagation(); openEdit(item) }}
                  >
                    <Pencil size={15} />
                    <span>{t('edit')}</span>
                  </div>
                  <div
                    className="product-card-action"
                    style={{ background: 'var(--color-success)', color: '#fff' }}
                    onClick={(e) => { e.stopPropagation(); openRestock(item) }}
                  >
                    <Plus size={18} />
                    <span>{t('add')}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
          )}
        </>
      )}

      {/* Product Form Modal */}
      {showModal && (
        <div style={overlay} onClick={closeProductModal}>
          <div style={modalContainer} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
                {editingProduct ? t('editProduct') : t('addProduct')}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {editingProduct && (
                  <button
                    onClick={() => { setDeleteTarget(editingProduct); setShowDeleteModal(true) }}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--color-danger)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={16} color="#fff" />
                  </button>
                )}
                <button
                  onClick={closeProductModal}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    fontSize: 20,
                    lineHeight: 1,
                  }}
                >
                  &times;
                </button>
              </div>
            </div>

            <div style={modalBody}>
              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('productName')}<RequiredMark /></label>
                <input
                  type="text"
                  placeholder={t('productNamePlaceholder')}
                  value={form.name}
                  onChange={(e) => { setForm((prev) => ({ ...prev, name: e.target.value })); setFormErrors((prev) => ({ ...prev, name: '' })) }}
                  style={formErrors.name ? inputError : inputBase}
                />
                {formErrors.name && <div style={errorText}>{formErrors.name}</div>}
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('buyPrice')}<RequiredMark /></label>
                <input
                  type="text"
                  placeholder="0"
                  value={form.buyPrice}
                  onChange={(e) => { setForm((prev) => ({ ...prev, buyPrice: formatInputAmount(e.target.value) })); setFormErrors((prev) => ({ ...prev, buyPrice: '' })) }}
                  style={formErrors.buyPrice ? inputError : inputBase}
                />
                {formErrors.buyPrice && <div style={errorText}>{formErrors.buyPrice}</div>}
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('sellPrice')}<RequiredMark /></label>
                <input
                  type="text"
                  placeholder="0"
                  value={form.sellPrice}
                  onChange={(e) => { setForm((prev) => ({ ...prev, sellPrice: formatInputAmount(e.target.value) })); setFormErrors((prev) => ({ ...prev, sellPrice: '' })) }}
                  style={formErrors.sellPrice ? inputError : inputBase}
                />
                {formErrors.sellPrice && <div style={errorText}>{formErrors.sellPrice}</div>}
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={label}>{t('quantity')}</label>
                <input
                  type="text"
                  placeholder={t('quantityPlaceholder')}
                  value={form.quantity}
                  onChange={(e) => { setForm((prev) => ({ ...prev, quantity: normalizeDigits(e.target.value) })); setFormErrors((prev) => ({ ...prev, quantity: '' })) }}
                  style={formErrors.quantity ? inputError : inputBase}
                />
                {formErrors.quantity && <div style={errorText}>{formErrors.quantity}</div>}
                {/* item 4 — the create form's Quantity field seeds the new product's
                    very first day's opening stock; nothing else on the form says so. */}
                {!editingProduct && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 4 }}>{t('openingQuantityHint')}</div>
                )}
              </div>

              {(previewQty > 0 || previewBuy > 0 || previewSell > 0) && (
                <div style={{
                  background: 'var(--color-surface)',
                  borderRadius: 10,
                  border: '1px solid var(--color-border)',
                  padding: 14,
                  marginBottom: 14,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    {t('preSaveCheck')}
                  </div>
                  {previewBuy > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('buyPrice')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(previewBuy)}</span>
                    </div>
                  )}
                  {previewSell > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('sellPrice')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(previewSell)}</span>
                    </div>
                  )}
                  {previewSell > 0 && previewBuy > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('profitPerUnit')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>{formatMoney(previewSell - previewBuy)}</span>
                    </div>
                  )}
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '6px 0' }} />
                  {previewQty > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('totalRevenueLabelShort')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(previewQty * previewSell)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('totalProductCost')}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(previewTotalCost)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('expectedProfitAmount')}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: previewExpectedProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                      {formatMoney(previewExpectedProfit)}
                    </span>
                  </div>
                  {previewSell > 0 && previewBuy > 0 && previewQty > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('profitMarginPercent')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>{previewMargin}%</span>
                    </div>
                  )}
                </div>
              )}

              <div
                onClick={handleImagePick}
                style={{
                  height: 200,
                  borderRadius: 12,
                  border: '1.5px dashed var(--color-border)',
                  background: 'var(--color-surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  marginBottom: 14,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {form.image ? (
                  <img src={resolveImageUrl(form.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <Package size={36} color="var(--color-text-tertiary)" style={{ marginBottom: 6, opacity: 0.5 }} />
                    <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('addImage')}</div>
                  </div>
                )}
              </div>
              {/* item 12 — light size/format guidance, previously zero guidance existed. */}
              <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: -8, marginBottom: 14, textAlign: 'center' }}>{t('imageSizeHint')}</div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />

              <div style={{
                padding: 14,
                borderRadius: 10,
                border: barcodeFieldError ? '1px solid var(--color-danger)' : '1px solid var(--color-border)',
                background: 'var(--color-surface)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: form.barcodes.length > 0 ? 10 : 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Shtrixkodlar</span>
                  <button
                    onClick={handleAddBarcode}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      marginLeft: 'auto',
                      flexShrink: 0,
                    }}
                  >
                    <Plus size={12} color="#fff" />
                  </button>
                </div>
                {form.barcodes.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {form.barcodes.map((code, i) => (
                      <div key={i} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '4px 10px',
                        borderRadius: 20,
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg)',
                        fontSize: 12,
                      }}>
                        <span style={{ color: 'var(--color-text)' }}>{code}</span>
                        <button onClick={() => handleRemoveBarcode(i)} style={{
                          border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--color-text-tertiary)',
                        }}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {form.barcodes.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>Shtrixkod yo'q</div>
                )}
                {/* item 8 — duplicate-barcode conflict (client-side pre-check or
                    server 409), surfaced next to the field instead of only a toast. */}
                {barcodeFieldError && <div style={{ ...errorText, marginTop: 8 }}>{barcodeFieldError}</div>}
              </div>
            </div>

            <div style={modalFooter}>
              <button onClick={closeProductModal} style={btnSecondary}>{t('cancel')}</button>
              <button
                onClick={handleSave}
                disabled={isSubmitting}
                style={{ ...btnPrimary, opacity: isSubmitting ? 0.6 : 1, cursor: isSubmitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, lineHeight: 1 }}
              >
                {blockCode && !blockDisabled ? <Lock size={14} color="#fff" style={{ display: 'block' }} /> : null}
                {isSubmitting ? t('loading') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        open={showBarcodeScanner}
        onClose={() => setShowBarcodeScanner(false)}
        onBarcodeDetected={handleScannerDetected}
        onManualInput={handleManualBarcode}
        conflictCheck={checkBarcodeConflict}
      />

      {/* Barcode Input Modal */}
      {showBarcodeInput && (
        <div style={overlay} onClick={() => setShowBarcodeInput(false)}>
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: 14,
            padding: 24,
            width: '100%',
            maxWidth: 360,
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-lg)',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 14 }}>Shtrixkod kiriting</div>
            <input
              type="text"
              placeholder="Shtrixkod raqami"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmBarcode()}
              style={inputBase}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowBarcodeInput(false)} style={btnSecondary}>{t('cancel')}</button>
              <button onClick={handleConfirmBarcode} style={btnPrimary}>Qo'shish</button>
            </div>
          </div>
        </div>
      )}

      {/* Restock Modal */}
      {showRestockModal && restockProduct && (
        <div style={overlay} onClick={closeRestockModal}>
          <div style={{ ...modalContainer, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('restock')}</span>
              <button onClick={closeRestockModal} style={{
                width: 34, height: 34, borderRadius: 8, border: 'none', background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                color: 'var(--color-text-secondary)', fontSize: 20, lineHeight: 1,
              }}>&times;</button>
            </div>
            <div style={modalBody}>
              <div style={{
                background: 'var(--color-surface)', borderRadius: 10, border: '1px solid var(--color-border)',
                padding: 16, marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center',
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 10, background: 'var(--color-bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
                }}>
                  {(restockProduct.image || restockProduct.imageHash) ? (
                    <img src={resolveImageUrl(restockProduct.image, restockProduct.imageHash)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <Package size={24} color="var(--color-text-tertiary)" />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{restockProduct.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {t('buy')}: {formatMoney(resolveBuyPrice(restockProduct, restockProduct))} | {t('sell')}: {formatMoney(resolveSellPrice(restockProduct, restockProduct))}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginTop: 4 }}>
                    {t('currentStock')}: <span style={{ color: 'var(--color-primary)' }}>{restockProduct.quantity ?? 0}</span>
                  </div>
                </div>
              </div>

              <label style={label}>{t('howMuchArrived')}</label>
              <input
                type="text"
                placeholder="0"
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value.replace(/\D/g, ''))}
                style={{ ...inputBase, fontSize: 20, fontWeight: 700, textAlign: 'center', padding: '14px' }}
              />

              {restockQty && (
                <div style={{
                  background: 'var(--color-surface)', borderRadius: 10, border: '1px solid var(--color-border)',
                  padding: 14, marginTop: 16,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', marginBottom: 10 }}>{t('result')}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('currentStock')}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{restockProduct.quantity ?? 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('addToStock')}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>+{restockQty}</span>
                  </div>
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '6px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('newStock')}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary)' }}>{(restockProduct.quantity ?? 0) + (parseInt(restockQty || '0', 10))}</span>
                  </div>
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '6px 0' }} />
                  {resolveBuyPrice(restockProduct, restockProduct) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('restockCost')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{formatMoney(parseInt(restockQty || '0', 10) * resolveBuyPrice(restockProduct, restockProduct))}</span>
                    </div>
                  )}
                  {resolveBuyPrice(restockProduct, restockProduct) > 0 && resolveSellPrice(restockProduct, restockProduct) > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('expectedProfitAmount')}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>
                        {formatMoney(parseInt(restockQty || '0', 10) * (resolveSellPrice(restockProduct, restockProduct) - resolveBuyPrice(restockProduct, restockProduct)))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={modalFooter}>
              <button onClick={closeRestockModal} style={btnSecondary}>{t('back')}</button>
              <button
                onClick={handleRestock}
                disabled={!restockQty || isRestocking}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--color-success)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: (!restockQty || isRestocking) ? 'not-allowed' : 'pointer',
                  opacity: (!restockQty || isRestocking) ? 0.6 : 1,
                }}
              >
                {isRestocking ? t('loading') : t('addStock')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteModal && (
        <div style={overlay} onClick={() => setShowDeleteModal(false)}>
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
            <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>{t('deleteMessage')}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => { setShowDeleteModal(false); setDeleteTarget(null) }} style={btnSecondary}>{t('cancel')}</button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                style={{ ...btnDanger, opacity: isDeleting ? 0.6 : 1, cursor: isDeleting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, lineHeight: 1 }}
              >
                {blockCode && !blockDisabled ? <Lock size={14} color="#fff" style={{ display: 'block' }} /> : null}
                {isDeleting ? t('loading') : t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Verification — shared between Save and Delete (item 11) */}
      {showPinVerify && (
        <div style={overlay} onClick={() => { setShowPinVerify(false); setPinAction(null) }}>
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
              {pinAction === 'delete' ? t('deleteRequiresBlockCode') : 'Mahsulotni saqlash uchun himoya kodini kiriting'}
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
              <button onClick={() => { setShowPinVerify(false); setPinAction(null) }} style={btnSecondary}>Bekor qilish</button>
              <button
                onClick={() => confirmPin(pinInput)}
                disabled={pinInput.length !== 4}
                style={{
                  ...btnPrimary, flex: 1,
                  opacity: pinInput.length === 4 ? 1 : 0.5,
                  cursor: pinInput.length === 4 ? 'pointer' : 'not-allowed',
                }}
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
