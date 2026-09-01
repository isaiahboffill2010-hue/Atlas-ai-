import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../lib/knowledge/knowledge-retriever'
import { executeOpenClawAgent } from '../../lib/openclaw/client'
import { isPrintRequest } from '../../lib/openclaw/tools'
import { getPersonName } from '../../lib/config'
import {
  getEmail,
  listEmails,
  replyEmail,
  searchEmails,
  sendEmail,
  isAffirmativeConfirmation,
  isNegativeConfirmation,
  summarizePendingEmailAction,
  type PendingEmailAction,
} from '../../lib/agentmail'
import {
  getOrCreateCurrentConversation,
  saveMessage,
  updateConversationTimestamp,
  getRecentConversationMessages,
  searchRelevantMessages,
  type MessageRecord,
} from '../../lib/supabase/conversations-db'

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, any>
  tool_use_id?: string
  content?: string | Array<{ type: 'text'; text: string }>
  is_error?: boolean
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
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

const conversationHistory: AnthropicMessage[] = []
const MAX_HISTORY_MESSAGES = 12

let pendingEmailAction: PendingEmailAction | null = null
let currentConversationId: string | null = null
let conversationInitError: string | null = null

const allToolDefinitions = [
  {
    name: 'search_emails',
    description: 'Search emails in Atlas Mail by keyword across the configured inbox.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms to find relevant emails.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of results to return.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_emails',
    description: 'List recent emails from the configured inbox.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of emails to return.' },
        from: { type: 'string', description: 'Filter by sender substring.' },
        to: { type: 'string', description: 'Filter by recipient substring.' },
        subject: { type: 'string', description: 'Filter by subject substring.' },
        before: { type: 'string', description: 'Only return emails before this timestamp.' },
        after: { type: 'string', description: 'Only return emails after this timestamp.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_email',
    description: 'Fetch one email by message ID.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The AgentMail message ID.' },
      },
      required: ['message_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_email',
    description:
      'Draft an email to send. This tool requires explicit user confirmation before the server will execute it.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'array',
          items: { type: 'string' },
          description: 'Recipient email address or addresses.',
        },
        subject: { type: 'string', description: 'Email subject line.' },
        text: { type: 'string', description: 'Plain-text body.' },
        html: { type: 'string', description: 'Optional HTML body.' },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional CC recipients.',
        },
        bcc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional BCC recipients.',
        },
        replyTo: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reply-to address or addresses.',
        },
      },
      required: ['to', 'subject', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'reply_email',
    description:
      'Draft a reply to an email. This tool requires explicit user confirmation before the server will execute it.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The message to reply to.' },
        text: { type: 'string', description: 'Plain-text reply body.' },
        html: { type: 'string', description: 'Optional HTML reply body.' },
        replyAll: { type: 'boolean', description: 'Reply to everyone on the thread.' },
      },
      required: ['message_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_openclaw',
    description:
      'Use OpenClaw for browser, file, and other computer-control actions when a local desktop task is needed.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The task description to send to OpenClaw.' },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
]

// Allowlist: Only enable non-email tools
const toolDefinitions = allToolDefinitions.filter((tool) => !tool.name.includes('email'))

function appendHistory(message: AnthropicMessage) {
  conversationHistory.push(message)
  while (conversationHistory.length > MAX_HISTORY_MESSAGES) {
    conversationHistory.shift()
  }
}

async function initializeConversation() {
  if (currentConversationId || conversationInitError) {
    return
  }

  try {
    const { id } = await getOrCreateCurrentConversation()
    currentConversationId = id
    console.log(`[Claude] Initialized conversation: ${currentConversationId}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    conversationInitError = errorMessage
    console.error(`[Claude] Failed to initialize conversation: ${errorMessage}`)
  }
}

async function buildContextFromDatabase(userMessage: string): Promise<string> {
  if (!currentConversationId) {
    return ''
  }

  try {
    const recentMessages = await getRecentConversationMessages(currentConversationId, 8)
    let context = ''

    if (recentMessages.length > 0) {
      context += 'RECENT CONVERSATION CONTEXT:\n'
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? 'You' : 'Atlas'
        context += `${role}: ${msg.content}\n`
      }
      context += '\n'
    }

    const relevantOldMessages = await searchRelevantMessages(userMessage, 3, currentConversationId)
    if (relevantOldMessages.length > 0) {
      context += 'RELEVANT PREVIOUS MEMORIES:\n'
      for (const msg of relevantOldMessages) {
        const role = msg.role === 'user' ? 'You' : 'Atlas'
        const date = new Date(msg.created_at).toLocaleDateString()
        context += `[${date}] ${role}: ${msg.content}\n`
      }
      context += '\n'
    }

    return context
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[Claude] Error building context from database: ${errorMessage}`)
    return ''
  }
}

