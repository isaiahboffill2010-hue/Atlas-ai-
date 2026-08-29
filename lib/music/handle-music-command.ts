import {
  setMusicPlayerState,
  setCurrentSong,
  setMusicError,
  resetMusicPlayer,
} from './music-player-state'
import { resetSession, enableAutoplay } from './autoplay-manager'
import type { MusicCommand } from './music-command-parser'

export async function handleMusicCommand(command: MusicCommand, query?: string): Promise<boolean> {
  try {
    switch (command) {
      case 'random': {
        console.log('[Music] Random song command: fetching random song from library')
        setMusicError(null)

        // Reset autoplay session for new user request
        resetSession()
        enableAutoplay()
        console.log('[Music] ✓ Autoplay session reset for random song request')

        // Get random song from library
        const randomResponse = await fetch('/api/music/random-song', {
          method: 'GET',
        })

        if (!randomResponse.ok) {
          const error = await randomResponse.json()
          if (error.error === 'Song library is empty') {
            setMusicError('No songs in your library yet. Save some songs first!')
          } else {
            setMusicError(error.error || 'Failed to get random song')
          }
          return false
        }

        const randomResult = await randomResponse.json()

        if (!randomResult.success || !randomResult.result) {
          setMusicError('Failed to get random song')
          return false
        }

        const songTitle = randomResult.result.song_title
        console.log(`[Music] Random song selected: "${songTitle}"`)

        // Now search YouTube for this song
        const searchResponse = await fetch('/api/music/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: songTitle }),
        })

        if (!searchResponse.ok) {
          const error = await searchResponse.json()
          setMusicError(error.error || 'Search failed')
          return false
        }

        const searchResult = await searchResponse.json()

        if (!searchResult.success || !searchResult.result) {
          setMusicError(`Couldn't find "${songTitle}"`)
          return false
        }

        console.log('[Music] Search result:', searchResult.result)

        // Set current song
        console.log(`[Music] Setting current song: ${searchResult.result.title}`)
        setCurrentSong(searchResult.result)
        console.log('[Music] ✓ Current song set')

        // Tell player to play
        if ((window as any).atlasMusic?.play) {
          console.log(`[Music] Calling atlasMusic.play(${searchResult.result.videoId})`)
          ;(window as any).atlasMusic.play(searchResult.result.videoId)
          console.log('[Music] ✓ atlasMusic.play() called')
        } else {
          console.error('[Music] ✗ atlasMusic.play not available')
          setMusicError('Music player not available')
          return false
        }

        return true
      }

      case 'play': {
        if (!query) {
          setMusicError('No song specified')
          return false
        }

        console.log(`[Music] Playing: "${query}"`)
        setMusicError(null)

        // Reset autoplay session for new user request
        resetSession()
        enableAutoplay()
        console.log('[Music] ✓ Autoplay session reset for play request')

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

        // Save the song to library (fire-and-forget, non-blocking)
        console.log(`[Music] Saving song to library: "${query}"`)
        fetch('/api/music/save-song', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songTitle: query }),
        }).catch((err) => {
          console.error('[Music] Error saving song (non-blocking):', err)
          // Don't interrupt playback on save error
        })

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

        // Reset autoplay session and disable autoplay
        resetSession()
        console.log('[Music] ✓ Autoplay session reset on stop')

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
