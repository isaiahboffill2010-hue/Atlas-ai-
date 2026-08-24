import fs from 'fs'
import path from 'path'
import { NormalizedEmailMessage } from './types'

interface AgentMailStoreData {
  processedWebhookEvents: Record<string, { eventType: string; processedAt: number }>
  incomingMessages: NormalizedEmailMessage[]
}

const storeDir = path.join(process.cwd(), 'Atlas', 'database')
const storePath = path.join(storeDir, 'agentmail.json')
const webhookTtlMs = 7 * 24 * 60 * 60 * 1000

function ensureStoreDir() {
  if (!fs.existsSync(storeDir)) {
    fs.mkdirSync(storeDir, { recursive: true })
  }
}

function loadStore(): AgentMailStoreData {
  ensureStoreDir()

  try {
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AgentMailStoreData>

      return {
        processedWebhookEvents: parsed.processedWebhookEvents || {},
        incomingMessages: parsed.incomingMessages || [],
      }
    }
  } catch (error) {
    console.error('[AgentMailStore] Failed to load store:', error)
  }

  return {
    processedWebhookEvents: {},
    incomingMessages: [],
  }
}

function saveStore(store: AgentMailStoreData) {
  ensureStoreDir()
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8')
}

function pruneProcessedEvents(store: AgentMailStoreData): boolean {
  const now = Date.now()
  let changed = false

  for (const [eventId, meta] of Object.entries(store.processedWebhookEvents)) {
    if (now - meta.processedAt > webhookTtlMs) {
      delete store.processedWebhookEvents[eventId]
      changed = true
    }
  }

  if (store.incomingMessages.length > 200) {
    store.incomingMessages = store.incomingMessages.slice(0, 200)
    changed = true
  }

  return changed
}

export function recordWebhookEvent(eventId: string, eventType: string): boolean {
  const store = loadStore()
  const alreadyProcessed = !!store.processedWebhookEvents[eventId]

  if (!alreadyProcessed) {
    store.processedWebhookEvents[eventId] = {
      eventType,
      processedAt: Date.now(),
    }
  }

  if (pruneProcessedEvents(store) || !alreadyProcessed) {
    saveStore(store)
  }

  return !alreadyProcessed
}

export function storeIncomingMessage(message: NormalizedEmailMessage) {
  const store = loadStore()
  const index = store.incomingMessages.findIndex((item) => item.messageId === message.messageId)

  if (index >= 0) {
    store.incomingMessages[index] = message
  } else {
    store.incomingMessages.unshift(message)
  }

  pruneProcessedEvents(store)
  saveStore(store)
}

export function getStoredIncomingMessage(messageId: string): NormalizedEmailMessage | undefined {
  const store = loadStore()
  return store.incomingMessages.find((message) => message.messageId === messageId)
}

export function listStoredIncomingMessages(limit = 20): NormalizedEmailMessage[] {
  const store = loadStore()
  return store.incomingMessages.slice(0, limit)
}

export function searchStoredIncomingMessages(query: string, limit = 20): NormalizedEmailMessage[] {
  const normalizedQuery = query.toLowerCase().trim()
  if (!normalizedQuery) {
    return []
  }

  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1)
  const candidates = listStoredIncomingMessages(200)

  return candidates
    .filter((message) => {
      const haystack = [
        message.from || '',
        message.subject || '',
        message.preview || '',
        message.text || '',
        message.extractedText || '',
        message.to.join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return terms.every((term) => haystack.includes(term))
    })
    .slice(0, limit)
}

