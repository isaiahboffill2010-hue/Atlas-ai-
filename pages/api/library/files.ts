import type { NextApiRequest, NextApiResponse } from 'next'
import { getAllKnowledgeFiles, getFileCounts } from '../../../lib/supabase/library-db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    console.log('[Files API] Fetching files from Supabase')
    const files = await getAllKnowledgeFiles()
    const counts = await getFileCounts()

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
