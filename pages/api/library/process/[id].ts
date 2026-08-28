import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getKnowledgeFile,
  updateFileProcessingStatus,
  saveKnowledgeChunks,
} from '../../../../lib/supabase/library-db'
import { getFileFromStorage } from '../../../../lib/supabase/storage'
import { processDocument } from '../../../../lib/knowledge/document-processor'

interface ProcessResponse {
  success?: boolean
  status?: string
  pages?: number
  textLength?: number
  error?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ProcessResponse>) {
  const { id } = req.query

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!id || typeof id !== 'string') {
    console.error('[Process API] Missing file ID')
    return res.status(400).json({ error: 'Missing file ID' })
  }

  try {
    console.log(`[Process API] Processing file: ${id}`)

    // Get file record from Supabase
    const file = await getKnowledgeFile(id)
    if (!file) {
      console.error(`[Process API] File not found: ${id}`)
      return res.status(404).json({ error: 'File not found' })
    }

    console.log(`[Process API] Found file: ${file.name}`)

    // Update status to processing
    await updateFileProcessingStatus(id, 'processing')

    // Get file from Supabase Storage
    console.log(`[Process API] Retrieving file from Storage`)
    const fileData = await getFileFromStorage(file.storage_path)

    // Process the document
    console.log(`[Process API] Starting document extraction`)
    const extracted = await processDocument({
      name: file.name,
      data: fileData,
    })

    console.log(`[Process API] Extraction successful: ${extracted.text.length} characters`)

    // Create knowledge chunks from extracted text
    const chunks = createChunksFromText(extracted.text)
    console.log(`[Process API] Created ${chunks.length} knowledge chunks`)

    // Save knowledge chunks to Supabase
    try {
      await saveKnowledgeChunks(
        id,
        chunks.map((chunk, index) => ({
          content: chunk,
          pageNumber: 1,
          chunkIndex: index,
        }))
      )
      console.log(`[Process API] Knowledge chunks saved`)
    } catch (chunkError) {
      console.warn(`[Process API] Error saving chunks:`, chunkError)
      // Continue even if chunk saving fails
    }

    // Update status to ready and store extracted text
    await updateFileProcessingStatus(id, 'ready', extracted.text)

    return res.status(200).json({
      success: true,
      status: 'ready',
      pages: extracted.pages,
      textLength: extracted.text.length,
    })
  } catch (error) {
    console.error('[Process API] Error processing file:', error)

    // Update status to failed
    if (id && typeof id === 'string') {
      try {
        await updateFileProcessingStatus(id, 'failed')
      } catch (updateError) {
        console.error('[Process API] Error updating failed status:', updateError)
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({
      error: `Processing failed: ${errorMessage}`,
    })
  }
}

function createChunksFromText(text: string, chunkSize: number = 1000): string[] {
  const chunks: string[] = []
  let currentChunk = ''

  const lines = text.split('\n')

  for (const line of lines) {
    if ((currentChunk + line).length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      currentChunk = line
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}
