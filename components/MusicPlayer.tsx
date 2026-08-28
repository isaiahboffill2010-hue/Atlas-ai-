import React, { useEffect, useRef, useState } from 'react'
import {
  getMusicPlayerState,
  subscribe,
  MusicPlayerStore,
  setMusicPlayerState,
} from '../lib/music/music-player-state'

export default function MusicPlayer() {
  const [musicState, setMusicState] = useState<MusicPlayerStore>(getMusicPlayerState())
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playerRef = useRef<any>(null)

  // Subscribe to music state changes
  useEffect(() => {
    const unsubscribe = subscribe((newState) => {
      setMusicState(newState)
    })

    return unsubscribe
  }, [])

  // Initialize YouTube IFrame API
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Load YouTube IFrame API
    if (!(window as any).YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      const firstScriptTag = document.getElementsByTagName('script')[0]
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)
      }
    }

    // Define onYouTubeIframeAPIReady
    ;(window as any).onYouTubeIframeAPIReady = () => {
      initializePlayer()
    }
  }, [])

  const initializePlayer = () => {
    if (typeof (window as any).YT === 'undefined') return

    playerRef.current = new (window as any).YT.Player('youtube-player', {
      height: '0',
      width: '0',
      videoId: '',
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
      },
    })
  }

  const onPlayerReady = () => {
    console.log('[MusicPlayer] YouTube player ready')
  }

  const onPlayerStateChange = (event: any) => {
    const YT = (window as any).YT
    const state = event.data

    if (state === YT.PlayerState.PLAYING) {
      console.log('[MusicPlayer] Playing')
      setMusicPlayerState('playing')
    } else if (state === YT.PlayerState.PAUSED) {
      console.log('[MusicPlayer] Paused')
      setMusicPlayerState('paused')
    } else if (state === YT.PlayerState.ENDED) {
      console.log('[MusicPlayer] Ended')
      setMusicPlayerState('stopped')
    }
  }

  const playVideo = (videoId: string) => {
    if (!playerRef.current) {
      console.error('[MusicPlayer] Player not initialized')
      return
    }

    try {
      console.log(`[MusicPlayer] Loading video: ${videoId}`)
      playerRef.current.loadVideoById(videoId)
      setMusicPlayerState('playing')
    } catch (error) {
      console.error('[MusicPlayer] Error loading video:', error)
    }
  }

  const pauseMusic = () => {
    if (playerRef.current) {
      playerRef.current.pauseVideo()
    }
  }

  const resumeMusic = () => {
    if (playerRef.current) {
      playerRef.current.playVideo()
    }
  }

  const stopMusic = () => {
    if (playerRef.current) {
      playerRef.current.stopVideo()
    }
  }

  // Expose control methods globally for voice system
  useEffect(() => {
    ;(window as any).atlasMusic = {
      play: playVideo,
      pause: pauseMusic,
      resume: resumeMusic,
      stop: stopMusic,
      getState: () => getMusicPlayerState(),
    }
  }, [])

  if (!musicState.currentSong) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        background: 'rgba(20, 20, 20, 0.95)',
        borderRadius: '12px',
        padding: '16px',
        minWidth: '300px',
        maxWidth: '400px',
        border: '1px solid rgba(100, 200, 255, 0.3)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#fff',
      }}
    >
      {/* Hidden YouTube Player */}
      <div id="youtube-player" style={{ display: 'none' }} />

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

      {/* Status */}
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

      {/* Thumbnail (optional) */}
      {musicState.currentSong.thumbnail && (
        <div
          style={{
            marginTop: '12px',
            borderRadius: '8px',
            overflow: 'hidden',
            height: '160px',
            background: 'rgba(50, 50, 50, 0.5)',
          }}
        >
          <img
            src={musicState.currentSong.thumbnail}
            alt="Song thumbnail"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
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
