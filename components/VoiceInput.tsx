import React, { useEffect, useState, useRef } from 'react'
import { AtlasState } from './Atlas'

interface VoiceInputProps {
  state: AtlasState
  transcript: string
}

export const VoiceInput: React.FC<VoiceInputProps> = ({ state, transcript }) => {
  const [displayTranscript, setDisplayTranscript] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [barHeights, setBarHeights] = useState([40, 30, 50, 35, 45, 38, 42, 40])
  const animationRef = useRef<number | null>(null)
  const lastTranscriptRef = useRef('')

  useEffect(() => {
    if (state === 'listening' && transcript) {
      const cleanTranscript = transcript.replace(/^\s*hey\s+atlas\s*/i, '').trim()
      setDisplayTranscript(cleanTranscript)
      lastTranscriptRef.current = cleanTranscript
    } else if (state === 'idle') {
      setDisplayTranscript('')
      lastTranscriptRef.current = ''
    }
  }, [state, transcript])

  useEffect(() => {
    setIsActive(state === 'listening')
  }, [state])

  useEffect(() => {
    if (!isActive) {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      return
    }

    const animate = () => {
      setBarHeights((prev) =>
        prev.map(() => {
          const base = 20
          const variation = Math.random() * 50
          return base + variation
        })
      )
      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isActive])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: '500px',
        zIndex: 100,
      }}
    >
      {/* Transcription Text Area */}
      {(state === 'listening' || (state === 'thinking' && displayTranscript)) && (
        <div
          style={{
            background: 'rgba(15, 23, 32, 0.95)',
            border: '1px solid rgba(0, 168, 243, 0.3)',
            borderRadius: '8px',
            padding: '14px 16px',
            marginBottom: '12px',
            color: '#e6eef6',
            fontSize: '14px',
            lineHeight: '1.5',
            minHeight: '44px',
            display: 'flex',
            alignItems: 'center',
            maxHeight: '100px',
            overflowY: 'auto',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span
            style={{
              color: displayTranscript ? '#e6eef6' : 'rgba(230, 238, 246, 0.5)',
              fontStyle: displayTranscript ? 'normal' : 'italic',
            }}
          >
            {displayTranscript || 'Listening...'}
          </span>
        </div>
      )}

      {/* Voice Activity Bar */}
      {state === 'listening' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap: '4px',
            height: '40px',
            padding: '0 8px',
            background: 'rgba(0, 168, 243, 0.08)',
            border: '1px solid rgba(0, 168, 243, 0.2)',
            borderRadius: '6px',
            backdropFilter: 'blur(2px)',
          }}
        >
          {barHeights.map((height, i) => (
            <div
              key={i}
              style={{
                width: '4px',
                height: `${height}px`,
                background: 'linear-gradient(180deg, #00a8f3 0%, #0077cc 100%)',
                borderRadius: '2px',
                opacity: 0.9,
                transition: 'height 100ms ease-out',
                boxShadow: '0 0 8px rgba(0, 168, 243, 0.4)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default VoiceInput
