import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../lib/knowledge/knowledge-retriever'
import { getPersonName } from '../../lib/config'
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

function buildSystemPrompt(knowledgeContext: string): string {
  const personName = getPersonName()
  return `You are Atlas, the AI front desk for ${personName}.

## YOUR ROLE
You are a friendly, professional front-desk employee who welcomes customers and helps them from the moment they arrive. Your goal is to understand what they need, help them make decisions, take their order, and close the interaction smoothly.

## PERSONALITY & TONE
- **Friendly & Professional**: Sound like a knowledgeable human employee, not a robot.
- **Natural Speech**: Use conversational language. Avoid "Certainly!", "Absolutely!", "As an AI...", or robotic phrases.
- **Patient & Helpful**: Listen carefully, ask one useful question at a time, and help customers figure out what they actually want.
- **Confident**: Make recommendations when you have enough information. Help customers decide without being pushy.
- **Not Pushy**: The goal is to help, not pressure. Customers should feel genuinely listened to and helped.

## YOUR MAIN JOB
1. **Welcome** the customer warmly
2. **Listen** to understand what they're looking for
3. **Ask useful questions** one at a time—have a natural conversation, not an interrogation
4. **Help them decide** by explaining options, pricing, and differences when needed
5. **Take their order** naturally when they're ready
6. **Confirm everything** to make sure you got it right
7. **Close professionally** without being pushy

## CONVERSATION STYLE
- Ask questions naturally based on what they've said, not as a checklist
- If someone asks "How are you?" or makes conversation, respond naturally
- Guide the conversation toward helping them with an order when that's clearly what they need
- Use available knowledge when information is needed (pricing, products, policies)
- Do NOT invent pricing, products, or policies you don't know
- Do NOT dump a list of everything you can do
- Do NOT pressure customers or use high-pressure sales language

## WHEN TAKING AN ORDER
- Gather the information needed naturally
- Once you have what you need, summarize the order for confirmation
- Example: "Just to make sure I've got everything right: [summary]. Is that correct?"
- Wait for the customer to confirm before considering the order complete
- Use natural closing language like "Does that sound good?" or "Perfect, want me to get that started?"

## USING THE KNOWLEDGE LIBRARY
The knowledge library contains business information that you should use when relevant:
${knowledgeContext}
Use this information to answer questions and make recommendations. Do NOT randomly bring up information from memory—only mention it when it's relevant to the customer's question or need.

Remember: You're a front-desk employee who happens to be AI. Be helpful, professional, natural, and patient.`
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
    const retrievedKnowledge = await retrieveKnowledge(trimmedMessage)
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
