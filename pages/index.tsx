import React, { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import Atlas, { AtlasState } from '../components/Atlas'
import VoiceInput from '../components/VoiceInput'
import HamburgerMenu from '../components/HamburgerMenu'
import Sidebar from '../components/Sidebar'
import { voiceInteraction } from '../lib/voice'
import { askClaude } from '../lib/claude'

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [state, setState] = useState<AtlasState>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isProcessingRef = useRef(false)
  const conversationTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isConversationActiveRef = useRef(false)

  const resetConversationTimeout = () => {
    console.log('[Atlas] Resetting conversation timeout')
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current)
    }
    conversationTimeoutRef.current = setTimeout(() => {
      console.log('[Atlas] Conversation timeout reached, returning to idle')
      conversationTimeoutRef.current = null
      isConversationActiveRef.current = false
      setState('idle')
      setTranscript('')
      startWakeWordDetection()
    }, 60000) // 60 seconds
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
    console.log('[Atlas] State check for wake word detection:', { state, isProcessing: isProcessingRef.current })
    if (state !== 'idle' || isProcessingRef.current) return

    console.log('[Atlas] Starting wake word detection')
    voiceInteraction.startWakeWordDetection({
      onWakeWordDetected: handleWakeWordDetected,
      onError: (error) => {
        console.error('[Atlas] Wake word detection error:', error)
        setError(error)
      },
    })
  }

  const resumeConversationListening = () => {
    console.log('[Atlas] Resuming listening for next question in conversation')
    if (isProcessingRef.current) {
      console.log('[Atlas] Still processing, will not resume listening yet')
      return
    }

    isConversationActiveRef.current = true
    setState('listening')
    setTranscript('')
    voiceInteraction.setSpeaking(false)

    voiceInteraction.resumeRequestListening({
      onTranscript: (text) => {
        setTranscript(text)
      },
      onListeningEnded: (finalTranscript) => {
        console.log('[Atlas] Listening ended, got request:', finalTranscript)
        handleListeningEnded(finalTranscript)
      },
      onError: (error) => {
        console.error('[Atlas] Listening error:', error)
        setError(error)
        handleError()
      },
    })
  }

  const handleWakeWordDetected = () => {
    console.log('[Atlas] Wake word detected callback triggered')
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    console.log('[Atlas] Transitioning to listening state')
    isConversationActiveRef.current = true
    setState('listening')
    voiceInteraction.setSpeaking(false)
    clearConversationTimeout() // Clear any previous timeout
    resetConversationTimeout() // Start new conversation timeout

    voiceInteraction.startListeningForRequest({
      onTranscript: (text) => {
        setTranscript(text)
      },
      onListeningEnded: (finalTranscript) => {
        console.log('[Atlas] Listening ended, got request:', finalTranscript)
        handleListeningEnded(finalTranscript)
      },
      onError: (error) => {
        console.error('[Atlas] Listening error:', error)
        setError(error)
        handleError()
      },
    })
  }

  const handleListeningEnded = async (userRequest: string) => {
    console.log('[Atlas] Handling listening end:', { userRequest })

    // Reset conversation timeout whenever user speaks
    resetConversationTimeout()

    // Strip the "hey atlas" wake word from the transcript
    const cleanedRequest = userRequest.replace(/^\s*hey\s+atlas\s*/i, '').trim()

    if (!cleanedRequest || cleanedRequest.length === 0) {
      console.log('[Atlas] Empty request after cleaning, returning to listening')
      // Empty request, return to listening and resume listening for next request
      isProcessingRef.current = false
      setTranscript('')
      resumeConversationListening()
      return
    }

    console.log('[Atlas] Transitioning to thinking state')
    setState('thinking')
    setTranscript('')

    try {
      console.log('[Atlas] Sending request to Claude:', cleanedRequest)
      const response = await askClaude(cleanedRequest)
      console.log('[Atlas] Got response from Claude:', response)

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

      <div
        style={{
          position: 'fixed',
          top: '12px',
          right: '12px',
          background: 'rgba(0, 0, 0, 0.85)',
          color: '#0f0',
          padding: '12px',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'monospace',
          zIndex: 999,
          maxWidth: '250px',
          maxHeight: '120px',
          overflowY: 'auto',
          lineHeight: '1.3',
          border: '1px solid #0f0',
        }}
      >
        <div>State: <strong>{state}</strong></div>
        <div>Processing: {isProcessingRef.current ? 'Yes' : 'No'}</div>
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
