import type { NextApiRequest, NextApiResponse } from 'next'
import { IncomingMessage } from 'http'
import {
  applyPairedDeviceCodeFromWebhook,
  applyTerminalCheckoutWebhook,
  recordSquareWebhookEvent,
  verifySquareWebhookSignature,
} from '../../../lib/square'

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

function getHeaderValue(headers: NextApiRequest['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return value || undefined
}

function parseWebhookPayload(rawBody: Buffer) {
  const text = rawBody.toString('utf8')
  if (!text.trim()) {
    throw new Error('Empty Square webhook body')
  }

  return JSON.parse(text)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rawBody = await readRawBody(req)
    const isValid = verifySquareWebhookSignature(rawBody, req.headers)

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid webhook signature' })
    }

    const payload = parseWebhookPayload(rawBody)
    const eventId = String(payload?.event_id || '')
    const eventType = String(payload?.type || '')

    if (!eventId) {
      return res.status(400).json({ error: 'Missing event id' })
    }

    const firstSeen = recordSquareWebhookEvent(eventId, eventType)
    if (!firstSeen) {
      return res.status(200).json({ received: true, duplicate: true })
    }

    if (eventType === 'device.code.paired') {
      applyPairedDeviceCodeFromWebhook(payload)
      return res.status(200).json({ received: true })
    }

    if (eventType === 'terminal.checkout.created' || eventType === 'terminal.checkout.updated') {
      await applyTerminalCheckoutWebhook(payload)
      return res.status(200).json({ received: true })
    }

    return res.status(200).json({ received: true, ignored: true })
  } catch (error) {
    console.error('[SquareWebhook] Error handling webhook:', error)
    return res.status(500).json({ error: 'Webhook handling failed' })
  }
}
