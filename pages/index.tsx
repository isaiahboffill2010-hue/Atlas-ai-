import React, { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Atlas, { AtlasState } from '../components/Atlas'
import VoiceInput from '../components/VoiceInput'
import HamburgerMenu from '../components/HamburgerMenu'
import Sidebar from '../components/Sidebar'
import MusicPlayer from '../components/MusicPlayer'
import { voiceInteraction } from '../lib/voice'
import { askAtlas } from '../lib/atlas'
import { askAtlasStreaming } from '../lib/atlas-stream'
import { SentenceChunker } from '../lib/text-chunker'
import { StreamingSpeech } from '../lib/streaming-player'
import { LatencyTracker, MARKS } from '../lib/latency'
import { STREAMING_TTS_ENABLED } from '../lib/voice-config'
import { defaultThinkingVariant } from '../lib/gemini-thinking'
import { stripMarkdownForSpeech } from '../lib/tts-text'
import FrontDeskPresenceDetector from '../components/FrontDeskPresenceDetector'
import {
  defaultFrontDeskDebugState,
  FrontDeskDebugState,
  frontDeskConfig,
} from '../lib/frontDesk'
import { parseMusicCommand } from '../lib/music/music-command-parser'
import { handleMusicCommand } from '../lib/music/handle-music-command'
import DesignRequestWatcher from '../components/DesignRequestWatcher'
import type { DesignRequestRecord } from '../lib/design-requests/types'

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

/**
 * Everything cancellable about the turn Atlas is currently answering: the
 * Gemini stream, the ElevenLabs requests, and the audio queue.
 */
interface ActiveTurn {
  token: object
  abort: AbortController
  speech: StreamingSpeech
  tracker: LatencyTracker
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
  const activeTurnRef = useRef<ActiveTurn | null>(null)

  /**
   * Tear down the in-flight response: stop audio, abort queued and in-flight
   * ElevenLabs requests, and abort the Gemini stream (which the server sees as
   * a disconnect and stops generating for).
   */
  const abortActiveTurn = (reason: string) => {
    const turn = activeTurnRef.current
    if (!turn) return

    console.log(`[ATLAS STREAM] Aborting active turn — ${reason}`)
    activeTurnRef.current = null

    try {
      turn.speech.cancel()
    } catch (e) {
      console.error('[ATLAS STREAM] Error cancelling speech:', e)
    }

    try {
      turn.abort.abort()
    } catch (e) {
      console.error('[ATLAS STREAM] Error aborting Gemini stream:', e)
    }

    turn.tracker.mark('turn-aborted', reason)
  }

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
    abortActiveTurn('conversation session ended')
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

  /**
   * A customer finished the form on their phone. Atlas acknowledges it out
   * loud, but only from a standing start: if Atlas is listening, thinking or
   * mid-answer, the arrival is logged and shown on screen instead, because
   * cutting into a live turn would be worse than staying quiet. The design
   * itself is generated in a later phase.
   */
  const handleDesignRequestReceived = useCallback(async (request: DesignRequestRecord) => {
    console.log('[Atlas] Customer information arrived from /session:', {
      designType: request.design_type,
      businessName: request.business_name,
      hasLogo: !!request.logo_file_reference,
      hasCustomerQr: !!request.customer_qr_file_reference,
    })

    if (stateRef.current !== 'idle' || isProcessingRef.current) {
      console.log('[Atlas] Busy, not announcing the design request out loud')
      return
    }

    isProcessingRef.current = true

    try {
      await voiceInteraction.pauseWakeWordDetection()
      setState('speaking')
      voiceInteraction.setSpeaking(true)
      await voiceInteraction.speak(
        `Got it! I have your information for ${request.business_name}. Let's create your design.`
      )
    } catch (err) {
      console.error('[Atlas] Failed to announce design request:', err)
    } finally {
      voiceInteraction.setSpeaking(false)
      isProcessingRef.current = false
      setState('idle')
      setTimeout(() => {
        startWakeWordDetection()
      }, 300)
    }
  }, [])

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
        console.log('[VOICE] >>> abortActiveTurn()')
        abortActiveTurn('person cleared')
      } catch (e) {
        console.log('[VOICE] abortActiveTurn error (continuing):', e)
      }

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

    // Cancel any pending operations, including a response that is mid-flight
    abortActiveTurn('stop command')
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
      voiceInteraction.stopAllSpeech()
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

  /** Shared end-of-turn handling for both the streaming and buffered pipelines. */
  const finishTurn = () => {
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
  }

  /**
   * Streaming pipeline: Gemini text streams in, is cut into natural chunks, and
   * each chunk goes to ElevenLabs as soon as it exists. Atlas starts speaking
   * on the first chunk while Gemini is still writing the rest.
   *
   * Returns true if the turn was handled (spoken, or deliberately interrupted).
   * Returns false if it failed before any audio played, so the caller can fall
   * back to the original buffered pipeline.
   */
  const runStreamingTurn = async (request: string, tracker: LatencyTracker): Promise<boolean> => {
    const token = {}
    const abort = new AbortController()
    const chunker = new SentenceChunker()

    const speech = new StreamingSpeech(
      {
        onFirstAudioPlaying: () => {
          if (activeTurnRef.current?.token !== token) return
          console.log('[ATLAS STREAM] First audio playing — thinking -> speaking')
          setState('speaking')
          voiceInteraction.setSpeaking(true)
        },
        onChunkError: (error, text) => {
          console.error(`[ATLAS STREAM] Chunk failed ("${text.slice(0, 40)}"):`, error.message)
        },
      },
      tracker
    )

    activeTurnRef.current = { token, abort, speech, tracker }
    const isCurrent = () => activeTurnRef.current?.token === token

    let fullText = ''

    try {
      tracker.mark(MARKS.GEMINI_REQUEST_STARTED)

      fullText = await askAtlasStreaming(request, {
        signal: abort.signal,
        onFirstDelta: () => tracker.markOnce(MARKS.FIRST_GEMINI_TEXT),
        onDelta: (delta) => {
          if (!isCurrent()) return
          for (const chunk of chunker.push(delta)) {
            tracker.markOnce(MARKS.FIRST_CHUNK_READY, `"${chunk}"`)
            // Markdown is stripped on the way to TTS only; the stored and
            // logged response text stays exactly as Gemini wrote it.
            speech.enqueue(stripMarkdownForSpeech(chunk))
          }
        },
      })

      if (!isCurrent()) {
        console.log('[ATLAS STREAM] Turn was interrupted during generation')
        speech.cancel()
        return true
      }

      tracker.mark(MARKS.GEMINI_COMPLETE, `${fullText.length} chars`)

      const tail = chunker.flush()
      if (tail) {
        tracker.markOnce(MARKS.FIRST_CHUNK_READY, `"${tail}"`)
        speech.enqueue(stripMarkdownForSpeech(tail))
      }

      await speech.finish()
    } catch (error: any) {
      const played = speech.hasPlayedAudio
      speech.cancel()

      if (!isCurrent() || error?.name === 'AbortError') {
        console.log('[ATLAS STREAM] Turn aborted; leaving state handling to the interrupt path')
        return true
      }

      activeTurnRef.current = null

      if (!played) {
        console.warn('[ATLAS STREAM] Failed before any audio played:', error)
        return false
      }

      console.error('[ATLAS STREAM] Failed mid-speech, ending turn:', error)
      tracker.mark(MARKS.RESPONSE_COMPLETE, 'error after partial audio')
      tracker.summary()
      finishTurn()
      return true
    }

    if (!isCurrent()) {
      console.log('[ATLAS STREAM] Turn was interrupted during playback')
      return true
    }

    // Text came back but nothing was audible — synthesise it the old way rather
    // than leaving the customer in silence. No second Gemini call.
    if (!speech.hasPlayedAudio && fullText.trim().length > 0) {
      console.warn('[ATLAS STREAM] No audio played; falling back to buffered TTS for this response')
      setState('speaking')
      voiceInteraction.setSpeaking(true)
      await voiceInteraction.speak(stripMarkdownForSpeech(fullText))
    }

    activeTurnRef.current = null
    tracker.mark(MARKS.RESPONSE_COMPLETE, `${fullText.length} chars`)
    tracker.summary()
    finishTurn()
    return true
  }

  /** Original pipeline: full Gemini response, then full ElevenLabs file, then play. */
  const runBufferedTurn = async (request: string, tracker: LatencyTracker) => {
    console.log('[ATLAS MAIN] Sending request to Atlas:', request)
    tracker.mark(MARKS.GEMINI_REQUEST_STARTED, 'buffered')

    const response = await askAtlas(request)
    console.log('[ATLAS MAIN] askAtlas returned successfully')
    console.log('[ATLAS MAIN] Response length:', response?.length || 0)
    tracker.mark(MARKS.GEMINI_COMPLETE, `${response?.length || 0} chars`)

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
    setState('speaking')
    voiceInteraction.setSpeaking(true)

    console.log('[ATLAS MAIN] Text to speak:', response.substring(0, 100))
    tracker.mark(MARKS.FIRST_TTS_REQUEST_STARTED, 'buffered: whole response')

    await voiceInteraction.speak(
      stripMarkdownForSpeech(response),
      () => {
        tracker.mark(MARKS.RESPONSE_COMPLETE, `${response.length} chars`)
        tracker.summary()
        finishTurn()
      },
      () => {
        tracker.markOnce(MARKS.FIRST_AUDIO_RECEIVED, 'buffered: whole file')
        tracker.markOnce(MARKS.FIRST_AUDIO_PLAYED, 'buffered')
      }
    )
    console.log('[ATLAS MAIN] voiceInteraction.speak() completed successfully')
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

    // The turn clock starts the moment the customer stops talking, so every
    // mark reflects what they actually experience.
    // Labels every log line with the active thinking variant, so A/B runs in the
    // browser console are unambiguous: [LATENCY][baseline][turn-3] ...
    const tracker = new LatencyTracker('turn', defaultThinkingVariant())
    tracker.mark(MARKS.USER_STOPPED_SPEAKING, `"${cleanedRequest.slice(0, 60)}"`)

    try {
      if (STREAMING_TTS_ENABLED) {
        const handled = await runStreamingTurn(cleanedRequest, tracker)
        if (handled) return
        console.warn('[ATLAS MAIN] Streaming turn did not produce audio, using buffered pipeline')
      }

      await runBufferedTurn(cleanedRequest, tracker)
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

      <DesignRequestWatcher onRequestReceived={handleDesignRequestReceived} />

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
