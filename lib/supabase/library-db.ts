import { getSupabaseAdmin } from './client'

export interface KnowledgeFile {
  id: string
  name: string
  category: 'Business' | 'Printing' | 'Education' | 'Personal'
  type: string
  storage_path: string
  file_size: number
  processing_status: 'pending' | 'processing' | 'ready' | 'failed'
  extracted_text?: string
  created_at: string
  updated_at: string
}

export interface KnowledgeChunk {
  id: string
  file_id: string
  content: string
  page_number?: number
  chunk_index: number
  created_at: string
}

// File operations
export async function addKnowledgeFile(
  file: Omit<KnowledgeFile, 'id' | 'created_at' | 'updated_at'>
): Promise<KnowledgeFile> {
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()

  const { data, error } = await db
    .from('knowledge_files')
    .insert({
      name: file.name,
      category: file.category,
      type: file.type,
      storage_path: file.storage_path,
      file_size: file.file_size,
      processing_status: file.processing_status || 'pending',
      extracted_text: file.extracted_text,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (error) {
    console.error('[DB] Error adding knowledge file:', error)
    throw error
  }

  console.log(`[DB] Added knowledge file: ${file.name} (${file.category}/${file.type})`)
  return data
}

export async function getKnowledgeFile(id: string): Promise<KnowledgeFile | null> {
  const db = getSupabaseAdmin()

  const { data, error } = await db.from('knowledge_files').select('*').eq('id', id).single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "not found" error, which is okay
    console.error('[DB] Error getting knowledge file:', error)
    throw error
  }

  return data || null
}

export async function getAllKnowledgeFiles(): Promise<KnowledgeFile[]> {
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('knowledge_files')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[DB] Error getting knowledge files:', error)
    throw error
  }

  console.log(`[DB] Retrieved ${data.length} knowledge files`)
  return data || []
}

export async function getKnowledgeFilesByCategory(category: string): Promise<KnowledgeFile[]> {
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('knowledge_files')
    .select('*')
    .eq('category', category)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[DB] Error getting files by category:', error)
    throw error
  }

  return data || []
}

export async function deleteKnowledgeFile(id: string): Promise<boolean> {
  const db = getSupabaseAdmin()

  const { error } = await db.from('knowledge_files').delete().eq('id', id)

  if (error) {
    console.error('[DB] Error deleting knowledge file:', error)
    throw error
  }

  console.log(`[DB] Deleted knowledge file: ${id}`)
  return true
}

export async function updateFileProcessingStatus(
  id: string,
  status: 'pending' | 'processing' | 'ready' | 'failed',
  extractedText?: string
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()

  const updateData: any = {
    processing_status: status,
    updated_at: now,
  }

  if (extractedText) {
    updateData.extracted_text = extractedText
  }

  const { error } = await db.from('knowledge_files').update(updateData).eq('id', id)

  if (error) {
    console.error('[DB] Error updating processing status:', error)
    throw error
  }

  console.log(`[DB] Updated processing status: ${id} → ${status}`)
  return true
}

export async function getFileCounts(): Promise<Record<string, number>> {
  const db = getSupabaseAdmin()

  const { data, error } = await db.from('knowledge_files').select('category')

  if (error) {
    console.error('[DB] Error getting file counts:', error)
    throw error
  }

  const counts: Record<string, number> = {
    Business: 0,
    Printing: 0,
    Education: 0,
    Personal: 0,
  }

  for (const file of data || []) {
    if (file.category in counts) {
      counts[file.category]++
    }
  }

  return counts
}

// Knowledge chunk operations
export async function saveKnowledgeChunks(
  fileId: string,
  chunks: Array<{ content: string; pageNumber?: number; chunkIndex: number }>
): Promise<void> {
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()

  const chunkData = chunks.map((chunk) => ({
    file_id: fileId,
    content: chunk.content,
    page_number: chunk.pageNumber || null,
    chunk_index: chunk.chunkIndex,
    created_at: now,
  }))

  const { error } = await db.from('knowledge_chunks').insert(chunkData)

  if (error) {
    console.error('[DB] Error saving knowledge chunks:', error)
    throw error
  }

  console.log(`[DB] Saved ${chunks.length} knowledge chunks for file ${fileId}`)
}

export async function getKnowledgeChunksByFile(fileId: string): Promise<KnowledgeChunk[]> {
  const db = getSupabaseAdmin()

  const { data, error } = await db
    .from('knowledge_chunks')
    .select('*')
    .eq('file_id', fileId)
    .order('chunk_index', { ascending: true })

  if (error) {
    console.error('[DB] Error getting knowledge chunks:', error)
    throw error
  }

  return data || []
}

export async function deleteKnowledgeChunks(fileId: string): Promise<void> {
  const db = getSupabaseAdmin()

  const { error } = await db.from('knowledge_chunks').delete().eq('file_id', fileId)

  if (error) {
    console.error('[DB] Error deleting knowledge chunks:', error)
    throw error
  }

  console.log(`[DB] Deleted knowledge chunks for file ${fileId}`)
}

export async function searchKnowledgeChunks(
  query: string,
  limit: number = 10
): Promise<KnowledgeChunk[]> {
  const db = getSupabaseAdmin()

  // Simple text search - for production, use Supabase full-text search
  const { data, error } = await db
    .from('knowledge_chunks')
    .select('*')
    .textSearch('content', query, { type: 'websearch' })
    .limit(limit)

  if (error) {
    console.error('[DB] Error searching knowledge chunks:', error)
    // Fall back to empty results if search fails
    return []
  }

  return data || []
}
