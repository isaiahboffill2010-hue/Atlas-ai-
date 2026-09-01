import { getSupabaseAdmin } from './client'

export interface SongRecord {
  id: string
  song_title: string
  normalized_title: string
  created_at: string
}

/**
 * Add a song to the library.
 * Handles unique constraint violation gracefully (song already exists = false, no error).
 */
export async function saveSong(
  songTitle: string,
  normalizedTitle: string
): Promise<{ success: boolean; saved: boolean; song: SongRecord | null; error?: string }> {
  const db = getSupabaseAdmin()

  try {
    const { data, error } = await db
      .from('atlas_songs')
      .insert({
        song_title: songTitle,
        normalized_title: normalizedTitle,
      })
      .select()
      .single()

    // Handle unique constraint violation - song already exists
    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        console.log(`[Songs DB] Song already exists: "${songTitle}" (normalized: "${normalizedTitle}")`)

        // Fetch and return the existing song
        const { data: existingSong, error: fetchError } = await db
          .from('atlas_songs')
          .select('*')
          .eq('normalized_title', normalizedTitle)
          .single()

        if (fetchError) {
          console.error('[Songs DB] Error fetching existing song:', fetchError)
          return {
            success: false,
            saved: false,
            song: null,
            error: 'Failed to fetch existing song',
          }
        }

        return {
          success: true,
          saved: false, // Already existed
          song: existingSong,
        }
      }

      console.error('[Songs DB] Error saving song:', error)
      return {
        success: false,
        saved: false,
        song: null,
        error: error.message,
      }
    }

    console.log(`[Songs DB] Saved new song: "${songTitle}" (ID: ${data.id})`)
    return {
      success: true,
      saved: true, // Newly inserted
      song: data,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Songs DB] Unexpected error:', errorMessage)
    return {
      success: false,
      saved: false,
      song: null,
      error: errorMessage,
    }
  }
}

/**
 * Get a random song from the library
 */
export async function getRandomSong(): Promise<SongRecord | null> {
  const db = getSupabaseAdmin()

  try {
    // Get total count
    const { count, error: countError } = await db
      .from('atlas_songs')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      console.error('[Songs DB] Error getting song count:', countError)
      return null
    }

    if (!count || count === 0) {
      console.log('[Songs DB] Song library is empty')
      return null
    }

    // Get random song using PostgreSQL RANDOM()
    const { data, error } = await db
      .from('atlas_songs')
      .select('*')
      .order('id', { ascending: false }) // Required for query planner
      .limit(1)

    // Use direct SQL for better random selection
    // Since Supabase doesn't always honor ORDER BY random() in RLS, we'll use limit and offset
    const randomOffset = Math.floor(Math.random() * count)

    const { data: randomData, error: randomError } = await db
      .from('atlas_songs')
      .select('*')
      .range(randomOffset, randomOffset)
      .single()

    if (randomError && randomError.code !== 'PGRST116') {
      console.error('[Songs DB] Error getting random song:', randomError)
      return null
    }

    if (!randomData) {
      console.log('[Songs DB] No song found at random offset')
      return null
    }

    console.log(`[Songs DB] Random song: "${randomData.song_title}"`)
    return randomData
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Songs DB] Error in getRandomSong:', errorMessage)
    return null
  }
}

/**
 * Get all songs from the library
 */
export async function getAllSongs(): Promise<SongRecord[]> {
  const db = getSupabaseAdmin()

  try {
    const { data, error } = await db
      .from('atlas_songs')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Songs DB] Error getting all songs:', error)
      return []
    }

    console.log(`[Songs DB] Retrieved ${data?.length || 0} songs`)
    return data || []
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Songs DB] Error in getAllSongs:', errorMessage)
    return []
  }
}

/**
 * Get song count
 */
export async function getSongCount(): Promise<number> {
  const db = getSupabaseAdmin()

  try {
    const { count, error } = await db
      .from('atlas_songs')
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.error('[Songs DB] Error getting song count:', error)
      return 0
    }

    return count || 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Songs DB] Error in getSongCount:', errorMessage)
    return 0
  }
}

/**
 * Check for duplicate normalized titles
 */
export async function checkDuplicates(): Promise<{ hasDuplicates: boolean; duplicates: string[] }> {
  const db = getSupabaseAdmin()

  try {
    const { data, error } = await db.rpc('find_duplicate_normalized_titles')

    if (error) {
      console.error('[Songs DB] Error checking duplicates:', error)
      return { hasDuplicates: false, duplicates: [] }
    }

    const duplicates = (data || []).map((d: any) => d.normalized_title)
    return {
      hasDuplicates: duplicates.length > 0,
      duplicates,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Songs DB] Error in checkDuplicates:', errorMessage)
    return { hasDuplicates: false, duplicates: [] }
  }
}
