import type { NextApiRequest, NextApiResponse } from 'next'
import { getFile, updateFileProcessingStatus } from '../../../../lib/db'
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

    // Get file record
    const file = getFile(id)
    if (!file) {
      console.error(`[Process API] File not found: ${id}`)
      return res.status(404).json({ error: 'File not found' })
    }

    console.log(`[Process API] Found file: ${file.name}`)

    // Update status to processing
    updateFileProcessingStatus(id, 'processing')

    // Process the document
    console.log(`[Process API] Starting document extraction`)
    const extracted = await processDocument(file)

    console.log(`[Process API] Extraction successful: ${extracted.text.length} characters`)

    // Update status to ready and store extracted text
    updateFileProcessingStatus(id, 'ready', extracted.text)

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
      updateFileProcessingStatus(id, 'failed')
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({
      error: `Processing failed: ${errorMessage}`,
    })
  }
}
