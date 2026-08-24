import { getAgentMailClient, resolveInboxId } from './client'
import {
  EmailListFilters,
  EmailSearchFilters,
  NormalizedEmailMessage,
  ReplyEmailInput,
  SendEmailInput,
} from './types'

function normalizeMessage(raw: any): NormalizedEmailMessage {
  return {
    messageId: raw.message_id || raw.messageId || '',
    threadId: raw.thread_id || raw.threadId,
    inboxId: raw.inbox_id || raw.inboxId,
    from: raw.from,
    to: Array.isArray(raw.to) ? raw.to : raw.to ? [raw.to] : [],
    cc: Array.isArray(raw.cc) ? raw.cc : raw.cc ? [raw.cc] : [],
    bcc: Array.isArray(raw.bcc) ? raw.bcc : raw.bcc ? [raw.bcc] : [],
    subject: raw.subject,
    preview: raw.preview,
    text: raw.text,
    html: raw.html,
    extractedText: raw.extracted_text || raw.extractedText,
    extractedHtml: raw.extracted_html || raw.extractedHtml,
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    timestamp: raw.timestamp,
    createdAt: raw.created_at || raw.createdAt,
    updatedAt: raw.updated_at || raw.updatedAt,
    inReplyTo: raw.in_reply_to || raw.inReplyTo || null,
    references: Array.isArray(raw.references) ? raw.references : [],
    attachmentsCount: Array.isArray(raw.attachments) ? raw.attachments.length : 0,
  }
}

function truncate(text: string | undefined, max = 1200): string | undefined {
  if (!text) {
    return text
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function normalizeMessageForClaude(message: NormalizedEmailMessage) {
  return {
    messageId: message.messageId,
    threadId: message.threadId,
    inboxId: message.inboxId,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    preview: message.preview,
    text: truncate(message.extractedText || message.text),
    html: truncate(message.extractedHtml || message.html),
    labels: message.labels,
    timestamp: message.timestamp || message.createdAt,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachmentsCount: message.attachmentsCount,
  }
}

export async function searchEmails(filters: EmailSearchFilters) {
  const client = getAgentMailClient()
  const inboxId = resolveInboxId(filters.inboxId)
  const response = await client.inboxes.messages.search(inboxId as any, {
    q: filters.query,
    limit: filters.limit,
    before: filters.before,
    after: filters.after,
  } as any)

  const messages = (response as any).messages || []
  return {
    inboxId,
    count: (response as any).count ?? messages.length,
    messages: messages.map((message: any) => normalizeMessageForClaude(normalizeMessage(message))),
  }
}

export async function listEmails(filters: EmailListFilters) {
  const client = getAgentMailClient()
  const inboxId = resolveInboxId(filters.inboxId)
  const response = await client.inboxes.messages.list(inboxId as any, {
    limit: filters.limit,
    before: filters.before,
    after: filters.after,
    from: filters.from,
    to: filters.to,
    subject: filters.subject,
    labels: filters.labels,
  } as any)

  const messages = (response as any).messages || []
  return {
    inboxId,
    count: (response as any).count ?? messages.length,
    messages: messages.map((message: any) => normalizeMessageForClaude(normalizeMessage(message))),
    nextPageToken: (response as any).next_page_token || (response as any).nextPageToken,
  }
}

export async function getEmail(messageId: string, inboxId?: string) {
  const client = getAgentMailClient()
  const resolvedInboxId = resolveInboxId(inboxId)
  const message = await client.inboxes.messages.get(resolvedInboxId as any, messageId as any)
  return {
    inboxId: resolvedInboxId,
    message: normalizeMessageForClaude(normalizeMessage(message)),
  }
}

export async function sendEmail(input: SendEmailInput) {
  const client = getAgentMailClient()
  const inboxId = resolveInboxId(input.inboxId)

  const response = await client.inboxes.messages.send(
    inboxId as any,
    {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      labels: input.labels,
    } as any,
    {
      idempotencyKey: `atlas-send-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    } as any
  )

  return {
    inboxId,
    messageId: (response as any).message_id || (response as any).messageId,
    threadId: (response as any).thread_id || (response as any).threadId,
  }
}

export async function replyEmail(input: ReplyEmailInput) {
  const client = getAgentMailClient()
  const inboxId = resolveInboxId(input.inboxId)
  const method = input.replyAll ? client.inboxes.messages.replyAll.bind(client.inboxes.messages) : client.inboxes.messages.reply.bind(client.inboxes.messages)

  const response = await method(
    inboxId as any,
    input.messageId as any,
    {
      text: input.text,
      html: input.html,
      labels: input.labels,
    } as any,
    {
      idempotencyKey: `atlas-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    } as any
  )

  return {
    inboxId,
    messageId: (response as any).message_id || (response as any).messageId,
    threadId: (response as any).thread_id || (response as any).threadId,
  }
}

