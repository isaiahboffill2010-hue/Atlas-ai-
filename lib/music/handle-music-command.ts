import {
  setMusicPlayerState,
  setCurrentSong,
  setMusicError,
  resetMusicPlayer,
} from './music-player-state'
import type { MusicCommand } from './music-command-parser'

export async function handleMusicCommand(command: MusicCommand, query?: string): Promise<boolean> {
  try {
    switch (command) {
      case 'play': {
        if (!query) {
          setMusicError('No song specified')
          return false
        }

        console.log(`[Music] Playing: "${query}"`)
        setMusicError(null)

        // Search YouTube
        const searchResponse = await fetch('/api/music/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        })

        if (!searchResponse.ok) {
          const error = await searchResponse.json()
          setMusicError(error.error || 'Search failed')
          return false
        }

        const result = await searchResponse.json()

        if (!result.success || !result.result) {
          setMusicError(`Couldn't find "${query}"`)
          return false
        }

        // Set current song and play
        setCurrentSong(result.result)
        setMusicPlayerState('playing')

        // Tell player to play
        if ((window as any).atlasMusic?.play) {
          ;(window as any).atlasMusic.play(result.result.videoId)
        }

        return true
      }

      case 'pause': {
        console.log('[Music] Pausing')
        setMusicError(null)
        setMusicPlayerState('paused')

        if ((window as any).atlasMusic?.pause) {
          ;(window as any).atlasMusic.pause()
        }

        return true
      }

      case 'resume': {
        console.log('[Music] Resuming')
        setMusicError(null)
        setMusicPlayerState('playing')

        if ((window as any).atlasMusic?.resume) {
          ;(window as any).atlasMusic.resume()
        }

        return true
      }

      case 'stop': {
        console.log('[Music] Stopping')
        setMusicError(null)
        resetMusicPlayer()

        if ((window as any).atlasMusic?.stop) {
          ;(window as any).atlasMusic.stop()
        }

        return true
      }

      default:
        return false
    }
  } catch (error) {
    console.error('[Music] Error handling command:', error)
    setMusicError('Command failed')
    return false
  }
}
