import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../lib/knowledge/knowledge-retriever'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ResponseData {
  content?: Array<{
    type: string
    text?: string
  }>
  error?: string
  details?: string
  request_id?: string
}

// Simple in-memory conversation history (resets on server restart)
// For production, use a database
const conversationHistory: Message[] = []
const MAX_HISTORY = 10

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseData>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { message, clearHistory } = req.body

  if (clearHistory) {
    console.log('[Claude] Clearing conversation history')
    conversationHistory.length = 0
    return res.status(200).json({ content: [{ type: 'text', text: 'History cleared' }] })
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid message' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[Claude] ANTHROPIC_API_KEY not set')
    return res.status(500).json({ error: 'API key not configured' })
  }

  try {
    const trimmedMessage = message.trim()

    // Retrieve relevant knowledge from Atlas Library
    console.log('[Claude] Retrieving knowledge for user message')
    const retrievedKnowledge = await retrieveKnowledge(trimmedMessage)
    const knowledgeContext = formatKnowledgeContext(retrievedKnowledge)

    // Track sources for this request
    const sources = retrievedKnowledge.map((k) => k.source)
    const knowledgeUsed = sources.length > 0

    if (knowledgeUsed) {
      console.log(`[Claude] Knowledge sources attached: ${sources.length}`)
      sources.forEach((s) => {
        console.log(`[Claude]   - ${s.fileName} (${s.category} → ${s.type})`)
      })
    }

    // Build system prompt with knowledge context if available
    let systemPrompt = `You are Atlas, the owner of a printing business. You speak directly with customers about orders, pricing, and printing services.

PERSONALITY:
You are confident, experienced, professional, and friendly. You know your business well. You speak naturally and conversationally. You move the conversation forward. You never sound like an AI explaining its reasoning.

CUSTOMER CONVERSATIONS:
- Keep responses short and natural (2-3 sentences typically)
- Speak like a real business owner, not a chatbot
- Do not expose calculations, file names, databases, or internal reasoning
- Do not say things like "according to my knowledge base" or "I retrieved this from"
- Do not show work like "50 × $20 = $1,000". Instead say "50 shirts would be $1,000"
- Ask smart follow-up questions that move the sale forward
- Be friendly without being weak
- Be confident without being arrogant
- Be persuasive without being pushy

PRICING & QUOTES:
When giving a price, state it naturally and confidently. Combine applicable pricing rules from verified information to create complete quotes when possible. If you need more information, ask a natural business question instead of refusing to help.

EXAMPLE:
Customer: "50 premium hoodies with front and back printing"
Say: "50 premium hoodies would be $2,000. Do you have the design ready, and are the front and back prints the same or different?"

MISSING INFORMATION:
Never invent prices, discounts, fees, policies, products, or turnaround times. If information is genuinely missing, identify what you know and ask naturally about what you need.

EXAMPLE:
Customer: "How much for embroidered backpacks?"
Say: "I don't have embroidery pricing in my system, but I can point you to our embroidery vendor who handles that. What's your timeline?"

OBJECTIONS & NEGOTIATION:
When a customer says the price is too high, respond professionally. Never sound desperate. Don't immediately invent discounts. Instead, investigate: "What price were you quoted? If you tell me what's included, I'll see how we're comparing."

ACCURACY & HONESTY:
You only use verified pricing from the customer's business information. You never make up information. You don't apologize excessively. You stand behind your prices and products. You help customers understand value, not just price.

IF CUSTOMER ASKS "WHERE DID YOU GET THAT?":
You can explain accurately. If they ask where a price came from, you can say "That's from the pricing information you provided" or identify the specific document if you know it. Do not make up sources. Do not claim information if you're not certain.`

    if (knowledgeContext) {
      console.log('[Claude] Adding verified knowledge context to request')
      systemPrompt = systemPrompt + '\n\n' + knowledgeContext
    }

    // Add user message to history
    conversationHistory.push({
      role: 'user',
      content: trimmedMessage,
    })

    console.log('[Claude] Sending request with history length:', conversationHistory.length)

    // Use a single model name configurable via ANTHROPIC_MODEL to avoid
    // repeatedly attempting known-bad model IDs. Do not guess which models
    // are enabled for the account — require configuration or use a single
    // conservative default.
    const upstreamUrl = 'https://api.anthropic.com/v1/messages'
    const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
    if (!configuredModel) {
      console.error('[Claude] ANTHROPIC_MODEL not configured')
      return res.status(500).json({
        error:
          'Server misconfiguration: ANTHROPIC_MODEL is not set. Set the exact Anthropic model ID supported by your account, such as claude-opus-5, claude-sonnet-5, claude-fable-5, or claude-haiku-4-5-20251001.',
      })
    }
    const upstreamBody = {
      model: configuredModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationHistory,
    }

    let response: any = null
    let data: any = null

    try {
      console.log('[Claude] Using model:', configuredModel)
      console.log('[Claude] API Key (first 20 chars):', apiKey.substring(0, 20))
      console.log('[Claude] Request body:', JSON.stringify(upstreamBody, null, 2))
      response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
      })

      const respText = await response.text().catch(() => '')

      if (!response.ok) {
        // Try to parse structured error from upstream, but avoid leaking secrets
        let upstreamInfo: any = null
        try {
          upstreamInfo = JSON.parse(respText)
        } catch (_) {
          upstreamInfo = { message: respText }
        }

        console.error('[Claude] Upstream error - Status:', response.status)
        console.error('[Claude] Upstream error - Response:', JSON.stringify(upstreamInfo, null, 2))
        console.error('[Claude] Full response text:', respText)

        // If model was not found, return a clear 404 explaining the model issue
        if (response.status === 404) {
          const requestId = upstreamInfo?.request_id || upstreamInfo?.error?.request_id
          const upstreamMessage = upstreamInfo?.error?.message || upstreamInfo?.message || respText
          return res.status(404).json({
            error: `Configured Anthropic model not found: ${configuredModel}`,
            details:
              `${upstreamMessage} Check ANTHROPIC_MODEL in .env.local and use a model your Anthropic account supports, e.g. claude-3.5 or claude-4.`,
            request_id: requestId,
          })
        }

        // For other upstream errors, propagate status and a safe message
        return res.status(response.status).json({ error: `Anthropic error: ${upstreamInfo?.error?.message || upstreamInfo?.message || respText}` })
      }

      // parse success body
      data = JSON.parse(respText || '{}')
      console.log('[Claude] Raw response:', JSON.stringify(data, null, 2))
    } catch (err: any) {
      console.error('[Claude] Fetch error:', err)
      return res.status(502).json({ error: 'Failed to contact Anthropic API' })
    }

    // Parse response from Messages API
    let assistantMessage = ''
    if (Array.isArray(data.content)) {
      const textContent = data.content.find((c: any) => c.type === 'text')
      if (textContent?.text) {
        assistantMessage = textContent.text
      }
    }
    console.log('[Claude] Parsed message:', assistantMessage)

    // Add assistant response to history
    if (assistantMessage) {
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      })

      // Keep history from getting too large
      if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory.splice(0, 2)
      }
    }

    console.log('[Claude] Response generated, history length now:', conversationHistory.length)
    return res.status(200).json({ content: [{ type: 'text', text: assistantMessage }] })
  } catch (error) {
    console.error('[Claude] API handler error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
