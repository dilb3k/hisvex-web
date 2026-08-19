import dayjs from 'dayjs'
import { t } from './i18n'

export const formatCurrency = (amount: number): string =>
  `${formatAmount(amount)} so'm`

export const formatDate = (date: string): string =>
  dayjs(date).format('DD MMM YYYY')

export const formatDateTime = (date: string): string =>
  dayjs(date).format('DD MMM YYYY, HH:mm')

export const formatAmount = (value: number | string): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0'
  return num.toLocaleString('uz-UZ')
}

export const formatInputAmount = (value: string): string => {
  const cleaned = value.replace(/[^\d]/g, '')
  if (!cleaned) return ''
  const num = parseInt(cleaned, 10)
  if (isNaN(num)) return ''
  return num.toLocaleString('uz-UZ')
}

export const parseFormattedAmount = (value: string): number => {
  const cleaned = value.replace(/[^\d]/g, '')
  if (!cleaned) return 0
  return parseInt(cleaned, 10)
}

export const formatPhone = (text: string): string => {
  const digits = text.replace(/\D/g, '').slice(0, 12)
  if (digits.length === 0) return '+998'
  let r = '+' + digits.slice(0, 3)
  if (digits.length > 3) r += ' ' + digits.slice(3, 5)
  if (digits.length > 5) r += ' ' + digits.slice(5, 8)
  if (digits.length > 8) r += ' ' + digits.slice(8, 10)
  if (digits.length > 10) r += ' ' + digits.slice(10, 12)
  return r
}

export const displayPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 0) return phone
  return formatPhone(digits)
}

export const formatShortDate = (dateStr?: string) => {
  if (!dateStr) return ''
  // Bare date-only strings ("YYYY-MM-DD") have no timezone info, so `new Date()` parses
  // them as UTC midnight - reading that back with local getters shifts the date by a day
  // in negative-UTC-offset timezones. Parse the Y/M/D components directly instead.
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr)
  if (dateOnlyMatch && !dateStr.includes('T')) {
    const [, yyyy, mm, dd] = dateOnlyMatch
    return `${dd}.${mm}.${yyyy}`
  }
  // Full ISO timestamps represent a real moment in time - converting to local time via
  // the normal Date getters is the correct behavior here.
  const d = new Date(dateStr)
  const dd = d.getDate().toString().padStart(2, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

// "Is this admin actually using the app" is a relative, at-a-glance signal —
// exact-to-the-minute precision only matters for the first hour or so, after
// which a bare date reads better than "312 soat oldin".
export const formatLastActive = (dateStr?: string | null): string => {
  if (!dateStr) return t('lastActiveNever')
  const then = new Date(dateStr).getTime()
  if (isNaN(then)) return t('lastActiveNever')
  const minutes = Math.floor((Date.now() - then) / 60000)
  if (minutes < 1) return t('lastActiveJustNow')
  if (minutes < 60) return t('lastActiveMinutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('lastActiveHoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 14) return t('lastActiveDaysAgo', { n: days })
  return formatDate(dateStr)
}
