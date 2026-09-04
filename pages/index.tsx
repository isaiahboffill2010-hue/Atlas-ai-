import React, { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Atlas, { AtlasState } from '../components/Atlas'
import VoiceInput from '../components/VoiceInput'
import HamburgerMenu from '../components/HamburgerMenu'
import Sidebar from '../components/Sidebar'
import MusicPlayer from '../components/MusicPlayer'
import { voiceInteraction } from '../lib/voice'
import { askAtlas } from '../lib/atlas'
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
  'Hi! Welcome! How can I help you today?',
  'Hello! Welcome in. How can I help you?',
  'Hi there! Welcome. What can I help you with today?',
  'Hey! Welcome in. How can I assist you?',
  'Hello! It\'s nice to see you. How can I help?',
  'Hi! Welcome. What brings you in today?',
  'Hello! Welcome in. What can I do for you?',
  'Hi there! How can I help you today?',
  'Welcome! How can I assist you?',
  'Hi! Glad to have you here. How can I help?',
  'Hello! Welcome. What can I help you with?',
  'Hi there! Welcome in. What brings you by?',
  'Welcome in! How can I help you today?',
  'Hello! How can I make your visit easier today?',
  'Hi! Welcome. What can I help you take care of today?',
  'Good morning! Welcome in. How can I help?',
  'Good afternoon! Welcome. How can I assist you?',
  'Good evening! Welcome in. How can I help you?',
  'Hi! Welcome in. Is there something I can help you with?',
  'Hello! Thanks for stopping by. How can I help?',
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
  const isFrontDeskConversationRef = useRef(false)
  const stateRef = useRef<AtlasState>('idle')
  const requestSourceRef = useRef<'wake-word' | 'front-desk' | null>(null)
  const musicWasPlayingBeforeConversationRef = useRef(false)
  const personStatusRef = useRef<string>('unknown')

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const endConversationSession = () => {
    console.log('==================== VOICE ====================')
    console.log('[VOICE] STOP LISTENING')
    console.log('[VOICE] Reason: endConversationSession() called')
    console.log('[VOICE] Person status: ' + frontDeskDebugState.personStatus)
    console.log('[VOICE] Current state: ' + stateRef.current)
    console.log('==============================================')

    console.log('[Atlas] Ending conversation session')

    // CRITICAL: Stop listening and microphone
    voiceInteraction.endListening()
    voiceInteraction.cancel().catch(() => {})

    conversationTimeoutRef.current = null
    isConversationActiveRef.current = false
    isFrontDeskConversationRef.current = false
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
  }

  const resetConversationTimeout = () => {
    console.log('[Atlas] Resetting conversation timeout (front-desk mode: no timeout)')
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
    }
    // No timeout set for front-desk conversations - they end when person is cleared
  }

  const clearConversationTimeout = () => {
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
      conversationTimeoutRef.current = null
    }
  }

  // CRITICAL FIX: Memoize callbacks to prevent detection loop restarts
  const canTriggerPresence = useCallback(() => {
    return stateRef.current === 'idle' && !isProcessingRef.current
  }, [])

  // Memoize onPresenceConfirmed to keep reference stable
  const memoizedStartFrontDeskConversation = useCallback(() => {
    return startFrontDeskConversation()
  }, [])

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

  useEffect(() => {
    // Keep personStatusRef in sync (for use in callbacks that might have stale closure)
    personStatusRef.current = frontDeskDebugState.personStatus

    // CRITICAL: When person is cleared, ALWAYS stop listening - no conditions
    if (frontDeskDebugState.personStatus === 'clear') {
      console.log('==================== PERSON CLEARED - FORCE STOP ====================')
      console.log('[FRONT DESK] Person is now CLEAR')
      console.log('[FRONT DESK] FORCE STOPPING ALL LISTENING')
      console.log('===================================================================')

      // CRITICAL: Stop listening immediately - unconditional, multiple times to be sure
      try {
        console.log('[VOICE] >>> endListening()')
        voiceInteraction.endListening()
      } catch (e) {
        console.log('[VOICE] endListening error (continuing):', e)
      }

      try {
        console.log('[VOICE] >>> cancel()')
        voiceInteraction.cancel()
      } catch (e) {
        console.log('[VOICE] cancel error (continuing):', e)
      }

      // Force state to idle
      console.log('[VOICE] >>> setState(idle)')
      setState('idle')
      console.log('[VOICE] >>> isConversationActiveRef = false')
      isConversationActiveRef.current = false
      console.log('[VOICE] >>> isFrontDeskConversationRef = false')
      isFrontDeskConversationRef.current = false
      console.log('[VOICE] Listening STOPPED (forced)')
    }
  }, [frontDeskDebugState.personStatus])

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
    console.log('==================== VOICE ====================')
    console.log('[VOICE] START LISTENING')
    console.log('[VOICE] Reason: beginRequestListening(mode=' + mode + ')')
    console.log('[VOICE] Person status: ' + frontDeskDebugState.personStatus)
    console.log('[VOICE] Is front-desk conversation: ' + isFrontDeskConversationRef.current)
    console.log('==============================================')

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
    console.log('[VOICE] Person status (from ref): ' + personStatusRef.current)

    if (isProcessingRef.current) {
      console.log('[Atlas] Still processing, will not resume listening yet')
      return
    }

    // CRITICAL: DO NOT resume listening if person is not detected
    // Use personStatusRef to avoid stale closure
    if (personStatusRef.current !== 'detected') {
      console.log('==================== LISTENING BLOCKED ====================')
      console.log('[VOICE] Person is NOT detected - CANNOT resume listening')
      console.log('[VOICE] Person status: ' + personStatusRef.current)
      console.log('[VOICE] Stopping everything')
      console.log('============================================================')

      // Stop all listening and end session
      voiceInteraction.endListening()
      voiceInteraction.cancel().catch(() => {})

      isConversationActiveRef.current = false
      isFrontDeskConversationRef.current = false
      setState('idle')
      return
    }

    console.log('[VOICE] Person IS detected - resuming listening')
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
    console.log('==================== PERSON DETECTED - START ====================')
    console.log('[FRONT DESK] Person DETECTED - Starting conversation')
    console.log('[FRONT DESK] Person status: ' + frontDeskDebugState.personStatus)
    console.log('================================================================')

    console.log('[Atlas] Front-desk person confirmed')
    if (isProcessingRef.current) {
      console.log('[Atlas] Already processing, front-desk trigger ignored')
      return
    }

    isProcessingRef.current = true
    isConversationActiveRef.current = true
    isFrontDeskConversationRef.current = true
    clearConversationTimeout()
    resetConversationTimeout()
    setError(null)
    setTranscript('')

    try {
      console.log('[FRONT DESK] Greeting START')
      await voiceInteraction.pauseWakeWordDetection()
      const greeting = getRandomPersonGreeting()
      console.log('[Atlas] Speaking person-detected greeting:', greeting)
      setState('speaking')
      voiceInteraction.setSpeaking(true)
      await voiceInteraction.speak(greeting)
      console.log('[FRONT DESK] Greeting END')
      console.log('[Atlas] Greeting complete')
    } catch (err) {
      console.error('[Atlas] Greeting error:', err)
      setError(err instanceof Error ? err.message : 'Greeting failed')
    } finally {
      voiceInteraction.setSpeaking(false)
    }

    console.log('[VOICE] >>> Starting listening for customer input')
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
        console.log('[Atlas] Music command executed, returning to wake-word mode')

        // Give React time to render the music player card before transitioning state
        // This ensures the card appears reliably when a song starts
        // Increased to 500ms to ensure subscription and state updates fully complete
        setTimeout(() => {
          clearConversationTimeout()
          setError(null)
          setState('idle')
          setTimeout(() => {
            startWakeWordDetection()
          }, 300)
        }, 500)
      } catch (musicError) {
        console.error('[Atlas] Music command error:', musicError)
        setTimeout(() => {
          clearConversationTimeout()
          setError(null)
          setState('idle')
          setTimeout(() => {
            startWakeWordDetection()
          }, 300)
        }, 100)
      }
      return
    }

      console.log('[Atlas] Transitioning to thinking state')
      setState('thinking')
      setTranscript('')

    try {
      console.log('[ATLAS MAIN] Sending request to Atlas:', cleanedRequest)
      const response = await askAtlas(cleanedRequest)
      console.log('[ATLAS MAIN] askAtlas returned successfully')
      console.log('[ATLAS MAIN] Got response from Atlas:', response)
      console.log('[ATLAS MAIN] Response type:', typeof response)
      console.log('[ATLAS MAIN] Response length:', response?.length || 0)
      console.log('[ATLAS MAIN] Response is empty?', !response || response.trim().length === 0)

      // Check if stop command was detected while we were thinking
      console.log('[ATLAS MAIN] Checking stop command flag')
      if (voiceInteraction.getPendingResponseIgnoreFlag()) {
        console.log('[ATLAS MAIN] EARLY RETURN: Stop command detected during thinking')
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

      console.log('[ATLAS MAIN] Stop command flag not set, proceeding to speak')
      console.log('[ATLAS MAIN] Setting state to speaking')
      setState('speaking')
      voiceInteraction.setSpeaking(true)

      console.log('[ATLAS MAIN] About to call voiceInteraction.speak()')
      console.log('[ATLAS MAIN] Text to speak:', response.substring(0, 100))
      await voiceInteraction.speak(response, () => {
        console.log('[ATLAS MAIN] Speaking finished, transitioning back to listening')
        console.log('[TIMELINE] speak-callback | personStatus=' + frontDeskDebugState.personStatus + ' isFrontDesk=' + isFrontDeskConversationRef.current)
        setState('listening')
        voiceInteraction.setSpeaking(false)
        isProcessingRef.current = false
        setTranscript('')
        setError(null)
        // Resume listening for next question in conversation
        console.log('[TIMELINE] about to call resumeConversationListening')
        resumeConversationListening()
      })
      console.log('[ATLAS MAIN] voiceInteraction.speak() completed successfully')
    } catch (err) {
      console.error('[ATLAS MAIN] EXCEPTION caught:', err)
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
        canTriggerPresence={canTriggerPresence}
        onPresenceConfirmed={memoizedStartFrontDeskConversation}
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
