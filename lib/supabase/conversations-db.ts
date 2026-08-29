import { getSupabaseAdmin } from './client'

export interface ConversationRecord {
  id: string
  created_at: string
  updated_at: string
}

export interface MessageRecord {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const DEBUG = true

function log(message: string) {
  if (DEBUG) {
    console.log(`[Conversations DB] ${message}`)
  }
}

export async function getOrCreateCurrentConversation(): Promise<{ id: string; isNew: boolean }> {
  const db = getSupabaseAdmin()

  try {
    // Try to get the current active conversation (the most recent one)
    const { data: existing, error: fetchError } = await db
      .from('atlas_conversations')
      .select('id')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()

    if (!fetchError && existing) {
      log(`Using existing conversation: ${existing.id}`)
      return { id: existing.id, isNew: false }
    }

    // Create a new conversation
    const { data: newConversation, error: insertError } = await db
      .from('atlas_conversations')
      .insert({})
      .select()
      .single()

    if (insertError) {
      throw insertError
    }

    if (!newConversation) {
      throw new Error('Failed to create conversation')
    }

    log(`Created new conversation: ${newConversation.id}`)
    return { id: newConversation.id, isNew: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Error getting/creating conversation: ${errorMessage}`)
    throw error
  }
}

export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<{ success: boolean; message?: MessageRecord; error?: string }> {
  const db = getSupabaseAdmin()

  console.log('[Conversations DB DEBUG] Starting message INSERT', {
    conversationId,
    role,
    contentLength: content.length,
  })

  try {
    console.log('[Conversations DB DEBUG] Executing Supabase insert query')
    const startTime = Date.now()

    const { data, error } = await db
      .from('atlas_messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
      })
      .select()
      .single()

    const duration = Date.now() - startTime
    console.log('[Conversations DB DEBUG] Message INSERT returned', {
      hasData: !!data,
      haserror: !!error,
      durationMs: duration,
    })

    if (error) {
      console.error('[Conversations DB ERROR] Message INSERT failed', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })
      log(`Error saving message: ${error.message}`)
      return { success: false, error: error.message }
    }

    if (!data) {
      console.error('[Conversations DB ERROR] Message INSERT succeeded but returned no data')
      return { success: false, error: 'No data returned from insert' }
    }

    console.log('[Conversations DB DEBUG] Message INSERT succeeded', {
      messageId: data.id,
      conversationId: data.conversation_id,
    })
    log(`Saved ${role} message to conversation ${conversationId}`)
    return { success: true, message: data }
  } catch (error) {
    console.error('[Conversations DB ERROR] Exception during message save', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'no stack',
    })
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Unexpected error saving message: ${errorMessage}`)
    return { success: false, error: errorMessage }
  }
}

export async function updateConversationTimestamp(conversationId: string): Promise<boolean> {
  const db = getSupabaseAdmin()

  console.log('[Conversations DB DEBUG] Starting conversation timestamp UPDATE', {
    conversationId,
  })

  try {
    console.log('[Conversations DB DEBUG] Executing Supabase update query')
    const startTime = Date.now()

    const { error } = await db
      .from('atlas_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    const duration = Date.now() - startTime
    console.log('[Conversations DB DEBUG] Timestamp UPDATE returned', {
      hasError: !!error,
      durationMs: duration,
    })

    if (error) {
      console.error('[Conversations DB ERROR] Timestamp UPDATE failed', {
        code: error.code,
        message: error.message,
        details: error.details,
      })
      log(`Error updating conversation timestamp: ${error.message}`)
      return false
    }

    console.log('[Conversations DB DEBUG] Timestamp UPDATE succeeded')
    return true
  } catch (error) {
    console.error('[Conversations DB ERROR] Exception during timestamp update', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'no stack',
    })
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Unexpected error updating timestamp: ${errorMessage}`)
    return false
  }
}

export async function getRecentConversationMessages(
  conversationId: string,
  limit: number = 10
): Promise<MessageRecord[]> {
  const db = getSupabaseAdmin()

  try {
    const { data, error } = await db
      .from('atlas_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      log(`Error getting recent messages: ${error.message}`)
      return []
    }

    // Return in chronological order (oldest first)
    return (data || []).reverse()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Unexpected error getting recent messages: ${errorMessage}`)
    return []
  }
}

export async function searchRelevantMessages(
  query: string,
  limit: number = 5,
  excludeConversationId?: string
): Promise<MessageRecord[]> {
  const db = getSupabaseAdmin()

  try {
    // Simple text search: look for messages containing key terms from the query
    // Split query into words and search for messages containing multiple query terms
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2) // Only search for words with 3+ characters

    if (queryTerms.length === 0) {
      return []
    }

    // Use Supabase full-text search (ilike)
    let dbQuery = db
      .from('atlas_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (excludeConversationId) {
      dbQuery = dbQuery.not('conversation_id', 'eq', excludeConversationId)
    }

    // Build OR condition for multiple search terms
    // For the first term
    dbQuery = dbQuery.ilike('content', `%${queryTerms[0]}%`)

    const { data, error } = await dbQuery

    if (error) {
      log(`Error searching messages: ${error.message}`)
      return []
    }

    if (!data || data.length === 0) {
      log(`No relevant messages found for query: "${query}"`)
      return []
    }

    log(`Found ${data.length} relevant messages for query: "${query}"`)
    return data
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Unexpected error searching messages: ${errorMessage}`)
    return []
  }
}

export async function getConversationHistory(
  conversationId: string,
  limit?: number
): Promise<MessageRecord[]> {
  return getRecentConversationMessages(conversationId, limit)
}

export async function getAllConversations(): Promise<ConversationRecord[]> {
  const db = getSupabaseAdmin()

  try {
    const { data, error } = await db
      .from('atlas_conversations')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      log(`Error getting all conversations: ${error.message}`)
      return []
    }

    log(`Retrieved ${data?.length || 0} conversations`)
    return data || []
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Unexpected error getting conversations: ${errorMessage}`)
    return []
  }
}
