# Atlas Persistent Conversation Memory Implementation

## Overview

This document describes the persistent conversation memory system added to Atlas. The system saves all conversations to Supabase and retrieves relevant previous context when processing new requests.

## Architecture

### Database Schema

Two main tables store conversation data:

#### `atlas_conversations`
- `id` (UUID, PK): Unique conversation identifier
- `created_at` (TIMESTAMP): When the conversation was created
- `updated_at` (TIMESTAMP): Last message timestamp in this conversation

#### `atlas_messages`
- `id` (UUID, PK): Unique message identifier
- `conversation_id` (FK): Reference to the conversation
- `role` (TEXT): Either 'user' or 'assistant'
- `content` (TEXT): The message content
- `created_at` (TIMESTAMP): When the message was created

### Context Flow

```
User speaks
    ↓
Speech recognition
    ↓
User message received
    ↓
Save user message to Supabase
    ↓
Retrieve recent conversation context (last 8 messages from current conversation)
    ↓
Search for relevant older memories (from previous conversations, same conversation)
    ↓
Build system prompt with:
  - Knowledge Library context (existing)
  - Recent conversation context (new)
  - Relevant previous memories (new)
    ↓
Send to Claude API
    ↓
Claude generates response
    ↓
Save Atlas response to Supabase
    ↓
Update conversation timestamp
    ↓
Speak response
```

## Implementation Details

### Files Changed

1. **`lib/supabase/conversations-db.ts`** (NEW)
   - Utility functions for conversation management
   - `getOrCreateCurrentConversation()`: Gets active conversation or creates new one
   - `saveMessage()`: Save user/assistant message
   - `getRecentConversationMessages()`: Retrieve recent messages from current conversation
   - `searchRelevantMessages()`: Search for relevant context from all conversations
   - `updateConversationTimestamp()`: Update conversation's last activity time

2. **`pages/api/claude.ts`** (MODIFIED)
   - Added conversation initialization on first request
   - Save user messages to database before processing
   - Retrieve database context and pass to Claude
   - Save assistant responses to database after generation
   - Graceful error handling - if DB fails, Atlas continues normally
   - Updated `buildSystemPrompt()` to include conversation context

3. **`scripts/create-atlas-conversations-table.sql`** (NEW)
   - SQL migration script for Supabase
   - Creates both tables with indexes
   - Enables RLS (Row Level Security)
   - Sets up full-text search index

4. **`scripts/setup-conversation-db.ts`** (NEW)
   - TypeScript setup script for database initialization
   - Can be run to create tables if SQL migration wasn't applied

## Setup Instructions

### Option 1: Using Supabase SQL Editor (Recommended)

1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Create a new query
4. Copy the contents of `scripts/create-atlas-conversations-table.sql`
5. Run the query
6. Verify tables are created

### Option 2: Using the Setup Script

```bash
npm run setup-conversation-db
```

