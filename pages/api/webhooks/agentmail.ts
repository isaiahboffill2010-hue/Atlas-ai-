import type { NextApiRequest, NextApiResponse } from 'next'
import { IncomingMessage } from 'http'
import { WebhookVerificationError } from 'svix'
import {
  parseAgentMailWebhookPayload,
  recordWebhookEvent,
  storeIncomingMessage,
  verifyAgentMailWebhook,
} from '../../../lib/agentmail'

export const config = {
  api: {
    bodyParser: false,
  },
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

function normalizeEmailArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item))
  }

  if (typeof value === 'string' && value.length > 0) {
    return [value]
  }

  return []
}

function normalizeWebhookMessage(raw: any) {
  return {
    messageId: String(raw?.message_id || raw?.messageId || raw?.id || ''),
    threadId: raw?.thread_id || raw?.threadId,
    inboxId: raw?.inbox_id || raw?.inboxId || process.env.AGENTMAIL_INBOX_ID?.trim(),
    from: raw?.from,
    to: normalizeEmailArray(raw?.to),
    cc: normalizeEmailArray(raw?.cc),
    bcc: normalizeEmailArray(raw?.bcc),
    subject: raw?.subject,
    preview: raw?.preview,
    text: raw?.extracted_text || raw?.text,
    html: raw?.extracted_html || raw?.html,
    extractedText: raw?.extracted_text || raw?.extractedText,
    extractedHtml: raw?.extracted_html || raw?.extractedHtml,
    labels: Array.isArray(raw?.labels) ? raw.labels.map((label: unknown) => String(label)) : [],
    timestamp: raw?.timestamp || raw?.created_at || raw?.createdAt,
    createdAt: raw?.created_at || raw?.createdAt,
    updatedAt: raw?.updated_at || raw?.updatedAt,
    inReplyTo: raw?.in_reply_to || raw?.inReplyTo || null,
    references: Array.isArray(raw?.references) ? raw.references.map((ref: unknown) => String(ref)) : [],
    attachmentsCount: Array.isArray(raw?.attachments) ? raw.attachments.length : 0,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)
    const verifiedPayload = verifyAgentMailWebhook(rawBody, req.headers)
    const payload = parseAgentMailWebhookPayload(verifiedPayload)

    if (!payload.eventId) {
      return res.status(400).json({ error: 'Missing event id' })
    }

    const firstSeen = recordWebhookEvent(payload.eventId, payload.eventType)
    if (!firstSeen) {
      return res.status(200).json({ received: true, duplicate: true })
    }

    if (payload.eventType === 'message.received' && payload.message) {
      storeIncomingMessage(normalizeWebhookMessage(payload.message))
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    console.error('[AgentMailWebhook] Error:', error)
    return res.status(500).json({ error: 'Webhook handling failed' })
  }
}