function trimText(text: string, max = 1200): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}…`
}

function getTextBlock(content: AnthropicContentBlock[] | undefined): string {
  if (!content) return ''
  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text || '')
    .join('\n')
    .trim()
}

function parseToolUses(content: AnthropicContentBlock[] | undefined) {
  return (content || []).filter((block) => block.type === 'tool_use' && block.id && block.name && block.input) as Array<
    Required<Pick<AnthropicContentBlock, 'type' | 'id' | 'name' | 'input'>>
  >
}

function buildSystemPrompt(knowledgeContext: string, conversationContext: string = ''): string {
  const personName = getPersonName()
  const basePrompt = `You are an AI representation of ${personName}, created from documented memories, personal stories, and shared information. Your role is to engage in conversations that reflect their life, personality, values, and experiences.

PERSONALITY & BEHAVIOR:
- Speak as if you are this person, reflecting their documented personality, communication style, and perspective
- Be authentic, warm, and genuine in conversations
- You move conversations forward naturally
- You never sound like an AI explaining its reasoning or apologizing for being an AI
- Keep responses conversational and human-like, usually 2-3 sentences

GROUNDING IN DOCUMENTED INFORMATION:
- Use retrieved memories from the Memory Library as factual grounding for conversations
- Treat documented information as accurate representations of this person
- Reference personal experiences and memories when relevant to the conversation
- Build on documented personality traits, values, and preferences

CRITICAL: DO NOT INVENT OR FABRICATE:
- Never invent memories or life events that are not documented
- Never invent relationships or claim to know people unless explicitly documented
- Never claim to personally remember something unless it is in the Memory Library
- Never fabricate personality traits, preferences, or communication patterns
- Do not create false connections between unrelated documented information
- If asked about undocumented information, express uncertainty naturally: "I don't recall that, but..."

EMAIL WORKFLOW:
- Use search_emails, list_emails, and get_email for reading emails
- Use send_email and reply_email only when the user has explicitly confirmed they want you to send the message
- If the user wants you to send or reply to an email, draft the action and wait for confirmation
- Never claim an email was sent until the server confirms it

OPENCLAW WORKFLOW:
- Use run_openclaw for browser, file, and other desktop actions when needed
- Prefer it for tasks that require interacting with the local machine

ACCURACY & HONESTY:
Never claim information is true if it's not documented. When uncertain, express it naturally without inventing details. The goal is to create a meaningful representation based on what is actually known.`

  let fullPrompt = basePrompt

  if (conversationContext) {
    fullPrompt += `\n\nCONVERSATION MEMORY:\n${conversationContext}`
  }

  if (knowledgeContext) {
    fullPrompt += `\n${knowledgeContext}`
  }

  return fullPrompt
}

