import type { IncomingHttpHeaders } from 'http'
import { Webhook, WebhookVerificationError } from 'svix'

export type AgentMailWebhookPayload = Record<string, any>

function headerValue(headers: IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export function getAgentMailWebhookSecret(): string {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new Error('AGENTMAIL_WEBHOOK_SECRET is not configured')
  }
  return secret
}

export function verifyAgentMailWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): AgentMailWebhookPayload {
  const secret = getAgentMailWebhookSecret()
  const webhook = new Webhook(secret)

  const signedHeaders = {
    'svix-id': headerValue(headers, 'svix-id') || '',
    'svix-timestamp': headerValue(headers, 'svix-timestamp') || '',
    'svix-signature': headerValue(headers, 'svix-signature') || '',
  }

  if (!signedHeaders['svix-id'] || !signedHeaders['svix-timestamp'] || !signedHeaders['svix-signature']) {
    throw new WebhookVerificationError('Missing Svix headers')
  }

  return webhook.verify(rawBody, signedHeaders) as AgentMailWebhookPayload
}

export function parseAgentMailWebhookPayload(payload: AgentMailWebhookPayload) {
  const eventType = String(payload.event_type || '')
  const eventId = String(payload.event_id || '')

  return {
    eventType,
    eventId,
    payload,
    message: payload.message,
    send: payload.send,
    delivery: payload.delivery,
    bounce: payload.bounce,
    complaint: payload.complaint,
    reject: payload.reject,
    domain: payload.domain,
  }
}

