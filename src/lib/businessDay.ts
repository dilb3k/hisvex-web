import dayjs from 'dayjs'

const BUSINESS_DAY_START_HOUR = Number(process.env.NEXT_PUBLIC_BUSINESS_DAY_START_HOUR) || 6

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

let activeHour = BUSINESS_DAY_START_HOUR
let pendingHour: number | null = null
let effectiveFrom: string | null = null

export function initBusinessDay() {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('hisvex_business_hour')
      if (saved) activeHour = parseInt(saved, 10)
      const pending = localStorage.getItem('hisvex_pending_hour')
      const from = localStorage.getItem('hisvex_pending_from')
      if (pending && from) {
        pendingHour = parseInt(pending, 10)
        effectiveFrom = from
      }
    } catch {}
  }
}

export const setBusinessDayStartHour = (hour: number) => {
  activeHour = hour
  if (typeof window !== 'undefined') {
    try { localStorage.setItem('hisvex_business_hour', String(hour)) } catch {}
  }
}

export const getBusinessDayStartHour = () => {
  applyPendingIfNeeded()
  return activeHour
}

export const scheduleBusinessDayStartHour = (hour: number) => {
  const tomorrow = dayjs().add(1, 'day').startOf('day').hour(hour)
  pendingHour = hour
  effectiveFrom = tomorrow.toISOString()
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('hisvex_pending_hour', String(hour))
      localStorage.setItem('hisvex_pending_from', effectiveFrom)
    } catch {}
  }
}

export const setPendingBusinessDayHour = (hour: number, from: string) => {
  pendingHour = hour
  effectiveFrom = from
}

export const getPendingBusinessDayStartHour = () => pendingHour
export const getEffectiveFrom = () => effectiveFrom

export const clearPending = () => {
  pendingHour = null
  effectiveFrom = null
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('hisvex_pending_hour')
      localStorage.removeItem('hisvex_pending_from')
    } catch {}
  }
}

function applyPendingIfNeeded() {
  if (pendingHour === null || effectiveFrom === null) return
  if (dayjs().isAfter(dayjs(effectiveFrom))) {
    activeHour = pendingHour
    pendingHour = null
    effectiveFrom = null
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('hisvex_business_hour', String(activeHour))
        localStorage.removeItem('hisvex_pending_hour')
        localStorage.removeItem('hisvex_pending_from')
      } catch {}
    }
  }
}

export const getBusinessDate = (input?: string | Date | dayjs.Dayjs): string => {
  if (typeof input === 'string' && DATE_ONLY_PATTERN.test(input)) {
    return input
  }
  applyPendingIfNeeded()
  const value = input ? dayjs(input) : dayjs()
  const adjusted = value.hour() < activeHour ? value.subtract(1, 'day') : value
  return adjusted.format('YYYY-MM-DD')
}

export const getBusinessDayMoment = (date?: string) =>
  dayjs(date || getBusinessDate(), 'YYYY-MM-DD')

export const isPastBusinessDate = (date: string): boolean =>
  getBusinessDayMoment(date).isBefore(getBusinessDayMoment(), 'day')

export const isTodayBusinessDate = (date: string): boolean =>
  getBusinessDayMoment(date).isSame(getBusinessDayMoment(), 'day')

export const isFutureBusinessDate = (date: string): boolean =>
  getBusinessDayMoment(date).isAfter(getBusinessDayMoment(), 'day')
