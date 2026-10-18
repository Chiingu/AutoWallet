import { apiFetch } from './request'
import { apiErrorDetail } from './errors'
import { isWalletType } from './walletTypes'
import type { WalletType } from './walletTypes'

export type AnalyticsInterval = 'day' | 'week' | 'month'
export interface AnalyticsFilters { start: string; end: string; envelope: WalletType | ''; interval: AnalyticsInterval }
export interface AnalyticsSummary {
  start: string; end: string; envelope: WalletType | null
  payments: number; received: number; average_payment: number; largest_payment: number
  by_envelope: Partial<Record<WalletType, number>>; balances: Partial<Record<WalletType, number>>
}
export interface AnalyticsPoint { period: string; received: number; envelopes: Partial<Record<WalletType, number>> }
export interface AnalyticsSeries { start: string; end: string; interval: AnalyticsInterval; envelope: WalletType | null; points: AnalyticsPoint[] }
export interface AnalyticsData { summary: AnalyticsSummary; timeseries: AnalyticsSeries }

export class AnalyticsApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function isAnalyticsDate(value: string) {
  return /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export function analyticsRangeError(filters: AnalyticsFilters): string | null {
  if (!isAnalyticsDate(filters.start) || !isAnalyticsDate(filters.end)) return 'Choose a valid start and end date.'
  if (filters.start > filters.end) return 'The start date must be on or before the end date.'
  const days = (Date.parse(filters.end) - Date.parse(filters.start)) / 86400000 + 1
  const max = filters.interval === 'day' ? 366 : 1100
  return days > max ? `Choose at most ${max} days for this interval.` : null
}

export function analyticsQuery(filters: AnalyticsFilters, includeInterval = false) {
  const params = new URLSearchParams({ start: filters.start, end: filters.end })
  if (filters.envelope) params.set('envelope', filters.envelope)
  if (includeInterval) params.set('interval', filters.interval)
  return params.toString()
}

function parseAmounts(value: unknown): Partial<Record<WalletType, number>> {
  if (!record(value)) throw new Error('The service returned invalid envelope totals.')
  const result: Partial<Record<WalletType, number>> = {}
  for (const [key, valueAmount] of Object.entries(value)) {
    if (!isWalletType(key) || !amount(valueAmount)) throw new Error('The service returned invalid envelope totals.')
    result[key] = valueAmount
  }
  return result
}

function validatePeriod(value: unknown, filters: AnalyticsFilters): asserts value is Record<string, unknown> {
  if (!record(value) || value.start !== filters.start || value.end !== filters.end || value.envelope !== (filters.envelope || null)) {
    throw new Error('The service returned analytics for an unexpected period.')
  }
}

function parseSummary(value: unknown, filters: AnalyticsFilters): AnalyticsSummary {
  validatePeriod(value, filters)
  if (!amount(value.payments) || !Number.isInteger(value.payments) || !amount(value.received) || !amount(value.average_payment) || !amount(value.largest_payment)) {
    throw new Error('The service returned invalid analytics totals.')
  }
  return { start: filters.start, end: filters.end, envelope: filters.envelope || null,
    payments: value.payments, received: value.received, average_payment: value.average_payment, largest_payment: value.largest_payment,
    by_envelope: parseAmounts(value.by_envelope), balances: parseAmounts(value.balances) }
}

function parseSeries(value: unknown, filters: AnalyticsFilters): AnalyticsSeries {
  validatePeriod(value, filters)
  if (value.interval !== filters.interval || !Array.isArray(value.points)) throw new Error('The service returned invalid chart data.')
  const seen = new Set<string>()
  const points = value.points.map((point: unknown) => {
    if (!record(point) || typeof point.period !== 'string' || !amount(point.received) || seen.has(point.period)) throw new Error('The service returned invalid chart data.')
    const valid = filters.interval === 'day' ? isAnalyticsDate(point.period)
      : filters.interval === 'week' ? /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(point.period)
        : /^\d{4}-(0[1-9]|1[0-2])$/.test(point.period)
    if (!valid) throw new Error('The service returned an invalid chart period.')
    seen.add(point.period)
    return { period: point.period, received: point.received, envelopes: parseAmounts(point.envelopes) }
  })
  return { start: filters.start, end: filters.end, envelope: filters.envelope || null, interval: filters.interval, points }
}

async function analyticsRequest(path: string, signal: AbortSignal, accept = 'application/json') {
  const token = localStorage.getItem('autowallet_token')
  if (!token) throw new AnalyticsApiError(401, 'Please sign in again.')
  const response = await apiFetch(path, { headers: { Authorization: `Bearer ${token}`, Accept: accept }, signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const { message } = apiErrorDetail(payload, 'Analytics is unavailable right now. Please try again.')
    throw new AnalyticsApiError(response.status, message)
  }
  return response
}

export async function fetchAnalytics(filters: AnalyticsFilters, signal: AbortSignal): Promise<AnalyticsData> {
  const invalid = analyticsRangeError(filters)
  if (invalid) throw new Error(invalid)
  const [summary, series] = await Promise.all([
    analyticsRequest(`/api/analytics/summary?${analyticsQuery(filters)}`, signal).then(response => response.json()),
    analyticsRequest(`/api/analytics/timeseries?${analyticsQuery(filters, true)}`, signal).then(response => response.json()),
  ])
  return { summary: parseSummary(summary, filters), timeseries: parseSeries(series, filters) }
}

export async function fetchAnalyticsExport(filters: AnalyticsFilters, format: 'csv' | 'pdf', signal: AbortSignal): Promise<Blob> {
  const invalid = analyticsRangeError(filters)
  if (invalid) throw new Error(invalid)
  const type = format === 'pdf' ? 'application/pdf' : 'text/csv'
  const response = await analyticsRequest(`/api/analytics/export?${analyticsQuery(filters)}&format=${format}`, signal, type)
  if (!response.headers.get('content-type')?.includes(type)) throw new Error('The service did not return a valid report file.')
  const blob = await response.blob()
  if (!blob.size) throw new Error('The service returned an empty report file.')
  return blob
}
