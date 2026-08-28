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

        console.log('[Music] Search result:', result.result)

        // Set current song (don't set playing state yet - wait for YouTube to report it)
        console.log(`[Music] Setting current song: ${result.result.title}`)
        setCurrentSong(result.result)
        console.log('[Music] ✓ Current song set')

        // Tell player to play - playback state will be set by YouTube's state change event
        if ((window as any).atlasMusic?.play) {
          console.log(`[Music] Calling atlasMusic.play(${result.result.videoId})`)
          ;(window as any).atlasMusic.play(result.result.videoId)
          console.log('[Music] ✓ atlasMusic.play() called')
        } else {
          console.error('[Music] ✗ atlasMusic.play not available')
          setMusicError('Music player not available')
          return false
        }

        return true
      }

      case 'pause': {
        console.log('[Music] Pause command: pausing playback')
        setMusicError(null)

        if ((window as any).atlasMusic?.pause) {
          console.log('[Music] Calling atlasMusic.pause()')
          ;(window as any).atlasMusic.pause()
          // State will be updated by YouTube's onStateChange event
          console.log('[Music] ✓ pauseVideo() called, state will update from YouTube')
        } else {
          console.error('[Music] ✗ atlasMusic.pause not available')
          setMusicError('Music player not available')
          return false
        }

        return true
      }

      case 'resume': {
        console.log('[Music] Resume command: resuming playback')
        setMusicError(null)

        if ((window as any).atlasMusic?.resume) {
          console.log('[Music] Calling atlasMusic.resume()')
          ;(window as any).atlasMusic.resume()
          // State will be updated by YouTube's onStateChange event
          console.log('[Music] ✓ playVideo() called, state will update from YouTube')
        } else {
          console.error('[Music] ✗ atlasMusic.resume not available')
          setMusicError('Music player not available')
          return false
        }

        return true
      }

      case 'stop': {
        console.log('[Music] Stop command: stopping music and clearing current song')
        setMusicError(null)

        if ((window as any).atlasMusic?.stop) {
          console.log('[Music] Calling atlasMusic.stop()')
          ;(window as any).atlasMusic.stop()
          console.log('[Music] ✓ stopVideo() called')
        }

        // Clear the current song completely
        console.log('[Music] Resetting music player state')
        resetMusicPlayer()
        console.log('[Music] ✓ Music state reset, card will disappear')

        return true
      }

      case 'replay': {
        console.log('[Music] Replay command: restarting current song from beginning')
        setMusicError(null)

        // Check if there's a current song to replay
        const currentState = (window as any).atlasMusic?.getState?.()
        if (!currentState?.currentSong) {
          console.log('[Music] No song to replay, returning error')
          setMusicError("There's nothing to replay.")
          return false
        }

        console.log(`[Music] Replaying: ${currentState.currentSong.title}`)

        if ((window as any).atlasMusic?.replay) {
          console.log('[Music] Calling atlasMusic.replay()')
          ;(window as any).atlasMusic.replay()
          console.log('[Music] ✓ Replay initiated (seekTo + playVideo)')
        } else {
          console.error('[Music] ✗ atlasMusic.replay not available')
          setMusicError('Music player replay not available')
          return false
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