(You may need to add this script to package.json if it doesn't exist)

## Memory Retrieval Strategy

### Recent Conversation Context
- Retrieves the **last 8 messages** from the current conversation
- Always included when available
- Provides immediate context for follow-up questions
- Example: "What about times 3?" after "What's 2+2?"

### Relevant Previous Memories
- Searches **all previous conversations** for messages matching query keywords
- Limits to **3 most relevant** results to keep context efficient
- Only searches messages from **other conversations** (excludes current)
- Uses simple text matching on key terms (3+ character words)
- Includes message date to help with temporal context

### System Prompt Integration
The retrieved context is added to Claude's system prompt in a structured format:

```
CONVERSATION MEMORY:
RECENT CONVERSATION CONTEXT:
You: [previous message]
Atlas: [previous response]
...

RELEVANT PREVIOUS MEMORIES:
[date] You: [old message]
[date] Atlas: [old response]
...
```

## Key Features

### Persistent Sessions
- Each conversation is persisted independently
- The system uses the **most recent conversation** as the "current" one
- 15-second silence timeout does NOT erase conversation memory
- Conversations remain in the database indefinitely

### Error Resilience
- If Supabase is unavailable:
  - Messages are NOT saved to database
  - Atlas continues to respond normally
  - In-memory history still works (but is lost on restart)
  - Errors are logged as warnings, not failures

### Efficient Context
- Does NOT send entire conversation history to Claude on every request
- Uses:
  - Recent messages (up to 8) from current conversation
  - Relevant old messages (up to 3) from other conversations
  - Knowledge Library context (existing feature)
- Keeps total context manageable

## Testing the System

### Test Scenario 1: Basic Memory

```
1. Say: "My favorite color is blue."
   → Atlas responds normally
   
2. Wait a bit (or end conversation with silence)

3. Later (new conversation):
   Say: "What's my favorite color?"
   → Atlas should retrieve the earlier message from the database
   → Response: "Your favorite color is blue."
```

### Test Scenario 2: Recent Context

```
1. Say: "What is 10 plus 5?"
   → Atlas: "15"
   
2. Immediately say: "Now multiply it by 2."
   → Atlas should use recent context to know "it" = 15
   → Response: "That's 30."
```

### Test Scenario 3: Multi-Turn Conversation

```
1. Say: "I'm working on a project called Atlas."
   → Atlas responds
   
2. Say: "Tell me about Atlas."
   → Atlas should retrieve the earlier message from the same conversation
   → Demonstrates that recent context is being used
```

### Test Scenario 4: Cross-Conversation Memory

```
1. Earlier session: "I love pizza."
   
2. Much later session: "What food do I like?"
   → Atlas searches previous conversations
   → Finds "I love pizza"
   → Response: "You love pizza."
```

## Monitoring

### Logs to Watch

Look for these log messages in the server console:

```
[Conversations DB] Using existing conversation: <id>
[Conversations DB] Created new conversation: <id>
[Conversations DB] Saved user message to conversation <id>
[Conversations DB] Saved assistant message to conversation <id>
[Conversations DB] Found N relevant messages for query
[Claude] Initialized conversation: <id>
```

### Warnings

If you see these warnings, database operations failed but Atlas continued:

```
[Claude] Failed to save user message: <error>
[Claude] Failed to save assistant message: <error>
```

This is expected if Supabase is temporarily unavailable.

## Database Maintenance

### Viewing Conversations

```sql
SELECT id, created_at, updated_at FROM atlas_conversations
ORDER BY updated_at DESC
LIMIT 20;
```

### Viewing Messages from a Conversation

```sql
SELECT created_at, role, content FROM atlas_messages
WHERE conversation_id = '<conversation-id>'
ORDER BY created_at ASC;
```

### Count Total Messages

```sql
SELECT COUNT(*) as total_messages FROM atlas_messages;
```

### Find Conversations by Date

```sql
SELECT id, created_at, updated_at FROM atlas_conversations
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY updated_at DESC;
```

## Performance Considerations

### Indexes
The migration script creates these indexes for performance:

1. `idx_atlas_messages_conversation_id` - Fast lookup by conversation
2. `idx_atlas_messages_created_at` - Fast sorting by date
3. `idx_atlas_conversations_updated_at` - Fast sorting by activity
4. `idx_atlas_messages_content_fts` - Full-text search on content

### Query Limits
- Recent messages: Limited to 8 to keep context concise
- Relevant searches: Limited to 3 to avoid overwhelming Claude
- Search terms: Only words with 3+ characters to reduce noise

## Migration Notes

### Did NOT Modify

✓ Wake word system ("Hey") - Unchanged
✓ Speech recognition - Unchanged
✓ 15-second conversation timeout - Unchanged
✓ Camera/Person detection - Unchanged
✓ YouTube music integration - Unchanged
✓ Music commands - Unchanged
✓ YouTube player card - Unchanged
✓ Supabase song library - Unchanged
✓ Knowledge Library - Enhanced (still works)
✓ Claude API flow - Enhanced (still works)
✓ TTS (Text-to-Speech) - Unchanged

## Future Enhancements

Possible improvements without redesign:

1. **Vector/Semantic Search**: Replace text-based search with embedding-based similarity
2. **Conversation Summaries**: Store summaries of older conversations for efficiency
3. **User Preferences**: Extract and remember preferences across conversations
4. **Multi-Session Support**: Tag conversations by device/context
5. **Conversation Export**: Export conversations to files
6. **Analytics**: Track conversation patterns and topics
7. **Selective Memory**: Archive old conversations or manually mark important ones

## Troubleshooting

### Tables Don't Exist After Setup

1. Check Supabase dashboard to confirm tables were created
2. Look for errors in the SQL execution
3. Try running the setup script again: `npm run setup-conversation-db`

### Messages Not Being Saved

1. Check server logs for `[Conversations DB]` errors
2. Verify Supabase credentials in `.env.local`
3. Check database permissions (service role key needs grants)
4. Review `pages/api/claude.ts` logs

### Slow Response Times

1. Check if the database queries are timing out
2. Review indexes are created (run `\d atlas_messages` in Supabase)
3. Check if search is matching too many results

### Atlas Doesn't Remember Previous Context

1. Verify tables were created successfully
2. Check that messages are being saved (look for success logs)
3. Test retrieval: Use SQL to query messages directly
4. Ensure current conversation ID is being set correctly

## Support

For issues or questions about this implementation:

1. Check the logs in the server console
2. Verify Supabase setup is complete
3. Test with SQL queries directly in Supabase console
4. Review this documentation again for any missed steps
