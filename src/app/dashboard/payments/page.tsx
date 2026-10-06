'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  CreditCard,
  CheckCircle2,
  Clock3,
  Ban,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Receipt,
  X,
  CalendarDays,
} from 'lucide-react'
import {
  adminPaymentsApi,
  clearApiCache,
  type AdminPayment,
  type PaymentHistory,
  type PaymentHistoryFilters,
} from '@/lib/api'
import { useAuthStore } from '@/lib/authStore'
import { t, getLanguage, type TranslationKey } from '@/lib/i18n'
import { formatMoney } from '@/lib/sharedStyles'
import { ErrorBanner } from '@/components/StatusViews'
import { useEscapeToClose } from '@/lib/useEscapeKey'
import styles from './payments.module.css'

const statuses: AdminPayment['status'][] = [
  'pending',
  'completed',
  'approved',
  'rejected',
  'cancelled',
  'provisioned',
]
const statusKeys: Record<AdminPayment['status'], TranslationKey> = {
  pending: 'paymentStatusPending',
  provisioned: 'paymentStatusProvisioned',
  approved: 'paymentStatusApproved',
  completed: 'paymentStatusCompleted',
  rejected: 'paymentStatusRejected',
  cancelled: 'paymentStatusCancelled',
}
const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(
        getLanguage() === 'ru' ? 'ru-RU' : 'uz-UZ',
        {
          timeZone: 'Asia/Tashkent',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      )
    : '—'

function Status({ payment }: { payment: AdminPayment }) {
  const tone =
    payment.needsReconciliation || payment.status === 'provisioned'
      ? 'warning'
      : ['completed', 'approved'].includes(payment.status)
        ? 'success'
        : payment.status === 'pending'
          ? 'pending'
          : 'muted'
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <span className={styles.dot} />
      {t(
        payment.needsReconciliation
          ? 'paymentStatusProvisioned'
          : statusKeys[payment.status],
      )}
    </span>
  )
}

