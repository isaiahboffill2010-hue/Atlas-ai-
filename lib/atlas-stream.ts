/**
 * Client for the streaming Atlas route.
 *
 * Mirrors `askAtlas` in lib/atlas.ts, except text is delivered incrementally
 * through `onDelta` as Gemini produces it instead of arriving in one piece at
 * the end. The non-streaming client is still there and unchanged.
 */

export interface AskAtlasStreamingOptions {
  /** Called for every piece of text Gemini produces. */
  onDelta?: (delta: string, accumulated: string) => void
  /** Called once, when the first text arrives. */
  onFirstDelta?: () => void
  /** Aborts the request (and, server-side, the Gemini stream). */
  signal?: AbortSignal
  /**
   * A/B override for Gemini's thinking level. Omit in normal operation — the
   * server then uses its configured default, which is the baseline config.
   */
  thinkingLevel?: string
}

interface StreamEvent {
  type: 'delta' | 'done' | 'error'
  text?: string
  error?: string
}

/** SSE frames are blank-line delimited. Tolerate both LF and CRLF endings. */
const FRAME_SEPARATOR = /\r?\n\r?\n/

export async function askAtlasStreaming(
  message: string,
  options: AskAtlasStreamingOptions = {}
): Promise<string> {
  if (!message || message.trim().length === 0) {
    throw new Error('Empty message')
  }

  const { onDelta, onFirstDelta, signal, thinkingLevel } = options

  console.log('[askAtlasStreaming] Opening stream to /api/atlas-stream')
  const response = await fetch('/api/atlas-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message.trim(), thinkingLevel }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`API error: ${response.status} ${response.statusText} - ${text}`)
  }

  if (!response.body) {
    throw new Error('Streaming not supported by this browser')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let sawFirstDelta = false
  let streamError: string | null = null

  const handleEvent = (event: StreamEvent) => {
    if (event.type === 'delta' && event.text) {
      if (!sawFirstDelta) {
        sawFirstDelta = true
        onFirstDelta?.()
      }
      accumulated += event.text
      onDelta?.(event.text, accumulated)
    } else if (event.type === 'done') {
      if (typeof event.text === 'string' && event.text.length > accumulated.length) {
        // Server has the authoritative full text; trust it if it is longer.
        accumulated = event.text
      }
    } else if (event.type === 'error') {
      streamError = event.error || 'Unknown streaming error'
    }
  }

  const consumeFrames = (flushTail: boolean) => {
    let match = FRAME_SEPARATOR.exec(buffer)
    while (match) {
      const frame = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      parseFrame(frame, handleEvent)
      match = FRAME_SEPARATOR.exec(buffer)
    }
    if (flushTail && buffer.trim().length > 0) {
      parseFrame(buffer, handleEvent)
      buffer = ''
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      consumeFrames(false)
    }
    buffer += decoder.decode()
    consumeFrames(true)
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.log('[askAtlasStreaming] Stream aborted by caller')
      throw error
    }
    console.error('[askAtlasStreaming] Stream read error:', error)
    throw error
  }

  if (streamError) {
    throw new Error(streamError)
  }

  console.log('[askAtlasStreaming] Stream complete, length:', accumulated.length)
  return accumulated
}

function parseFrame(frame: string, handleEvent: (event: StreamEvent) => void): void {
  const dataLines: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return

  const payload = dataLines.join('\n')
  if (!payload || payload === '[DONE]') return

  try {
    handleEvent(JSON.parse(payload) as StreamEvent)
  } catch (error) {
    console.warn('[askAtlasStreaming] Could not parse frame:', payload.slice(0, 200))
  }
}
