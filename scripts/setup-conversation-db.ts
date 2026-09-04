import { getSupabaseAdmin } from '../lib/supabase/client'

async function setupConversationDatabase() {
  const db = getSupabaseAdmin()

  console.log('[Setup] Creating atlas_conversations table...')
  const { error: conversationsError } = await db.rpc('exec', {
    sql: `
      CREATE TABLE IF NOT EXISTS atlas_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `,
  })

  if (conversationsError && !conversationsError.message?.includes('already exists')) {
    console.error('[Setup] Error creating conversations table:', conversationsError)
    return false
  }

  console.log('[Setup] Creating atlas_messages table...')
  const { error: messagesError } = await db.rpc('exec', {
    sql: `
      CREATE TABLE IF NOT EXISTS atlas_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES atlas_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `,
  })

  if (messagesError && !messagesError.message?.includes('already exists')) {
    console.error('[Setup] Error creating messages table:', messagesError)
    return false
  }

  console.log('[Setup] Creating indexes...')

  const indexQueries = [
    `CREATE INDEX IF NOT EXISTS idx_atlas_messages_conversation_id
      ON atlas_messages(conversation_id);`,
    `CREATE INDEX IF NOT EXISTS idx_atlas_messages_created_at
      ON atlas_messages(created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_atlas_conversations_updated_at
      ON atlas_conversations(updated_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_atlas_messages_content_fts
      ON atlas_messages USING GIN (to_tsvector('english', content));`,
  ]

  for (const query of indexQueries) {
    const { error: indexError } = await db.rpc('exec', { sql: query })
    if (indexError && !indexError.message?.includes('already exists')) {
      console.error('[Setup] Error creating index:', indexError)
    }
  }

  console.log('[Setup] Conversation database setup complete!')
  return true
}

setupConversationDatabase()
  .then((success) => {
    if (success) {
      console.log('[Setup] ✓ Database initialization successful')
      process.exit(0)
    } else {
      console.log('[Setup] ✗ Database initialization had errors')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('[Setup] Fatal error:', error)
    process.exit(1)
  })
