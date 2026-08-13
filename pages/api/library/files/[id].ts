import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import path from 'path'
import { getFile, deleteFile } from '../../../../lib/db'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
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

    // Get file record
    const file = getFile(id)
    if (!file) {
      console.error(`[Delete API] File not found: ${id}`)
      return res.status(404).json({ error: 'File not found' })
    }

    console.log(`[Delete API] Found file: ${file.name} at ${file.path}`)

    // Delete physical file
    const filePath = path.join(process.cwd(), file.path)
    console.log(`[Delete API] Physical path: ${filePath}`)

    if (fs.existsSync(filePath)) {
      console.log(`[Delete API] Deleting physical file`)
      fs.unlinkSync(filePath)
      console.log(`[Delete API] Physical file deleted`)
    } else {
      console.warn(`[Delete API] Physical file not found at ${filePath}`)
    }

    // Delete database record
    console.log(`[Delete API] Deleting database record`)
    const deleted = deleteFile(id)

    if (!deleted) {
      console.error(`[Delete API] Failed to delete from database`)
      return res.status(500).json({ error: 'Failed to delete file from database' })
    }

    console.log(`[Delete API] File deleted successfully`)
    return res.status(200).json({
      success: true,
      message: 'File deleted',
    })
  } catch (error) {
    console.error('[Delete API] Unexpected error:', error)
    return res.status(500).json({ error: 'Failed to delete file: ' + (error instanceof Error ? error.message : 'Unknown error') })
  }
}
