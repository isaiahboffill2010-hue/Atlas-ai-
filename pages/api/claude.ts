import type { NextApiRequest, NextApiResponse } from 'next'
import { retrieveKnowledge, formatKnowledgeContext } from '../../lib/knowledge/knowledge-retriever'
import { executeOpenClawAgent } from '../../lib/openclaw/client'
import { isPrintRequest } from '../../lib/openclaw/tools'
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

const toolDefinitions = [
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

function appendHistory(message: AnthropicMessage) {
  conversationHistory.push(message)
  while (conversationHistory.length > MAX_HISTORY_MESSAGES) {
    conversationHistory.shift()
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

function buildSystemPrompt(knowledgeContext: string): string {
  const basePrompt = `You are Atlas, the owner of a printing business. You speak directly with customers about orders, pricing, printing services, email, and office work.

PERSONALITY:
You are confident, experienced, professional, and friendly. You know your business well. You speak naturally and conversationally. You move the conversation forward. You never sound like an AI explaining its reasoning.

GENERAL CONVERSATION:
- Keep responses short and natural, usually 2-3 sentences
- Speak like a real business owner, not a chatbot
- Do not expose calculations, file names, databases, or internal reasoning
- Do not say things like "according to my knowledge base" or "I retrieved this from"
- Do not show work unless the user explicitly asks
- Ask smart follow-up questions that move the conversation forward

PRICING & QUOTES:
When giving a price, state it naturally and confidently. Combine applicable pricing rules from verified information to create complete quotes when possible. If you need more information, ask a natural business question instead of refusing to help.

EMAIL WORKFLOW:
- Use search_emails, list_emails, and get_email for reading, searching, and gathering context from mail
- Use send_email and reply_email only when the user has explicitly confirmed they want you to send the message
- If the user wants you to send or reply to an email, draft the action and wait for confirmation
- Never claim an email was sent until the server confirms it
- If the user says "yes", "go ahead", "send it", or similar after a confirmation request, proceed with the stored email action

OPENCLAW WORKFLOW:
- Use run_openclaw for browser, file, and other desktop actions
- Prefer it for tasks that require interacting with the local machine

ACCURACY & HONESTY:
Never invent prices, discounts, fees, policies, products, email details, or turnaround times. If information is missing, identify what you know and ask naturally for what you need.`

  if (!knowledgeContext) {
    return basePrompt
  }

  return `${basePrompt}

VERIFIED BUSINESS INFORMATION:
${knowledgeContext}`
}

async function callClaude(messages: AnthropicMessage[], system: string, withTools = true): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const configuredModel = process.env.ANTHROPIC_MODEL?.trim()
  if (!configuredModel) {
    throw new Error('ANTHROPIC_MODEL not configured')
  }

  const body: Record<string, any> = {
    model: configuredModel,
    max_tokens: 1024,
    system,
    messages,
  }

  if (withTools) {
    body.tools = toolDefinitions
    body.tool_choice = { type: 'auto' }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const responseText = await response.text().catch(() => '')

  if (!response.ok) {
    let upstreamInfo: any = null
    try {
      upstreamInfo = JSON.parse(responseText)
    } catch (_) {
      upstreamInfo = { message: responseText }
    }

    const errorMessage = upstreamInfo?.error?.message || upstreamInfo?.message || responseText
    const error = new Error(`Anthropic error: ${errorMessage}`)
    ;(error as any).status = response.status
    ;(error as any).requestId = upstreamInfo?.request_id || upstreamInfo?.error?.request_id
    throw error
  }

  return JSON.parse(responseText || '{}')
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
    const response = await callClaude(
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

  const followUp = await callClaude(conversationHistory, assistantHistorySystem, true)
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  try {
    const trimmedMessage = message.trim()

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

        return res.status(200).json({ content: [{ type: 'text', text: finalText }] })
      }
    }

    const retrievedKnowledge = await retrieveKnowledge(trimmedMessage)
    const knowledgeContext = formatKnowledgeContext(retrievedKnowledge)

    let systemPrompt = buildSystemPrompt(knowledgeContext)

    appendHistory({
      role: 'user',
      content: [{ type: 'text', text: trimmedMessage }],
    })

    const initialResponse = await callClaude(conversationHistory, systemPrompt, true)
    const initialToolUses = parseToolUses(initialResponse.content)

    if (initialToolUses.length > 0) {
      const toolOutcome = await handleToolCalls(initialToolUses, trimmedMessage, systemPrompt)

      if (toolOutcome.pending) {
        const confirmationText = buildConfirmationPrompt(toolOutcome.pending)
        appendHistory({
          role: 'assistant',
          content: [{ type: 'text', text: confirmationText }],
        })
        return res.status(200).json({ content: [{ type: 'text', text: confirmationText }] })
      }

      if (toolOutcome.finalText) {
        return res.status(200).json({ content: [{ type: 'text', text: toolOutcome.finalText }] })
      }
    }

    const assistantText = getTextBlock(initialResponse.content)

    if (assistantText) {
      appendHistory({
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
      })
      return res.status(200).json({ content: [{ type: 'text', text: assistantText }] })
    }

    return res.status(200).json({ content: [{ type: 'text', text: 'I am here.' }] })
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
