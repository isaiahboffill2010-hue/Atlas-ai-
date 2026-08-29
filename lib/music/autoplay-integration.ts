import {
  getCurrentSessionId,
  isSessionValid,
  isAutoplayActive,
  schedulePendingAutoplay,
  cancelPendingAutoplay,
  getLastPlayedSongId,
  setLastPlayedSongId,
} from './autoplay-manager'
import { setCurrentSong, setMusicError } from './music-player-state'
import type { CurrentSong } from './music-player-state'

const DEBUG = true

function log(message: string) {
  if (DEBUG) {
    console.log(`[Autoplay Integration] ${message}`)
  }
}

export async function playNextSongAutomatically(): Promise<boolean> {
  const sessionId = getCurrentSessionId()

  log(`playNextSongAutomatically() called for session ${sessionId}`)

  // Verify session is still valid
  if (!isSessionValid(sessionId)) {
    log(`Session ${sessionId} is stale, aborting autoplay`)
    return false
  }

  // Verify autoplay is enabled
  if (!isAutoplayActive()) {
    log('Autoplay is disabled, skipping next song')
    return false
  }

  try {
    log(`Fetching random song (current session: ${sessionId})`)

    // Build exclude_id query param to prevent immediate repeats
    const lastSongId = getLastPlayedSongId()
    const url = lastSongId ? `/api/music/random-song?exclude_id=${encodeURIComponent(lastSongId)}` : '/api/music/random-song'

    const randomResponse = await fetch(url, {
      method: 'GET',
    })

    // Check if session is still valid after async operation
    if (!isSessionValid(sessionId)) {
      log(`Session became stale during fetch, discarding result`)
      return false
    }

    if (!randomResponse.ok) {
      const error = await randomResponse.json()
      log(`Failed to get random song: ${error.error}`)
      setMusicError(error.error || 'Failed to get next song')
      return false
    }

    const randomResult = await randomResponse.json()

    if (!randomResult.success || !randomResult.result) {
      log('Random song response invalid')
      setMusicError('Failed to get next song')
      return false
    }

    const song = randomResult.result
    const songTitle = song.song_title

    log(`Random song fetched: "${songTitle}" (ID: ${song.id})`)
    setLastPlayedSongId(song.id)

    // Search YouTube for this song
    log(`Searching YouTube for: "${songTitle}"`)
    const searchResponse = await fetch('/api/music/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: songTitle }),
    })

    // Check session validity again
    if (!isSessionValid(sessionId)) {
      log(`Session became stale during YouTube search, discarding result`)
      return false
    }

    if (!searchResponse.ok) {
      const error = await searchResponse.json()
      log(`YouTube search failed: ${error.error}`)
      setMusicError(error.error || 'Search failed')
      return false
    }

    const searchResult = await searchResponse.json()

    if (!searchResult.success || !searchResult.result) {
      log(`Couldn't find "${songTitle}" on YouTube`)
      setMusicError(`Couldn't find "${songTitle}"`)
      return false
    }

    const youtubeResult = searchResult.result as CurrentSong

    log(`YouTube search result: "${youtubeResult.title}" (videoId: ${youtubeResult.videoId})`)

    // Set current song in player state
    log(`Setting current song for autoplay: ${youtubeResult.title}`)
    setCurrentSong(youtubeResult)

    // Tell player to play the video
    if ((window as any).atlasMusic?.play) {
      log(`Calling atlasMusic.play(${youtubeResult.videoId}) for autoplay`)
      ;(window as any).atlasMusic.play(youtubeResult.videoId)
      log(`✓ Autoplay video loading initiated`)
      return true
    } else {
      log(`✗ atlasMusic.play not available`)
      setMusicError('Music player not available')
      return false
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`Error during autoplay: ${errorMessage}`)
    console.error('[Autoplay Integration]', error)
    setMusicError('Autoplay failed')
    return false
  }
}

export function scheduleNextSongAutoplay(delayMs: number = 500): void {
  const sessionId = getCurrentSessionId()

  if (!isSessionValid(sessionId)) {
    log(`Cannot schedule autoplay for stale session ${sessionId}`)
    return
  }

  if (!isAutoplayActive()) {
    log('Autoplay is disabled, not scheduling')
    return
  }

  log(`Scheduling autoplay for session ${sessionId}`)

  schedulePendingAutoplay(
    sessionId,
    async () => {
      await playNextSongAutomatically()
    },
    delayMs
  )
}

export function stopAutoplay(): void {
  log('Stopping autoplay')
  cancelPendingAutoplay()
}
