import { apiFetch } from './request'
import { apiErrorDetail } from './errors'
import { readEventStream } from './sse'

export class AssistantApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function streamAssistant(message: string, token: string, signal: AbortSignal, onToken: (text: string) => void) {
  const response = await apiFetch('/api/ai/chat/stream', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message }),
    signal,
  }, 90000)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const fallback = response.status === 429 ? 'Too many questions. Wait a moment before trying again.' : response.status === 503 ? 'The assistant is unavailable right now. Please try again later.' : 'The assistant could not answer. Please try again.'
    throw new AssistantApiError(response.status, apiErrorDetail(payload, fallback).message)
  }
  let finished = false
  await readEventStream(response, ({ event, data }) => {
    const payload: unknown = JSON.parse(data)
    if (typeof payload !== 'object' || payload === null) throw new Error('The assistant returned an invalid response.')
    if (event === 'error') throw new Error('message' in payload && typeof payload.message === 'string' ? payload.message : 'The answer was interrupted. Please try again.')
    if (event === 'done') { finished = true; return false }
    if (event === 'token' && 'text' in payload && typeof payload.text === 'string') onToken(payload.text)
  })
  if (!finished) throw new Error('The connection ended before the answer finished. Please try again.')
}
