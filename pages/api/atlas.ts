import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../lib/knowledge/knowledge-retriever'
import { getAllKnowledgeFiles } from '../../lib/supabase/library-db'
import { buildSystemPrompt } from '../../lib/atlas-prompt'
import {
  getOrCreateCurrentConversation,
  saveMessage,
  updateConversationTimestamp,
  getRecentConversationMessages,
  type MessageRecord,
} from '../../lib/supabase/conversations-db'

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: Record<string, any> }
}

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

interface ResponseData {
  content?: Array<{
    type: string
    text?: string
  }>
  error?: string
  details?: string
}

let currentConversationId: string | null = null
let conversationInitError: string | null = null

async function initializeConversation(): Promise<void> {
  if (currentConversationId) return
  if (conversationInitError) throw new Error(conversationInitError)

  try {
    const conversation = await getOrCreateCurrentConversation()
    currentConversationId = conversation.id
    console.log('[Atlas] Initialized conversation with ID:', currentConversationId)
  } catch (error) {
    conversationInitError = error instanceof Error ? error.message : String(error)
    console.warn('[Atlas] Conversation initialization error:', conversationInitError)
  }
}

async function callGemini(contents: GeminiContent[], system: string): Promise<{ content: Array<{ type: string; text?: string }> }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  console.log('[Atlas DEBUG] ABOUT TO CALL GEMINI NOW')
  console.log('[Gemini] Calling Gemini API with', contents.length, 'messages')

  const requestBody = {
    contents: contents,
    systemInstruction: {
      parts: [{ text: system }],
    },
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
    },
  }

  // Create abort controller with 30 second timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }
    )

    clearTimeout(timeoutId)
    console.log('[Atlas DEBUG] GEMINI CALL COMPLETED')
    console.log('[Gemini] Request completed, status:', response.status)

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      let upstreamInfo: any = null
      try {
        upstreamInfo = JSON.parse(responseText)
      } catch (_) {
        upstreamInfo = { message: responseText }
      }

      const errorMessage = upstreamInfo?.error?.message || upstreamInfo?.message || responseText
      const error = new Error(`Gemini error: ${errorMessage}`)
      ;(error as any).status = response.status
      throw error
    }

    const responseText = await response.text()
    const geminiResponse = JSON.parse(responseText || '{}')

    console.log('[Gemini] Response received successfully')

    if (!geminiResponse.candidates || !geminiResponse.candidates[0]) {
      return { content: [{ type: 'text', text: 'I am here.' }] }
    }

    const candidate = geminiResponse.candidates[0]
    const content: Array<{ type: string; text?: string }> = []

    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          content.push({ type: 'text', text: part.text })
        }
      }
    }

    if (content.length === 0) {
      content.push({ type: 'text', text: 'I am here.' })
    }

    return { content }
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Gemini request timeout (30s)')
    }
    throw error
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseData>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { message, clearHistory } = req.body

  if (clearHistory) {
    return res.status(200).json({ content: [{ type: 'text', text: 'History cleared' }] })
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid message' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' })
  }

  try {
    console.log('[Atlas] Processing request with Gemini')

    await initializeConversation()
    console.log('[Atlas DEBUG] Initialization completed')

    const trimmedMessage = message.trim()
    console.log('[Atlas DEBUG] Message trimmed')

    if (currentConversationId) {
      console.log('[Atlas DEBUG] Saving user message to database')
      const saveResult = await saveMessage(currentConversationId, 'user', trimmedMessage)
      if (!saveResult.success) {
        console.warn(`[Atlas] Failed to save user message: ${saveResult.error}`)
      } else {
        console.log('[Atlas DEBUG] User message saved successfully')
      }
    }

    console.log('[Atlas DEBUG] Knowledge retrieval completed')
    // The second argument is required: without it retrieveKnowledge searches an
    // empty file list and Atlas answers with no knowledge library at all.
    const retrievedKnowledge = await retrieveKnowledge(trimmedMessage, getAllKnowledgeFiles)
    const knowledgeContext = formatKnowledgeContext(retrievedKnowledge)
    console.log('[Atlas DEBUG] Knowledge context formatted')

    const systemPrompt = buildSystemPrompt(knowledgeContext)
    console.log('[Atlas DEBUG] System prompt prepared')

    console.log('[Atlas DEBUG] Retrieving recent conversation messages')
    const messages = currentConversationId ? await getRecentConversationMessages(currentConversationId, 6) : []
    console.log('[Atlas DEBUG] Retrieved', messages.length, 'recent messages')

    const contents: GeminiContent[] = []

    console.log('[Atlas DEBUG] Preparing Gemini contents')
    for (const msg of messages.slice(-4)) {
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }],
      })
    }
    console.log('[Atlas DEBUG] Added', contents.length, 'messages from history')

    console.log('[Atlas DEBUG] Adding current user message')
    contents.push({
      role: 'user',
      parts: [{ text: trimmedMessage }],
    })
    console.log('[Atlas DEBUG] Gemini contents fully prepared, total:', contents.length)

    console.log('[Atlas DEBUG] Calling Gemini API')
    const response = await callGemini(contents, systemPrompt)
    console.log('[Atlas DEBUG] Gemini response received')

    const assistantText = response.content.find((c) => c.type === 'text')?.text || 'I am here.'
    console.log('[Atlas DEBUG] Extracted assistant text, length:', assistantText.length)

    // Prepare the response immediately (don't wait for database)
    const responsePayload = { content: [{ type: 'text', text: assistantText }] }
    console.log('[Atlas DEBUG] Response payload prepared')

    // Save to database asynchronously with timeout (don't block the response)
    if (currentConversationId) {
      // Use Promise.race to enforce timeout on database operations
      const saveTimeoutMs = 5000 // 5 second timeout

      // Create timeout promise
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Database save operation timed out')), saveTimeoutMs)
      })

      // Race: whichever completes first
      try {
        console.log('[Atlas DEBUG] About to save assistant message', {
          conversationId: currentConversationId,
          textLength: assistantText.length,
        })

        const savePromise = (async () => {
          const saveResult = await saveMessage(currentConversationId, 'assistant', assistantText)
          if (!saveResult.success) {
            console.warn(`[Atlas] Failed to save assistant message: ${saveResult.error}`)
            throw new Error(saveResult.error || 'Save failed')
          }
          console.log('[Atlas DEBUG] Assistant message saved successfully')

          console.log('[Atlas DEBUG] Updating conversation timestamp')
          await updateConversationTimestamp(currentConversationId)
          console.log('[Atlas DEBUG] Timestamp updated')
        })()

        // Don't wait for save to complete - just attempt it
        Promise.race([savePromise, timeoutPromise])
          .then(() => {
            console.log('[Atlas DEBUG] Database persistence succeeded')
          })
          .catch((error) => {
            if (error.message === 'Database save operation timed out') {
              console.error('[Atlas ERROR] Assistant message database save timed out after', saveTimeoutMs, 'ms')
            } else {
              console.error('[Atlas ERROR] Database persistence failed:', error.message)
            }
          })
      } catch (error) {
        console.error('[Atlas ERROR] Exception during database save setup:', error)
      }
    }

    console.log('[Atlas DEBUG] Preparing final response')
    console.log('[Atlas DEBUG] RETURNING RESPONSE TO FRONTEND')
    return res.status(200).json(responsePayload)
  } catch (error: any) {
    console.error('[Atlas ERROR] Exception caught:', error)
    if (error instanceof Error) {
      console.error('[Atlas ERROR] Stack trace:', error.stack)
    }

    if (error?.status) {
      return res.status(error.status).json({
        error: error.message || 'Gemini error',
      })
    }

    console.error('[Atlas] API handler error:', error)
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' })
  }
}
