-- Create conversations table for persistent memory storage
CREATE TABLE IF NOT EXISTS atlas_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create messages table for storing individual messages
CREATE TABLE IF NOT EXISTS atlas_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES atlas_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_atlas_messages_conversation_id
  ON atlas_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_atlas_messages_created_at
  ON atlas_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_conversations_updated_at
  ON atlas_conversations(updated_at DESC);

-- Create full-text search index on message content for better search performance
CREATE INDEX IF NOT EXISTS idx_atlas_messages_content_fts
  ON atlas_messages USING GIN (to_tsvector('english', content));

-- Enable RLS (Row Level Security) if needed
ALTER TABLE atlas_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_messages ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations (since this is single-user for now)
CREATE POLICY "Allow all operations on conversations" ON atlas_conversations
  USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on messages" ON atlas_messages
  USING (true) WITH CHECK (true);

-- Grant permissions to service role (used by server-side code)
GRANT ALL ON atlas_conversations TO service_role;
GRANT ALL ON atlas_messages TO service_role;

-- Log the creation
SELECT 'Atlas conversations and messages tables created successfully' AS status;
