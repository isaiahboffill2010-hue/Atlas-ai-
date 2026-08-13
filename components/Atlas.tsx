import React, { useEffect, useRef } from 'react'

export type AtlasState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface AtlasProps {
  state: AtlasState
  className?: string
}

export const Atlas: React.FC<AtlasProps> = ({ state, className }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    if (state === 'speaking') {
      v.loop = true
      v.muted = true
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } else {
      // stop and reset when leaving speaking
      try {
        v.pause()
        v.currentTime = 0
      } catch (e) {
        // ignore
      }
    }
  }, [state])

  return (
    <div className={className} aria-live="polite">
      {state === 'idle' && (
        // Use an img tag so the supplied asset is shown exactly
        <img src="/idle.png" alt="Atlas idle" />
      )}
      {state === 'listening' && <img src="/listening.png" alt="Atlas listening" />}
      {state === 'thinking' && <img src="/thinking.png" alt="Atlas thinking" />}
      {state === 'speaking' && (
        <video
          ref={videoRef}
          src="/speaking.mp4"
          playsInline
          muted
          autoPlay
          loop
          aria-label="Atlas speaking animation"
        />
      )}
    </div>
  )
}

export default Atlas
