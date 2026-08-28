import type { NextApiRequest, NextApiResponse } from 'next'
import { migrateLocalFilesToSupabase } from '../../../lib/supabase/migrate-local-to-supabase'
import { ensureStorageBucketExists } from '../../../lib/supabase/storage'

interface MigrateResponse {
  success?: boolean
  message?: string
  result?: {
    totalFiles: number
    migratedFiles: number
    failedFiles: Array<{ file: string; error: string }>
  }
  error?: string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MigrateResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    console.log('[Migration API] Starting migration...')

    // Ensure storage bucket exists
    console.log('[Migration API] Ensuring storage bucket exists...')
    await ensureStorageBucketExists()

    // Run migration
    console.log('[Migration API] Running migration...')
    const result = await migrateLocalFilesToSupabase()

    console.log('[Migration API] Migration complete')

    return res.status(200).json({
      success: true,
      message: `Migration complete: ${result.migratedFiles}/${result.totalFiles} files migrated`,
      result,
    })
  } catch (error) {
    console.error('[Migration API] Unexpected error:', error)
    return res
      .status(500)
      .json({ error: 'Migration failed: ' + (error instanceof Error ? error.message : 'Unknown error') })
  }
}
