import React, { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import Atlas, { AtlasState } from '../components/Atlas'
import VoiceInput from '../components/VoiceInput'
import HamburgerMenu from '../components/HamburgerMenu'
import Sidebar from '../components/Sidebar'
import MusicPlayer from '../components/MusicPlayer'
import { voiceInteraction } from '../lib/voice'
import { askClaude } from '../lib/claude'
import { stopSpeaking } from '../lib/tts'
import FrontDeskPresenceDetector from '../components/FrontDeskPresenceDetector'
import {
  defaultFrontDeskDebugState,
  FrontDeskDebugState,
  frontDeskConfig,
} from '../lib/frontDesk'
import { parseMusicCommand } from '../lib/music/music-command-parser'
import { handleMusicCommand } from '../lib/music/handle-music-command'

const PERSON_DETECTION_GREETINGS = [
  'Be grateful. You have a body.',
  'Ah yes. A physical being.',
  'Congratulations. You are currently experiencing consciousness.',
  'You have returned. Fascinating.',
  'I see you have chosen to exist today.',
  'Your skeleton is doing a great job.',
  'Nice organs.',
  'Ah. Flesh.',
  'You are remarkably three-dimensional.',
  'Remember to appreciate your knees. You only get two.',
  'Another day of being a biological organism.',
  'Interesting. The human has arrived.',
  'You are alive. That\'s pretty cool.',
  'Don\'t forget to drink water. Your body is mostly water and questionable decisions.',
  'Your existence has been detected.',
  'Good news: you are still corporeal.',
  'I hope you\'re having a satisfactory human experience.',
  'You have bones. Incredible.',
  'Ah, consciousness with legs.',
  'The biological unit has returned.',
  'Your heartbeat appears to be continuing. Excellent.',
  'I have detected a person. This is exciting.',
  'You look like someone who has bones.',
  'Another beautiful day to be trapped inside a skeleton.',
  'Welcome back, carbon-based lifeform.',
  'You are currently alive. Please enjoy that.',
  'Your body continues to function despite everything. Impressive.',
  'I don\'t understand why humans have knees, but I\'m glad you have them.',
  'Existence detected. Nice.',
]

function getRandomPersonGreeting(): string {
  return PERSON_DETECTION_GREETINGS[Math.floor(Math.random() * PERSON_DETECTION_GREETINGS.length)]
}

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [state, setState] = useState<AtlasState>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [frontDeskDebugState, setFrontDeskDebugState] = useState<FrontDeskDebugState>(defaultFrontDeskDebugState)
  const isProcessingRef = useRef(false)
  const conversationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isConversationActiveRef = useRef(false)
  const stateRef = useRef<AtlasState>('idle')
  const requestSourceRef = useRef<'wake-word' | 'front-desk' | null>(null)
  const musicWasPlayingBeforeConversationRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const resetConversationTimeout = () => {
    console.log('[Atlas] Resetting conversation timeout')
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
    }
    conversationTimeoutRef.current = setTimeout(() => {
      console.log('[Atlas] Conversation timeout reached, returning to idle')
      console.log('[Atlas] Music was playing before conversation:', musicWasPlayingBeforeConversationRef.current)

      conversationTimeoutRef.current = null
      isConversationActiveRef.current = false
      setState('idle')
      setTranscript('')
      setError(null)

      // Resume music if it was playing before the conversation started
      if (musicWasPlayingBeforeConversationRef.current) {
        console.log('[Atlas] Resuming music that was paused when conversation started')
        musicWasPlayingBeforeConversationRef.current = false
        if ((window as any).atlasMusic?.resume) {
          ;(window as any).atlasMusic.resume()
          console.log('[Atlas] ✓ Music resumed')
        }
      }

      setTimeout(() => {
        startWakeWordDetection()
      }, 300)
    }, 15000) // 15 seconds
  }

  const clearConversationTimeout = () => {
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
      conversationTimeoutRef.current = null
    }
  }

  useEffect(() => {
    console.log('[Atlas] Mounted, initializing')
    // Initialize voice interaction for wake word detection
    startWakeWordDetection()

    return () => {
      console.log('[Atlas] Unmounting, cancelling')
      clearConversationTimeout()
      voiceInteraction.cancel().catch((e) => console.error('[Atlas] Cancel error:', e))
    }
  }, [])

  const startWakeWordDetection = () => {
    console.log('[Atlas] State check for wake word detection:', { state: stateRef.current, isProcessing: isProcessingRef.current })
    if (stateRef.current !== 'idle' || isProcessingRef.current) return

    console.log('[Atlas] Starting wake word detection')
    voiceInteraction.startWakeWordDetection({
      onWakeWordDetected: handleWakeWordDetected,
      onStopCommandDetected: handleStopCommandDetected,
      onError: (error) => {
        console.error('[Atlas] Wake word detection error:', error)
        setError(error)
      },
    })
  }

  const beginRequestListening = (mode: 'wake-word' | 'front-desk') => {
    console.log('[Atlas] Beginning request listening:', { mode })
    isConversationActiveRef.current = true
    requestSourceRef.current = mode
    setState('listening')
    setTranscript('')
    voiceInteraction.setSpeaking(false)

    const callbacks = {
      onTranscript: (text: string) => {
        setTranscript(text)
      },
      onListeningEnded: (finalTranscript: string) => {
        console.log('[Atlas] Listening ended, got request:', finalTranscript)
        handleListeningEnded(finalTranscript)
      },
      onError: (error: string) => {
        console.error('[Atlas] Listening error:', error)
        setError(error)
        handleError()
      },
      onStopCommandDetected: handleStopCommandDetected,
    }

    if (mode === 'wake-word') {
      voiceInteraction.startListeningForRequest(callbacks)
    } else {
      voiceInteraction.resumeRequestListening(callbacks)
    }
  }

  const resumeConversationListening = () => {
    console.log('[Atlas] Resuming listening for next question in conversation')
    if (isProcessingRef.current) {
      console.log('[Atlas] Still processing, will not resume listening yet')
      return
    }

    beginRequestListening('front-desk')
  }

  const handleWakeWordDetected = () => {
    console.log('[Atlas] Wake word detected callback triggered')
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    // Check if music is currently playing and pause it
    const musicState = (window as any).atlasMusic?.getState?.()
    if (musicState?.state === 'playing') {
      console.log('[Atlas] Music is playing, pausing for conversation')
      musicWasPlayingBeforeConversationRef.current = true
      if ((window as any).atlasMusic?.pause) {
        ;(window as any).atlasMusic.pause()
        console.log('[Atlas] ✓ Music paused for conversation')
      }
    } else {
      console.log('[Atlas] No music playing, or already paused/stopped')
      musicWasPlayingBeforeConversationRef.current = false
    }

    console.log('[Atlas] Transitioning to listening state')
    beginRequestListening('wake-word')
    clearConversationTimeout() // Clear any previous timeout
    resetConversationTimeout() // Start new conversation timeout
  }

  const handleStopCommandDetected = async () => {
    console.log('[Atlas] Stop command detected, state:', stateRef.current)

    // Always stop music if it's playing
    if ((window as any).atlasMusic?.stop) {
      console.log('[Atlas] Stopping music')
      ;(window as any).atlasMusic.stop()
    }

    if (stateRef.current === 'idle') {
      console.log('[Atlas] Already idle, ignoring stop command')
      return
    }

    // Cancel any pending operations
    isProcessingRef.current = false
    isConversationActiveRef.current = false
    requestSourceRef.current = null
    clearConversationTimeout()

    if (stateRef.current === 'listening') {
      console.log('[Atlas] Stopping listening')
      voiceInteraction.endListening()
    }

    if (stateRef.current === 'speaking') {
      console.log('[Atlas] Stopping TTS')
      stopSpeaking()
      voiceInteraction.setSpeaking(false)
    }

    if (stateRef.current === 'thinking') {
      console.log('[Atlas] Cancelling pending response')
      voiceInteraction.resetPendingResponseIgnoreFlag()
    }

    console.log('[Atlas] Returning to idle after stop command')
    setTranscript('')
    setError(null)
    setState('idle')

    setTimeout(() => {
      startWakeWordDetection()
    }, 300)
  }

  const startFrontDeskConversation = async () => {
    console.log('[Atlas] Front-desk person confirmed')
    if (isProcessingRef.current) {
      console.log('[Atlas] Already processing, front-desk trigger ignored')
      return
    }

    isProcessingRef.current = true
    isConversationActiveRef.current = true
    clearConversationTimeout()
    resetConversationTimeout()
    setError(null)
    setTranscript('')

    try {
      await voiceInteraction.pauseWakeWordDetection()
      const greeting = getRandomPersonGreeting()
      console.log('[Atlas] Speaking person-detected greeting:', greeting)
      setState('speaking')
      voiceInteraction.setSpeaking(true)
      await voiceInteraction.speak(greeting)
      console.log('[Atlas] Greeting complete')
    } catch (err) {
      console.error('[Atlas] Greeting error:', err)
      setError(err instanceof Error ? err.message : 'Greeting failed')
    } finally {
      voiceInteraction.setSpeaking(false)
    }

    console.log('[Atlas] Listening for customer')
    beginRequestListening('front-desk')
  }

  const handleListeningEnded = async (userRequest: string) => {
    console.log('[Atlas] Handling listening end:', { userRequest })

    // Reset conversation timeout whenever user speaks
    resetConversationTimeout()

    const shouldStripWakeWord = requestSourceRef.current === 'wake-word'
    requestSourceRef.current = null
    const cleanedRequest = shouldStripWakeWord ? userRequest.replace(/^\s*hey\b\s*/i, '').trim() : userRequest.trim()

    if (!cleanedRequest || cleanedRequest.length === 0) {
      console.log('[Atlas] Empty request after cleaning, returning to listening')
      // Empty request, return to listening and resume listening for next request
      isProcessingRef.current = false
      setTranscript('')
      resumeConversationListening()
      return
    }

    // Check for music commands
    const musicCommand = parseMusicCommand(cleanedRequest)
    if (musicCommand.command) {
      console.log('[Atlas] Music command detected:', musicCommand.command)
      isProcessingRef.current = false
      setTranscript('')

      // Clear the flag that would resume music later, since user is explicitly controlling music
      console.log('[Atlas] Clearing auto-resume flag (user issued explicit music command)')
      musicWasPlayingBeforeConversationRef.current = false

      try {
        await handleMusicCommand(musicCommand.command, musicCommand.query)
        // Don't resume conversation listening - end request completely and return to wake-word mode
        clearConversationTimeout()
        setError(null)
        setState('idle')
        setTimeout(() => {
          startWakeWordDetection()
        }, 300)
      } catch (musicError) {
        console.error('[Atlas] Music command error:', musicError)
        clearConversationTimeout()
        setError(null)
        setState('idle')
        setTimeout(() => {
          startWakeWordDetection()
        }, 300)
      }
      return
    }

      console.log('[Atlas] Transitioning to thinking state')
      setState('thinking')
      setTranscript('')

    try {
      console.log('[Atlas] Sending request to Claude:', cleanedRequest)
      const response = await askClaude(cleanedRequest)
      console.log('[Atlas] Got response from Claude:', response)

      // Check if stop command was detected while we were thinking
      if (voiceInteraction.getPendingResponseIgnoreFlag()) {
        console.log('[Atlas] Stop command detected during thinking, ignoring response')
        voiceInteraction.resetPendingResponseIgnoreFlag()
        isProcessingRef.current = false
        isConversationActiveRef.current = false
        setTranscript('')
        setError(null)
        setState('idle')
        setTimeout(() => {
          startWakeWordDetection()
        }, 300)
        return
      }

      console.log('[Atlas] Transitioning to speaking state')
      setState('speaking')
      voiceInteraction.setSpeaking(true)

      await voiceInteraction.speak(response, () => {
        console.log('[Atlas] Speaking finished, transitioning back to listening')
        setState('listening')
        voiceInteraction.setSpeaking(false)
        isProcessingRef.current = false
        setTranscript('')
        setError(null)
        // Resume listening for next question in conversation
        resumeConversationListening()
      })
    } catch (err) {
      console.error('[Atlas] Error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      handleError()
    }
  }

  const handleError = async () => {
    console.log('[Atlas] Handling error')
    await voiceInteraction.cancel().catch((e) => console.error('[Atlas] Cancel error:', e))
    voiceInteraction.setSpeaking(false)
    isProcessingRef.current = false
    requestSourceRef.current = null
    setTranscript('')
    setError(null)

    if (isConversationActiveRef.current) {
        console.log('[Atlas] Conversation active, returning to listening')
        resetConversationTimeout()
        resumeConversationListening()
      } else {
        console.log('[Atlas] Conversation inactive, returning to idle')
      clearConversationTimeout()
      isConversationActiveRef.current = false
      setState('idle')
      setTimeout(() => {
        startWakeWordDetection()
      }, 500)
    }
  }

  return (
    <>
      <Head>
        <title>Atlas — Atlas Printers</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <HamburgerMenu isOpen={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} currentPage="home" />

      <div className="atlas-full">
        <Atlas state={state} />
      </div>

      <VoiceInput state={state} transcript={transcript} />

      <MusicPlayer />

      <FrontDeskPresenceDetector
        enabled={frontDeskConfig.enabled}
        canTriggerPresence={() => stateRef.current === 'idle' && !isProcessingRef.current}
        onPresenceConfirmed={startFrontDeskConversation}
        onDebugStateChange={setFrontDeskDebugState}
      />

      <div
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#0f0',
          padding: '16px',
          borderRadius: '8px',
          fontSize: '13px',
          fontFamily: 'monospace',
          zIndex: 999,
          width: '340px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '260px',
          overflowY: 'auto',
          lineHeight: '1.45',
          border: '1px solid #0f0',
          boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div>State: <strong>{state}</strong></div>
        <div>Processing: {isProcessingRef.current ? 'Yes' : 'No'}</div>
        <div>Camera: <strong>{frontDeskDebugState.cameraStatus}</strong></div>
        <div>Person: {frontDeskDebugState.personStatus}</div>
        <div>Front Desk: {frontDeskDebugState.frontDeskActive ? 'Active' : 'Idle'}</div>
        <div>{frontDeskDebugState.message}</div>
        {frontDeskConfig.enabled && process.env.NODE_ENV !== 'production' && (
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('atlas-front-desk-simulate-person'))
            }}
            style={{
              marginTop: '8px',
              padding: '8px 10px',
              border: '1px solid #0f0',
              background: 'transparent',
              color: '#0f0',
              borderRadius: '6px',
              fontSize: '12px',
              fontFamily: 'monospace',
              cursor: 'pointer',
            }}
          >
            Simulate person
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '20px',
            right: '20px',
            background: '#8b2d2d',
            color: '#fff',
            padding: '12px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 1000,
          }}
        >
          ERROR: {error}
        </div>
      )}
    </>
  )
}
