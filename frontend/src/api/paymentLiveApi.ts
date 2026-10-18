import { apiFetch } from './request'
import { readEventStream } from './sse'
import { isWalletType } from './walletTypes'

export class PaymentLiveError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function streamPaymentUpdates(token: string, signal: AbortSignal, onReady: () => void, onPayment: () => void) {
  const watchdog = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const watch = (milliseconds: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => watchdog.abort(new DOMException('Live updates timed out', 'TimeoutError')), milliseconds)
  }
  watch(15000)
  try {
    const response = await apiFetch('/api/analytics/live', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: AbortSignal.any([signal, watchdog.signal]),
      cache: 'no-store',
    }, null)
    if (!response.ok) throw new PaymentLiveError(response.status, 'Live updates are unavailable.')
    watch(45000)
    await readEventStream(response, ({ event, data }) => {
      if (event !== 'ready' && event !== 'payment') return
      const value: unknown = JSON.parse(data)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid live event.')
      if (event === 'ready') { onReady(); return }
      if (!('type' in value) || value.type !== 'payment.processed') return
      if (!('reference' in value) || typeof value.reference !== 'string' || !value.reference ||
          !('amount' in value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount <= 0 ||
          !('allocations' in value) || !value.allocations || typeof value.allocations !== 'object' || Array.isArray(value.allocations)) {
        throw new Error('Invalid payment update.')
      }
      let total = 0
      for (const [type, amount] of Object.entries(value.allocations)) {
        if (!isWalletType(type) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new Error('Invalid payment allocation.')
        total += amount
      }
      if (Math.abs(total - value.amount) > 0.02) throw new Error('Incomplete payment update.')
      onPayment()
    }, () => watch(45000))
    throw new Error('The live connection ended.')
  } finally { clearTimeout(timer) }
}
