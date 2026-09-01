import type { NextApiRequest, NextApiResponse } from 'next'
import { saveSong, type SongRecord } from '../../../lib/supabase/songs-db'
import { normalizeSongTitle } from '../../../lib/music/normalize-song-title'

interface SaveSongResponse {
  success: boolean
  saved: boolean
  song?: SongRecord
  error?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<SaveSongResponse>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, saved: false, error: 'Method not allowed' })
  }

  const { songTitle } = req.body

  if (!songTitle || typeof songTitle !== 'string' || songTitle.trim().length === 0) {
    return res.status(400).json({ success: false, saved: false, error: 'Song title is required' })
  }

  try {
    const trimmedTitle = songTitle.trim()
    const normalizedTitle = normalizeSongTitle(trimmedTitle)

    console.log(`[Music API] Saving song: "${trimmedTitle}" (normalized: "${normalizedTitle}")`)

    const result = await saveSong(trimmedTitle, normalizedTitle)

    if (!result.success) {
      console.error(`[Music API] Failed to save song: ${result.error}`)
      return res.status(500).json({
        success: false,
        saved: false,
        error: result.error || 'Failed to save song',
      })
    }

    console.log(
      `[Music API] Song save result: saved=${result.saved}, song="${result.song?.song_title}"`
    )

    return res.status(200).json({
      success: true,
      saved: result.saved,
      song: result.song || undefined,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Music API] Save song error:', errorMessage)
    return res.status(500).json({
      success: false,
      saved: false,
      error: 'Internal server error',
    })
  }
}