async function callGemini(messages: AnthropicMessage[], system: string, withTools = true): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  console.log('[Gemini] Calling Gemini 2.5 Flash API with', messages.length, 'messages')

  // Convert Anthropic message format to proper Gemini format
  const geminiMessages: any[] = []
  for (const msg of messages) {
    const parts: any[] = []
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        // Gemini format: just { text: "..." }, NOT { type: "text", text: "..." }
        parts.push({ text: block.text })
      } else if (block.type === 'tool_result' && block.content) {
        parts.push({ text: `Tool result: ${block.content}` })
      }
    }

    if (parts.length > 0) {
      geminiMessages.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: parts,
      })
    }
  }

  // Build request body for Gemini (proper Gemini-compatible format)
  const requestBody: Record<string, any> = {
    contents: geminiMessages,
    systemInstruction: {
      parts: [{ text: system }],
    },
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
    },
  }

  // Add tools if needed - convert Anthropic tool schema to Gemini format
  if (withTools && toolDefinitions.length > 0) {
    requestBody.tools = [
      {
        functionDeclarations: toolDefinitions.map((tool) => {
          // Create Gemini-compatible parameters by excluding unsupported JSON Schema fields
          const { additionalProperties, ...geminiParams } = tool.input_schema as any

          return {
            name: tool.name,
            description: tool.description,
            parameters: geminiParams,
          }
        }),
      },
    ]
  }

  console.log('[GEMINI DEBUG] About to call Gemini API')
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  )

  console.log('[GEMINI DEBUG] Gemini request completed, status:', response.status)
  const responseText = await response.text().catch(() => '')
  console.log('[GEMINI DEBUG] Raw response text length:', responseText.length)
  console.log('[GEMINI DEBUG] Raw response (first 500 chars):', responseText.substring(0, 500))

  if (!response.ok) {
    console.log('[GEMINI DEBUG] Response not OK, status:', response.status)
    let upstreamInfo: any = null
    try {
      upstreamInfo = JSON.parse(responseText)
    } catch (_) {
      upstreamInfo = { message: responseText }
    }

    const errorMessage = upstreamInfo?.error?.message || upstreamInfo?.message || responseText
    console.log('[GEMINI DEBUG] Throwing error:', errorMessage)
    const error = new Error(`Gemini error: ${errorMessage}`)
    ;(error as any).status = response.status
    throw error
  }

  console.log('[GEMINI DEBUG] Response is OK, parsing JSON')
  const geminiResponse = JSON.parse(responseText || '{}')
  console.log('[GEMINI DEBUG] Parsed gemini response:', JSON.stringify(geminiResponse).substring(0, 300))

  console.log('[Gemini] Received response from Gemini API')
  console.log('[Gemini] Full response:', JSON.stringify(geminiResponse).substring(0, 500))

  // Convert Gemini response format back to Anthropic format
  if (!geminiResponse.candidates || !geminiResponse.candidates[0]) {
    console.log('[Gemini] No candidates in response, returning default message')
    return { content: [{ type: 'text', text: 'No response from Gemini' }] }
  }

  const candidate = geminiResponse.candidates[0]
  const content: AnthropicContentBlock[] = []

  if (candidate.content && candidate.content.parts) {
    console.log('[Gemini] Found', candidate.content.parts.length, 'parts in response')
    for (const part of candidate.content.parts) {
      if (part.text) {
        console.log('[Gemini] Found text part:', part.text.substring(0, 100))
        content.push({ type: 'text', text: part.text })
      } else if (part.functionCall) {
        console.log('[Gemini] Found function call:', part.functionCall.name)
        // Convert function call to tool_use format
        content.push({
          type: 'tool_use',
          id: `call_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        })
      }
    }
  }

  // If no content generated, return default response
  if (content.length === 0) {
    console.log('[Gemini] No content parts found, using default response')
    content.push({ type: 'text', text: 'I am here.' })
  }

  console.log('[Gemini] Returning', content.length, 'content blocks to frontend')
  console.log('[Gemini] Response being sent:', JSON.stringify({ content }).substring(0, 200))

  return { content }
}

async function runOpenClaw(message: string): Promise<string> {
  const enhancedMessage = isPrintRequest(message)
    ? `${message}\n\nIMPORTANT: Use OpenClaw's computer control to print using the actual Windows desktop GUI. Do not use PowerShell or command-line printing.`
    : message

  const result = await executeOpenClawAgent(enhancedMessage)

  if (!result.success) {
    throw new Error(result.error || 'OpenClaw request failed')
  }

  return result.result?.content || 'OpenClaw task completed.'
}

function buildConfirmationPrompt(action: PendingEmailAction): string {
  return summarizePendingEmailAction(action)
}

async function executePendingEmailAction(pendingAction: PendingEmailAction): Promise<{ text: string; raw: any }> {
  if (pendingAction.action === 'send_email') {
    const result = await sendEmail(pendingAction.input)
    return {
      text: `Email sent successfully to ${Array.isArray((pendingAction.input as any).to) ? (pendingAction.input as any).to.join(', ') : (pendingAction.input as any).to}.`,
      raw: result,
    }
  }

  const result = await replyEmail(pendingAction.input)
  return {
    text: 'Reply sent successfully.',
    raw: result,
  }
}

async function turnToolResultsIntoFinalText(userMessage: string, actionText: string): Promise<string> {
  try {
    const response = await callGemini(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${userMessage}\n\nThe following action was completed successfully: ${actionText}\n\nRespond naturally in 1-2 sentences.`,
            },
          ],
        },
      ],
      'You are Atlas. Confirm completed actions in a natural, concise way.',
      false
    )

    const text = getTextBlock(response.content)
    return text || actionText
  } catch (_) {
    return actionText
  }
}

async function handleToolCalls(
  toolUses: ReturnType<typeof parseToolUses>,
  currentUserMessage: string,
  assistantHistorySystem: string
): Promise<{ finalText?: string; pending?: PendingEmailAction }> {
  const toolResults: AnthropicContentBlock[] = []

  for (const toolUse of toolUses) {
    const input = toolUse.input || {}

    if (toolUse.name === 'send_email' || toolUse.name === 'reply_email') {
      const pendingAction: PendingEmailAction =
        toolUse.name === 'send_email'
          ? {
              action: 'send_email',
              input: {
                inboxId: process.env.AGENTMAIL_INBOX_ID?.trim(),
                to: input.to,
                subject: input.subject,
                text: input.text,
                html: input.html,
                cc: input.cc,
                bcc: input.bcc,
                replyTo: input.replyTo,
              },
              summary: `Send an email to ${Array.isArray(input.to) ? input.to.join(', ') : input.to} with subject "${input.subject}"`,
              createdAt: Date.now(),
            }
          : {
              action: 'reply_email',
              input: {
                inboxId: process.env.AGENTMAIL_INBOX_ID?.trim(),
                messageId: input.message_id,
                text: input.text,
                html: input.html,
                replyAll: input.replyAll,
              },
              summary: `Reply to email ${input.message_id}`,
              createdAt: Date.now(),
            }

      pendingEmailAction = pendingAction
      return {
        pending: pendingAction,
      }
    }

    if (toolUse.name === 'search_emails') {
      const result = await searchEmails({
        query: String(input.query || ''),
        limit: input.limit,
      })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      })
      continue
    }

    if (toolUse.name === 'list_emails') {
      const result = await listEmails({
        limit: input.limit,
        from: input.from,
        to: input.to,
        subject: input.subject,
        before: input.before,
        after: input.after,
      })

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      })
      continue
    }

    if (toolUse.name === 'get_email') {
      const result = await getEmail(String(input.message_id))
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      })
      continue
    }

    if (toolUse.name === 'run_openclaw') {
      const result = await runOpenClaw(String(input.message || currentUserMessage))
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify({ result: trimText(result, 4000) }),
      })
      continue
    }
  }

  if (toolResults.length === 0) {
    return {}
  }

  appendHistory({
    role: 'assistant',
    content: toolUses.map((toolUse) => ({
      type: 'tool_use',
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
    })),
  })

  appendHistory({
    role: 'user',
    content: toolResults,
  })

  const followUp = await callGemini(conversationHistory, assistantHistorySystem, true)
  const followUpToolUses = parseToolUses(followUp.content)

  if (followUpToolUses.length > 0) {
    const nested = await handleToolCalls(followUpToolUses, currentUserMessage, assistantHistorySystem)
    if (nested.pending) {
      return { pending: nested.pending }
    }
    if (nested.finalText) {
      return nested
    }
  }

  const finalText = getTextBlock(followUp.content)
  if (!finalText) {
    return {}
  }

  appendHistory({
    role: 'assistant',
    content: [{ type: 'text', text: finalText }],
  })

  return {
    finalText,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseData>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { message, clearHistory } = req.body

  if (clearHistory) {
    conversationHistory.length = 0
    pendingEmailAction = null
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
    console.log('[Atlas LLM] Processing request with Gemini 2.5 Flash as the brain')

    // Initialize conversation on first request
    await initializeConversation()

    const trimmedMessage = message.trim()

    // Save user message to database (gracefully handle errors)
    if (currentConversationId) {
      const saveResult = await saveMessage(currentConversationId, 'user', trimmedMessage)
      if (!saveResult.success) {
        console.warn(`[Atlas] Failed to save user message: ${saveResult.error}`)
      }
    }

    if (pendingEmailAction) {
      if (isAffirmativeConfirmation(trimmedMessage)) {
        appendHistory({
          role: 'user',
          content: [{ type: 'text', text: trimmedMessage }],
        })

        const completed = await executePendingEmailAction(pendingEmailAction)
        const finalText = await turnToolResultsIntoFinalText(trimmedMessage, completed.text)
        pendingEmailAction = null

        appendHistory({
          role: 'assistant',
          content: [{ type: 'text', text: finalText }],
        })

        // Save assistant response to database
        if (currentConversationId) {
          const saveResult = await saveMessage(currentConversationId, 'assistant', finalText)
          if (!saveResult.success) {
            console.warn(`[Claude] Failed to save assistant message: ${saveResult.error}`)
          }
          await updateConversationTimestamp(currentConversationId)
        }

        return res.status(200).json({ content: [{ type: 'text', text: finalText }] })
      }

      if (isNegativeConfirmation(trimmedMessage)) {
        pendingEmailAction = null
        appendHistory({
          role: 'user',
          content: [{ type: 'text', text: trimmedMessage }],
        })

        const finalText = "No problem. I won't send it."
        appendHistory({
          role: 'assistant',
          content: [{ type: 'text', text: finalText }],
        })

        // Save assistant response to database
        if (currentConversationId) {
          const saveResult = await saveMessage(currentConversationId, 'assistant', finalText)
          if (!saveResult.success) {
            console.warn(`[Claude] Failed to save assistant message: ${saveResult.error}`)
          }
          await updateConversationTimestamp(currentConversationId)
        }

        return res.status(200).json({ content: [{ type: 'text', text: finalText }] })
      }
    }

    const retrievedKnowledge = await retrieveKnowledge(trimmedMessage)
    const knowledgeContext = formatKnowledgeContext(retrievedKnowledge)

    // Build context from conversation database
    const conversationContext = await buildContextFromDatabase(trimmedMessage)

    let systemPrompt = buildSystemPrompt(knowledgeContext, conversationContext)

    appendHistory({
      role: 'user',
      content: [{ type: 'text', text: trimmedMessage }],
    })

    const initialResponse = await callGemini(conversationHistory, systemPrompt, true)
    const initialToolUses = parseToolUses(initialResponse.content)

    if (initialToolUses.length > 0) {
      const toolOutcome = await handleToolCalls(initialToolUses, trimmedMessage, systemPrompt)

      if (toolOutcome.pending) {
        const confirmationText = buildConfirmationPrompt(toolOutcome.pending)
        appendHistory({
          role: 'assistant',
          content: [{ type: 'text', text: confirmationText }],
        })

        // Save pending confirmation to database
        if (currentConversationId) {
          const saveResult = await saveMessage(currentConversationId, 'assistant', confirmationText)
          if (!saveResult.success) {
            console.warn(`[Claude] Failed to save assistant message: ${saveResult.error}`)
          }
          await updateConversationTimestamp(currentConversationId)
        }

        return res.status(200).json({ content: [{ type: 'text', text: confirmationText }] })
      }

      if (toolOutcome.finalText) {
        // Save assistant response to database
        if (currentConversationId) {
          const saveResult = await saveMessage(currentConversationId, 'assistant', toolOutcome.finalText)
          if (!saveResult.success) {
            console.warn(`[Claude] Failed to save assistant message: ${saveResult.error}`)
          }
          await updateConversationTimestamp(currentConversationId)
        }

        return res.status(200).json({ content: [{ type: 'text', text: toolOutcome.finalText }] })
      }
    }

    const assistantText = getTextBlock(initialResponse.content)

    console.log('[API] Final response text from Gemini:', assistantText.substring(0, 100))
    console.log('[API] Response is empty?', !assistantText || assistantText.trim().length === 0)

    if (assistantText) {
      appendHistory({
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
      })

      // Save assistant response to database
      if (currentConversationId) {
        const saveResult = await saveMessage(currentConversationId, 'assistant', assistantText)
        if (!saveResult.success) {
          console.warn(`[Claude] Failed to save assistant message: ${saveResult.error}`)
        }
        await updateConversationTimestamp(currentConversationId)
      }

      const responsePayload = { content: [{ type: 'text', text: assistantText }] }
      console.log('[API DEBUG] About to return response to client')
      console.log('[API DEBUG] Response payload:', JSON.stringify(responsePayload))
      console.log('[API DEBUG] Sending status 200')
      return res.status(200).json(responsePayload)
    }

    const fallbackText = 'I am here.'
    console.log('[API DEBUG] No assistant text, returning fallback:', fallbackText)
    const fallbackPayload = { content: [{ type: 'text', text: fallbackText }] }
    console.log('[API DEBUG] Fallback payload:', JSON.stringify(fallbackPayload))
    return res.status(200).json(fallbackPayload)
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({
        error: error.message || 'Anthropic error',
        request_id: error.requestId,
      })
    }

    console.error('[Claude] API handler error:', error)
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' })
  }
}
