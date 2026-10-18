export interface StreamEvent {
  event: string
  data: string
}

// Return false from onEvent to stop after a terminal event, such as AI "done".
export async function readEventStream(response: Response, onEvent: (event: StreamEvent) => boolean | void, onActivity?: () => void) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('The service returned an unexpected stream response.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consume = (block: string) => {
    if (block.length > 262144) throw new Error('The service returned an oversized event.')
    let event = 'message'
    const data: string[] = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    return data.length ? onEvent({ event, data: data.join('\n') }) : undefined
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (value?.length) onActivity?.()
      buffer += decoder.decode(value, { stream: !done })
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        if (consume(block) === false) return
      }
      if (buffer.length > 262144) throw new Error('The service returned an oversized event.')
      if (done) { if (buffer.trim()) consume(buffer); return }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