function PaymentDetails({
  payment,
  onClose,
}: {
  payment: AdminPayment
  onClose: () => void
}) {
  const token = useAuthStore((s) => s.token)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [receiptError, setReceiptError] = useState(false)
  const [receiptLoading, setReceiptLoading] = useState(false)
  const [receiptAttempt, setReceiptAttempt] = useState(0)
  const [openReceipt, setOpenReceipt] = useState(false)
  useEscapeToClose([[true, onClose]])
  useEffect(() => {
    if (!openReceipt || !payment.hasReceipt) return
    let cancelled = false,
      url: string | null = null
    setReceiptLoading(true)
    setReceiptError(false)
    adminPaymentsApi
      .receipt(payment.id)
      .then((result) => {
        if (cancelled || token !== useAuthStore.getState().token) return
        url = URL.createObjectURL(
          new Blob([result.body], { type: result.mime }),
        )
        setReceiptUrl(url)
      })
      .catch(() => {
        if (!cancelled && token === useAuthStore.getState().token)
          setReceiptError(true)
      })
      .finally(() => {
        if (!cancelled) setReceiptLoading(false)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [payment.id, payment.hasReceipt, openReceipt, token, receiptAttempt])
  const details: [TranslationKey, string][] = [
    ['paymentAccount', payment.username || t('paymentUnavailableAccount')],
    ['paymentId', payment.id],
    [
      'paymentPlan',
      `${payment.tier.toUpperCase()} · ${t('paymentMonth', { count: payment.durationMonths })}`,
    ],
    [
      'paymentMethod',
      payment.method === 'click' ? 'Click' : t('paymentManual'),
    ],
    ['paymentCreated', dateTime(payment.createdAt)],
    ...(payment.approvedAt
      ? [
          ['paymentReviewed', dateTime(payment.approvedAt)] as [
            TranslationKey,
            string,
          ],
        ]
      : []),
    ...(payment.approvedBy
      ? [['paymentReviewer', payment.approvedBy] as [TranslationKey, string]]
      : []),
    ...(payment.reference
      ? [['paymentReference', payment.reference] as [TranslationKey, string]]
      : []),
    ...(payment.sender
      ? [
          [
            'paymentSender',
            `${payment.sender.name} · ${payment.sender.card}`,
          ] as [TranslationKey, string],
        ]
      : []),
    ...(payment.receiptAmount != null
      ? [
          ['paymentReceiptAmount', formatMoney(payment.receiptAmount)] as [
            TranslationKey,
            string,
          ],
        ]
      : []),
  ]
  return (
    <div className={styles.overlay} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-details-title"
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.drawerHeader}>
          <span className={styles.icon}>
            <Receipt size={22} />
          </span>
          <h2 id="payment-details-title">{t('paymentDetails')}</h2>
          <button
            autoFocus
            className="icon-ghost-btn"
            onClick={onClose}
            aria-label={t('close')}
          >
            <X size={20} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <div className={styles.detailAmount}>
            {formatMoney(payment.amount)}
          </div>
          <Status payment={payment} />
          {payment.needsReconciliation && (
            <p className={styles.notice}>{t('paymentReconciliation')}</p>
          )}
          <dl className={styles.detailList}>
            {details.map(([key, value]) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {payment.rejectedReason && (
            <div className={styles.notice}>
              <strong>{t('paymentRejectionReason')}</strong>
              <p>{payment.rejectedReason}</p>
            </div>
          )}
          <div className={styles.receiptSection}>
            <h3>
              <Receipt size={18} />
              {t('paymentReceipt')}
            </h3>
            {!payment.hasReceipt ? (
              <p className={styles.secondary}>{t('paymentNoReceipt')}</p>
            ) : !openReceipt ? (
              <button
                className="btn btn-secondary"
                onClick={() => setOpenReceipt(true)}
              >
                <Receipt size={16} />
                {t('paymentOpenReceipt')}
              </button>
            ) : receiptLoading ? (
              <p role="status" className={styles.secondary}>
                {t('loading_data')}
              </p>
            ) : receiptError ? (
              <div role="alert">
                <p>{t('paymentReceiptError')}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => setReceiptAttempt((a) => a + 1)}
                >
                  {t('paymentRetry')}
                </button>
              </div>
            ) : receiptUrl ? (
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                <Image
                  unoptimized
                  width={768}
                  height={1024}
                  className={styles.receiptImage}
                  src={receiptUrl}
                  alt={t('paymentReceipt')}
                />
              </a>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

export default function PaymentHistoryPage() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const allowed = user?.role === 'superAdmin' && user.scope !== 'procurement'
  const [filters, setFilters] = useState<PaymentHistoryFilters>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [data, setData] = useState<PaymentHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<AdminPayment | null>(null)
  const [loadedToken, setLoadedToken] = useState<string | null>(null)
  const invalidRange = !!(
    filters.from &&
    filters.to &&
    filters.from > filters.to
  )
  useEffect(() => {
    if (filters.q === (search.trim() || undefined)) return
    const timer = setTimeout(() => {
      setFilters((value) => ({ ...value, q: search.trim() || undefined }))
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [search, filters.q])
  useEffect(() => {
    setSelected(null)
    setData(null)
  }, [token])
  useEffect(() => {
    if (!allowed || invalidRange) {
      setLoading(false)
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    setData(null)
    adminPaymentsApi
      .list({ ...filters, page, limit: 25 })
      .then((result) => {
        if (cancelled || token !== useAuthStore.getState().token) return
        if (result.totalPages > 0 && page > result.totalPages) {
          setPage(result.totalPages)
          return
        }
        setData(result)
        setLoadedToken(token)
      })
      .catch(() => {
        if (!cancelled && token === useAuthStore.getState().token)
          setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [allowed, token, filters, page, reload, invalidRange])
  const updateFilter = (key: keyof PaymentHistoryFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value || undefined }))
    setPage(1)
  }
  const reset = () => {
    setSearch('')
    setFilters({})
    setPage(1)
  }
  const refresh = () => {
    clearApiCache()
    setReload((value) => value + 1)
  }
  if (!allowed) return null
  const visibleData = loadedToken === token ? data : null
  const summary = visibleData?.summary
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            <CreditCard size={16} />
            HISVEX
          </div>
          <h1>{t('paymentHistory')}</h1>
          <p>{t('paymentHistorySubtitle')}</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? styles.spinning : ''} />
          {t('refresh')}
        </button>
      </header>
      <div className={styles.metrics} aria-busy={loading}>
        {[
          {
            label: 'paymentSettled' as const,
            value: summary ? formatMoney(summary.settledAmount) : '—',
            count: summary?.settledCount,
            Icon: CheckCircle2,
            tone: 'paid',
          },
          {
            label: 'paymentAwaiting' as const,
            value: summary ? formatMoney(summary.pendingAmount) : '—',
            count: summary?.pendingCount,
            Icon: Clock3,
            tone: 'waiting',
          },
          {
            label: 'paymentTotalCount' as const,
            value: summary?.total.toLocaleString() ?? '—',
            Icon: CreditCard,
            tone: 'neutral',
          },
          {
            label: 'paymentRejectedCount' as const,
            value: summary?.rejectedCount.toLocaleString() ?? '—',
            Icon: Ban,
            tone: 'neutral',
          },
        ].map(({ label, value, count, Icon, tone }) => (
          <div className={`${styles.metric} ${styles[tone]}`} key={label}>
            <span className={styles.metricIcon}>
              <Icon size={20} />
            </span>
            <p>{t(label)}</p>
            <strong>{value}</strong>
            {count != null && <small>{t('paymentCount', { count })}</small>}
          </div>
        ))}
      </div>
      <section className={styles.tableCard}>
        <div className={styles.filters}>
          <label className={styles.search}>
            <Search size={18} />
            <input
              aria-label={t('paymentSearch')}
              placeholder={t('paymentSearch')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className={styles.filterRow}>
            <select
              aria-label={t('paymentState')}
              value={filters.status ?? ''}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">{t('paymentAllStatuses')}</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {t(statusKeys[status])}
                </option>
              ))}
            </select>
            <select
              aria-label={t('paymentMethod')}
              value={filters.method ?? ''}
              onChange={(e) => updateFilter('method', e.target.value)}
            >
              <option value="">{t('paymentAllMethods')}</option>
              <option value="manual_card">{t('paymentManual')}</option>
              <option value="click">Click</option>
            </select>
            <select
              aria-label={t('paymentPlan')}
              value={filters.tier ?? ''}
              onChange={(e) => updateFilter('tier', e.target.value)}
            >
              <option value="">{t('paymentAllPlans')}</option>
              <option value="bor">BOR</option>
              <option value="pro">PRO</option>
            </select>
            <label className={styles.dateFilter}>
              <CalendarDays size={15} />
              <input
                type="date"
                aria-label={t('paymentFrom')}
                title={t('paymentFrom')}
                value={filters.from ?? ''}
                max={filters.to}
                onChange={(e) => updateFilter('from', e.target.value)}
              />
            </label>
            <label className={styles.dateFilter}>
              <span>→</span>
              <input
                type="date"
                aria-label={t('paymentTo')}
                title={t('paymentTo')}
                value={filters.to ?? ''}
                min={filters.from}
                onChange={(e) => updateFilter('to', e.target.value)}
              />
            </label>
            <button className={styles.reset} onClick={reset}>
              {t('paymentResetFilters')}
            </button>
          </div>
        </div>
        {invalidRange ? (
          <div className={styles.empty} role="alert">
            {t('paymentInvalidRange')}
          </div>
        ) : error ? (
          <div className={styles.empty}>
            <ErrorBanner onRetry={refresh} />
          </div>
        ) : loading ? (
          <div
            className={styles.skeleton}
            role="status"
            aria-label={t('loading_data')}
          >
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} />
            ))}
          </div>
        ) : !visibleData?.items.length ? (
          <div className={styles.empty}>
            <Receipt size={38} />
            <h3>{t('paymentNoResults')}</h3>
            <p>{t('paymentNoResultsHint')}</p>
          </div>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('paymentAccount')}</th>
                    <th>{t('paymentPlan')}</th>
                    <th>{t('paymentAmount')}</th>
                    <th>{t('paymentMethod')}</th>
                    <th>{t('paymentState')}</th>
                    <th>{t('date')}</th>
                    <th>
                      <span className={styles.srOnly}>
                        {t('paymentDetails')}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleData.items.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <div className={styles.accountCell}>
                          <span className={styles.avatar}>
                            {(payment.username || '?')
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <div>
                            <strong>
                              {payment.username ||
                                t('paymentUnavailableAccount')}
                            </strong>
                            <small>
                              {payment.phone ||
                                (payment.telegramUsername
                                  ? '@' +
                                    payment.telegramUsername.replace(/^@/, '')
                                  : payment.telegramUserId)}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`${styles.plan} ${payment.tier === 'pro' ? styles.pro : ''}`}
                        >
                          {payment.tier.toUpperCase()}
                        </span>
                        <small className={styles.duration}>
                          {t('paymentMonth', { count: payment.durationMonths })}
                        </small>
                      </td>
                      <td className={styles.amount}>
                        {formatMoney(payment.amount)}
                      </td>
                      <td>
                        <span className={styles.method}>
                          {payment.method === 'click'
                            ? 'Click'
                            : t('paymentManual')}
                        </span>
                        {payment.hasReceipt && (
                          <small className={styles.receiptHint}>
                            <Receipt size={12} />
                            {t('paymentReceipt')}
                          </small>
                        )}
                      </td>
                      <td>
                        <Status payment={payment} />
                      </td>
                      <td className={styles.date}>
                        {dateTime(payment.createdAt)}
                      </td>
                      <td>
                        <button
                          onClick={() => setSelected(payment)}
                          className={styles.openButton}
                          aria-label={`${t('paymentDetails')}: ${payment.username || payment.id}`}
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className={styles.pagination}>
              <span>
                {t('paymentPage', {
                  page: visibleData.page,
                  pages: Math.max(1, visibleData.totalPages),
                  total: visibleData.summary.total,
                })}
              </span>
              <div>
                <button
                  className="btn btn-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => value - 1)}
                  aria-label={t('paymentPrev')}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={page >= visibleData.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                  aria-label={t('paymentNext')}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
      {selected && loadedToken === token && (
        <PaymentDetails
          key={selected.id}
          payment={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
