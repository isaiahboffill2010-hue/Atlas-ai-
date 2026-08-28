import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getKnowledgeFile,
  deleteKnowledgeFile,
  deleteKnowledgeChunks,
} from '../../../../lib/supabase/library-db'
import { deleteFileFromStorage } from '../../../../lib/supabase/storage'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!id || typeof id !== 'string') {
    console.error('[Delete API] Missing file ID')
    return res.status(400).json({ error: 'Missing file ID' })
  }

  try {
    console.log(`[Delete API] Deleting file: ${id}`)

    // Get file record from Supabase
    const file = await getKnowledgeFile(id)
    if (!file) {
      console.error(`[Delete API] File not found: ${id}`)
      return res.status(404).json({ error: 'File not found' })
    }

    console.log(`[Delete API] Found file: ${file.name} at ${file.storage_path}`)

    try {
      // Delete from Supabase Storage
      console.log(`[Delete API] Deleting from Supabase Storage`)
      await deleteFileFromStorage(file.storage_path)
      console.log(`[Delete API] File deleted from Storage`)
    } catch (storageError) {
      console.warn(`[Delete API] Error deleting from Storage:`, storageError)
      // Continue with database cleanup even if storage deletion fails
    }

    try {
      // Delete knowledge chunks
      console.log(`[Delete API] Deleting knowledge chunks`)
      await deleteKnowledgeChunks(id)
    } catch (chunksError) {
      console.warn(`[Delete API] Error deleting chunks:`, chunksError)
      // Continue with record deletion
    }

    // Delete database record
    console.log(`[Delete API] Deleting database record`)
    await deleteKnowledgeFile(id)

    console.log(`[Delete API] File deleted successfully`)
    return res.status(200).json({
      success: true,
      message: 'File deleted',
    })
  } catch (error) {
    console.error('[Delete API] Unexpected error:', error)
    return res.status(500).json({
      error: 'Failed to delete file: ' + (error instanceof Error ? error.message : 'Unknown error'),
    })
  }
}
