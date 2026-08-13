import type { NextApiRequest, NextApiResponse } from 'next'
import { getFiles, getFileCounts } from '../../../lib/db'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    console.log('[Files API] Fetching files')
    const files = getFiles()
    const counts = getFileCounts()

    console.log(`[Files API] Returning ${files.length} files with counts:`, counts)

    return res.status(200).json({
      files,
      counts,
    })
  } catch (error) {
    console.error('[Files API] Error getting files:', error)
    return res.status(500).json({ error: 'Failed to get files' })
  }
}
