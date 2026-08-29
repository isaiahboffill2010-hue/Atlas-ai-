import React, { useEffect, useRef, useState } from 'react'
import {
  getMusicPlayerState,
  subscribe,
  MusicPlayerStore,
  setMusicPlayerState,
  setMusicError,
} from '../lib/music/music-player-state'

export default function MusicPlayer() {
  const [musicState, setMusicState] = useState<MusicPlayerStore>(getMusicPlayerState())
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const playerRef = useRef<any>(null)
  const playerReadyRef = useRef(false)
  const pendingVideoRef = useRef<string | null>(null)
  const playAttemptedRef = useRef(false)
  const isMountedRef = useRef(true)

  // Subscribe to music state changes
  useEffect(() => {
    console.log('[MusicPlayer] Setting up state subscription')
    isMountedRef.current = true

    const unsubscribe = subscribe((newState) => {
      // Only update state if component is mounted
      if (!isMountedRef.current) {
        console.log('[MusicPlayer] Component unmounted, ignoring state update')
        return
      }

      console.log('[MusicPlayer] State subscription fired')
      console.log('[MusicPlayer] New state:', newState)
      console.log('[MusicPlayer] currentSong:', newState.currentSong ? newState.currentSong.title : 'None')

      // Force immediate state update
      setMusicState(newState)
    })

    console.log('[MusicPlayer] Initial state after subscription setup:', musicState)

    return () => {
      console.log('[MusicPlayer] Component unmounting, marking as unmounted')
      isMountedRef.current = false
      unsubscribe()
    }
  }, [])

  // Fallback: Poll music state if subscription might have missed updates
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (!isMountedRef.current) return

      const currentState = getMusicPlayerState()
      setMusicState((prevState) => {
        // Only update if state actually changed
        if (currentState.currentSong?.videoId !== prevState.currentSong?.videoId) {
          console.log('[MusicPlayer] Polling detected state change, updating:', currentState.currentSong?.title)
          return currentState
        }
        return prevState
      })
    }, 500)

    return () => clearInterval(pollInterval)
  }, [])

  // Lazy YouTube player initialization - only when a song is selected
  useEffect(() => {
    // Only initialize when we have a currentSong
    if (!musicState.currentSong) {
      console.log('[MusicPlayer] No currentSong, skipping player initialization')
      return
    }

    if (typeof window === 'undefined') {
      console.log('[MusicPlayer] SSR detected, skipping YouTube initialization')
      return
    }

    // If player is already initialized, nothing to do
    if (playerReadyRef.current) {
      console.log('[MusicPlayer] Player already initialized, not reinitializing')
      return
    }

    console.log('[MusicPlayer] Song selected, initializing YouTube player lazily')

    // Load YouTube IFrame API if not already loaded
    if (!(window as any).YT) {
      console.log('[MusicPlayer] YouTube API not loaded, loading script from https://www.youtube.com/iframe_api')

      // Define global callback FIRST before loading script
      ;(window as any).onYouTubeIframeAPIReady = () => {
        console.log('[MusicPlayer] ✓ onYouTubeIframeAPIReady callback fired')
        initializePlayer()
      }

      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      tag.onload = () => {
        console.log('[MusicPlayer] YouTube script loaded, waiting for API ready...')
      }
      tag.onerror = () => {
        console.error('[MusicPlayer] Failed to load YouTube script')
      }
      const firstScriptTag = document.getElementsByTagName('script')[0]
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
      }
    } else {
      console.log('[MusicPlayer] YouTube API already loaded, initializing player immediately')
      // Give DOM a chance to render the container
      setTimeout(() => {
        initializePlayer()
      }, 100)
    }

    return () => {
      console.log('[MusicPlayer] Cleaning up YouTube player')
      if (playerRef.current) {
        try {
          playerRef.current.destroy?.()
          console.log('[MusicPlayer] Player destroyed')
        } catch (e) {
          console.error('[MusicPlayer] Error destroying player:', e)
        }
      }
      playerReadyRef.current = false
      pendingVideoRef.current = null
    }
  }, [musicState.currentSong])

  const initializePlayer = () => {
    if (playerReadyRef.current) {
      console.log('[MusicPlayer] Player already initialized, skipping')
      return
    }

    console.log('[MusicPlayer] initializePlayer() called')

    if (typeof (window as any).YT === 'undefined') {
      console.error('[MusicPlayer] ✗ YouTube API not available, retrying in 100ms')
      setTimeout(() => {
        initializePlayer()
      }, 100)
      return
    }

    // Check if container exists
    const container = document.getElementById('youtube-player')
    if (!container) {
      console.error('[MusicPlayer] ✗ Container element "youtube-player" not found in DOM, retrying in 100ms')
      console.log('[MusicPlayer] Available elements:', document.body.innerHTML.substring(0, 200))
      setTimeout(() => {
        initializePlayer()
      }, 100)
      return
    }

    console.log('[MusicPlayer] ✓ YouTube API available, container found, creating YT.Player instance')
    console.log('[MusicPlayer] Container:', container)

    try {
      console.log('[MusicPlayer] YouTube player container:', document.getElementById('youtube-player'))
      playerRef.current = new (window as any).YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onPlayerStateChange,
          onError: onPlayerError,
        },
      })
      console.log('[MusicPlayer] ✓ YT.Player instance created successfully')
      console.log('[MusicPlayer] Player dimensions: 100% x 100%')
      console.log('[MusicPlayer] playerRef.current:', playerRef.current)
    } catch (error) {
      console.error('[MusicPlayer] ✗ Error creating player:', error)
      if (error instanceof Error) {
        console.error('[MusicPlayer] Error details:', error.message)
      }
    }
  }

  const onPlayerReady = (event: any) => {
    console.log('[MusicPlayer] ✓ YouTube player onReady event fired')
    console.log('[MusicPlayer] Player ready event object:', event)
    playerReadyRef.current = true
    console.log('[MusicPlayer] ✓ Set playerReadyRef = true')

    // If there's a pending video, play it now
    if (pendingVideoRef.current) {
      const videoId = pendingVideoRef.current
      console.log('[MusicPlayer] ✓ Found pending video, playing:', videoId)
      pendingVideoRef.current = null
      playVideo(videoId)
    } else {
      console.log('[MusicPlayer] No pending video in queue')
    }
  }

  const onPlayerError = (event: any) => {
    console.error('[MusicPlayer] YouTube player error:', event.data)
    const errorCodes: Record<number, string> = {
      2: 'Invalid parameter',
      5: 'HTML5 player error',
      100: 'Video not found',
      101: 'Video not allowed to be played',
      150: 'Same as 101',
    }
    const errorMsg = errorCodes[event.data] || `Error code ${event.data}`
    setMusicError(`YouTube error: ${errorMsg}`)
  }

  const onPlayerStateChange = (event: any) => {
    const YT = (window as any).YT
    const state = event.data

    const stateMap: Record<number, string> = {
      [-1]: 'UNSTARTED',
      [0]: 'ENDED',
      [1]: 'PLAYING',
      [2]: 'PAUSED',
      [3]: 'BUFFERING',
      [5]: 'CUED',
    }

    const stateName = stateMap[state] || 'UNKNOWN'
    console.log(`[MusicPlayer] YouTube state changed: ${stateName} (${state})`)

    if (state === YT.PlayerState.PLAYING) {
      console.log('[MusicPlayer] ✓ Audio playback started')
      setAutoplayBlocked(false)
      setMusicPlayerState('playing')
      playAttemptedRef.current = false
    } else if (state === YT.PlayerState.PAUSED) {
      console.log('[MusicPlayer] Audio paused')
      setMusicPlayerState('paused')
    } else if (state === YT.PlayerState.ENDED) {
      console.log('[MusicPlayer] Audio ended')
      setMusicPlayerState('stopped')
    } else if (state === YT.PlayerState.BUFFERING) {
      console.log('[MusicPlayer] Audio buffering...')
    } else if (state === YT.PlayerState.UNSTARTED || state === YT.PlayerState.CUED) {
      // Detect if autoplay was blocked: video is ready (UNSTARTED/CUED) but we tried to play
      if (playAttemptedRef.current && musicState.state !== 'paused') {
        console.log('[MusicPlayer] ⚠️ Autoplay blocked by browser - showing manual play button')
        setAutoplayBlocked(true)
      } else {
        console.log('[MusicPlayer] Video ready but not playing')
      }
    }
  }

  const playVideo = (videoId: string) => {
    console.log(`[MusicPlayer] playVideo(${videoId}) called`)
    console.log(`[MusicPlayer] playerReadyRef.current = ${playerReadyRef.current}`)

    if (!playerReadyRef.current) {
      console.log(`[MusicPlayer] ⏳ Player not ready yet, queueing video: ${videoId}`)
      pendingVideoRef.current = videoId
      return
    }

    if (!playerRef.current) {
      console.error('[MusicPlayer] ✗ Player ref is null despite playerReadyRef=true!')
      setMusicError('Music player not initialized')
      return
    }

    try {
      console.log(`[MusicPlayer] ✓ Player ready, loading video: ${videoId}`)
      playerRef.current.loadVideoById(videoId)
      console.log(`[MusicPlayer] ✓ loadVideoById(${videoId}) called`)

      // Call playVideo() to actually start playback
      // Small delay to ensure video is loaded before playing
      setTimeout(() => {
        try {
          console.log('[MusicPlayer] Calling playVideo()...')
          if (playerRef.current?.playVideo) {
            playAttemptedRef.current = true
            setAutoplayBlocked(false)
            playerRef.current.playVideo()
            console.log('[MusicPlayer] ✓ playVideo() called successfully')
          } else {
            console.error('[MusicPlayer] ✗ playVideo method not available on player')
          }
        } catch (error) {
          console.error('[MusicPlayer] ✗ Error calling playVideo():', error)
          setMusicError(`Playback error: ${error instanceof Error ? error.message : 'Unknown'}`)
        }
      }, 100)

      console.log('[MusicPlayer] Playback initiated, waiting for YouTube state confirmation')
    } catch (error) {
      console.error('[MusicPlayer] ✗ Error loading video:', error)
      setMusicError(`Failed to load video: ${error instanceof Error ? error.message : 'Unknown'}`)
    }
  }

  const pauseMusic = () => {
    console.log('[MusicPlayer] pauseMusic() called')
    if (playerRef.current) {
      try {
        playerRef.current.pauseVideo()
        console.log('[MusicPlayer] ✓ pauseVideo() called on YouTube player')
      } catch (error) {
        console.error('[MusicPlayer] Error pausing video:', error)
      }
    } else {
      console.error('[MusicPlayer] ✗ No player available to pause')
    }
  }

  const resumeMusic = () => {
    console.log('[MusicPlayer] resumeMusic() called')
    if (playerRef.current) {
      try {
        playerRef.current.playVideo()
        console.log('[MusicPlayer] ✓ playVideo() called on YouTube player (resume)')
      } catch (error) {
        console.error('[MusicPlayer] Error resuming video:', error)
      }
    } else {
      console.error('[MusicPlayer] ✗ No player available to resume')
    }
  }

  const stopMusic = () => {
    console.log('[MusicPlayer] stopMusic() called')
    if (playerRef.current) {
      try {
        playerRef.current.stopVideo()
        console.log('[MusicPlayer] ✓ stopVideo() called on YouTube player')
      } catch (error) {
        console.error('[MusicPlayer] Error stopping video:', error)
      }
    } else {
      console.log('[MusicPlayer] No player to stop (may already be stopped)')
    }
  }

  const replayMusic = () => {
    console.log('[MusicPlayer] replayMusic() called')
    if (!playerRef.current) {
      console.error('[MusicPlayer] ✗ No player available to replay')
      return
    }

    try {
      console.log('[MusicPlayer] Seeking to 0:00 (seekTo(0, true))')
      playerRef.current.seekTo(0, true)

      console.log('[MusicPlayer] Calling playVideo() to start from beginning')
      playerRef.current.playVideo()
      console.log('[MusicPlayer] ✓ Replay initiated - seeked to 0:00 and called playVideo()')
    } catch (error) {
      console.error('[MusicPlayer] Error replaying video:', error)
    }
  }

  const handleManualPlay = () => {
    console.log('[MusicPlayer] Manual play button clicked')
    if (!playerRef.current) {
      console.error('[MusicPlayer] ✗ No player available for manual play')
      return
    }

    try {
      console.log('[MusicPlayer] Attempting playback from manual user click')
      playerRef.current.playVideo()
      setAutoplayBlocked(false)
      console.log('[MusicPlayer] ✓ Manual playVideo() called')
    } catch (error) {
      console.error('[MusicPlayer] Error on manual play:', error)
      setMusicError(`Playback error: ${error instanceof Error ? error.message : 'Unknown'}`)
    }
  }

  // Expose control methods globally for voice system
  useEffect(() => {
    ;(window as any).atlasMusic = {
      play: playVideo,
      pause: pauseMusic,
      resume: resumeMusic,
      replay: replayMusic,
      stop: stopMusic,
      getState: () => getMusicPlayerState(),
    }
  }, [])

  // Don't render anything if there's no song
  if (!musicState.currentSong) {
    console.log('[MusicPlayer] No currentSong in state, not rendering player')
    return null
  }

  console.log('[MusicPlayer] currentSong exists, rendering full card UI with song:', musicState.currentSong.title)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        width: '360px',
        background: 'rgba(20, 20, 20, 0.95)',
        borderRadius: '12px',
        padding: '16px',
        border: '1px solid rgba(100, 200, 255, 0.3)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        zIndex: 50000,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
      }}
    >
      {/* YouTube Player - Video visible inside card */}
      <div
        id="youtube-player"
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          minHeight: '180px',
          marginBottom: '12px',
          borderRadius: '8px',
          overflow: 'hidden',
          background: '#000',
        }}
      />

      {/* Song Title */}
      <div
        style={{
          fontSize: '14px',
          fontWeight: '600',
          marginBottom: '6px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        🎵 {musicState.currentSong.title}
      </div>

      {/* Channel/Artist */}
      <div
        style={{
          fontSize: '12px',
          opacity: '0.7',
          marginBottom: '12px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {musicState.currentSong.channel}
      </div>

      {/* Status or Manual Play Button */}
      {autoplayBlocked ? (
        <button
          onClick={handleManualPlay}
          style={{
            marginTop: '8px',
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #00d9ff 0%, #0099cc 100%)',
            border: 'none',
            borderRadius: '6px',
            color: '#000',
            fontWeight: '600',
            fontSize: '13px',
            cursor: 'pointer',
            width: '100%',
            transition: 'all 0.2s ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'scale(1.02)'
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 217, 255, 0.4)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >
          ▶ Tap to Play
        </button>
      ) : (
        <div
          style={{
            fontSize: '12px',
            textTransform: 'capitalize',
            opacity: '0.8',
            letterSpacing: '0.5px',
          }}
        >
          {musicState.state === 'playing' && '▶ Playing'}
          {musicState.state === 'paused' && '⏸ Paused'}
          {musicState.state === 'stopped' && '⏹ Stopped'}
        </div>
      )}

      {/* Error Message */}
      {musicState.error && (
        <div
          style={{
            fontSize: '12px',
            color: '#ff6b6b',
            marginTop: '8px',
            padding: '8px',
            background: 'rgba(255, 107, 107, 0.1)',
            borderRadius: '6px',
          }}
        >
          {musicState.error}
        </div>
      )}
    </div>
  )
}
