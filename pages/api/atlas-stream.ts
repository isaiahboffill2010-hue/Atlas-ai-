import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../lib/knowledge/knowledge-retriever'
import { getAllKnowledgeFiles } from '../../lib/supabase/library-db'
import { buildSystemPrompt } from '../../lib/atlas-prompt'
import { buildGenerationConfig, resolveThinkingVariant } from '../../lib/gemini-thinking'
import {
  getOrCreateCurrentConversation,
  saveMessage,
  updateConversationTimestamp,
  getRecentConversationMessages,
} from '../../lib/supabase/conversations-db'

/**
 * Streaming counterpart to /api/atlas.
 *
 * Same model, same system prompt, same history window, same generation config —
 * the only difference is that text is relayed to the browser as Gemini produces
 * it instead of being buffered until the response is complete. The original
 * non-streaming route is untouched and still works.
 *
 * Wire format is SSE, one JSON object per frame:
 *   {"type":"delta","text":"..."}   incremental text
 *   {"type":"done","text":"..."}    full response text
 *   {"type":"error","error":"..."}  fatal error
 */

export const config = {
  api: {
    responseLimit: false,
  },
}

interface GeminiPart {
  text?: string
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/** SSE frames are blank-line delimited; Gemini uses CRLF, our own client uses LF. */
const FRAME_SEPARATOR = /\r?\n\r?\n/

const GEMINI_MODEL = 'gemini-3.6-flash'
/** Overall cap on a single generation, matching the non-streaming route's spirit. */
const GENERATION_TIMEOUT_MS = 45000
/** Assistant-message persistence must never hold up the next turn. */
const DB_SAVE_TIMEOUT_MS = 5000

let currentConversationId: string | null = null
let conversationInitError: string | null = null

async function initializeConversation(): Promise<void> {
  if (currentConversationId) return
  if (conversationInitError) throw new Error(conversationInitError)

  try {
    const conversation = await getOrCreateCurrentConversation()
    currentConversationId = conversation.id
    console.log('[AtlasStream] Initialized conversation with ID:', currentConversationId)
  } catch (error) {
    conversationInitError = error instanceof Error ? error.message : String(error)
    console.warn('[AtlasStream] Conversation initialization error:', conversationInitError)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { message, thinkingLevel } = req.body || {}
  // A/B only. Defaults to the configured variant, which defaults to baseline.
  const variant = resolveThinkingVariant(thinkingLevel)

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid message' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' })
  }

  const requestStart = Date.now()
  const since = () => `${Date.now() - requestStart}ms`

  const trimmedMessage = message.trim()

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tells nginx and friends not to buffer the response.
    'X-Accel-Buffering': 'no',
  })
  flush(res)

  const send = (payload: Record<string, unknown>) => {
    if (res.writableEnded) return
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
    flush(res)
  }

  // Abort Gemini as soon as the browser hangs up (customer interrupted Atlas).
  const controller = new AbortController()
  let clientGone = false
  const onClose = () => {
    clientGone = true
    console.log(`[AtlasStream] Client disconnected at ${since()}, aborting Gemini`)
    controller.abort()
  }
  req.on('close', onClose)

  const timeoutId = setTimeout(() => {
    console.warn(`[AtlasStream] Generation timeout after ${GENERATION_TIMEOUT_MS}ms`)
    controller.abort()
  }, GENERATION_TIMEOUT_MS)

  let fullText = ''

  try {
    await initializeConversation()

    // Persist the customer's message, but do not make Gemini wait on Supabase.
    // The original route awaited this round trip in the critical path.
    if (currentConversationId) {
      const conversationId = currentConversationId
      void saveMessage(conversationId, 'user', trimmedMessage)
        .then((result) => {
          if (!result.success) {
            console.warn(`[AtlasStream] Failed to save user message: ${result.error}`)
          }
        })
        .catch((error) => {
          console.warn('[AtlasStream] User message save threw:', error)
        })
    }

    // Both of these must finish before Gemini can be called, and neither
    // depends on the other, so they run concurrently rather than back to back.
    // The second argument to retrieveKnowledge is required: without it the
    // function searches an empty file list and the knowledge library is never
    // actually consulted.
    const [retrievedKnowledge, history] = await Promise.all([
      retrieveKnowledge(trimmedMessage, getAllKnowledgeFiles),
      currentConversationId ? getRecentConversationMessages(currentConversationId, 6) : Promise.resolve([]),
    ])

    const knowledgeContext = formatKnowledgeContext(retrievedKnowledge)
    const systemPrompt = buildSystemPrompt(knowledgeContext)
    console.log(
      `[AtlasStream][${variant}] Knowledge: ${retrievedKnowledge.length} document(s), ` +
        `${knowledgeContext.length} chars of context at ${since()}`
    )

    const contents: GeminiContent[] = []
    for (const msg of history.slice(-4)) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      })
    }

    // The user-message save above is fire-and-forget, so history may or may not
    // already contain this turn depending on timing. Drop it if present so the
    // prompt is deterministic and the message is not sent twice.
    const last = contents[contents.length - 1]
    if (last && last.role === 'user' && last.parts[0]?.text?.trim() === trimmedMessage) {
      contents.pop()
    }

    contents.push({ role: 'user', parts: [{ text: trimmedMessage }] })

    console.log(
      `[AtlasStream][${variant}] Calling Gemini at ${since()} with ${contents.length} messages`
    )

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: buildGenerationConfig(variant),
        }),
        signal: controller.signal,
      }
    )

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text().catch(() => '')
      let parsed: any = null
      try {
        parsed = JSON.parse(errorBody)
      } catch (_) {
        parsed = { message: errorBody }
      }
      const errorMessage = parsed?.error?.message || parsed?.message || errorBody
      throw new Error(`Gemini error: ${errorMessage}`)
    }

    if (!geminiResponse.body) {
      throw new Error('Gemini returned no response body')
    }

    console.log(`[AtlasStream] Gemini responded at ${since()}, reading stream`)

    const reader = (geminiResponse.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let firstTextAt: number | null = null

    const handleFrame = (frame: string) => {
      const dataLines: string[] = []
      // Gemini terminates SSE lines with CRLF, so split on either ending.
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
      if (dataLines.length === 0) return

      const payload = dataLines.join('\n')
      if (!payload || payload === '[DONE]') return

      let parsed: any
      try {
        parsed = JSON.parse(payload)
      } catch (error) {
        console.warn('[AtlasStream] Unparseable Gemini frame:', payload.slice(0, 200))
        return
      }

      const parts = parsed?.candidates?.[0]?.content?.parts
      if (!Array.isArray(parts)) return

      for (const part of parts) {
        if (typeof part?.text !== 'string' || part.text.length === 0) continue
        if (firstTextAt === null) {
          firstTextAt = Date.now()
          console.log(`[AtlasStream][${variant}] First Gemini text at ${since()}`)
        }
        fullText += part.text
        send({ type: 'delta', text: part.text })
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone) break

      buffer += decoder.decode(value, { stream: true })

      let match = FRAME_SEPARATOR.exec(buffer)
      while (match) {
        handleFrame(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
        match = FRAME_SEPARATOR.exec(buffer)
      }
    }

    buffer += decoder.decode()
    if (buffer.trim().length > 0) {
      handleFrame(buffer)
    }

    clearTimeout(timeoutId)

    if (clientGone) {
      console.log(`[AtlasStream] Stopped early (client gone) at ${since()}`)
      return
    }

    if (fullText.trim().length === 0) {
      // Matches the non-streaming route's fallback for an empty candidate.
      fullText = 'I am here.'
      send({ type: 'delta', text: fullText })
    }

    console.log(
      `[AtlasStream][${variant}] Generation complete at ${since()}, ${fullText.length} chars`
    )
    send({ type: 'done', text: fullText, variant })
    res.end()

    persistAssistantMessage(fullText)
  } catch (error: any) {
    clearTimeout(timeoutId)

    if (clientGone || error?.name === 'AbortError') {
      console.log('[AtlasStream] Request aborted; not reporting as an error')
      // Anything generated before the interruption is still worth keeping.
      if (fullText.trim().length > 0) persistAssistantMessage(fullText)
      if (!res.writableEnded) res.end()
      return
    }

    console.error('[AtlasStream] Error:', error)
    send({ type: 'error', error: error instanceof Error ? error.message : 'Internal server error' })
    if (!res.writableEnded) res.end()
  } finally {
    req.off('close', onClose)
  }
}

/** Save the assistant turn without blocking the response. */
function persistAssistantMessage(text: string): void {
  if (!currentConversationId) return
  const conversationId = currentConversationId

  const save = (async () => {
    const result = await saveMessage(conversationId, 'assistant', text)
    if (!result.success) {
      throw new Error(result.error || 'Save failed')
    }
    await updateConversationTimestamp(conversationId)
  })()

  const timeout = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Database save operation timed out')), DB_SAVE_TIMEOUT_MS)
  })

  Promise.race([save, timeout])
    .then(() => console.log('[AtlasStream] Assistant message persisted'))
    .catch((error) => console.error('[AtlasStream] Persistence failed:', error.message))
}

/** Push bytes out immediately even if a compression middleware is in the way. */
function flush(res: NextApiResponse): void {
  const flushable = res as unknown as { flush?: () => void }
  if (typeof flushable.flush === 'function') {
    flushable.flush()
  }
}
