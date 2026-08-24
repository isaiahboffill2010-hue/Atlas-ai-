import { AgentMailClient } from 'agentmail'

let cachedClient: AgentMailClient | null = null
let cachedInboxId: string | null = null

export function getAgentMailApiKey(): string {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('AGENTMAIL_API_KEY is not configured')
  }

  return apiKey
}

export function getAgentMailInboxId(): string {
  if (cachedInboxId) {
    return cachedInboxId
  }

  const inboxId = process.env.AGENTMAIL_INBOX_ID?.trim()
  if (!inboxId) {
    throw new Error('AGENTMAIL_INBOX_ID is not configured')
  }

  cachedInboxId = inboxId
  return inboxId
}

export function getAgentMailClient(): AgentMailClient {
  if (!cachedClient) {
    cachedClient = new AgentMailClient({
      apiKey: getAgentMailApiKey(),
    })
  }

  return cachedClient
}

export function resolveInboxId(explicitInboxId?: string): string {
  return explicitInboxId?.trim() || getAgentMailInboxId()
}

