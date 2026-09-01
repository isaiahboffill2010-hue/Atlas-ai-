import type { NextApiRequest, NextApiResponse } from 'next'
import { getSupabaseAdmin } from '../../../lib/supabase/client'
import { getSongCount, type SongRecord } from '../../../lib/supabase/songs-db'

interface RandomSongResponse {
  success: boolean
  result?: SongRecord
  error?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RandomSongResponse>) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    console.log('[Music API] Getting random song from library...')

    // Check if library is empty
    const count = await getSongCount()
    console.log(`[Music API] Total songs in library: ${count}`)

    if (count === 0) {
      console.log('[Music API] Song library is empty')
      return res.status(404).json({
        success: false,
        error: 'Song library is empty',
      })
    }

    // Get exclude_id from query params to prevent immediate repeats
    const excludeId = req.query.exclude_id as string | undefined

    // If only 1 song in library, return it (even if it's the excluded one)
    if (count === 1) {
      const db = getSupabaseAdmin()
      const { data, error } = await db
        .from('atlas_songs')
        .select('*')
        .limit(1)
        .single()

      if (error || !data) {
        console.error('[Music API] Failed to retrieve the only song in library')
        return res.status(500).json({
          success: false,
          error: 'Failed to retrieve song',
        })
      }

      console.log(`[Music API] Only 1 song available: "${data.song_title}"`)
      return res.status(200).json({
        success: true,
        result: data,
      })
    }

    // For multiple songs, try to get a random one that's not the excluded one
    let song: SongRecord | undefined = undefined

    if (excludeId) {
      console.log(`[Music API] Attempting to get random song excluding ID: ${excludeId}`)
      const db = getSupabaseAdmin()

      // Get random song excluding the specified one
      const randomOffset = Math.floor(Math.random() * (count - 1))

      const { data, error } = await db
        .from('atlas_songs')
        .select('*')
        .neq('id', excludeId)
        .order('id', { ascending: false })
        .range(randomOffset, randomOffset)
        .single()

      if (!error && data) {
        song = data
        console.log(`[Music API] Got random song (excluding ${excludeId}): "${data.song_title}"`)
      } else {
        console.log(`[Music API] Could not get non-excluded random song, falling back`)
      }
    }

    // If no song found yet (or no exclude_id was provided), get any random song
    if (!song) {
      const db = getSupabaseAdmin()
      const randomOffset = Math.floor(Math.random() * count)

      const { data, error } = await db
        .from('atlas_songs')
        .select('*')
        .order('id', { ascending: false })
        .range(randomOffset, randomOffset)
        .single()

      if (error || !data) {
        console.error('[Music API] Failed to retrieve random song')
        return res.status(500).json({
          success: false,
          error: 'Failed to retrieve random song',
        })
      }

      song = data
    }

    if (!song) {
      console.error('[Music API] Failed to select a random song')
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve random song',
      })
    }

    console.log(`[Music API] Random song selected: "${song.song_title}" (ID: ${song.id})`)

    return res.status(200).json({
      success: true,
      result: song,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Music API] Random song error:', errorMessage)
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    })
  }
}
