export interface NormalizedEmailMessage {
  messageId: string
  threadId?: string
  inboxId?: string
  from?: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject?: string
  preview?: string
  text?: string
  html?: string
  extractedText?: string
  extractedHtml?: string
  labels: string[]
  timestamp?: string
  createdAt?: string
  updatedAt?: string
  inReplyTo?: string | null
  references: string[]
  attachmentsCount: number
}

export interface EmailSearchFilters {
  query: string
  limit?: number
  inboxId?: string
  before?: string
  after?: string
}

export interface EmailListFilters {
  limit?: number
  inboxId?: string
  before?: string
  after?: string
  from?: string
  to?: string
  subject?: string
  labels?: string[]
}

export interface SendEmailInput {
  inboxId?: string
  to: string | string[]
  subject: string
  text: string
  html?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string | string[]
  labels?: string[]
}

export interface ReplyEmailInput {
  inboxId?: string
  messageId: string
  text: string
  html?: string
  replyAll?: boolean
  labels?: string[]
}

export interface PendingSendEmailAction {
  action: 'send_email'
  input: SendEmailInput
  summary: string
  createdAt: number
}

export interface PendingReplyEmailAction {
  action: 'reply_email'
  input: ReplyEmailInput
  summary: string
  createdAt: number
}

export type PendingEmailAction = PendingSendEmailAction | PendingReplyEmailAction
